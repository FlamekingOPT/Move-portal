/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Move Portal (Riverside -> Tippecanoe warehouse move). A separate app from the
 * picker portal; shares no code with it.
 * Spec: docs/superpowers/specs/2026-09-27-move-portal-design.md
 */
define(['N/runtime', 'N/log', 'N/render', 'N/url', 'N/format',
        './move_core', './move_data', './move_tx', './move_label_template', './move_ui', './move_verify', './move_ns'],
function (runtime, log, render, url, format, core, data, tx, tpl, ui, verify, ns) {
    'use strict';

    const P = core.PALLET, L = core.LOAD;
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
            pieces: p.pieces, edited: p.edited, damaged: p.damaged, catchup: p.catchup, lines: p.lines, loadId: p.loadId,
            printedAt: p.data.printedAt || '', receipt: p.receipt }, extra || {});
    }

    function countsFromPallets(ps) {
        const out = {};
        ps.forEach(p => { const o = out[p.status] = out[p.status] || { n: 0, pcs: 0 }; o.n++; o.pcs += p.pieces; });
        return out;
    }

    function pubLoad(Ld, counts) {
        const d = Ld.data || {}, cs = counts || {};
        const n = st => (cs[st] ? cs[st].n : 0);
        const pcs = st => (cs[st] ? cs[st].pcs : 0);
        const onTruck = [P.LOADED, P.SHIPPED, P.RECEIVED, P.MISSING];
        return { id: Ld.id, number: Ld.number, status: Ld.status, door: d.door || '', carrier: d.carrier || '', trailer: d.trailer || '',
            seal: d.seal || '', to: Ld.to, if: Ld.if, error: d.error || '', readyBy: d.readyBy || '', readyAt: d.readyAt || '',
            approvedAt: d.approvedAt || '', approvedBy: d.approvedBy || '', catchupFor: d.catchupFor || '',
            pallets: onTruck.reduce((a, s) => a + n(s), 0), pieces: onTruck.reduce((a, s) => a + pcs(s), 0), received: n(P.RECEIVED) };
    }

    function mustLoad(id) { const Ld = data.getLoad(id); if (!Ld) throw userErr('Load not found'); return Ld; }
    function mustPallet(id) { const p = data.getPallet(id); if (!p) throw userErr('Label not found'); return p; }
    function stale(Ld) { return Date.now() - (Number(Ld.data.workingAt) || 0) > STALE_MS; }

    // Flips the load to a working status under a fresh claim token, then re-reads it to confirm
    // no other request's write interleaved. Returns the fresh load and the claim to re-check later.
    function claimLoad(Ld, status, phase, mustBe) {
        const cur = data.getLoad(Ld.id);               // never merge over a stale copy: re-read, then guard, then claim
        if (!cur) throw userErr('Load not found');
        if (mustBe) mustBe(cur);
        Ld = cur;
        const claim = String(Date.now()) + Math.random().toString(36).slice(2, 8);
        data.updateLoad(Ld, { status: status, data: { workingAt: Date.now(), error: '', phase: phase, claim: claim } });
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
            data.createPallet(Object.assign({ status: P.LABELED, job: job, printedDay: c.now.dayIso }, f,
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
    const T = verify.TRUCK, VP = verify.VP;
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
        if (p.status !== P.LABELED) throw userErr(p.code + ' is ' + p.status + '. Only labels not on a load can be voided.');
        data.updatePallet(p, { status: P.VOID, data: { voidReason: String(a.reason || '').slice(0, 60), voidedBy: c.actor, voidedAt: c.now.stamp } });
        return {};
    });

    act('pallet_reprint', true, (a) => {
        const p = mustPallet(a.palletId);
        if (p.status === P.VOID) throw userErr(p.code + ' is voided');
        data.updatePallet(p, { data: { printCount: (Number(p.data.printCount) || 1) + 1 } });
        return { ids: [p.id] };
    });

    act('pallet_relabel', true, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status === P.VOID && p.data.replacedBy) throw userErr(p.code + ' was already relabeled as ' + core.palletCode(p.data.replacedBy));
        const job = 'RL' + p.id;
        let np = data.palletsByJob(job)[0];
        if (!np) {
            if (p.status !== P.LABELED) throw userErr(p.code + ' is ' + p.status + '. Fix loaded pallets with Edit on the Load screen.');
            createPalletsForJob(job, normalizeLines(a.lines, c.S), 1, 'relabel:' + p.id, c);
            np = data.palletsByJob(job)[0];
        }
        if (p.status !== P.VOID) {
            data.updatePallet(p, { status: P.VOID, data: { voidReason: 'relabeled', replacedBy: np.id, voidedBy: c.actor, voidedAt: c.now.stamp } });
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

    // ── (Tasks 9–11 add more act(...) blocks here) ──

    // ── loading (outbound) ───────────────────────────────────────────────
    const OUT_OPEN = [L.LOADING, L.READY, L.SHIPPING, L.ERROR];

    function loadView(loadId) {
        const Ld = mustLoad(loadId);
        const pallets = data.palletsByLoad(Ld.id, [P.LOADED, P.SHIPPED, P.RECEIVED, P.MISSING]);
        const items = {};
        pallets.forEach(p => p.lines.forEach(l => { items[l.item] = 1; }));
        return { load: pubLoad(Ld, countsFromPallets(pallets)), pallets: pallets.slice().reverse().map(p => pubPallet(p)),
            totals: { pallets: pallets.length, pieces: pallets.reduce((a, p) => a + p.pieces, 0), skus: Object.keys(items).length } };
    }

    act('load_list', false, () => {
        const loads = data.loadsByStatus(OUT_OPEN, 50).filter(l => (l.data || {}).phase !== 'recv' && !(l.data || {}).catchupFor);
        const counts = data.palletCountsByLoad(loads.map(l => l.id));
        return { loads: loads.map(l => pubLoad(l, counts[l.id])) };
    });

    act('load_create', false, (a, c) => {
        const clean = v => String(v || '').trim().slice(0, 40);
        const id = data.createLoad({ number: core.nextLoadNumber(data.allLoadNumbers()), status: L.LOADING,
            data: { door: clean(a.door), carrier: clean(a.carrier), trailer: clean(a.trailer), seal: clean(a.seal), createdBy: c.actor, createdAt: c.now.stamp } });
        // Two docks opening a load at the same moment can get the same number; the newer one renumbers.
        const Ld = data.getLoad(id);
        if (data.loadsByNumber(Ld.number).some(x => Number(x.id) < Number(id))) data.updateLoad(Ld, { number: core.nextLoadNumber(data.allLoadNumbers()) });
        return { load: pubLoad(data.getLoad(id)) };
    });

    act('load_get', false, (a) => loadView(a.loadId));

    act('scan_load', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        if (Ld.status !== L.LOADING) throw userErr(Ld.number + ' is closed for scanning (' + Ld.status + ')');
        const sc = core.parseScan(a.raw);
        const p = sc.palletId ? data.getPallet(sc.palletId) : null;
        const loads = {};
        if (p && p.loadId) { const o = p.loadId === Ld.id ? Ld : data.getLoad(p.loadId); if (o) loads[o.id] = o; }
        const rule = core.loadScanRule(p, Ld.id, loads);
        if (rule.set) data.updatePallet(p, { status: rule.set.status, load: rule.set.loadId, data: { loadedAt: c.now.stamp, loadedBy: c.actor } });
        data.logScan({ pallet: p ? p.id : '', load: Ld.id, result: rule.result, data: { raw: sc.raw, mode: 'load', actor: c.actor, at: c.now.stamp } });
        const fresh = p ? data.getPallet(p.id) : null;
        return { result: rule.result, tone: core.toneFor(rule.result), raw: sc.raw, pallet: fresh ? pubPallet(fresh) : null,
            loadNumber: Ld.number, otherNumber: rule.otherNumber || '', view: loadView(Ld.id) };
    });

    act('load_move_here', false, (a, c) => {
        const Ld = mustLoad(a.loadId), p = mustPallet(a.palletId);
        if (Ld.status !== L.LOADING) throw userErr(Ld.number + ' is closed for scanning');
        const other = p.loadId ? data.getLoad(p.loadId) : null;
        if (p.status !== P.LOADED || !other || other.status !== L.LOADING) throw userErr(p.code + ' can no longer be moved');
        data.updatePallet(p, { load: Ld.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor, movedFrom: other.number } });
        return { pallet: pubPallet(data.getPallet(p.id)), view: loadView(Ld.id) };
    });

    function editablePallet(a) {
        const Ld = mustLoad(a.loadId), p = mustPallet(a.palletId);
        if (Ld.status !== L.LOADING || p.status !== P.LOADED || p.loadId !== Ld.id) throw userErr(p.code + ' can only be changed while it is on an open load');
        return { Ld: Ld, p: p };
    }

    act('pallet_edit', false, (a, c) => {
        const o = editablePallet(a);
        const byItem = {};
        o.p.lines.forEach(l => { byItem[String(l.item)] = l; });
        const next = (Array.isArray(a.lines) ? a.lines : []).map(l => byItem[String(l.item)] ? Object.assign({}, byItem[String(l.item)], { pcs: l.pcs }) : null);
        if (next.length !== o.p.lines.length || next.some(l => !l)) throw userErr('Edit can only change piece counts');
        const err = core.validateLines(next);
        if (err) throw userErr(err);
        const lines = next.map(l => Object.assign({}, l, { pcs: Math.floor(Number(l.pcs)) }));
        data.updatePallet(o.p, { lines: lines, summary: core.summarize(lines), pieces: core.totalPieces(lines), edited: true,
            data: { editedAt: c.now.stamp, editedBy: c.actor } });
        return { pallet: pubPallet(data.getPallet(o.p.id)), view: loadView(o.Ld.id) };
    });

    act('pallet_remove', false, (a, c) => {
        const o = editablePallet(a);
        data.updatePallet(o.p, { status: P.LABELED, load: '', data: { removedAt: c.now.stamp, removedBy: c.actor } });
        return { view: loadView(o.Ld.id) };
    });

    act('load_ready', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        if (Ld.status !== L.LOADING) throw userErr(Ld.number + ' is not open');
        if (!data.palletsByLoad(Ld.id, [P.LOADED]).length) throw userErr('Scan at least one pallet first');
        data.updateLoad(Ld, { status: L.READY, data: { readyBy: c.actor, readyAt: c.now.stamp } });
        return {};
    });

    act('load_sendback', true, (a) => {
        const Ld = mustLoad(a.loadId);
        if (Ld.data.catchupFor) throw userErr('Catch-up loads are handled on the Catch-ups screen');
        if ([L.READY, L.ERROR].indexOf(Ld.status) === -1 || Ld.to) throw userErr(Ld.number + ' can no longer be sent back');
        if (tx.findByToken(core.txToken(Ld.id, 'to'), 'TrnfrOrd')) throw userErr(Ld.number + ' already has a transfer order in NetSuite; press Retry instead');
        data.updateLoad(Ld, { status: L.LOADING, data: { error: '', phase: '' } });
        return {};
    });

    act('ship_list', true, (a, c) => {
        const loads = data.loadsByStatus([L.READY, L.SHIPPING, L.ERROR], 50).filter(l => (l.data || {}).phase !== 'recv' && !(l.data || {}).catchupFor);
        const per = loads.map(Ld => ({ Ld: Ld, pallets: data.palletsByLoad(Ld.id, [P.LOADED]) }));
        const skuOf = {};
        per.forEach(o => o.pallets.forEach(p => p.lines.forEach(l => { skuOf[l.item] = l.sku; })));
        const stock = Object.keys(skuOf).length ? data.locationStock(c.S.locFrom, Object.keys(skuOf)) : {};
        const out = per.map(o => {
            const agg = o.Ld.to && o.Ld.data.lines ? o.Ld.data.lines : core.aggregate(o.pallets);
            const rows = Object.keys(agg).map(item => {
                const avail = stock[item] ? stock[item].avail : 0;
                // Once the TO exists its own lines are already committed, so availability no longer applies.
                return { item: item, sku: skuOf[item] || item, qty: agg[item], avail: avail, ok: !!o.Ld.to || avail >= agg[item] };
            });
            return Object.assign(pubLoad(o.Ld, countsFromPallets(o.pallets)), { rows: rows,
                canSendBack: !o.Ld.to && [L.READY, L.ERROR].indexOf(o.Ld.status) !== -1 });
        });
        const recent = data.loadsByStatus([L.SHIPPED, L.RECEIVING, L.RECV_READY, L.RECEIVED, L.RECEIVED_SHORT], 10);
        const t = data.tranids([].concat.apply([], recent.map(l => [l.to, l.if])).filter(Boolean));
        const rc = data.palletCountsByLoad(recent.map(l => l.id));
        return { loads: out, recent: recent.map(l => Object.assign(pubLoad(l, rc[l.id]), { toNumber: t[l.to] || '', ifNumber: t[l.if] || '' })) };
    });

    // Resumable: each finished step (TO, IF) is saved on the load, and memo tokens
    // find a transaction that was saved just before a crash.
    function shipLoad(Ld, c) {
        if ([L.READY, L.ERROR, L.SHIPPING].indexOf(Ld.status) === -1 || Ld.data.phase === 'recv') throw userErr(Ld.number + ' is ' + Ld.status + ', not ready to ship');
        if (Ld.status === L.SHIPPING && !stale(Ld)) throw userErr(Ld.number + ' is already being shipped. Wait a minute and refresh.');
        const claimed = claimLoad(Ld, L.SHIPPING, 'ship');
        Ld = claimed.Ld;
        const claim = claimed.claim;
        try {
            const skuOf = {};
            data.palletsByLoad(Ld.id, [P.LOADED, P.SHIPPED]).forEach(p => p.lines.forEach(l => { skuOf[l.item] = l.sku; }));
            const name = k => skuOf[k] || k;
            let lines = Ld.data.lines;
            if (!Ld.to) {
                const loaded = data.palletsByLoad(Ld.id, [P.LOADED]);
                if (!loaded.length) {
                    data.updateLoad(Ld, { status: L.READY, data: { workingAt: 0, phase: '' } });
                    throw userErr('No pallets on ' + Ld.number);
                }
                const tok = core.txToken(Ld.id, 'to');
                // An orphan TO from a prior crash already committed the stock, so the check
                // below would wrongly see it as unavailable — adopt it and skip the check.
                const orphan = tx.findByToken(tok, 'TrnfrOrd');
                lines = core.aggregate(loaded);
                let toId = orphan;
                if (!toId) {
                    const stock = data.locationStock(c.S.locFrom, Object.keys(lines));
                    const avail = {};
                    Object.keys(stock).forEach(k => { avail[k] = stock[k].avail; });
                    const short = core.shortages(lines, avail);
                    if (short.length) {
                        data.updateLoad(Ld, { status: L.READY, data: { workingAt: 0, phase: '' } });
                        throw userErr('Not enough available at ' + c.S.fromName + ': ' +
                            short.map(s => name(s.item) + ' needs ' + s.need + ', available ' + s.avail).join('; ') + '. Remove a pallet or check the count.');
                    }
                    assertClaim(Ld.id, claim, Ld.number, 'ship');
                    toId = tx.createTransferOrder({ fromLoc: c.S.locFrom, toLoc: c.S.locTo,
                        orderStatus: c.S.toStatus, memo: 'Move ' + Ld.number + ' ' + tok, lines: lines });
                }
                data.updateLoad(Ld, { to: toId, data: { lines: lines } });
                Ld = data.getLoad(Ld.id);
            }
            if (!Ld.if) {
                const tok = core.txToken(Ld.id, 'if');
                let ifId = tx.findByToken(tok, 'ItemShip');
                if (!ifId) {
                    const sf = tx.committedShortfalls(Ld.to, lines);
                    if (sf.length) throw userErr('The transfer order was created but NetSuite reserved less than the load: ' +
                        sf.map(s => name(s.item) + ' reserved ' + s.committed + ' of ' + s.need).join('; ') +
                        '. Free that stock (or fix the transfer order in NetSuite) and press Retry.');
                    assertClaim(Ld.id, claim, Ld.number, 'ship');
                    ifId = tx.fulfillTransferOrder(Ld.to, lines, 'Move ' + Ld.number + ' ' + tok);
                }
                data.updateLoad(Ld, { if: ifId });
                Ld = data.getLoad(Ld.id);
            }
            data.palletsByLoad(Ld.id, [P.LOADED]).forEach(p => data.updatePallet(p, { status: P.SHIPPED, shippedDay: c.now.dayIso, data: { shippedAt: c.now.stamp } }));
            data.updateLoad(Ld, { status: L.SHIPPED, data: { approvedBy: c.actor, approvedAt: c.now.stamp, workingAt: 0, phase: '' } });
            let t = {}; try { t = data.tranids([Ld.to, Ld.if]); } catch (e) { t = {}; }
            return { number: Ld.number, toNumber: t[Ld.to] || '', ifNumber: t[Ld.if] || '' };
        } catch (e) {
            const cur = data.getLoad(Ld.id);
            if (cur && cur.status === L.SHIPPING) data.updateLoad(cur, { status: L.ERROR, data: { error: e.message, workingAt: 0 } });
            throw e;
        }
    }

    act('load_approve', true, (a, c) => shipLoad(mustLoad(a.loadId), c));

    // ── receiving (inbound) ──────────────────────────────────────────────
    const IN_OPEN = [L.SHIPPED, L.RECEIVING, L.RECV_READY, L.RECEIVED_SHORT];

    function recvView(loadId) {
        const Ld = mustLoad(loadId);
        const pallets = data.palletsByLoad(Ld.id, [P.SHIPPED, P.RECEIVED, P.MISSING]);
        const received = pallets.filter(p => p.status === P.RECEIVED);
        return { load: pubLoad(Ld, countsFromPallets(pallets)), total: pallets.length, receivedCount: received.length,
            expected: pallets.filter(p => p.status !== P.RECEIVED).map(p => pubPallet(p)),
            recent: received.slice(-5).reverse().map(p => pubPallet(p)) };
    }

    act('inbound_list', false, () => {
        const loads = data.loadsByStatus(IN_OPEN, 50);
        const counts = data.palletCountsByLoad(loads.map(l => l.id));
        return { loads: loads.map(l => pubLoad(l, counts[l.id])) };
    });

    act('recv_get', false, (a) => recvView(a.loadId));

    function receiveOne(p, Ld, c, raw) {
        if (IN_OPEN.concat([L.RECEIVED]).indexOf(Ld.status) === -1) throw userErr(Ld.number + ' is not open for receiving (' + Ld.status + ')');
        const loads = {};
        if (p && p.loadId) { const o = p.loadId === Ld.id ? Ld : data.getLoad(p.loadId); if (o) loads[o.id] = o; }
        const rule = core.receiveScanRule(p, Ld.id, loads);
        if (rule.set) {
            const patch = { status: rule.set.status, data: {} };
            if ('loadId' in rule.set) patch.load = rule.set.loadId;
            if (rule.set.status === P.RECEIVED) { patch.data.receivedAt = c.now.stamp; patch.data.receivedBy = c.actor; }
            if (rule.set.status === P.ARRIVED_UNSHIPPED) {
                patch.arrivedOn = Ld.id;
                patch.data.arrivedAt = c.now.stamp; patch.data.arrivedBy = c.actor; patch.data.arrivedFromLoad = rule.fromLoadNumber || '';
            }
            data.updatePallet(p, patch);
            if (rule.set.status === P.RECEIVED && Ld.status === L.SHIPPED) data.updateLoad(Ld, { status: L.RECEIVING });
        }
        data.logScan({ pallet: p ? p.id : '', load: Ld.id, result: rule.result, data: { raw: raw, mode: 'receive', actor: c.actor, at: c.now.stamp } });
        const fresh = p ? data.getPallet(p.id) : null;
        return { result: rule.result, tone: core.toneFor(rule.result), raw: raw, pallet: fresh ? pubPallet(fresh) : null,
            loadNumber: Ld.number, otherNumber: rule.otherNumber || '', otherLoadId: rule.otherLoadId || '',
            fromLoadNumber: rule.fromLoadNumber || '', view: recvView(Ld.id) };
    }

    act('scan_recv', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        const sc = core.parseScan(a.raw);
        return receiveOne(sc.palletId ? data.getPallet(sc.palletId) : null, Ld, c, sc.raw);
    });

    act('recv_other', false, (a, c) => {
        const p = mustPallet(a.palletId), other = mustLoad(a.otherLoadId);
        if (p.loadId !== other.id) throw userErr(p.code + ' is not on ' + other.number);
        const r = receiveOne(p, other, c, p.code);
        r.view = recvView(a.loadId || other.id);   // keep the worker on the load they are unloading
        return r;
    });

    act('recv_damaged', false, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.RECEIVED) throw userErr('Scan the pallet in first');
        data.updatePallet(p, { damaged: true, data: { damagedBy: c.actor, damagedAt: c.now.stamp } });
        return { pallet: pubPallet(data.getPallet(p.id)), view: a.loadId ? recvView(a.loadId) : null };
    });

    act('recv_undo', false, (a) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.RECEIVED || p.receipt) throw userErr(p.code + ' can no longer be undone');
        const Ld = mustLoad(p.loadId);
        const pinned = Ld.data.pendingRecv && (Ld.data.pendingRecv.ids || []).map(Number).indexOf(Number(p.id)) !== -1;
        if (Ld.status === L.RECEIVING_TX || pinned) throw userErr(p.code + ' is being received right now and can no longer be undone');
        const back = [L.RECEIVED, L.RECEIVED_SHORT].indexOf(Ld.status) !== -1 ? P.MISSING : P.SHIPPED;
        data.updatePallet(p, { status: back, damaged: false, data: { receivedAt: '', receivedBy: '' } });
        return { view: recvView(a.loadId || Ld.id) };
    });

    act('recv_ready', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        if (Ld.status !== L.RECEIVING) throw userErr(Ld.number + ' has nothing scanned in yet');
        data.updateLoad(Ld, { status: L.RECV_READY, data: { recvReadyBy: c.actor, recvReadyAt: c.now.stamp } });
        return {};
    });

    act('toreceive_list', true, () => {
        const unposted = {};
        data.findPalletsWhere({ status: [P.RECEIVED], receiptEmpty: true }).forEach(p => { unposted[p.loadId] = 1; });
        const seen = {};
        const cand = data.loadsByStatus([L.RECV_READY, L.RECEIVING_TX, L.ERROR], 50)
            .filter(l => l.if && (l.status !== L.ERROR || (l.data || {}).phase === 'recv'))
            .concat(data.getLoads(Object.keys(unposted)).filter(l => [L.RECEIVED_SHORT, L.RECEIVED].indexOf(l.status) !== -1))
            .filter(l => { if (seen[l.id]) return false; seen[l.id] = 1; return true; });
        const loads = cand.map(Ld => {
            const ps = data.palletsByLoad(Ld.id, [P.SHIPPED, P.RECEIVED, P.MISSING]);
            const scanned = ps.filter(p => p.status === P.RECEIVED);
            return Object.assign(pubLoad(Ld, countsFromPallets(ps)), {
                expected: ps.length, scanned: scanned.length,
                missing: ps.filter(p => p.status !== P.RECEIVED).map(p => ({ code: p.code, summary: p.summary })),
                damaged: ps.filter(p => p.damaged).map(p => ({ code: p.code, summary: p.summary })),
                unpostedPieces: scanned.filter(p => !p.receipt).reduce((x, p) => x + p.pieces, 0),
                late: [L.RECEIVED_SHORT, L.RECEIVED].indexOf(Ld.status) !== -1 });
        });
        const transit = data.loadsByStatus([L.SHIPPED, L.RECEIVING], 50);
        const tc = data.palletCountsByLoad(transit.map(l => l.id));
        return { loads: loads, transit: transit.map(l => pubLoad(l, tc[l.id])) };
    });

    // Resumable: `pendingRecv` pins the pallet set, and the memo token finds a
    // receipt that was saved just before a crash.
    function receiveLoad(Ld, c) {
        const ok = [L.RECV_READY, L.RECEIVED_SHORT, L.RECEIVED, L.ERROR, L.RECEIVING_TX];
        if (ok.indexOf(Ld.status) === -1 || !Ld.if || (Ld.status === L.ERROR && Ld.data.phase !== 'recv')) {
            throw userErr(Ld.number + ' is not ready to receive (' + Ld.status + ')');
        }
        if (Ld.status === L.RECEIVING_TX && !stale(Ld)) throw userErr(Ld.number + ' is already being received. Wait a minute and refresh.');
        // Check BEFORE claiming the load: a nothing-to-receive load must not flip to error status.
        if (!Ld.data.pendingRecv) {
            const unposted = data.palletsByLoad(Ld.id, [P.RECEIVED]).filter(p => !p.receipt);
            if (!unposted.length) throw userErr('Nothing scanned in on ' + Ld.number + ' to receive');
        }
        const claimed = claimLoad(Ld, L.RECEIVING_TX, 'recv');
        Ld = claimed.Ld;
        const claim = claimed.claim;
        try {
            let pend = Ld.data.pendingRecv;
            if (!pend) {
                const ids = data.palletsByLoad(Ld.id, [P.RECEIVED]).filter(p => !p.receipt).map(p => p.id);
                pend = { seq: (Number(Ld.data.recvSeq) || 0) + 1, ids: ids };
                data.updateLoad(Ld, { data: { pendingRecv: pend, recvSeq: pend.seq } });
                Ld = data.getLoad(Ld.id);
            }
            const pallets = data.palletsByIds(pend.ids);
            const lines = core.aggregate(pallets);
            const tok = core.txToken(Ld.id, 'r' + pend.seq);
            let rid = tx.findByToken(tok, 'ItemRcpt');
            if (!rid) {
                assertClaim(Ld.id, claim, Ld.number, 'recv');
                rid = tx.receiveTransferOrder(Ld.to, lines, 'Move ' + Ld.number + ' receipt ' + pend.seq + ' ' + tok);
            }
            if (Ld.receipts.indexOf(String(rid)) === -1) data.updateLoad(Ld, { receipts: Ld.receipts.concat([String(rid)]) });
            Ld = data.getLoad(Ld.id);
            pallets.forEach(p => { if (!p.receipt) data.updatePallet(p, { receipt: String(rid) }); });
            data.palletsByLoad(Ld.id, [P.SHIPPED]).forEach(p => data.updatePallet(p, { status: P.MISSING }));
            const missing = data.palletsByLoad(Ld.id, [P.MISSING]).length;
            data.updateLoad(Ld, { status: missing ? L.RECEIVED_SHORT : L.RECEIVED,
                data: { pendingRecv: null, recvApprovedBy: c.actor, recvApprovedAt: c.now.stamp, workingAt: 0, phase: '' } });
            let t = {}; try { t = data.tranids([rid]); } catch (e) { t = {}; }
            return { number: Ld.number, receiptNumber: t[rid] || '', pieces: pallets.reduce((x, p) => x + p.pieces, 0), missing: missing };
        } catch (e) {
            const cur = data.getLoad(Ld.id);
            if (cur && cur.status === L.RECEIVING_TX) data.updateLoad(cur, { status: L.ERROR, data: { error: e.message, workingAt: 0 } });
            throw e;
        }
    }

    act('recv_approve', true, (a, c) => receiveLoad(mustLoad(a.loadId), c));

    // ── catch-ups (pallet arrived without an outbound scan) ──────────────
    act('catchup_list', true, (a, c) => {
        const ps = data.palletsByStatus([P.ARRIVED_UNSHIPPED]);
        // Pallets already sent through catch-up once but stuck on a load that hasn't finished
        // receiving (usually because its ship/receive attempt errored) — surfaced so the office
        // can retry them instead of the pallet silently vanishing from every screen.
        const retryPs = data.findPalletsWhere({ catchup: true }).filter(p => p.data.catchupLoad);
        const retryLoads = {};
        data.getLoads(retryPs.map(p => p.data.catchupLoad)).forEach(l => { retryLoads[l.id] = l; });
        const retries = retryPs.filter(p => { const cl = retryLoads[p.data.catchupLoad]; return cl && cl.status !== L.RECEIVED; });
        const items = {};
        ps.forEach(p => p.lines.forEach(l => { items[l.item] = 1; }));
        const stock = Object.keys(items).length ? data.locationStock(c.S.locFrom, Object.keys(items)) : {};
        const num = {};
        data.getLoads(ps.map(p => p.arrivedOn).filter(Boolean)).forEach(l => { num[l.id] = l.number; });
        const waiting = ps.map(p => {
            const short = p.lines.filter(l => (stock[l.item] ? stock[l.item].avail : 0) < l.pcs)
                .map(l => l.sku + ' (' + (stock[l.item] ? stock[l.item].avail : 0) + ' available)');
            return pubPallet(p, { arrivedOnNumber: num[p.arrivedOn] || '', arrivedAt: p.data.arrivedAt || '', ok: !short.length, short: short.join(', ') });
        });
        const retryOut = retries.map(p => pubPallet(p, { retry: true, ok: true, error: (retryLoads[p.data.catchupLoad].data || {}).error || '' }));
        return { pallets: waiting.concat(retryOut) };
    });

    act('catchup_approve', true, (a, c) => {
        let p = mustPallet(a.palletId);
        let cl = p.data.catchupLoad ? data.getLoad(p.data.catchupLoad) : null;
        if (!cl) {
            if (p.status !== P.ARRIVED_UNSHIPPED) throw userErr(p.code + ' is not waiting for a catch-up');
            // A prior attempt may have created the load but crashed before it could be saved back
            // onto this pallet — reuse it instead of creating a second, orphaned catch-up load.
            const existing = data.loadsByStatus([L.READY, L.ERROR, L.SHIPPING], 50).find(l => (l.data || {}).catchupPallet === String(p.id));
            if (existing) {
                cl = existing;
            } else {
                const parent = p.arrivedOn ? data.getLoad(p.arrivedOn) : null;
                const id = data.createLoad({ number: core.catchupNumber(parent ? parent.number : 'MV-000', data.allLoadNumbers()), status: L.READY,
                    data: { catchupFor: parent ? parent.id : '', catchupPallet: String(p.id), createdBy: c.actor, createdAt: c.now.stamp, readyBy: c.actor, readyAt: c.now.stamp } });
                cl = data.getLoad(id);
            }
            data.updatePallet(p, { status: P.LOADED, load: cl.id, catchup: true, data: { catchupLoad: cl.id } });
        }
        if (cl.status === L.RECEIVED) return { number: cl.number, receiptNumber: '' };
        if ([L.READY, L.ERROR, L.SHIPPING].indexOf(cl.status) !== -1 && cl.data.phase !== 'recv') shipLoad(cl, c);
        cl = data.getLoad(cl.id);
        p = data.getPallet(p.id);
        if (p.status === P.SHIPPED) data.updatePallet(p, { status: P.RECEIVED, data: { receivedAt: c.now.stamp, receivedBy: c.actor } });
        if (cl.status === L.SHIPPED) { data.updateLoad(cl, { status: L.RECV_READY }); cl = data.getLoad(cl.id); }
        const r = receiveLoad(cl, c);
        return { number: cl.number, receiptNumber: r.receiptNumber };
    });

    act('catchup_reject', true, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.ARRIVED_UNSHIPPED) throw userErr(p.code + ' is not waiting for a catch-up');
        data.updatePallet(p, { status: P.LABELED, load: '', arrivedOn: '', data: { catchupRejectedBy: c.actor, catchupRejectedAt: c.now.stamp } });
        return {};
    });

    // ── dashboard ────────────────────────────────────────────────────────
    act('dashboard', true, (a, c) => {
        const sm = stockModel(c);
        const m = tracker(c, sm.est);
        const moved = data.movedByDay();
        const end = c.now.dayIso < c.S.target ? c.now.dayIso : c.S.target;
        const days = core.moveDays(c.S.start, end, c.S.skip || []).map(d => ({ day: d, n: moved[d] || 0 }));
        const loads = data.recentLoads(15);
        const lc = data.palletCountsByLoad(loads.map(l => l.id));
        const exc = {
            missing: data.countPallets({ status: [P.MISSING] }),
            arrivedUnshipped: data.countPallets({ status: [P.ARRIVED_UNSHIPPED] }),
            catchups7: data.countPallets({ catchup: true, shippedSince: core.isoAddDays(c.now.dayIso, -6) }),
            damaged: data.countPallets({ damaged: true }),
            edited: data.countPallets({ edited: true, status: [P.SHIPPED, P.RECEIVED, P.MISSING] }),
            stale: data.countPallets({ status: [P.LABELED], printedBefore: core.isoAddDays(c.now.dayIso, -(Number(c.S.staleDays) || 5)) }),
            noConfig: sm.est.unknownItems.length
        };
        const skuOf = k => (sm.stock[k] ? sm.stock[k].sku : k);
        const bySku = Object.keys(sm.est.byItem).map(k => ({ sku: skuOf(k), palletsLeft: sm.est.byItem[k] }))
            .sort((x, y) => y.palletsLeft - x.palletsLeft).slice(0, 20);
        return {
            m: Object.assign({}, m, { neededPerDay: isFinite(m.neededPerDay) ? m.neededPerDay : null }),
            labeled: data.countPallets({ status: [P.LABELED, P.LOADED] }),
            inTransit: data.countPallets({ status: [P.SHIPPED, P.MISSING] }),
            received: data.countPallets({ status: [P.RECEIVED] }),
            target: c.S.target, days: days, loads: loads.map(l => pubLoad(l, lc[l.id])), exc: exc, bySku: bySku,
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
    function receiveOn(x, p, prev, c) {
        data.updatePallet(p, { status: VP.RECEIVED, data: { receivedAt: c.now.stamp, receivedBy: c.actor } });
        pushStack(mustTruck(x.id), { id: String(p.id), prev: prev }, 'rstack');
        const cur = mustTruck(x.id);
        if (cur.status === T.DEPARTED) data.updateLoad(cur, { status: T.RECEIVING });
    }

    act('unload_list', false, () => ({ trucks: allTrucks().filter(x => x.status === T.DEPARTED || x.status === T.RECEIVING ||
        (x.status === T.RECEIVED && truckSummary(x).missing > 0)).map(truckSummary) }));

    act('unload_get', false, (a, c) => ({ view: unloadView(mustUnloadable(a.truckId), c) }));

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
        receiveOn(x, p, p.status, c);
        return { view: unloadView(mustTruck(x.id), c) };
    });

    act('unload_damaged', false, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== VP.RECEIVED) throw userErr('Scan the pallet in first');
        data.updatePallet(p, { damaged: true, data: { damagedAt: c.now.stamp, damagedBy: c.actor } });
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
        return verify.planReceipts({ alloc: x.data.alloc || [], pallets: data.palletsByLoad(x.id, [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]),
            received: x.data.received || {}, stamp: x.data.depart, seq: (Number(x.data.recvSeq) || 0) + 1 });
    }

    act('receipt_preview', true, (a) => {
        const x = mustUnloadable(a.truckId), rp = receiptPlan(x);
        return { perIf: rp.perIf, missing: rp.missing, ops: rp.ops };
    });

    act('receipt_approve', true, (a, c) => {
        const x0 = mustUnloadable(a.truckId);
        if (!receiptPlan(x0).ops.length) throw userErr('Nothing new scanned in on this truck');
        const prevStatus = x0.status === T.DEPARTED ? T.RECEIVING : x0.status;
        const cl = claimLoad(x0, T.APPROVING, 'receive', cur => {
            if (UNLOADABLE.indexOf(cur.status) === -1) throw userErr('This truck is ' + cur.status + ', not ready to approve');
        });
        const x = cl.Ld, claim = cl.claim, label = truckLabel(x);
        const rp = receiptPlan(x), seq = (Number(x.data.recvSeq) || 0) + 1;
        const writes = Object.assign({}, x.data.writes);
        data.updateLoad(data.getLoad(x.id), { data: { rplan: (x.data.rplan || []).concat(rp.ops), recvApprovedBy: c.actor, recvApprovedAt: c.now.stamp } });
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
        data.palletsByLoad(x.id, [VP.RECEIVED]).filter(p => !p.data.postedSeq).forEach(p => data.updatePallet(p, { data: { postedSeq: seq } }));
        data.palletsByLoad(x.id, [VP.IN_TRANSIT]).forEach(p => data.updatePallet(p, { status: VP.MISSING }));
        data.updateLoad(data.getLoad(x.id), { status: T.RECEIVED, data: { received: rp.cumulative, recvSeq: seq, recvRequested: null, error: '', writes: writes, workingAt: 0, claim: '', phase: '' } });
        return { perIf: rp.perIf, missing: rp.missing, written: res.written, view: unloadView(mustTruck(x.id), c) };
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

    function loadSheetModel(Ld, S) {
        const ps = data.palletsByLoad(Ld.id, [P.LOADED, P.SHIPPED, P.RECEIVED, P.MISSING]);
        const t = data.tranids([Ld.to, Ld.if].filter(Boolean));
        const tot = {}, sku = {};
        ps.forEach(p => p.lines.forEach(l => { tot[l.item] = (tot[l.item] || 0) + l.pcs; sku[l.item] = l.sku; }));
        const d = Ld.data || {};
        return { number: Ld.number, fromName: S.fromName, toName: S.toName, toNumber: t[Ld.to] || '', ifNumber: t[Ld.if] || '',
            door: d.door || '', carrier: d.carrier || '', trailer: d.trailer || '', seal: d.seal || '',
            approvedAt: d.approvedAt || '', approvedBy: d.approvedBy || '',
            pallets: ps.map(p => ({ code: p.code, summary: p.summary, pieces: p.pieces })),
            totals: Object.keys(tot).map(k => ({ sku: sku[k], qty: tot[k] })).sort((x, y) => (x.sku < y.sku ? -1 : 1)) };
    }

    function pdf(ctx) {
        const q = ctx.request.parameters;
        if (!isManager()) { ctx.response.write('Managers only'); return; }
        const S = data.getSettings();
        let xml;
        if (q.type === 'loadsheet') {
            const Ld = data.getLoad(q.loadId);
            if (!Ld) { ctx.response.write('Load not found'); return; }
            xml = tpl.loadSheetXml(loadSheetModel(Ld, S));
        } else {
            const ps = q.job ? data.palletsByJob(String(q.job)).filter(p => p.status !== P.VOID) : data.palletsByIds(String(q.ids || '').split(','));
            if (!ps.length) { ctx.response.write('No labels to print'); return; }
            xml = tpl.labelsXml(ps.map(p => ({ code: p.code, lines: p.lines, pieces: p.pieces, edited: p.edited, printedDay: p.printedDay,
                by: p.data.printedBy || '', summary: p.summary })), { codeMode: S.labelCode, header: q.header === '1', fromName: S.fromName, toName: S.toName });
        }
        ctx.response.writeFile({ file: render.xmlToPdf({ xmlString: xml }), isInline: true });
    }

    return { onRequest: onRequest, _runAction: runAction };
});
