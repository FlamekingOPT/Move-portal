/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Move Portal (Riverside -> Tippecanoe warehouse move). A separate app from the
 * picker portal; shares no code with it.
 * Spec: docs/superpowers/specs/2026-09-27-move-portal-design.md
 */
define(['N/runtime', 'N/log', 'N/render', 'N/url', 'N/format',
        './move_core', './move_data', './move_tx', './move_label_template', './move_ui'],
function (runtime, log, render, url, format, core, data, tx, tpl, ui) {
    'use strict';

    const P = core.PALLET, L = core.LOAD;
    const MANAGER_ROLE_SCRIPT_IDS = ['customrole_warehouse_manager', 'customrole1009', 'customrole2522', 'customrole_warehouse_portal_manager'];
    const PRINT_CHUNK_MAX = 80;
    const CFG_CHUNK_MAX = 100;
    const STALE_MS = 2 * 60 * 1000;

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
        const loads = data.loadsByStatus(OUT_OPEN, 50).filter(l => (l.data || {}).phase !== 'recv');
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
        if ([L.READY, L.ERROR].indexOf(Ld.status) === -1 || Ld.to) throw userErr(Ld.number + ' can no longer be sent back');
        data.updateLoad(Ld, { status: L.LOADING, data: { error: '', phase: '' } });
        return {};
    });

    act('ship_list', true, (a, c) => {
        const loads = data.loadsByStatus([L.READY, L.SHIPPING, L.ERROR], 50).filter(l => (l.data || {}).phase !== 'recv');
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
        const claim = String(Date.now()) + Math.random().toString(36).slice(2, 8);
        data.updateLoad(Ld, { status: L.SHIPPING, data: { workingAt: Date.now(), error: '', phase: 'ship', claim: claim } });
        Ld = data.getLoad(Ld.id);
        if (Ld.data.claim !== claim) throw userErr(Ld.number + ' is already being shipped by someone else. Refresh in a minute.');
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
                lines = core.aggregate(loaded);
                const stock = data.locationStock(c.S.locFrom, Object.keys(lines));
                const avail = {};
                Object.keys(stock).forEach(k => { avail[k] = stock[k].avail; });
                const short = core.shortages(lines, avail);
                if (short.length) {
                    data.updateLoad(Ld, { status: L.READY, data: { workingAt: 0, phase: '' } });
                    throw userErr('Not enough available at ' + c.S.fromName + ': ' +
                        short.map(s => name(s.item) + ' needs ' + s.need + ', available ' + s.avail).join('; ') + '. Remove a pallet or check the count.');
                }
                const tok = core.txToken(Ld.id, 'to');
                const toId = tx.findByToken(tok, 'TrnfrOrd') || tx.createTransferOrder({ fromLoc: c.S.locFrom, toLoc: c.S.locTo,
                    orderStatus: c.S.toStatus, memo: 'Move ' + Ld.number + ' ' + tok, lines: lines });
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
