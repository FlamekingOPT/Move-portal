/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Move Portal (Riverside -> Tippecanoe warehouse move). A separate app from the
 * picker portal; shares no code with it.
 * Spec: docs/superpowers/specs/2026-10-01-move-portal-verification-design.md
 */
define(['N/runtime', 'N/log', 'N/render', 'N/url', 'N/format',
        './move_core', './move_data', './move_tx', './move_label_template', './move_ui', './move_verify', './move_ns'],
function (runtime, log, render, url, format, core, data, tx, tpl, ui, verify, ns) {
    'use strict';

    const VP = verify.VP;
    const MANAGER_ROLE_SCRIPT_IDS = ['customrole_warehouse_manager', 'customrole1009', 'customrole2522', 'customrole_warehouse_portal_manager'];
    const PRINT_CHUNK_MAX = 80;
    const CFG_CHUNK_MAX = 100;
    const STALE_MS = 10 * 60 * 1000;   // above the Suitelet time limit, so a Retry can't take over a still-running request

    // ── shared helpers ───────────────────────────────────────────────────
    function userErr(msg) { const e = new Error(msg); e.user = true; return e; }

    function isManager() {
        const u = runtime.getCurrentUser();
        const role = String(u.roleId || '').toLowerCase();
        if (role === 'administrator' || Number(u.role) === 3 || MANAGER_ROLE_SCRIPT_IDS.indexOf(role) !== -1) return true;
        return data.employeeIsPortalManager(u.id);
    }

    function nowInfo() {
        const stamp = format.format({ value: new Date(), type: format.Type.DATETIMETZ, timezone: format.Timezone.AMERICA_LOS_ANGELES });
        const p = core.parseNsStamp(stamp);
        return { stamp: stamp, dayIso: p ? p.dayIso : new Date().toISOString().slice(0, 10), hour: p ? p.hour : 12 };
    }

    function settings() {
        const S = data.getSettings();
        if (!S.locFrom || !S.locTo) throw userErr('Move settings are missing locFrom/locTo. Ask an admin to fill in the Move Settings record.');
        return S;
    }

    function pubPallet(p, extra) {
        return Object.assign({ id: p.id, code: p.code, status: p.status, summary: p.summary, headline: core.headline(p.lines),
            pieces: p.pieces, edited: p.edited, damaged: p.damaged, lines: p.lines, loadId: p.loadId,
            printedAt: p.data.printedAt || '', receipt: p.receipt }, extra || {});
    }

    function mustPallet(id) { const p = data.getPallet(id); if (!p) throw userErr('Label not found'); return p; }
    function stale(Ld) { return Date.now() - (Number(Ld.data.workingAt) || 0) > STALE_MS; }

    // Flips the load to a working status under a fresh claim token, then re-reads it to confirm
    // no other request's write interleaved. Returns the fresh load and the claim to re-check later.
    function claimLoad(Ld, status, phase, mustBe, extraData) {
        const cur = data.getLoad(Ld.id);               // never merge over a stale copy: re-read, then guard, then claim
        if (!cur) throw userErr('Load not found');
        if (mustBe) mustBe(cur);
        Ld = cur;
        const claim = String(Date.now()) + Math.random().toString(36).slice(2, 8);
        data.updateLoad(Ld, { status: status, data: Object.assign({ workingAt: Date.now(), error: '', phase: phase, claim: claim }, extraData || {}) });
        const fresh = data.getLoad(Ld.id);
        if (fresh.data.claim !== claim) throw userErr((Ld.number || 'This truck') + ' is already being processed by someone else. Refresh in a minute.');
        return { Ld: fresh, claim: claim };
    }

    // Re-checked right before each transaction create, so a claim stolen mid-processing (not just
    // at the initial flip) still stops the create instead of racing another request's own create.
    function assertClaim(loadId, claim, number, phase) {
        const fresh = data.getLoad(loadId);
        if (!fresh || fresh.data.claim !== claim) throw userErr((number || 'This truck') + ' is already being processed by someone else. Refresh in a minute.');
    }

    // Client lines are only trusted for item, cfg and pcs; SKU and description come from NetSuite.
    function normalizeLines(lines, S) {
        const err = core.validateLines(lines);
        if (err) throw userErr(err);
        const info = data.itemInfo(lines.map(l => l.item));
        const cfg = data.configsByItem(S.activeBatch);
        return lines.map(l => {
            const i = info[String(l.item)];
            if (!i) throw userErr('Unknown item ' + (l.sku || l.item));
            const cs = cfg[String(l.item)] || [];
            return { item: String(l.item), sku: i.sku, desc: i.desc, cfg: cs.some(x => x.code === l.cfg) ? l.cfg : '', pcs: Math.floor(Number(l.pcs)) };
        });
    }

    function lineFields(lines, S) {
        return { summary: core.summarize(lines), pieces: core.totalPieces(lines),
            edited: core.isEdited(lines, core.pcsMap(data.configsByItem(S.activeBatch))) };
    }

    // Idempotent: creates only the labels still missing to reach `upTo` for this job.
    function createPalletsForJob(job, lines, upTo, source, c) {
        const target = Math.floor(Number(upTo)) || 0;
        const existing = data.countByJob(job);
        const n = target - existing;
        if (n > PRINT_CHUNK_MAX) throw userErr('Too many labels in one request (max ' + PRINT_CHUNK_MAX + ')');
        const f = lineFields(lines, c.S);
        for (let i = 0; i < n; i++) {
            data.createPallet(Object.assign({ status: VP.LABELED, job: job, printedDay: c.now.dayIso }, f,
                { lines: lines, data: { source: source, printedAt: c.now.stamp, printedBy: c.actor, printCount: 1 } }));
        }
        return Math.max(existing, target);
    }

    function stockModel(c) {
        const stock = data.locationStock(c.S.locFrom, null);
        const cfg = data.configsByItem(c.S.activeBatch);
        const onHand = {};
        Object.keys(stock).forEach(k => { onHand[k] = stock[k].onHand; });
        return { stock: stock, cfg: cfg, est: core.estimateRemaining(onHand, core.defaultPcs(cfg)) };
    }

    function tracker(c, est) {
        const moved = data.movedByDay();
        const todayDone = (moved[c.now.dayIso] || 0) > 0 && c.now.hour >= 15;
        return core.trackerMetrics({ todayIso: c.now.dayIso, targetIso: c.S.target, startIso: c.S.start, skipDates: c.S.skip || [],
            remaining: est.pallets, movedByDay: moved, todayDone: todayDone });
    }

    // ── actions ──────────────────────────────────────────────────────────
    // ── v3 trucks (spec 2026-10-01) ──────────────────────────────────────
    const T = verify.TRUCK;
    function writeMode(c) { return verify.normMode(c.S.writeMode); }
    function allTrucks() { return data.loadsByStatus(Object.values(T)).filter(x => x.data && x.data.v3); }
    function mustTruck(id) { const x = data.getLoad(id); if (!x || !x.data || !x.data.v3) throw userErr('Truck not found'); return x; }
    function truckLabel(x) {
        const d = x.data || {};
        return d.depart ? verify.memoFor(d.depart.truckNo, d.depart.day) : (d.ifs || []).map(f => f.ifNum).join(' + ');
    }
    function truckMap(list) { const o = {}; list.forEach(x => { o[x.id] = { status: x.status, label: truckLabel(x) }; }); return o; }
    function skuNames(items) { const info = data.itemInfo(items.map(String)); const o = {}; items.forEach(k => { o[k] = info[k] ? info[k].sku : String(k); }); return o; }
    function defPcs(c) { return core.defaultPcs(data.configsByItem(c.S.activeBatch)); }
    function pubIf(f, dp) {
        const pcs = f.lines.reduce((a, l) => a + l.qty, 0);
        const est = f.lines.reduce((a, l) => a + (dp[l.item] ? Math.ceil(l.qty / dp[l.item]) : 0), 0);
        return { ifId: f.ifId, ifNum: f.ifNum, status: f.status, toNum: f.toNum, trandate: f.trandate, lines: f.lines, pcs: pcs, estPallets: est };
    }
    function truckSummary(x) {
        const ps = data.palletsByLoad(x.id, [VP.LOADED, VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
        return { id: x.id, label: truckLabel(x), status: x.status, pending: x.data.pending || null, depart: x.data.depart || null,
            error: x.data.error || '', pallets: ps.length, received: ps.filter(p => p.status === VP.RECEIVED).length,
            missing: ps.filter(p => p.status === VP.MISSING || (x.status === T.RECEIVED && p.status === VP.IN_TRANSIT)).length };
    }
    function truckView(x, c) {
        const d = x.data || {}, dp = defPcs(c);
        const ps = data.palletsByLoad(x.id, [VP.LOADED, VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
        const fill = verify.fillExpected(d.ifs || [], verify.sumLines(ps));
        const lines = [];
        (d.ifs || []).forEach(f => f.lines.forEach(l => lines.push({ ifNum: f.ifNum, item: l.item, sku: l.sku, expected: l.qty,
            scanned: fill.alloc[f.ifId] ? fill.alloc[f.ifId][l.item] || 0 : 0, estPallets: dp[l.item] ? Math.ceil(l.qty / dp[l.item]) : null })));
        const extraIds = Object.keys(fill.left).filter(k => fill.left[k] > 0), sk = skuNames(extraIds);
        return { truck: Object.assign(truckSummary(x), { bol: d.bol || null }), lines: lines,
            extras: extraIds.map(k => ({ item: k, sku: sk[k], scanned: fill.left[k] })),
            pallets: ps.map(p => pubPallet(p)), totals: { pallets: ps.length, pieces: ps.reduce((a, p) => a + p.pieces, 0) },
            trailers: c.S.trailers || ['537224', '416460', '105488', '522051', '211659'], carrier: c.S.defaultCarrier || 'Armstrong Group', writeMode: writeMode(c) };
    }
    function pushStack(x, entry, key) {
        const k = key || 'stack';
        data.updateLoad(x, { data: { [k]: ((x.data && x.data[k]) || []).concat([entry]).slice(-60) } });
    }
    function scanCtx(x) {
        return { truckId: x.id, trucks: truckMap(allTrucks()), ifs: x.data.ifs, toLines: ns.openToLines(),
            loadedByItem: verify.sumLines(data.palletsByLoad(x.id, [VP.LOADED])) };
    }
    function mustOpenTruck(id) {
        const x = mustTruck(id);
        if (x.status !== T.LOADING || x.data.pending) throw userErr('Scanning is closed on this truck');
        return x;
    }
    function pubPlan(p) {
        const ids = {};
        p.ops.forEach(o => { if (o.item) ids[o.item] = 1; if (o.lines) Object.keys(o.lines).forEach(k => { ids[k] = 1; }); });
        const sk = skuNames(Object.keys(ids));
        return { ops: p.ops.map(o => Object.assign({}, o, { sku: o.item ? sk[o.item] : '', skus: o.lines ? Object.keys(o.lines).map(k => sk[k] + ' ×' + o.lines[k]) : [] })),
            unplanned: p.unplanned, needsManager: p.needsManager, bol: p.bol, corrections: p.corrections.length };
    }
    function departInput(a, x, c) {
        const p = x.data.pending || {};
        const pick = (k, d) => String(a[k] != null && a[k] !== '' ? a[k] : p[k] || d || '').trim();
        const inp = { trailer: pick('trailer'), seal: pick('seal'), carrier: pick('carrier', c.S.defaultCarrier || 'Armstrong Group') };
        if (!inp.trailer) throw userErr('Enter the trailer #');
        if (!inp.seal) throw userErr('Enter the seal #');
        if (verify.sealUsed(allTrucks(), inp.seal, x.id)) throw userErr('Seal ' + inp.seal + ' was already used on another truck');
        return inp;
    }
    function departPlan(x, inp, c) {
        const truckNo = verify.truckNoForDay(allTrucks(), c.now.dayIso, x.id);
        try {
            return { truckNo: truckNo, plan: verify.planDeparture({ ifs: x.data.ifs, pallets: data.palletsByLoad(x.id, [VP.LOADED]), toLines: ns.openToLines(),
                stamp: { trailer: inp.trailer, seal: inp.seal, truckNo: truckNo, dayIso: c.now.dayIso } }) };
        } catch (e) { if (/^No open transfer order covers/.test(e.message || '')) throw userErr(e.message); throw e; }
    }
    function finishDepart(x, c, claim) {
        const writes = Object.assign({}, x.data.writes);
        try {
            verify.runOps(x.data.plan, writeMode(c), op => { assertClaim(x.id, claim, truckLabel(x), 'depart'); return tx.apply(verify.resolveNew(op, writes)); }, writes,
                (k, id) => { writes[k] = id; data.updateLoad(data.getLoad(x.id), { data: { writes: writes } }); });  // fresh read so a stale copy never rewrites the claim
        } catch (e) {
            if (e.user) throw e;                      // claim lost: another request owns the truck now, leave its state alone
            log.error({ title: 'move depart ' + x.id, details: (e && e.stack) || String(e) });
            data.updateLoad(data.getLoad(x.id), { data: { error: e.message || String(e), writes: writes } });
            throw userErr('Departure saved but a NetSuite write failed: ' + (e.message || e) + '. A manager can press Retry.');
        }
        assertClaim(x.id, claim, truckLabel(x), 'depart');
        data.palletsByLoad(x.id, [VP.LOADED]).forEach(p => data.updatePallet(p, { status: VP.IN_TRANSIT, shippedDay: x.data.depart.day }));
        data.updateLoad(data.getLoad(x.id), { status: T.DEPARTED, data: { error: '', writes: writes, workingAt: 0, claim: '', phase: '' } });
        return { departed: true, view: truckView(mustTruck(x.id), c) };
    }

    const A = {};
    function act(name, managerOnly, fn) { A[name] = { m: managerOnly, fn: fn }; }

    // items and configs
    act('item_lookup', false, (a, c) => {
        const q = String(a.q || '').trim();
        if (!q) return { items: [] };
        const items = data.itemLookup(q);
        const stock = data.locationStock(c.S.locFrom, items.map(i => i.item));
        const cfg = data.configsByItem(c.S.activeBatch);
        const exact = i => (i.sku.toUpperCase() === q.toUpperCase() || i.upc === q ? 0 : 1);
        items.sort((x, y) => exact(x) - exact(y));
        return { items: items.map(i => Object.assign({}, i, { onHand: stock[i.item] ? stock[i.item].onHand : 0, cfgs: cfg[i.item] || [] })) };
    });

    act('cfg_list', true, (a, c) => {
        const cfg = data.configsByItem(c.S.activeBatch);
        const stock = data.locationStock(c.S.locFrom, null);
        const info = data.itemInfo(Object.keys(cfg));
        const rows = Object.keys(cfg).map(item => {
            const def = cfg[item].find(x => x.isDefault) || cfg[item][0];
            const onHand = stock[item] ? stock[item].onHand : 0;
            return { item: item, sku: info[item] ? info[item].sku : item, desc: info[item] ? info[item].desc : '', cfgs: cfg[item],
                onHand: onHand, estPallets: def && onHand > 0 ? Math.ceil(onHand / def.pcs) : 0 };
        }).sort((x, y) => y.onHand - x.onHand);
        const noConfig = Object.keys(stock).filter(k => !cfg[k] && stock[k].onHand > 0).map(k => ({ item: k, sku: stock[k].sku }));
        return { rows: rows, noConfig: noConfig, activeBatch: c.S.activeBatch };
    });

    act('cfg_preview', true, (a, c) => {
        const rows = core.parseCsv(a.csv);
        if (!rows.length) throw userErr('The CSV is empty');
        const imp = core.buildConfigImport(rows, data.skuMap());
        const stock = data.locationStock(c.S.locFrom, null);
        const has = {}, skus = {};
        imp.configs.forEach(x => { has[x.item] = 1; skus[x.sku] = 1; });
        return { configs: imp.configs, errors: imp.errors, unknownSkus: imp.unknownSkus, skuCount: Object.keys(skus).length,
            noConfigWithStock: Object.keys(stock).filter(k => !has[k] && stock[k].onHand > 0).map(k => stock[k].sku) };
    });

    act('cfg_commit_chunk', true, (a, c) => {
        const batch = String(a.batch || '');
        const list = Array.isArray(a.configs) ? a.configs : [];
        if (!/^B\d+$/.test(batch)) throw userErr('Bad batch id');
        if (list.length > CFG_CHUNK_MAX) throw userErr('Too many configs in one request');
        const start = Math.floor(Number(a.upTo)) - list.length;
        const skip = Math.max(0, data.countConfigsInBatch(batch) - start);
        list.slice(skip).forEach(x => {
            const pcs = Math.floor(Number(x.pcs));
            if (!x.item || !x.code || !(pcs > 0)) throw userErr('Bad config row for ' + (x.sku || x.item));
            data.createConfig({ item: String(x.item), code: String(x.code).toUpperCase(), pcs: pcs, isDefault: !!x.isDefault }, batch);
        });
        return { written: data.countConfigsInBatch(batch) };
    });

    act('cfg_activate', true, (a) => {
        const batch = String(a.batch || '');
        if (!data.countConfigsInBatch(batch)) throw userErr('That import batch has no configs');
        data.saveSettings({ activeBatch: batch });
        return {};
    });

    act('cfg_cleanup', true, (a, c) => {
        if (!c.S.activeBatch || String(a.batch) !== c.S.activeBatch) throw userErr('Activate the batch before cleanup');
        return { remaining: data.deleteConfigsNotInBatch(c.S.activeBatch, 150) };
    });

    // printing and label requests
    act('print_chunk', true, (a, c) => {
        const job = String(a.job || '');
        if (!/^J[a-z0-9]+$/i.test(job)) throw userErr('Bad print job id');
        const lines = normalizeLines(a.lines, c.S);
        const src = a.source === 'plan' ? 'plan' : 'office';
        return { created: createPalletsForJob(job, lines, a.upTo, src, c) };
    });

    function pubReq(q) {
        const d = q.data || {};
        return { id: q.id, status: q.status, requester: q.requester, summary: core.summarize(d.lines || []), count: d.count || 1,
            note: d.note || '', via: d.via || 'phone', at: d.at || '', job: d.job || '' };
    }

    act('req_create', false, (a, c) => {
        const lines = normalizeLines(a.lines, c.S);
        const count = Math.floor(Number(a.count) || 1);
        if (count < 1 || count > 50) throw userErr('Request 1 to 50 labels');
        const radio = c.mgr && a.via === 'radio';
        const requester = radio ? String(a.requester || '').trim().slice(0, 60) : c.actor;
        if (!requester) throw userErr('Enter who called it in');
        const id = data.createReq({ status: 'queued', requester: requester,
            data: { lines: lines, count: count, note: String(a.note || '').slice(0, 200), via: radio ? 'radio' : 'phone', at: c.now.stamp } });
        return { id: id };
    });

    act('req_list', false, (a, c) => {
        if (!a.mine && !c.mgr) throw userErr('Managers only');
        const q = a.mine ? { requester: c.actor, limit: 20 } : { status: a.status === 'queued' ? 'queued' : null, limit: 100 };
        return { reqs: data.findReqs(q).map(pubReq) };
    });

    act('req_print', true, (a, c) => {
        const q = data.getReq(a.reqId);
        if (!q) throw userErr('Request not found');
        if (q.status === 'cancelled') throw userErr('That request was cancelled');
        const job = 'R' + q.id;
        createPalletsForJob(job, q.data.lines, q.data.count || 1, 'request:' + q.id, c);
        if (q.status !== 'printed') data.updateReq(q, { status: 'printed', data: { job: job, printedAt: c.now.stamp, printedBy: c.actor } });
        return { job: job };
    });

    act('req_cancel', false, (a, c) => {
        const q = data.getReq(a.reqId);
        if (!q) throw userErr('Request not found');
        if (!c.mgr && q.requester !== c.actor) throw userErr('Only the requester or a manager can cancel');
        if (q.status !== 'queued') throw userErr('Only queued requests can be cancelled');
        data.updateReq(q, { status: 'cancelled' });
        return {};
    });

    // pallet tools
    act('pallet_get', false, (a, c) => {
        const sc = core.parseScan(a.code);
        if (!sc.palletId) throw userErr('Not a move label: ' + sc.raw);
        const p = mustPallet(sc.palletId);
        const Ld = p.loadId ? data.getLoad(p.loadId) : null;
        const cfg = data.configsByItem(c.S.activeBatch);
        const edLines = p.lines.map(l => ({ item: l.item, sku: l.sku, desc: l.desc || '', onHand: null, cfgs: cfg[l.item] || [], cfg: l.cfg, pcs: l.pcs }));
        return { pallet: pubPallet(p, { loadNumber: Ld ? Ld.number : '', edLines: edLines }) };
    });

    act('pallet_void', false, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== VP.LABELED) throw userErr(p.code + ' is ' + p.status + '. Only labels not on a load can be voided.');
        data.updatePallet(p, { status: VP.VOID, data: { voidReason: String(a.reason || '').slice(0, 60), voidedBy: c.actor, voidedAt: c.now.stamp } });
        return {};
    });

    act('pallet_reprint', true, (a) => {
        const p = mustPallet(a.palletId);
        if (p.status === VP.VOID) throw userErr(p.code + ' is voided');
        data.updatePallet(p, { data: { printCount: (Number(p.data.printCount) || 1) + 1 } });
        return { ids: [p.id] };
    });

    act('pallet_relabel', true, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status === VP.VOID && p.data.replacedBy) throw userErr(p.code + ' was already relabeled as ' + core.palletCode(p.data.replacedBy));
        const job = 'RL' + p.id;
        let np = data.palletsByJob(job)[0];
        if (!np) {
            if (p.status !== VP.LABELED) throw userErr(p.code + ' is ' + p.status + '. Fix loaded pallets with Edit on the Load screen.');
            createPalletsForJob(job, normalizeLines(a.lines, c.S), 1, 'relabel:' + p.id, c);
            np = data.palletsByJob(job)[0];
        }
        if (p.status !== VP.VOID) {
            data.updatePallet(p, { status: VP.VOID, data: { voidReason: 'relabeled', replacedBy: np.id, voidedBy: c.actor, voidedAt: c.now.stamp } });
        }
        return { job: job, code: np.code };
    });

    act('plan', true, (a, c) => {
        const sm = stockModel(c);
        const m = tracker(c, sm.est);
        const labeled = data.labeledPiecesByItem();
        const rows = [], noConfig = [];
        Object.keys(sm.stock).forEach(item => {
            const st = sm.stock[item];
            if (st.onHand <= 0) return;
            const cs = sm.cfg[item];
            const def = cs && (cs.find(x => x.isDefault) || cs[0]);
            if (!def) { noConfig.push({ item: item, sku: st.sku }); return; }
            const lab = labeled[item] || 0;
            rows.push({ item: item, sku: st.sku, desc: st.desc, cfg: def.code, pcs: def.pcs,
                palletsLeft: Math.ceil(Math.max(0, st.onHand - lab) / def.pcs), labeled: Math.ceil(lab / def.pcs) });
        });
        const labeledPallets = rows.reduce((x, r) => x + r.labeled, 0);
        const need = isFinite(m.neededPerDay) ? m.neededPerDay : m.remaining;
        const sugg = core.suggestPlan(rows.filter(r => r.palletsLeft > 0), Math.max(0, need - labeledPallets));
        rows.forEach(r => { r.suggest = sugg[r.item] || 0; });
        rows.sort((x, y) => y.palletsLeft - x.palletsLeft);
        return { dayLabel: c.now.dayIso, neededPerDay: isFinite(m.neededPerDay) ? m.neededPerDay : null, labeledPallets: labeledPallets,
            rows: rows.filter(r => r.palletsLeft > 0 || r.labeled > 0), noConfig: noConfig };
    });

    // ── dashboard ────────────────────────────────────────────────────────
    act('dashboard', true, (a, c) => {
        const sm = stockModel(c);
        const m = tracker(c, sm.est);
        const moved = data.movedByDay();
        const end = c.now.dayIso < c.S.target ? c.now.dayIso : c.S.target;
        const days = core.moveDays(c.S.start, end, c.S.skip || []).map(d => ({ day: d, n: moved[d] || 0 }));
        const trucks = allTrucks().slice(0, 15);
        const exc = {
            missing: data.countPallets({ status: [VP.MISSING] }),
            neverLoaded: data.findPalletsWhere({ status: [VP.LABELED, VP.LOADED] }).filter(p => p.data.flag === 'never_loaded').length,
            damaged: data.countPallets({ damaged: true }),
            edited: data.countPallets({ edited: true, status: [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING] }),
            stale: data.countPallets({ status: [VP.LABELED], printedBefore: core.isoAddDays(c.now.dayIso, -(Number(c.S.staleDays) || 5)) }),
            noConfig: sm.est.unknownItems.length
        };
        const skuOf = k => (sm.stock[k] ? sm.stock[k].sku : k);
        const bySku = Object.keys(sm.est.byItem).map(k => ({ sku: skuOf(k), palletsLeft: sm.est.byItem[k] }))
            .sort((x, y) => y.palletsLeft - x.palletsLeft).slice(0, 20);
        return {
            m: Object.assign({}, m, { neededPerDay: isFinite(m.neededPerDay) ? m.neededPerDay : null }),
            labeled: data.countPallets({ status: [VP.LABELED, VP.LOADED] }),
            inTransit: data.countPallets({ status: [VP.IN_TRANSIT, VP.MISSING] }),
            received: data.countPallets({ status: [VP.RECEIVED] }),
            target: c.S.target, days: days, trucks: trucks.map(truckSummary), exc: exc, bySku: bySku,
            noConfigSkus: sm.est.unknownItems.map(skuOf)
        };
    });

    act('truck_planned', false, (a, c) => {
        const trucks = allTrucks(), taken = {}, dp = defPcs(c);
        trucks.forEach(x => (x.data.ifs || []).forEach(f => { taken[f.ifId] = true; }));
        return { planned: ns.plannedIfs().filter(f => !taken[f.ifId]).map(f => pubIf(f, dp)),
            open: trucks.filter(x => x.status === T.LOADING || x.status === T.DEPARTING).map(truckSummary), pulledAt: ns.pulledAt() };
    });

    act('truck_start', false, (a, c) => {
        const ids = (a.ifIds || []).map(String);
        if (!ids.length) throw userErr('Pick at least one IF');
        const planned = ns.plannedIfs(), taken = {};
        allTrucks().forEach(x => (x.data.ifs || []).forEach(f => { taken[f.ifId] = true; }));
        const ifs = ids.map(id => {
            const f = planned.find(y => y.ifId === id);
            if (taken[id]) throw userErr((f ? f.ifNum : 'IF ' + id) + ' is already on a truck');
            if (!f) throw userErr('IF ' + id + ' is not Picked/Packed any more. Refresh the list.');
            return f;
        });
        const id = data.createLoad({ number: ifs.map(f => f.ifNum).join('+').slice(0, 290), status: T.LOADING,
            data: { v3: true, ifs: ifs, startedBy: c.actor, startedAt: c.now.stamp, stack: [] } });
        return { view: truckView(mustTruck(id), c) };
    });

    act('truck_get', false, (a, c) => ({ view: truckView(mustTruck(a.truckId), c) }));

    act('truck_scan', false, (a, c) => {
        const x = mustOpenTruck(a.truckId);
        const s = core.parseScan(a.raw);
        const p = s.palletId ? data.getPallet(s.palletId) : null;
        const r = verify.classifyLoadScan(Object.assign({ pallet: p }, scanCtx(x)));
        if (r.set) {
            data.updatePallet(p, { status: r.set.status, load: x.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor } });
            pushStack(x, String(p.id));
        }
        data.logScan({ pallet: p ? p.id : '', load: x.id, result: r.result, data: { raw: s.raw, mode: 'load', actor: c.actor, at: c.now.stamp } });
        return Object.assign({}, r, { raw: s.raw, tone: verify.toneFor(r.result), pallet: p ? pubPallet(data.getPallet(p.id)) : null, view: truckView(mustTruck(x.id), c) });
    });

    act('truck_move_here', false, (a, c) => {
        const x = mustOpenTruck(a.truckId), p = mustPallet(a.palletId);
        const from = p.loadId ? data.getLoad(p.loadId) : null;
        if (p.status !== VP.LOADED || !from || from.status !== T.LOADING || from.data.pending) throw userErr('That pallet can no longer be moved');
        const r = verify.fitOnTruck(p, scanCtx(x));
        if (r.result === 'no_to') throw userErr('No open transfer order for ' + r.sku + ' on this truck. Set it aside and call the office.');
        data.updatePallet(p, { load: x.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor } });
        pushStack(x, String(p.id));
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('truck_remove', false, (a, c) => {
        const x = mustOpenTruck(a.truckId), p = mustPallet(a.palletId);
        if (p.status !== VP.LOADED || p.loadId !== x.id) throw userErr('That pallet is not on this truck');
        data.updatePallet(p, { status: VP.LABELED, load: '' });
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('truck_undo', false, (a, c) => {
        const x = mustOpenTruck(a.truckId), st = (x.data.stack || []).slice();
        while (st.length) {
            const p = data.getPallet(st.pop());
            if (p && p.status === VP.LOADED && p.loadId === x.id) { data.updatePallet(p, { status: VP.LABELED, load: '' }); break; }
        }
        data.updateLoad(x, { data: { stack: st } });
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('depart_preview', false, (a, c) => {
        const x = mustTruck(a.truckId), inp = departInput(a, x, c), d = departPlan(x, inp, c);
        return { input: inp, truckNo: d.truckNo, plan: pubPlan(d.plan) };
    });

    act('depart_confirm', false, (a, c) => {
        const x0 = mustTruck(a.truckId);
        if (x0.status !== T.LOADING) throw userErr('This truck is already ' + x0.status);
        const inp = departInput(a, x0, c), d = departPlan(x0, inp, c);
        if (d.plan.needsManager && !c.mgr) {
            data.updateLoad(x0, { data: { pending: Object.assign({ by: c.actor, at: c.now.stamp }, inp) } });
            return { waiting: true, plan: pubPlan(d.plan), view: truckView(mustTruck(x0.id), c) };
        }
        const cl = claimLoad(x0, T.DEPARTING, 'depart', cur => {
            if (cur.status !== T.LOADING || cur.data.depart) throw userErr('This truck is already departing');
        }), x = cl.Ld;
        const gone = {};
        d.plan.unplanned.forEach(u => { gone[u.ifId] = true; });
        data.updateLoad(x, { data: { depart: Object.assign({ truckNo: d.truckNo, day: c.now.dayIso, at: c.now.stamp, by: c.actor,
            approvedBy: d.plan.needsManager ? c.actor : '', requestedBy: (x0.data.pending || {}).by || '' }, inp), plan: d.plan.ops, alloc: d.plan.alloc, unplanned: d.plan.unplanned,
            bol: d.plan.bol, ifs: x.data.ifs.filter(f => !gone[f.ifId]), writes: {}, pending: null } });
        return finishDepart(mustTruck(x.id), c, cl.claim);
    });

    act('depart_cancel', false, (a, c) => {
        const x = mustTruck(a.truckId);
        if (x.status !== T.LOADING) throw userErr('This truck already left');
        data.updateLoad(x, { data: { pending: null } });
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('depart_retry', true, (a, c) => {
        const x = mustTruck(a.truckId);
        if (x.status !== T.DEPARTING || !x.data.depart) throw userErr('Nothing to retry on this truck');
        if (!x.data.error && !stale(x)) throw userErr('This departure is still running. Wait a minute, then Retry.');
        const cl = claimLoad(x, T.DEPARTING, 'depart', cur => {
            if (cur.status !== T.DEPARTING || !cur.data.depart || (!cur.data.error && !stale(cur))) throw userErr('This departure is still running. Wait a minute, then Retry.');
        });
        return finishDepart(cl.Ld, c, cl.claim);
    });

    // ── v3 unload and receipt approval ───────────────────────────────────
    const UNLOADABLE = [T.DEPARTED, T.RECEIVING, T.RECEIVED];
    function unloadView(x, c) {
        const ps = data.palletsByLoad(x.id, [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
        const rp = verify.planReceipts({ alloc: x.data.alloc || [], pallets: ps, received: x.data.received || {}, stamp: x.data.depart || {}, seq: 0 });
        const got = ps.filter(p => p.status === VP.RECEIVED);
        const flagged = data.findPalletsWhere({ status: [VP.LABELED, VP.LOADED] }).filter(p => p.data.flag === 'never_loaded' && p.data.flaggedTruck === x.id);
        return { truck: truckSummary(x), perIf: rp.perIf, expected: ps.filter(p => p.status !== VP.RECEIVED).map(p => pubPallet(p)),
            recent: got.slice(-5).reverse().map(p => pubPallet(p)), counts: { in: got.length, of: ps.length }, flagged: flagged.map(p => pubPallet(p)) };
    }
    function mustUnloadable(id) {
        const x = mustTruck(id);
        if (UNLOADABLE.indexOf(x.status) === -1) throw userErr('This truck is ' + x.status + ', not ready to unload');
        return x;
    }
    // Every update goes through a fresh read: updateLoad rebuilds data from the copy it is given.
    function mustViewable(id) {
        const x = mustTruck(id);
        if (UNLOADABLE.indexOf(x.status) === -1 && x.status !== T.APPROVING) throw userErr('This truck is ' + x.status + ', not ready to unload');
        return x;
    }
    function receiveOn(x, p, prev, c) {
        data.updatePallet(p, { status: VP.RECEIVED, data: { receivedAt: c.now.stamp, receivedBy: c.actor } });
        pushStack(mustTruck(x.id), { id: String(p.id), prev: prev }, 'rstack');
        const cur = mustTruck(x.id);
        if (cur.status === T.DEPARTED) data.updateLoad(cur, { status: T.RECEIVING });
    }

    act('unload_list', false, () => ({ trucks: allTrucks().filter(x => x.status === T.DEPARTED || x.status === T.RECEIVING || (x.status === T.APPROVING && (x.data.error || stale(x))) ||
        (x.status === T.RECEIVED && (truckSummary(x).missing > 0 || data.palletsByLoad(x.id, [VP.RECEIVED]).some(p => !p.data.postedSeq)))).map(truckSummary) }));

    act('unload_get', false, (a, c) => ({ view: unloadView(mustViewable(a.truckId), c) }));

    act('unload_scan', false, (a, c) => {
        const x = mustUnloadable(a.truckId);
        const s = core.parseScan(a.raw);
        const p = s.palletId ? data.getPallet(s.palletId) : null;
        const r = verify.classifyUnloadScan({ pallet: p, truckId: x.id, trucks: truckMap(allTrucks()) });
        if (r.set) receiveOn(x, p, p.status, c);
        if (r.result === 'never_loaded') data.updatePallet(p, { data: { flag: 'never_loaded', flaggedAt: c.now.stamp, flaggedBy: c.actor, flaggedTruck: x.id } });
        data.logScan({ pallet: p ? p.id : '', load: x.id, result: r.result, data: { raw: s.raw, mode: 'unload', actor: c.actor, at: c.now.stamp } });
        return Object.assign({}, r, { raw: s.raw, tone: verify.toneFor(r.result), pallet: p ? pubPallet(data.getPallet(p.id)) : null, view: unloadView(mustTruck(x.id), c) });
    });

    act('unload_other', false, (a, c) => {
        const p = mustPallet(a.palletId);
        const x = mustUnloadable(p.loadId);
        if (p.status !== VP.IN_TRANSIT && p.status !== VP.MISSING) throw userErr('That pallet is ' + p.status);
        const was = p.status;
        receiveOn(x, p, was, c);
        data.logScan({ pallet: p.id, load: x.id, result: was === VP.MISSING ? 'late' : 'ok', data: { raw: p.code || '', mode: 'unload', actor: c.actor, at: c.now.stamp, via: 'other_truck' } });
        return { view: unloadView(mustTruck(x.id), c) };
    });

    act('unload_damaged', false, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== VP.RECEIVED) throw userErr('Scan the pallet in first');
        const x = mustUnloadable(p.loadId);
        data.updatePallet(p, { damaged: true, data: { damagedAt: c.now.stamp, damagedBy: c.actor } });
        data.logScan({ pallet: p.id, load: x.id, result: 'damaged', data: { raw: p.code || '', mode: 'unload', actor: c.actor, at: c.now.stamp } });
        return {};
    });

    act('unload_undo', false, (a, c) => {
        const x = mustUnloadable(a.truckId), st = (x.data.rstack || []).slice();
        while (st.length) {
            const e = st.pop(), p = data.getPallet(e.id);
            if (p && p.status === VP.RECEIVED && p.loadId === x.id && !p.data.postedSeq) { data.updatePallet(p, { status: e.prev, damaged: false }); break; }
        }
        data.updateLoad(mustTruck(x.id), { data: { rstack: st } });
        return { view: unloadView(mustTruck(x.id), c) };
    });

    act('unload_done', false, (a, c) => {
        const x = mustUnloadable(a.truckId);
        data.updateLoad(x, { data: { recvRequested: { by: c.actor, at: c.now.stamp } } });
        return { view: unloadView(mustTruck(x.id), c) };
    });

    function receiptPlan(x) {
        const ps = data.palletsByLoad(x.id, [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
        const rp = verify.planReceipts({ alloc: x.data.alloc || [], pallets: ps, received: x.data.received || {}, stamp: x.data.depart, seq: (Number(x.data.recvSeq) || 0) + 1 });
        rp.recvIds = ps.filter(p => p.status === VP.RECEIVED).map(p => p.id);
        rp.transitIds = ps.filter(p => p.status === VP.IN_TRANSIT).map(p => p.id);
        return rp;
    }

    act('receipt_preview', true, (a) => {
        const x = mustViewable(a.truckId), rp = receiptPlan(x);
        return { perIf: rp.perIf, missing: rp.missing, ops: rp.ops };
    });

    act('receipt_approve', true, (a, c) => {
        const canApprove = cur => UNLOADABLE.indexOf(cur.status) !== -1 || (cur.status === T.APPROVING && (cur.data.error || stale(cur)));
        const x0 = mustTruck(a.truckId);
        if (!canApprove(x0)) throw userErr(x0.status === T.APPROVING ? 'This truck is already being approved. Wait a few minutes, then try again.' : 'This truck is ' + x0.status + ', not ready to unload');
        if (!receiptPlan(x0).ops.length) throw userErr('Nothing new scanned in on this truck');
        const prevStatus = x0.status === T.APPROVING ? (x0.data.prevStatus || T.RECEIVING) : x0.status === T.DEPARTED ? T.RECEIVING : x0.status;
        const cl = claimLoad(x0, T.APPROVING, 'receive', cur => {
            if (!canApprove(cur)) throw userErr('This truck is ' + cur.status + ', not ready to approve');
        }, { prevStatus: prevStatus });
        const x = cl.Ld, claim = cl.claim, label = truckLabel(x);
        const rp = receiptPlan(x), seq = (Number(x.data.recvSeq) || 0) + 1;
        const writes = Object.assign({}, x.data.writes);
        data.updateLoad(data.getLoad(x.id), { data: { recvApprovedBy: c.actor, recvApprovedAt: c.now.stamp } });
        let res;
        try {
            res = verify.runOps(rp.ops, writeMode(c), op => { assertClaim(x.id, claim, label, 'receive'); return tx.apply(verify.resolveNew(op, writes)); }, writes,
                (k, id) => { writes[k] = id; data.updateLoad(data.getLoad(x.id), { data: { writes: writes } }); });
        } catch (e) {
            if (e.user) throw e;                      // claim lost: another request owns the truck now, leave its state alone
            log.error({ title: 'move receive ' + x.id, details: (e && e.stack) || String(e) });
            data.updateLoad(data.getLoad(x.id), { status: prevStatus, data: { error: e.message || String(e), writes: writes } });
            throw userErr('Receipt write failed: ' + (e.message || e) + '. Fix it and approve again; finished receipts are not repeated.');
        }
        assertClaim(x.id, claim, label, 'receive');
        const planned = {}, transit = {};
        rp.recvIds.forEach(id => { planned[String(id)] = 1; });
        rp.transitIds.forEach(id => { transit[String(id)] = 1; });
        data.palletsByLoad(x.id, [VP.RECEIVED]).filter(p => planned[String(p.id)] && !p.data.postedSeq).forEach(p => data.updatePallet(p, { data: { postedSeq: seq } }));
        data.palletsByLoad(x.id, [VP.IN_TRANSIT]).filter(p => transit[String(p.id)]).forEach(p => data.updatePallet(p, { status: VP.MISSING }));
        const fin = data.getLoad(x.id);
        data.updateLoad(fin, { status: T.RECEIVED, data: { rplan: (fin.data.rplan || []).concat(rp.ops), prevStatus: '', received: rp.cumulative, recvSeq: seq, recvRequested: null, error: '', writes: writes, workingAt: 0, claim: '', phase: '' } });
        return { perIf: rp.perIf, missing: rp.missing, written: res.written, view: unloadView(mustTruck(x.id), c) };
    });

    // ── v3 manager approvals and shadow report ───────────────────────────
    act('approvals', true, (a, c) => {
        const trucks = allTrucks();
        const stuck = x => !!(x.data.error || stale(x));
        return {
            departures: trucks.filter(x => x.status === T.LOADING && x.data.pending).map(x => {
                let plan = null, error = null;
                try { plan = pubPlan(departPlan(x, x.data.pending, c).plan); } catch (e) { error = e.message; }
                return { truck: truckSummary(x), pending: x.data.pending, plan: plan, error: error };
            }),
            retries: trucks.filter(x => x.status === T.DEPARTING && stuck(x)).map(truckSummary),
            receipts: trucks.filter(x => UNLOADABLE.indexOf(x.status) !== -1 || (x.status === T.APPROVING && stuck(x))).map(x => {
                const isStuck = x.status === T.APPROVING;
                try {
                    const unposted = data.palletsByLoad(x.id, [VP.RECEIVED]).filter(p => !p.data.postedSeq).length;
                    if (!isStuck && (!unposted || (x.status !== T.RECEIVED && !x.data.recvRequested))) return null;
                    const rp = receiptPlan(x);
                    const o = { truck: truckSummary(x), perIf: rp.perIf, missing: rp.missing, lateOnly: x.status === T.RECEIVED };
                    if (isStuck) o.stuck = true;
                    return o;
                } catch (e) {
                    log.error({ title: 'move approvals receipt ' + x.id, details: (e && e.stack) || String(e) });
                    const o = { truck: { id: x.id, label: truckLabel(x) }, error: (e && e.message) || String(e) };
                    if (isStuck) o.stuck = true;
                    return o;
                }
            }).filter(Boolean)
        };
    });

    act('report', true, (a, c) => {
        const trucks = allTrucks().filter(x => x.data.depart);
        const ids = {};
        trucks.forEach(x => (x.data.alloc || []).forEach(al => Object.keys(al.lines).forEach(k => { ids[k] = 1; })));
        const rows = verify.shadowRows({ trucks: trucks, ifInfo: ns.ifInfo(), ifsByTo: ns.ifsByTo(), receipts: ns.receiptsByIf(), sku: skuNames(Object.keys(ids)) });
        const days = {}, diffsBy = {};
        rows.forEach(r => { if (r.ok === false) diffsBy[r.truck] = (diffsBy[r.truck] || 0) + 1; });
        trucks.forEach(x => {
            const dd = days[x.data.depart.day] = days[x.data.depart.day] || { day: x.data.depart.day, trucks: 0, pallets: 0, pieces: 0, diffs: 0 };
            const ps = data.palletsByLoad(x.id, [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
            dd.trucks++; dd.pallets += ps.length; dd.pieces += ps.reduce((s, p) => s + p.pieces, 0);
            dd.diffs += diffsBy[truckLabel(x)] || 0;
        });
        return { rows: rows, days: Object.values(days).sort((p, q) => (p.day < q.day ? 1 : -1)), pulledAt: ns.pulledAt(), writeMode: writeMode(c) };
    });

    // ── entry points ─────────────────────────────────────────────────────
    function runAction(action, a, mgr) {
        const def = A[action];
        if (!def) throw userErr('Unknown action: ' + action);
        if (def.m && !mgr) throw userErr('Managers only');
        data.resetCache();
        const body = a || {};
        const c = { mgr: !!mgr, S: settings(), now: nowInfo(),
            actor: String(body.actor || '').trim().slice(0, 60) || runtime.getCurrentUser().name };
        return def.fn(body, c) || {};
    }

    function onRequest(ctx) {
        const q = ctx.request.parameters;
        if (!q.action) return page(ctx);
        if (q.action === 'pdf') return pdf(ctx);
        let out;
        try {
            let a = {};
            try { a = JSON.parse(ctx.request.body || '{}') || {}; } catch (e) { a = {}; }
            out = Object.assign({ ok: true }, runAction(q.action, a, isManager()));
        } catch (e) {
            if (!e.user) log.error({ title: 'move ' + q.action, details: (e && e.stack) || String(e) });
            out = { ok: false, error: e.user ? e.message : 'Error: ' + (e.message || e.name || String(e)) };
        }
        ctx.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        ctx.response.write(JSON.stringify(out));
    }

    function page(ctx) {
        const S = data.getSettings();
        const script = runtime.getCurrentScript();
        ctx.response.write(ui.buildPage({
            url: url.resolveScript({ scriptId: script.id, deploymentId: script.deploymentId }),
            mode: isManager() ? 'manager' : 'floor', me: runtime.getCurrentUser().name, roster: S.roster || [],
            fromName: S.fromName, toName: S.toName, maxPrint: Number(S.maxPrint) || 250
        }));
    }

    function pdf(ctx) {
        const q = ctx.request.parameters;
        if (!isManager()) { ctx.response.write('Managers only'); return; }
        const S = data.getSettings();
        const ps = q.job ? data.palletsByJob(String(q.job)).filter(p => p.status !== VP.VOID) : data.palletsByIds(String(q.ids || '').split(','));
        if (!ps.length) { ctx.response.write('No labels to print'); return; }
        const xml = tpl.labelsXml(ps.map(p => ({ code: p.code, lines: p.lines, pieces: p.pieces, edited: p.edited, printedDay: p.printedDay,
            by: p.data.printedBy || '', summary: p.summary })), { codeMode: S.labelCode, header: q.header === '1', fromName: S.fromName, toName: S.toName });
        ctx.response.writeFile({ file: render.xmlToPdf({ xmlString: xml }), isInline: true });
    }

    return { onRequest: onRequest, _runAction: runAction };
});
