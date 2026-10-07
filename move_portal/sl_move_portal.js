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
    const STALE_MS = 10 * 60 * 1000;      // above the Suitelet time limit, so a Retry can't take over a still-running request
    const STACK_MAX = 30;                 // undo stacks live in the truck JSON: keep them small
    const FLOOR_DEPLOY_ID = 'customdeploy_move_portal_floor';     // available without login: pages there call its external URL
    const MANAGER_DEPLOY_ID = 'customdeploy_move_portal';   // fail closed: any other deployment (e.g. the no-login floor URL) is floor

    // ── shared helpers ───────────────────────────────────────────────────
    function userErr(msg) { const e = new Error(msg); e.user = true; return e; }

    function isManager() {
        const u = runtime.getCurrentUser();
        const role = String(u.roleId || '').toLowerCase();
        if (role === 'administrator' || Number(u.role) === 3 || MANAGER_ROLE_SCRIPT_IDS.indexOf(role) !== -1) return true;
        return data.employeeIsPortalManager(u.id);
    }

    // Manager only on the manager deployment, with a real logged-in user (an external request runs as id -4).
    function managerDeploy() {
        const s = runtime.getCurrentScript(), u = runtime.getCurrentUser();
        return !!s && s.deploymentId === MANAGER_DEPLOY_ID && !!u && Number(u.id) > 0;
    }
    function onFloorDeploy() { return !managerDeploy(); }

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

    // The truck's last user step, for the Dashboard's Active loads. Rides on writes that already happen: never its own write.
    function stepOf(kind, c) { return { kind: kind, by: c.actor, at: c.now.stamp }; }

    function mustPallet(id) { const p = data.getPallet(id); if (!p) throw userErr('Label not found'); return p; }
    function stale(Ld) { return Date.now() - (Number(Ld.data.workingAt) || 0) > STALE_MS; }

    // Flips the load to a working status under a fresh claim token, then re-reads it to confirm
    // no other request's write interleaved. Returns the fresh load and the claim to re-check later.
    // `status` null keeps the status of the guarded fresh read (a decision must not roll back a status change that landed meanwhile).
    function claimLoad(Ld, status, phase, mustBe, extraData) {
        const cur = data.getLoad(Ld.id);               // never merge over a stale copy: re-read, then guard, then claim
        if (!cur) throw userErr('Load not found');
        if (mustBe) mustBe(cur);
        Ld = cur;
        const extra = typeof extraData === 'function' ? extraData(cur) : extraData;   // computed from the guarded copy, written with the claim
        const claim = String(Date.now()) + Math.random().toString(36).slice(2, 8);
        data.updateLoad(Ld, { status: status === null ? Ld.status : status, data: Object.assign({ workingAt: Date.now(), error: '', phase: phase, claim: claim }, extra || {}) });
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
    const DEFAULT_TRAILERS = ['537224', '416460', '105488', '522051', '211659', '543804', '487491'];   // the rotation when settings list none
    function writeMode(c) { return verify.normMode(c.S.writeMode); }
    function allTrucks() { return data.loadsByStatus(Object.values(T)).filter(x => x.data && x.data.v3); }
    function mustTruck(id) { const x = data.getLoad(id); if (!x || !x.data || !x.data.v3) throw userErr('Truck not found'); return x; }
    function truckLabel(x) {
        const d = x.data || {};
        if (d.depart) return verify.memoFor(d.depart.truckNo, d.depart.day);
        if (d.trailer) return 'Trailer ' + d.trailer;
        return (d.ifs || []).length ? d.ifs.map(f => f.ifNum).join(' + ') : 'No IFs: add one';     // gone IFs keep their number until dropped
    }
    function truckMap(list) { const o = {}; list.forEach(x => { o[x.id] = { status: x.status, label: truckLabel(x) }; }); return o; }
    function skuNames(items) { const info = data.itemInfo(items.map(String)); const o = {}; items.forEach(k => { o[k] = info[k] ? info[k].sku : String(k); }); return o; }
    function defPcs(c) { return core.defaultPcs(data.configsByItem(c.S.activeBatch)); }
    function pubIf(f, dp) {
        const pcs = f.lines.reduce((a, l) => a + l.qty, 0);
        const est = f.lines.reduce((a, l) => a + (dp[l.item] ? Math.ceil(l.qty / dp[l.item]) : 0), 0);
        return { ifId: f.ifId, ifNum: f.ifNum, status: f.status, toNum: f.toNum, trandate: f.trandate, lines: f.lines, pcs: pcs, estPallets: est };
    }
    // counts = data.palletStatusCounts(ids) run once by the caller for every truck it lists; without it, one grouped search.
    function cnt(counts, id, st) { const b = (counts || {})[String(id)] || {}; return b[st] ? b[st].n : 0; }
    function pcsOf(counts, id, sts) { const b = (counts || {})[String(id)] || {}; return sts.reduce((a, st) => a + (b[st] ? b[st].pcs : 0), 0); }
    function countsFromPallets(id, ps) {
        const b = {};
        ps.forEach(p => { const c = (b[p.status] = b[p.status] || { n: 0, pcs: 0 }); c.n++; c.pcs += Number(p.pieces) || 0; });
        return { [String(id)]: b };
    }
    function truckSummary(x, counts) {
        const k = counts || data.palletStatusCounts([x.id]), n = st => cnt(k, x.id, st);
        return { id: x.id, label: truckLabel(x), status: x.status, depart: x.data.depart || null, shipReq: x.data.shipReq || null, sentBack: x.data.sentBack || null,
            error: x.data.error || '', pallets: n(VP.LOADED) + n(VP.IN_TRANSIT) + n(VP.RECEIVED) + n(VP.MISSING), received: n(VP.RECEIVED),
            missing: n(VP.MISSING) + (x.status === T.RECEIVED ? n(VP.IN_TRANSIT) : 0) };
    }
    // Received pallets not yet in an approved receipt. Kept on the truck (data.unposted); a pre-flag truck falls back to a search.
    function unpostedOf(x, counts) {
        if (typeof x.data.unposted === 'number') return x.data.unposted;
        if (!x.data.recvSeq) return cnt(counts || data.palletStatusCounts([x.id]), x.id, VP.RECEIVED);
        return data.palletsByLoad(x.id, [VP.RECEIVED]).filter(p => !p.data.postedSeq).length;
    }
    // opt.planned / opt.trucks: reads the caller already made, so a needs_fix view doesn't read them again.
    // The truck's Item Receipts from its writes (receipt:<ifId>:<seq> -> id): number, IF, pieces. irNums holds numbers saved at approve;
    // older trucks are looked up once per request.
    const IR_SEEN = {};
    function irsOf(x) {
        const d = x.data || {}, saved = d.irNums || {}, list = [];
        Object.keys(d.writes || {}).forEach(k => {
            const m = /^receipt:([^:]+):(\d+)$/.exec(k);
            if (m) list.push({ ifId: m[1], seq: Number(m[2]), irId: String(d.writes[k]) });
        });
        const need = list.filter(r => !saved[r.irId] && !(r.irId in IR_SEEN)).map(r => r.irId);
        if (need.length && tx.tranIds) { let got = {}; try { got = tx.tranIds(need); } catch (e) { /* ids shown */ } need.forEach(id => { IR_SEEN[id] = got[id] || ''; }); }
        return list.sort((p, q) => p.seq - q.seq || Number(p.ifId) - Number(q.ifId)).map(r => {
            const op = (d.rplan || []).find(o => String(o.ifId) === r.ifId && Number(o.seq) === r.seq);
            return Object.assign(r, { irNum: saved[r.irId] || IR_SEEN[r.irId] || 'IR id ' + r.irId, ifNum: op ? op.ifNum : '', pcs: op ? Object.keys(op.lines).reduce((s, i) => s + Number(op.lines[i]), 0) : null });
        });
    }
    function truckView(x, c, opt) {
        const d = x.data || {}, dp = defPcs(c), live = verify.liveIfs(d.ifs);
        const ps = data.palletsByLoad(x.id, [VP.LOADED, VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
        const fill = verify.fillExpected(live, verify.sumLines(ps));
        const lines = [];
        live.forEach(f => f.lines.forEach(l => lines.push({ ifNum: f.ifNum, item: l.item, sku: l.sku, expected: l.qty,
            scanned: fill.alloc[f.ifId] ? fill.alloc[f.ifId][l.item] || 0 : 0, estPallets: dp[l.item] ? Math.ceil(l.qty / dp[l.item]) : null })));
        const extraIds = Object.keys(fill.left).filter(k => fill.left[k] > 0), sk = skuNames(extraIds);
        const vd = d.verify ? pubDiffs(d.verify.diffs || [], ps.filter(p => p.status === VP.LOADED)) : null;
        return { stage: x.status, verify: d.verify ? Object.assign({}, d.verify, { diffs: vd }) : null,
            suggestions: x.status === T.NEEDS_FIX && d.verify ? suggestionsFor(x, d.ifs, d.verify.diffs || [], dp, (opt || {}).trucks, (opt || {}).planned) : [],   // only needs_fix reads NetSuite here
            truck: Object.assign(truckSummary(x, countsFromPallets(x.id, ps)), { bol: d.bol || null }), lines: lines,
            extras: extraIds.map(k => ({ item: k, sku: sk[k], scanned: fill.left[k] })),
            pallets: ps.map(p => pubPallet(p)), totals: { pallets: ps.length, pieces: ps.reduce((a, p) => a + p.pieces, 0) },
            trailers: c.S.trailers || DEFAULT_TRAILERS, carrier: c.S.defaultCarrier || 'Armstrong Group', writeMode: writeMode(c),
            trailer: d.trailer || '', otherItems: d.otherItems || [], shortNote: d.shortNote || null,
            receipt: d.depart ? receiptView(x, ps) : null };
    }
    // After departure the truck pop-up shows what arrived, not what was loaded: received / shipped per IF, missing pallets, its IRs.
    function receiptView(x, ps) {
        const sent = ps.filter(p => p.status !== VP.LOADED), d = x.data;
        const rp = verify.planReceipts({ alloc: d.alloc || [], pallets: sent, received: d.received || {}, stamp: d.depart, seq: 0 });
        return { perIf: rp.perIf, missing: sent.filter(p => p.status === VP.MISSING).map(p => p.code),
            inTransit: sent.filter(p => p.status === VP.IN_TRANSIT).length, irs: irsOf(x) };
    }
    // Stages where pallets may go on or off.
    const OPEN = [T.LOADING, T.NEEDS_FIX, T.READY];
    function isOpen(x) { return OPEN.indexOf(x.status) !== -1 && !x.data.claim && !x.data.depart; }
    // After a pallet change: a fresh read, never written over a truck that closed meanwhile (the pallet update itself is
    // already done). A `ready` truck goes back to `loading` in the same write, so its old verify result can't be used.
    function touched(id, patchData, noPalletChange) {
        const cur = data.getLoad(id);
        if (!cur || !isOpen(cur)) return;
        const patch = { data: typeof patchData === 'function' ? patchData(cur) : (patchData || {}) };
        if (cur.status === T.READY && !noPalletChange) patch.status = T.LOADING;
        if (!patch.status && !Object.keys(patch.data).length) return;
        data.updateLoad(cur, patch);
    }
    function pushStack(id, entry, c) {
        touched(id, cur => ({ stack: (cur.data.stack || []).concat([entry]).slice(-STACK_MAX), lastStep: stepOf('scanned', c) }));
    }
    // Load scans: a pallet on another open truck (any open stage) can be moved here, so it reads as a loading truck.
    function scanTruckMap(list) {
        const o = truckMap(list);
        Object.keys(o).forEach(k => { if (OPEN.indexOf(o[k].status) !== -1) o[k].status = T.LOADING; });
        return o;
    }
    // The room accepted-but-pending pallets will need once the office acts. Their ops live on the pallets (decision.op), not on a truck plan,
    // and every truck counts, the one being decided on included (its other pending accepts are still pending).
    // Stacked accepts on one IF line each target the line on top of the earlier ones (while `from` stays NetSuite's qty), so they reserve once per
    // (TO, IF, SKU): the highest target minus what NetSuite reads now, not the sum of each op's own to - from.
    function pendingReservations(trucks) {
        const res = {}, add = (toId, item, q) => { if (q > 0) { const k = String(toId) + '|' + String(item); res[k] = (res[k] || 0) + q; } };
        const qtys = {}, creates = [];
        (trucks || []).filter(x => UNLOADABLE.indexOf(x.status) !== -1 || x.status === T.APPROVING).forEach(x => pendingAccepts(x).forEach(p => {
            const op = (p.data.decision || {}).op;
            if (!op) return;
            if (op.op === 'if_qty') {
                const k = String(op.toId) + '|' + String(op.ifId) + '|' + String(op.item), g = qtys[k] || (qtys[k] = { op: op, to: 0 });
                g.to = Math.max(g.to, Number(op.to) || 0);
            }
            if (op.op === 'if_create') creates.push(op);
        }));
        const groups = Object.keys(qtys);
        if (!groups.length && !creates.length) return res;
        const info = ns.ifInfo();                           // read once, and only when something is pending
        groups.forEach(k => {
            const g = qtys[k], f = (info || {})[String(g.op.ifId)];
            const cur = f ? (f.lines || []).filter(l => String(l.item) === String(g.op.item)).reduce((n, l) => n + Number(l.qty || 0), 0) : Number(g.op.from) || 0;
            add(g.op.toId, g.op.item, g.to - cur);
        });
        creates.forEach(op => {
            if (findAddOnIf(op.toId, op.lines || {}, info, trucks || [], null, {})) return;   // the office IF exists: NetSuite's TO remaining already counts it
            Object.keys(op.lines || {}).forEach(k => add(op.toId, k, Number(op.lines[k]) || 0));
        });
        return res;
    }
    // Open TO lines minus the room other trucks will need (loading surplus, planned-but-unwritten raises and add-ons, pending accepts).
    function reservedToLines(exceptId, trucks, loadedAll, c, openTo) {
        const byTruck = {}, toLines = verify.reserveToLines(openTo || ns.openToLines(), pendingReservations(trucks));
        (loadedAll || data.palletsByStatus([VP.LOADED])).forEach(p => { (byTruck[p.loadId] = byTruck[p.loadId] || []).push(p); });
        Object.keys(byTruck).forEach(k => { byTruck[k] = verify.sumLines(byTruck[k]); });
        return verify.reserveToLines(toLines, verify.reservationsFromTrucks({ trucks: trucks, loadedByTruck: byTruck, toLines: toLines, mode: writeMode(c), exceptId: exceptId }));
    }
    function scanCtx(x, c) {
        const trucks = allTrucks(), loadedAll = data.palletsByStatus([VP.LOADED]);
        return { truckId: x.id, trucks: scanTruckMap(trucks), ifs: verify.liveIfs(x.data.ifs), toLines: reservedToLines(x.id, trucks, loadedAll, c),
            loadedByItem: verify.sumLines(loadedAll.filter(p => p.loadId === String(x.id))) };
    }
    // Called at the start and again right before a pallet changes, so a scan never lands on a truck that is departing.
    function mustOpenTruck(id) {
        const x = mustTruck(id);
        if (x.status === T.SHIP_PENDING) throw waitingErr();
        if (!isOpen(x)) throw userErr('Scanning is closed on this truck');
        return x;
    }

    // ── Verify Load (spec 2026-10-05) ────────────────────────────────────
    // Each diff plus a floor instruction; pallet counts only when every loaded pallet of that item has the same pcs.
    // skAll: SKU names the caller already looked up for several trucks at once (approvals).
    function pubDiffs(diffs, loaded, skAll) {
        const items = [...new Set(diffs.filter(d => d.item).map(d => String(d.item)))], sk = skAll || skuNames(items), pcs = {};
        loaded.forEach(p => (p.lines || []).forEach(l => { const k = String(l.item); (pcs[k] = pcs[k] || {})[Number(l.pcs)] = 1; }));
        const one = k => { const v = Object.keys(pcs[k] || {}); return v.length === 1 ? Number(v[0]) : null; };
        return diffs.map(d => Object.assign({}, d, { sku: d.item ? sk[String(d.item)] : '', text: verify.diffText(d, d.item ? sk[String(d.item)] : '', d.item ? one(String(d.item)) : null) }));
    }
    function takenByOthers(trucks, exceptId) {
        const o = {};
        trucks.forEach(t => { if (String(t.id) !== String(exceptId)) (t.data.ifs || []).forEach(f => { o[String(f.ifId)] = true; }); });
        return o;
    }
    // Picked/Packed IFs on this truck's TOs (or the TO a no_if diff names) that no truck has. Never attached by itself.
    function suggestionsFor(x, ifs, diffs, dp, trucks, planned) {
        const list = verify.ifSuggestions({ truckIfs: ifs || [], diffs: diffs, planned: planned || ns.plannedIfs(), takenIfIds: takenByOthers(trucks || allTrucks(), x.id) });
        return list.map(f => pubIf(f, dp));
    }
    // What a verify result depends on: IF ids, gone flags and line qtys; the diffs as saved.
    function ifSig(ifs) { return JSON.stringify((ifs || []).map(f => [String(f.ifId), !!f.gone, (f.lines || []).map(l => [String(l.item), Number(l.qty)])]).sort()); }
    function diffSig(diffs) { return JSON.stringify(diffs || null); }
    function palletKey(ps) { return ps.map(p => String(p.id)).sort().join(','); }
    // Shared by truck_verify, trucks_recheck, truck_add_if, truck_drop_if (and departure in Task 3).
    // opt.newIfs(x, planned, trucks): the IF list to check (default: the saved one). Saves the fresh NetSuite IFs plus the
    // gone ones (flagged) as data.ifs, so reservations never use a stale IF qty and if_gone repeats until a manager drops it.
    // opt.truck/trucks/planned/openTo/loadedAll: reads the caller already made (recheck reads them once per request).
    // opt.poll: write only when the status, the diffs or the IFs changed. Any verify keeps at/by when nothing changed.
    // opt.auto (trucks_recheck): a change found by the background poll is recorded as AUTO_BY, not the polling device.
    // Refuses if the truck closed, or its IFs or pallets changed while it was being checked.
    // The verify rule with no write: departure re-runs it from the claimed (frozen) truck.
    function checkTruck(x, c, opt) {
        opt = opt || {};
        const trucks = opt.trucks || allTrucks(), planned = opt.planned || ns.plannedIfs();
        const ifs = opt.newIfs ? opt.newIfs(x, planned, trucks) : (x.data.ifs || []);
        const ps = opt.loadedAll ? opt.loadedAll.filter(p => String(p.loadId) === String(x.id)) : data.palletsByLoad(x.id, [VP.LOADED]);
        const r = verify.verifyLoad({ savedIfs: ifs, freshIfs: planned, pallets: ps, toLines: reservedToLines(x.id, trucks, opt.loadedAll, c, opt.openTo) });
        return { r: r, ps: ps, trucks: trucks, planned: planned };
    }
    const AUTO_BY = { id: 0, name: 'Auto re-check' };
    // Why verify can't run: a manager's correction holds the claim only briefly, so say so instead of "departing".
    function waitingErr() { return userErr('This truck is waiting for a manager to confirm shipping'); }
    function closedErr(x) {
        if (x && x.status === T.SHIP_PENDING) return waitingErr();
        if (x && x.data.claim && x.data.phase === 'correct' && !x.data.depart) return userErr('This truck is being corrected by a manager, try again in a moment');
        return userErr('This truck is closed for changes (' + (x ? (x.data.claim || x.data.depart ? T.DEPARTING : x.status) : 'gone') + ')');
    }
    function verifyTruck(id, c, opt) {
        opt = opt || {};
        const x = opt.truck || mustTruck(id);
        if (!isOpen(x)) throw closedErr(x);
        const chk = checkTruck(x, c, opt), r = chk.r, ps = chk.ps, trucks = chk.trucks, planned = chk.planned;
        // A manual Verify that finds a short needs a note (once per truck); nothing is written without it.
        if (opt.needNote && !opt.note && !x.data.shortNote && r.diffs.some(d => d.kind === 'if_short')) return { needsNote: true, r: r, x: x, ps: ps };
        const status = r.match ? T.READY : T.NEEDS_FIX;
        const changed = status !== x.status || ifSig(r.keep) !== ifSig(x.data.ifs) || diffSig(r.diffs) !== diffSig((x.data.verify || {}).diffs);
        const out = { r: r, x: x, ps: ps, trucks: trucks, planned: planned, changed: changed };
        if (opt.poll && !changed) return out;
        if (palletKey(data.palletsByLoad(x.id, [VP.LOADED])) !== palletKey(ps)) throw userErr('This truck changed while it was being checked. Verify again.');
        const cur = data.getLoad(id);                 // right before the write: never merge over a stale copy
        if (!cur || !isOpen(cur)) throw closedErr(cur);
        if (ifSig(cur.data.ifs) !== ifSig(x.data.ifs)) throw userErr('This truck changed while it was being checked. Verify again.');
        // Unchanged: keep at/by, so a re-pressed Verify never raises a second ready alert. A poll-driven change is the auto re-check's.
        const old = x.data.verify || {}, by = !changed && old.at ? old.by : opt.auto ? AUTO_BY : c.actor;
        data.updateLoad(cur, { status: status, data: Object.assign({ ifs: r.keep, verify: { at: !changed && old.at ? old.at : c.now.stamp, by: by, diffs: r.diffs } },
            status === T.READY ? { correctError: '' } : {}, opt.note ? { shortNote: { text: opt.note, by: c.actor, at: c.now.stamp } } : {},
            changed ? { lastStep: stepOf(opt.stepKind || 'verified', c) } : {}) });      // a ready truck has nothing left to correct
        out.x = mustTruck(id);
        return out;
    }
    function verifyOut(v, c) {
        if (v.needsNote) return { needsNote: true, diffs: pubDiffs(v.r.diffs, v.ps) };
        const view = truckView(v.x, c, { planned: v.planned, trucks: v.trucks });   // lists suggestions when the truck is needs_fix
        return { match: v.r.match, diffs: pubDiffs(v.r.diffs, v.ps), suggestions: view.suggestions, view: view };
    }
    // Departure leaves only from Ready, with no claim and no depart yet.
    function notReady(x) {
        if (x.status === T.LOADING || x.status === T.NEEDS_FIX) return userErr('Verify the load first');
        if (x.status === T.SHIP_PENDING) return userErr('This truck is already marked shipped');
        return userErr('This truck is already ' + (x.status === T.READY ? T.DEPARTING : x.status));
    }
    function mustReady(x) { if (x.status !== T.READY || x.data.claim || x.data.depart) throw notReady(x); }
    // Ship confirm and send back act only on a marked truck nobody is processing.
    function mustPending(x) {
        if (x.status === T.SHIP_PENDING && !x.data.claim && !x.data.depart && x.data.shipReq) return;
        if (x.status === T.SHIP_PENDING || x.status === T.DEPARTING) throw userErr((truckLabel(x) || 'This truck') + ' is already being processed by someone else. Refresh in a minute.');
        throw userErr('This truck is ' + x.status + ', not waiting for a ship confirmation');
    }
    function sealTaken(seal, id) {
        const h = verify.sealHolder(allTrucks(), seal, id);
        if (!h) return;
        const tr = (h.data.depart && h.data.depart.trailer) || h.data.trailer;
        throw userErr('Seal ' + seal + ' is already on ' + (tr ? 'Trailer ' + tr : truckLabel(h)));
    }
    // chk: a checkTruck result that matched. The plan comes from the IFs and pallets it checked.
    function departPlan(x, inp, c, chk) {
        const truckNo = verify.truckNoForDay(chk.trucks, c.now.dayIso, x.id), ps = chk.ps;
        if (!ps.length) throw userErr('Nothing is loaded on this truck');
        let plan;
        try {
            plan = verify.planDeparture({ ifs: chk.r.ifs, pallets: ps, toLines: reservedToLines(x.id, chk.trucks, null, c),
                stamp: { trailer: inp.trailer, seal: inp.seal, truckNo: truckNo, dayIso: c.now.dayIso } });
        } catch (e) { if (/^No open transfer order covers/.test(e.message || '')) throw userErr(e.message); throw e; }
        return { truckNo: truckNo, palletKey: palletKey(ps), plan: plan, ifs: chk.r.ifs, otherItems: x.data.otherItems || [] };
    }
    // Safety net: a matched load plans stamps only. Anything else is a mismatch, never a silent correction.
    function planMismatch(plan) {
        return plan.corrections.map(o => ({ key: 'plan:' + verify.opKey(o), kind: 'plan_mismatch', op: o.op, ifNum: o.ifNum || '', ifId: o.ifId || '' }))
            .concat(plan.unplanned.map(u => ({ key: 'plan:unplanned:' + u.ifId, kind: 'plan_mismatch', op: 'unplanned', ifNum: u.ifNum, ifId: String(u.ifId) })));
    }
    // seenIfs: the IFs on the truck copy the check ran on, so the needs_fix write never lands over IFs changed meanwhile.
    function mismatch(chk, diffs, x) { return Object.assign(new Error('mismatch'), { mismatch: { keep: chk.r.keep, diffs: diffs || chk.r.diffs, ps: chk.ps, seenIfs: x.data.ifs } }); }
    // Back to needs_fix with the new diffs. Without `claim` the truck must still be open; with it the claim must still be ours,
    // and the departure state written with the claim is cleared. Always a fresh read right before the write.
    // pending: the truck is ship_pending (Confirm shipped re-verified before claiming).
    function toNeedsFix(id, m, c, claim, pending) {
        const cur = data.getLoad(id);
        if (!cur) throw userErr('Truck not found');
        const ok = claim ? cur.data.claim === claim : pending ? cur.status === T.SHIP_PENDING && !cur.data.claim && !cur.data.depart : isOpen(cur);
        if (!ok) throw userErr((truckLabel(cur) || 'This truck') + ' is already being processed by someone else. Refresh in a minute.');
        if (!claim && ifSig(cur.data.ifs) !== ifSig(m.seenIfs)) throw userErr('This truck changed while it was being checked. Verify again.');
        data.updateLoad(cur, { status: T.NEEDS_FIX, data: Object.assign({ ifs: m.keep, verify: { at: c.now.stamp, by: c.actor, diffs: m.diffs }, claim: '', workingAt: 0, phase: '' },
            claim ? { depart: null, plan: null, alloc: null, unplanned: null, bol: null, writes: null, departPallets: null } : {}, claim || pending ? { shipReq: null } : {}) });
        const x = mustTruck(id), view = truckView(x, c);
        return { needsFix: true, match: false, diffs: pubDiffs(m.diffs, m.ps), suggestions: view.suggestions, view: view };
    }
    function finishDepart(x, c, claim) {
        const writes = Object.assign({}, x.data.writes);
        try {
            verify.runOps(x.data.plan, writeMode(c), op => {
                assertClaim(x.id, claim, truckLabel(x), 'depart');
                return tx.apply(op);
            }, writes,
                (k, id) => { writes[k] = id; data.updateLoad(data.getLoad(x.id), { data: { writes: writes } }); });  // fresh read so a stale copy never rewrites the claim
        } catch (e) {
            if (e.user) throw e;                      // claim lost: another request owns the truck now, leave its state alone
            log.error({ title: 'move depart ' + x.id, details: (e && e.stack) || String(e) });
            data.updateLoad(data.getLoad(x.id), { data: { error: e.message || String(e), writes: writes } });
            throw userErr('Departure saved but a NetSuite write failed: ' + (e.message || e) + '. A manager can press Retry.');
        }
        assertClaim(x.id, claim, truckLabel(x), 'depart');
        // Only the pallets the plan was built from leave; one that slipped on after the plan stays at the dock.
        const planned = x.data.departPallets == null ? null : String(x.data.departPallets).split(',').filter(Boolean);
        data.palletsByLoad(x.id, [VP.LOADED]).forEach(p => {
            if (!planned || planned.indexOf(String(p.id)) !== -1) data.updatePallet(p, { status: VP.IN_TRANSIT, shippedDay: x.data.depart.day });
            else data.updatePallet(p, { status: VP.LABELED, load: '', data: { flag: 'left_at_dock', leftAt: (c.now || {}).stamp || '', leftTruck: x.id } });
        });
        data.updateLoad(data.getLoad(x.id), { status: T.DEPARTED, data: { error: '', writes: writes, workingAt: 0, claim: '', phase: '', shortNote: null } });   // the note lives until the truck leaves
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

    act('pallet_void', true, (a, c) => {
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

    act('truck_planned', false, (a, c) => {
        const trucks = allTrucks(), taken = {}, dp = defPcs(c);
        trucks.forEach(x => (x.data.ifs || []).forEach(f => { taken[f.ifId] = true; }));
        const open = trucks.filter(x => OPEN.indexOf(x.status) !== -1 || x.status === T.SHIP_PENDING || x.status === T.DEPARTING);
        // Shipped today (Shipments tab): trucks that left with today's departure day.
        const shipped = trucks.filter(x => x.status !== T.DEPARTING && x.data.depart && x.data.depart.day === c.now.dayIso);
        const counts = data.palletStatusCounts(open.concat(shipped).map(x => x.id));
        const busy = {};
        trucks.filter(x => TRAILER_BUSY.indexOf(x.status) !== -1).forEach(x => { busy[normTrailer(x.data.trailer)] = true; });
        return { planned: ns.plannedIfs().filter(f => !taken[f.ifId]).map(f => pubIf(f, dp)),
            open: open.map(x => truckSummary(x, counts)), shippedToday: shipped.map(x => truckSummary(x, counts)), pulledAt: ns.pulledAt(),
            trailers: (c.S.trailers || DEFAULT_TRAILERS).filter(t => !busy[normTrailer(t)]), carrier: c.S.defaultCarrier || 'Armstrong Group' };
    });

    // A trailer is on one truck at a time until it leaves.
    const TRAILER_BUSY = [T.LOADING, T.NEEDS_FIX, T.READY, T.SHIP_PENDING, T.DEPARTING];
    const normTrailer = t => String(t || '').trim().toUpperCase();
    // A trailer # entered on the floor: trimmed, 1-20 chars, not on another open truck (exceptId = the truck it goes on).
    function checkTrailer(raw, exceptId) {
        const trailer = String(raw || '').trim();
        if (!trailer) throw userErr('Enter the trailer #');
        if (trailer.length > 20) throw userErr('The trailer # is too long (20 characters max)');
        if (data.loadsByStatus(TRAILER_BUSY).some(x => x.data && x.data.v3 && String(x.id) !== String(exceptId) && normTrailer(x.data.trailer) === normTrailer(trailer)))
            throw userErr('Trailer ' + trailer + ' is already on an open truck');
        return trailer;
    }
    act('truck_start', false, (a, c) => {
        const ids = (a.ifIds || []).map(String);
        if (!String(a.trailer || '').trim()) throw userErr('Enter the trailer #');
        if (!ids.length) throw userErr('Pick at least one IF');
        const trailer = checkTrailer(a.trailer, null);
        const planned = ns.plannedIfs(), taken = {};
        allTrucks().forEach(x => (x.data.ifs || []).forEach(f => { taken[f.ifId] = true; }));
        const ifs = ids.map(id => {
            const f = planned.find(y => y.ifId === id);
            if (taken[id]) throw userErr((f ? f.ifNum : 'IF ' + id) + ' is already on a truck');
            if (!f) throw userErr('IF ' + id + ' is not Picked/Packed any more. Refresh the list.');
            return f;
        });
        const id = data.createLoad({ number: ifs.map(f => f.ifNum).join('+').slice(0, 290), status: T.LOADING,
            data: { v3: true, ifs: ifs, trailer: trailer, startedBy: c.actor, startedAt: c.now.stamp, stack: [], lastStep: stepOf('started', c) } });
        return { view: truckView(mustTruck(id), c) };
    });

    // Fix the trailer # on an open truck. Not a load change, so the status stays (a ready truck stays ready).
    act('truck_set_trailer', false, (a, c) => {
        const x = mustOpenTruck(a.truckId);
        const trailer = checkTrailer(a.trailer, x.id);
        const cur = mustOpenTruck(x.id);              // fresh read right before the write
        if (cur.data.trailer !== trailer) data.updateLoad(cur, { data: { trailer: trailer, trailerBy: c.actor, trailerAt: c.now.stamp } });
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('truck_get', false, (a, c) => ({ view: truckView(mustTruck(a.truckId), c) }));

    // Take off: only a pallet loaded on this truck goes back to labeled. No capacity check is needed.
    function takeOff(x, s, p, c) {
        let result = 'not_on_truck';
        if (p && p.status === VP.LOADED && String(p.loadId) === String(x.id)) {
            mustOpenTruck(x.id);
            data.updatePallet(p, { status: VP.LABELED, load: '', data: { takenOffAt: c.now.stamp, takenOffBy: c.actor, takenOffTruck: x.id } });
            touched(x.id, { lastStep: stepOf('taken_off', c) });
            result = 'taken_off';
        }
        data.logScan({ pallet: p ? p.id : '', load: x.id, result: result, data: { raw: s.raw, mode: 'off', actor: c.actor, at: c.now.stamp } });
        return { result: result, raw: s.raw, tone: result === 'taken_off' ? 'warn' : 'bad', pallet: p ? pubPallet(data.getPallet(p.id)) : null, view: truckView(mustTruck(x.id), c) };
    }

    act('truck_scan', false, (a, c) => {
        const x = mustOpenTruck(a.truckId);
        const s = core.parseScan(a.raw);
        const p = s.palletId ? data.getPallet(s.palletId) : null;
        if (a.mode === 'off') return takeOff(x, s, p, c);
        if (p && ((p.data.decision && p.data.decision.kind === 'accepted_pending') || p.data.flag === 'never_loaded')) {   // a manager is deciding it at Tippecanoe: it must not load here
            data.logScan({ pallet: p.id, load: x.id, result: 'flagged_tippecanoe', data: { raw: s.raw, mode: 'load', actor: c.actor, at: c.now.stamp } });
            return { result: 'flagged_tippecanoe', raw: s.raw, tone: 'bad', pallet: pubPallet(p), view: truckView(mustTruck(x.id), c) };
        }
        let sc;                                       // capacity data (TO lines, all trucks) only for a pallet that can actually load
        if (p && p.status === VP.LABELED) sc = scanCtx(x, c);
        else {
            const o = p && p.loadId ? data.getLoad(p.loadId) : null;
            sc = { truckId: x.id, trucks: o ? scanTruckMap([o]) : {} };
        }
        const r = verify.classifyLoadScan(Object.assign({ pallet: p }, sc));
        if (r.set) {
            mustOpenTruck(x.id);
            data.updatePallet(p, { status: r.set.status, load: x.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor } });
            pushStack(x.id, String(p.id), c);
        }
        data.logScan({ pallet: p ? p.id : '', load: x.id, result: r.result, data: { raw: s.raw, mode: 'load', actor: c.actor, at: c.now.stamp } });
        return Object.assign({}, r, { raw: s.raw, tone: verify.toneFor(r.result), pallet: p ? pubPallet(data.getPallet(p.id)) : null, view: truckView(mustTruck(x.id), c) });
    });

    act('truck_move_here', false, (a, c) => {
        const x = mustOpenTruck(a.truckId), p = mustPallet(a.palletId);
        const from = p.loadId ? data.getLoad(p.loadId) : null;
        if (p.status !== VP.LOADED || !from || !isOpen(from)) throw userErr('That pallet can no longer be moved');
        const r = verify.fitOnTruck(p, scanCtx(x, c));
        if (r.result === 'no_to') throw userErr('No open transfer order for ' + r.sku + ' on this truck. Set it aside and call the office.');
        mustOpenTruck(x.id);
        data.updatePallet(p, { load: x.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor } });
        pushStack(x.id, String(p.id), c);
        touched(from.id);                             // the truck it came from lost a pallet too
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('truck_remove', false, (a, c) => {
        const x = mustOpenTruck(a.truckId), p = mustPallet(a.palletId);
        if (p.status !== VP.LOADED || p.loadId !== x.id) throw userErr('That pallet is not on this truck');
        data.updatePallet(p, { status: VP.LABELED, load: '' });
        touched(x.id);
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('truck_undo', false, (a, c) => {
        const x = mustOpenTruck(a.truckId), st = (x.data.stack || []).slice();
        let undone = false;
        while (st.length) {
            const p = data.getPallet(st.pop());
            if (p && p.status === VP.LOADED && p.loadId === x.id) { mustOpenTruck(x.id); data.updatePallet(p, { status: VP.LABELED, load: '' }); undone = true; break; }
        }
        touched(x.id, { stack: st }, !undone);
        return { view: truckView(mustTruck(x.id), c) };
    });

    // A floor Verify that finds a short needs a note; a manager's Re-check never does (a note given is still saved).
    act('truck_verify', false, (a, c) => verifyOut(verifyTruck(a.truckId, c, { needNote: !c.mgr, note: String(a.shortNote || '').trim().slice(0, 300) }), c));

    // Other (non-inventory) items: typed lines, not in NetSuite, ignored by Verify. An edit sends a ready truck back to loading.
    function editOther(id, fn) {
        mustOpenTruck(id);
        const cur = data.getLoad(id);                 // fresh read right before the write
        if (!cur || !isOpen(cur)) throw closedErr(cur);
        const patch = { data: { otherItems: fn((cur.data.otherItems || []).slice()) } };
        if (cur.status === T.READY) patch.status = T.LOADING;
        data.updateLoad(cur, patch);
    }
    act('truck_other_add', false, (a, c) => {
        const desc = String(a.desc || '').trim(), qty = Number(a.qty);
        if (!desc || desc.length > 80) throw userErr('Enter a description (1 to 80 characters)');
        if (!Number.isInteger(qty) || qty < 1) throw userErr('Enter a count of 1 or more (whole number)');
        const item = { id: String(Date.now()) + String(Math.floor(Math.random() * 10000)).padStart(4, '0'), desc: desc, qty: qty, by: c.actor, at: c.now.stamp };
        editOther(a.truckId, list => list.concat([item]));
        return { view: truckView(mustTruck(a.truckId), c) };
    });
    act('truck_other_remove', false, (a, c) => {
        const id = String(a.id || '');
        editOther(a.truckId, list => {
            if (!list.some(o => String(o.id) === id)) throw userErr('That item is not on this truck');
            return list.filter(o => String(o.id) !== id);
        });
        return { view: truckView(mustTruck(a.truckId), c) };
    });

    // An office fix in NetSuite (IF qty edited, IF added) can turn a needs_fix truck ready without anyone scanning.
    act('trucks_recheck', false, (a, c) => {
        const trucks = allTrucks(), nowReady = [];
        // ready: every truck ready now, with its verify time, so each device alerts once per ready event (not only the one that saw nowReady).
        const readyOut = list => list.map(x => ({ id: x.id, label: truckLabel(x), at: (x.data.verify || {}).at || '' }));
        const ready = trucks.filter(x => x.status === T.READY && isOpen(x));
        const fix = trucks.filter(x => x.status === T.NEEDS_FIX && isOpen(x));
        if (!fix.length) return { nowReady: nowReady, ready: readyOut(ready) };
        const shared = { trucks: trucks, planned: ns.plannedIfs(), openTo: ns.openToLines(), loadedAll: data.palletsByStatus([VP.LOADED]), poll: true, auto: true };
        fix.forEach(x => {
            let v;
            try { v = verifyTruck(x.id, c, Object.assign({ truck: x }, shared)); } catch (e) { if (e.user) return; throw e; }
            if (v.r.match) { nowReady.push({ id: v.x.id, label: truckLabel(v.x) }); ready.push(v.x); }
        });
        return { nowReady: nowReady, ready: readyOut(ready) };
    });

    // Floor: only an IF the verify suggests. Manager: any Picked/Packed IF no truck has.
    act('truck_add_if', false, (a, c) => {
        const ifId = String(a.ifId || '');
        const v = verifyTruck(a.truckId, c, { stepKind: 'if_added', newIfs: (x, planned, trucks) => {
            const f = planned.find(y => String(y.ifId) === ifId);
            if ((x.data.ifs || []).some(y => String(y.ifId) === ifId)) throw userErr((f ? f.ifNum : 'IF ' + ifId) + ' is already on this truck');
            if (takenByOthers(trucks, x.id)[ifId]) throw userErr((f ? f.ifNum : 'IF ' + ifId) + ' is already on another truck');
            if (!c.mgr) {
                const diffs = (x.data.verify || {}).diffs;
                const ok = x.status === T.NEEDS_FIX && diffs && verify.ifSuggestions({ truckIfs: x.data.ifs || [], diffs: diffs, planned: planned,
                    takenIfIds: takenByOthers(trucks, x.id) }).some(y => String(y.ifId) === ifId);
                if (!ok) throw userErr((f ? f.ifNum : 'IF ' + ifId) + ' is not a suggested IF for this truck. Ask a manager.');
            }
            if (!f) throw userErr('IF ' + ifId + ' is not Picked/Packed any more. Refresh the list.');
            return (x.data.ifs || []).concat([f]);
        } });
        return verifyOut(v, c);
    });

    act('truck_drop_if', true, (a, c) => {
        const ifId = String(a.ifId || '');
        const v = verifyTruck(a.truckId, c, { stepKind: 'if_dropped', newIfs: x => {
            const ifs = x.data.ifs || [], f = ifs.find(y => String(y.ifId) === ifId);
            if (!f) throw userErr('That IF is not on this truck');
            if (ifs.length === 1 && !f.gone) throw userErr('A truck needs at least one IF (only one no longer Packed can be dropped)');
            return ifs.filter(f => String(f.ifId) !== ifId);
        } });
        return verifyOut(v, c);
    });

    // ── Correct the IF (manager, spec 2026-10-05 §6) ─────────────────────
    // What a recorded correction write was for: a later correction of the same IF/item (same opKey) with other numbers is a new write.
    function corrSig(op) { return op.op === 'if_qty' ? op.from + '>' + op.to : JSON.stringify(op.lines || {}); }
    // Several no_if diffs on one TO become one add-on IF (one opKey per TO).
    function mergeCreates(ops) {
        const out = [], byTo = {};
        ops.forEach(op => {
            if (op.op !== 'if_create') { out.push(op); return; }
            const m = byTo[op.toId];
            if (m) { m.lines = Object.assign({}, m.lines, op.lines); m.keys.push(op.key); return; }
            out.push(byTo[op.toId] = Object.assign({}, op, { lines: Object.assign({}, op.lines), keys: [op.key] }));
        });
        return out;
    }
    // Add-on IFs a correction created that are no longer on the truck (a manager dropped them): never created again.
    function orphanCreates(x) {
        const on = {};
        (x.data.ifs || []).forEach(f => { on[String(f.ifId)] = 1; });
        return Object.keys(x.data.correctionWrites || {}).map(k => x.data.correctionWrites[k]).filter(w => w.op === 'if_create' && !on[String(w.id)])
            .map(w => ({ key: w.key, id: String(w.id), text: 'already created as IF ' + w.id + ': add it from the suggestions' }));
    }
    function createToken(truckId, op) {          // short, and unique per truck + TO + lines, so a retry finds its own IF and nothing else
        return '[mv:' + truckId + ':' + verify.opKey(op) + ':' + Object.keys(op.lines || {}).sort().map(k => k + 'x' + op.lines[k]).join(',') + ']';
    }
    function stuckCorrect(x) { return !!x.data.claim && x.data.phase === 'correct' && stale(x); }
    function correctGuard(seen) {
        return cur => {
            if (cur.status !== T.NEEDS_FIX || cur.data.depart) throw userErr(cur.status === T.LOADING ? 'Verify the load first' : 'This truck is ' + cur.status + ', nothing to correct');
            if (cur.data.claim) throw userErr((truckLabel(cur) || 'This truck') + ' is already being processed by someone else. Refresh in a minute.');
            if (ifSig(cur.data.ifs) !== ifSig(seen.ifs) || diffSig((cur.data.verify || {}).diffs) !== diffSig(seen.diffs)) throw userErr('This truck changed while it was being checked. Verify again.');
        };
    }
    act('truck_correct', true, (a, c) => {
        let x0 = mustTruck(a.truckId);
        if (stuckCorrect(x0)) {                       // a correction request that died holding the claim: free it, then start over
            data.updateLoad(x0, { data: { claim: '', workingAt: 0, phase: '' } });
            x0 = mustTruck(x0.id);
        }
        if (x0.status !== T.NEEDS_FIX || x0.data.claim || x0.data.depart) throw correctGuardErr(x0);
        const v = verifyTruck(x0.id, c, { truck: x0, poll: true });
        if (v.r.match) return { written: [], planOnly: [], skipped: [], verify: { match: true, diffs: [] }, view: truckView(v.x, c, { planned: v.planned, trucks: v.trucks }) };
        const keys = Array.isArray(a.keys) && a.keys.length ? a.keys.map(String) : null;
        const all = verify.correctionOps(v.r.diffs).filter(op => !keys || keys.indexOf(op.key) !== -1);
        if (!all.length) throw userErr('Nothing the portal can correct here: ' + (keys ? 'that fix is no longer needed. Verify again.' : 'take pallets off or add an IF.'));
        const cl = claimLoad(v.x, T.NEEDS_FIX, 'correct', correctGuard({ ifs: v.x.data.ifs, diffs: v.r.diffs }), cur => {
            const list = (cur.data.corrections || []).filter(k => !all.some(op => op.key === k.key));
            return { corrections: list.concat(all.map(op => ({ key: op.key, op: op, by: c.user, at: c.now.stamp }))), correctError: '' };
        });
        const id = cl.Ld.id, claim = cl.claim, label = truckLabel(cl.Ld);
        const release = patch => { assertClaim(id, claim, label, 'correct'); data.updateLoad(data.getLoad(id), { data: Object.assign({ claim: '', workingAt: 0, phase: '' }, patch) }); };
        if (palletKey(data.palletsByLoad(id, [VP.LOADED])) !== palletKey(v.ps)) {   // a scan landed between the check and the claim
            release({});
            throw userErr('This truck changed while it was being checked. Verify again.');
        }
        // Portal-only drops. Never the last live IF: a truck needs one (as in truck_drop_if).
        const skipped = [];
        const drops = all.filter(op => op.op === 'drop_if');
        if (drops.length) {
            const cur = data.getLoad(id);
            let ifs = cur.data.ifs || [];
            drops.forEach(op => {
                const f = ifs.find(y => String(y.ifId) === String(op.ifId));
                if (!f) return;
                if (!f.gone && verify.liveIfs(ifs).length === 1) { skipped.push({ key: op.key, reason: 'the last IF on a truck is not dropped: add another IF first' }); return; }
                ifs = ifs.filter(y => String(y.ifId) !== String(op.ifId));
            });
            assertClaim(id, claim, label, 'correct');
            data.updateLoad(data.getLoad(id), { data: { ifs: ifs } });
        }
        // Only an add-on IF is skipped as done (same TO + lines), and only while it is on the truck; once dropped it is never
        // created again (the manager re-adds it from the suggestions). if_qty is never skipped: setIfItemQty is idempotent, and
        // an IF the office reverted to the old number must be written again.
        const now = data.getLoad(id), cw = Object.assign({}, now.data.correctionWrites), done = {}, orphan = {};
        orphanCreates(now).forEach(o => { orphan[o.key] = o; });
        const ops = mergeCreates(all.filter(op => op.op !== 'drop_if')).filter(op => {
            const k = verify.opKey(op);
            if (op.op === 'if_create' && orphan[k]) { skipped.push({ key: k, reason: orphan[k].text }); return false; }
            const w = op.op === 'if_create' && cw[k + '|' + corrSig(op)];
            if (w) done[k] = w.id;
            return true;
        }).map(op => op.op === 'if_create' ? Object.assign({}, op, { token: createToken(id, op) }) : op);
        const byKey = {};
        ops.forEach(op => { byKey[verify.opKey(op)] = op; });
        const sk = skuNames([...new Set(ops.filter(op => op.op === 'if_create').reduce((s, op) => s.concat(Object.keys(op.lines)), []))]);
        let res, err = null, wrote = false;
        try {
            res = verify.runOps(ops, writeMode(c), op => { assertClaim(id, claim, label, 'correct'); return tx.apply(op); }, done, (k, newId) => {
                wrote = true;
                const op = byKey[k], cur = data.getLoad(id), patch = { correctionWrites: Object.assign({}, cur.data.correctionWrites,
                    { [k + '|' + corrSig(op)]: { key: k, op: op.op, id: String(newId), sig: corrSig(op), at: c.now.stamp, by: c.user } }) };
                if (op.op === 'if_create') patch.ifs = (cur.data.ifs || []).concat([{ ifId: String(newId), ifNum: 'IF ' + newId, toId: String(op.toId), toNum: op.toNum, status: 'B',
                    lines: Object.keys(op.lines).map(it => ({ item: String(it), sku: sk[String(it)], qty: Number(op.lines[it]) })) }]);
                data.updateLoad(cur, { data: patch });   // fresh read: the write record and the attached IF land together
            });
        } catch (e) {
            if (e.user) throw e;                      // claim lost: another request owns the truck now, leave its state alone
            log.error({ title: 'move correct ' + id, details: (e && e.stack) || String(e) });
            err = e.message || String(e);
        }
        release({ correctError: err || '', lastStep: stepOf('corrected', c) });
        if (wrote && ns.resetCache) ns.resetCache();   // the re-verify must read the IFs as written, not this request's cached copy
        let vv = null;
        try { vv = verifyTruck(id, c); } catch (e) { if (!e.user || !err) throw e; }
        if (err) throw userErr('Correction refused: ' + err + ' — fix it in NetSuite');
        return { written: res.written, planOnly: res.planOnly, skipped: skipped, verify: { match: vv.r.match, diffs: pubDiffs(vv.r.diffs, vv.ps) },
            view: truckView(vv.x, c, { planned: vv.planned, trucks: vv.trucks }) };
    });
    function correctGuardErr(x) {
        if (x.status === T.SHIP_PENDING) return waitingErr();
        if (x.data.claim || x.data.depart) return userErr((truckLabel(x) || 'This truck') + ' is already being processed by someone else. Refresh in a minute.');
        return userErr(x.status === T.LOADING ? 'Verify the load first' : 'This truck is ' + x.status + ', nothing to correct');
    }

    // What the claim write carries, so a departing truck always has its plan (no claimed-but-unplanned state).
    function departData(d, inp, c) {
        return { depart: Object.assign({ truckNo: d.truckNo, day: c.now.dayIso, at: c.now.stamp, by: c.actor,
            approvedBy: c.mgr ? c.user : '', approvedByRoster: c.mgr ? c.actor : '', otherItems: d.otherItems || [] }, inp), plan: d.plan.ops, alloc: d.plan.alloc, unplanned: d.plan.unplanned,
            bol: d.plan.bol, ifs: d.ifs, departPallets: d.palletKey, writes: {}, lastStep: stepOf('confirmed', c) };
    }
    // Re-verify and plan from a truck copy; a mismatch is thrown, so a claim is never taken (or is released) on a load that no longer matches.
    function planOrMismatch(x, inp, c) {
        const chk = checkTruck(x, c);
        if (!chk.r.match) throw mismatch(chk, null, x);
        const d = departPlan(x, inp, c, chk), pm = planMismatch(d.plan);
        if (pm.length) throw mismatch(chk, pm, x);
        return d;
    }
    // Shipments (spec 2026-10-06 §2). The floor marks a Ready truck shipped with its seal; it re-verifies and locks the truck.
    act('ship_mark', false, (a, c) => {
        const x = mustTruck(a.truckId);
        mustReady(x);
        const own = String(x.data.trailer || '').trim();
        // A truck with no trailer (started before the rework) takes the one entered at the mark.
        const inp = { trailer: own || checkTrailer(a.trailer, x.id), seal: String(a.seal || '').trim(), carrier: String(a.carrier || '').trim() || c.S.defaultCarrier || 'Armstrong Group' };
        if (!inp.seal) throw userErr('Enter the seal #');
        if (inp.seal.length > 30) throw userErr('The seal # is too long (30 characters max)');
        if (inp.carrier.length > 60) throw userErr('The carrier is too long (60 characters max)');
        sealTaken(inp.seal, x.id);
        const v = verifyTruck(x.id, c, { truck: x, poll: true });    // an unchanged load keeps verify at/by
        if (!v.r.match) return Object.assign({ needsFix: true }, verifyOut(v, c));
        const d = departPlan(v.x, inp, c, v), pm = planMismatch(d.plan);
        if (pm.length) return toNeedsFix(x.id, { keep: v.r.keep, diffs: pm, ps: v.ps, seenIfs: v.x.data.ifs }, c);
        const cur = data.getLoad(x.id);               // right before the write: never merge over a stale copy
        mustReady(cur);
        if (ifSig(cur.data.ifs) !== ifSig(v.x.data.ifs) || palletKey(data.palletsByLoad(x.id, [VP.LOADED])) !== d.palletKey) throw userErr('This truck changed while it was being checked. Verify again.');
        if (String(cur.data.trailer || '').trim() !== own) throw userErr('This truck changed while it was being checked. Verify again.');
        data.updateLoad(cur, { status: T.SHIP_PENDING, data: Object.assign({ shipReq: Object.assign(inp, { by: c.actor, at: c.now.stamp }), sentBack: null, lastStep: stepOf('marked_shipped', c) }, own ? {} : { trailer: inp.trailer }) });
        return { view: truckView(mustTruck(x.id), c) };
    });

    // Confirm shipped (manager): the departure as the floor marked it. Departure time and Truck # day = the floor's mark time.
    function shipInput(x) {
        const q = x.data.shipReq || {};
        return { trailer: String(x.data.trailer || q.trailer || '').trim(), seal: q.seal, carrier: q.carrier, markedBy: q.by };
    }
    function markCtx(x, c) {
        const at = (x.data.shipReq || {}).at || c.now.stamp, p = core.parseNsStamp(at);
        return Object.assign({}, c, { now: { stamp: at, dayIso: p ? p.dayIso : c.now.dayIso, hour: p ? p.hour : c.now.hour } });
    }
    act('ship_confirm', true, (a, c) => {
        const x0 = mustTruck(a.truckId);
        mustPending(x0);
        const inp = shipInput(x0), mc = markCtx(x0, c);
        sealTaken(inp.seal, x0.id);
        let d = null, cl;
        try {
            // Re-verified from the guarded copy, and the plan is written with the claim.
            cl = claimLoad(x0, T.DEPARTING, 'depart', mustPending, cur => { d = planOrMismatch(cur, inp, mc); return departData(d, inp, mc); });
        } catch (e) { if (e.mismatch) return toNeedsFix(x0.id, e.mismatch, c, null, true); throw e; }
        // A pallet change that landed between that check and the claim: check again from the claimed state (now frozen).
        if (palletKey(data.palletsByLoad(x0.id, [VP.LOADED])) !== d.palletKey) {
            let again;
            try { again = planOrMismatch(Object.assign({}, cl.Ld, { data: Object.assign({}, cl.Ld.data, { ifs: x0.data.ifs }) }), inp, mc); }
            catch (e) {
                if (e.mismatch) return toNeedsFix(x0.id, e.mismatch, c, cl.claim);
                throw e;
            }
            assertClaim(x0.id, cl.claim, truckLabel(cl.Ld), 'depart');
            data.updateLoad(data.getLoad(x0.id), { data: departData(again, inp, mc) });
        }
        return finishDepart(mustTruck(x0.id), c, cl.claim);
    });

    // Send back (manager, note required): the floor gets the truck back as loading, with the note on its screen.
    act('ship_sendback', true, (a, c) => {
        const note = String(a.note || '').trim().slice(0, 300);
        if (!note) throw userErr('Enter a note for the floor');
        const cur = mustTruck(a.truckId);            // fresh read, guarded, then the write
        mustPending(cur);
        data.updateLoad(cur, { status: T.LOADING, data: { sentBack: { note: note, by: c.user, at: c.now.stamp }, shipReq: null, lastStep: stepOf('sent_back', c) } });
        return { view: truckView(mustTruck(cur.id), c) };
    });

    // A stuck departure that wrote no stamp yet: a manager sends it back to needs_fix (the seal is free again) and it re-verifies.
    function stampWritten(x) { return Object.keys(x.data.writes || {}).some(k => k.indexOf('if_stamp:') === 0); }
    act('depart_release', true, (a, c) => {
        const guard = cur => {
            if (cur.status !== T.DEPARTING || !cur.data.depart) throw userErr('Nothing to release on this truck');
            if (stampWritten(cur)) throw userErr('This truck is already stamped in NetSuite. Press Retry to finish the departure.');
            if (!cur.data.error && !stale(cur)) throw userErr('This departure is still running. Wait a minute, then try again.');
        };
        guard(mustTruck(a.truckId));
        const cl = claimLoad(mustTruck(a.truckId), T.DEPARTING, 'release', guard, { releasedBy: c.user, releasedAt: c.now.stamp });
        // A finishDepart that died inside its pallet loop left some pallets in transit: they never left, so back on this truck.
        data.palletsByLoad(cl.Ld.id, [VP.IN_TRANSIT]).forEach(p => {
            assertClaim(cl.Ld.id, cl.claim, truckLabel(cl.Ld), 'release');
            data.updatePallet(p, { status: VP.LOADED, load: cl.Ld.id, shippedDay: '' });
        });
        assertClaim(cl.Ld.id, cl.claim, truckLabel(cl.Ld), 'release');
        // verify cleared too: a re-verify that fails below must not leave the old (ready) result on a needs_fix truck.
        data.updateLoad(data.getLoad(cl.Ld.id), { status: T.NEEDS_FIX, data: { claim: '', workingAt: 0, phase: '', error: '', depart: null, plan: null, alloc: null,
            unplanned: null, bol: null, writes: null, departPallets: null, verify: null, shipReq: null } });
        return verifyOut(verifyTruck(cl.Ld.id, c), c);
    });

    act('depart_retry', true, (a, c) => {
        const x = mustTruck(a.truckId);
        if (x.status !== T.DEPARTING || !x.data.depart) throw userErr('Nothing to retry on this truck');
        if (!x.data.error && !stale(x)) throw userErr('This departure is still running. Wait a minute, then Retry.');
        const cl = claimLoad(x, T.DEPARTING, 'depart', cur => {
            if (cur.status !== T.DEPARTING || !cur.data.depart || (!cur.data.error && !stale(cur))) throw userErr('This departure is still running. Wait a minute, then Retry.');
        }, { retriedBy: c.user, retriedAt: c.now.stamp });
        return finishDepart(cl.Ld, c, cl.claim);
    });

    // ── v3 unload and receipt approval ───────────────────────────────────
    const UNLOADABLE = [T.DEPARTED, T.RECEIVING, T.RECEIVED];
    function unloadView(x, c) {
        const ps = data.palletsByLoad(x.id, [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
        const rp = verify.planReceipts({ alloc: x.data.alloc || [], pallets: ps, received: x.data.received || {}, stamp: x.data.depart || {}, seq: 0 });
        const got = ps.filter(p => p.status === VP.RECEIVED);
        const flagged = stillFlagged(x.data.flagged).filter(p => p.data.flaggedTruck === x.id);
        const tick = x.data.otherItemsIn || {};
        return { otherItems: ((x.data.depart || {}).otherItems || []).map(o => Object.assign({}, o, { in: !!tick[o.id] })),
            truck: truckSummary(x, countsFromPallets(x.id, ps)), perIf: rp.perIf, expected: ps.filter(p => p.status !== VP.RECEIVED).map(p => pubPallet(p)),
            recent: got.slice(-5).reverse().map(p => pubPallet(p)), counts: { in: got.length, of: ps.length }, flagged: flagged.map(p => pubPallet(p)), decided: decidedRows(x) };
    }
    // Never-loaded pallets are listed on the truck that flagged them (data.flagged) and read back by id.
    function stillFlagged(ids) {
        const u = [...new Set((ids || []).map(String))];
        return u.length ? data.palletsByIds(u).filter(p => p.data.flag === 'never_loaded' && (p.status === VP.LABELED || p.status === VP.LOADED)) : [];
    }
    // ── Flagged pallets: manager Accept / Reject (spec 2026-10-06 pm §2) ──
    // Undecided never-loaded pallets on this truck, as rows for Approvals and the receipt card.
    function flaggedRows(x, ps) {
        const label = truckLabel(x);
        return (ps || stillFlagged(x.data.flagged).filter(p => p.data.flaggedTruck === x.id && !(p.data.decision && p.data.decision.kind === 'accepted_pending')))
            .map(p => ({ palletId: p.id, code: p.code, summary: p.summary, sku: [...new Set((p.lines || []).map(l => String(l.sku || l.item)))].join(' + '), item: String((p.lines[0] || {}).item || ''), pcs: p.pieces,
                truckId: x.id, truckLabel: label, truckStatus: x.status, by: whoName(p.data.flaggedBy), at: p.data.flaggedAt || '' }));
    }
    // Accepted, but the IF op was plan-only (write mode) and the office has not done it yet in NetSuite.
    function pendingAccepts(x) {
        return stillFlagged(x.data.flagged).filter(p => p.data.flaggedTruck === x.id && p.data.decision && p.data.decision.kind === 'accepted_pending');
    }
    function pendingRows(x) {
        return pendingAccepts(x).map(p => Object.assign(flaggedRows(x, [p])[0], { text: p.data.decision.text || '' }));
    }
    function decidedRows(x) {
        return (x.data.corrections || []).filter(k => (k.kind === 'pallet_accept' || k.kind === 'pallet_reject') && !k.pending).map(k => ({ code: k.code, text: k.text || '', at: k.at, by: whoName(k.by) }));
    }
    // Undecided flagged pallets no longer block a receipt (Jack 2026-10-07): the receipt posts what is in, a pallet accepted later posts as a late receipt.
    function flaggedWarnOf(x) {
        const n = flaggedRows(x).length + pendingAccepts(x).length;
        return n ? n + ' flagged pallet' + (n === 1 ? '' : 's') + ' still to decide' : '';
    }
    // Other items (typed lines, not inventory) not ticked in at unload: shown on the receipt card, never block it.
    function otherNotInOf(x) {
        const tick = x.data.otherItemsIn || {};
        return ((x.data.depart || {}).otherItems || []).filter(o => !tick[o.id]);
    }
    // A decision runs only on a truck at Tippecanoe that nobody is processing (an approve or another decision in flight holds the claim).
    function inFlight(cur) { return !!(cur.data.claim && !stale(cur) && !cur.data.error); }
    function decideGuard(cur) {
        if (UNLOADABLE.indexOf(cur.status) === -1) throw userErr('This truck is ' + cur.status + ', its pallets cannot be decided yet');
        if (inFlight(cur)) throw userErr((truckLabel(cur) || 'This truck') + ' is already being processed by someone else. Refresh in a minute.');
    }
    // Gives the claim back after a failure (never throws): the truck must not stay locked for the stale window.
    function dropClaim(id, claim) {
        try {
            const cur = data.getLoad(id);
            if (cur && cur.data.claim === claim) data.updateLoad(cur, { data: { claim: '', workingAt: 0, phase: '' } });
        } catch (e) { log.error({ title: 'move dropClaim ' + id, details: (e && e.stack) || String(e) }); }
    }
    // allowPending: Reject may withdraw a pending accept (nothing was written to NetSuite for it); Accept may not.
    function mustFlaggedOn(x, palletId, allowPending) {
        const p = data.getPallet(palletId);
        if (!p || p.data.flag !== 'never_loaded' || String(p.data.flaggedTruck) !== String(x.id) || (x.data.flagged || []).indexOf(String(p.id)) === -1) throw userErr('That pallet is not flagged on this truck');
        if (!allowPending && p.data.decision && p.data.decision.kind === 'accepted_pending') throw userErr('That pallet is already accepted: the office finishes it in NetSuite');
        if (p.status !== VP.LABELED && p.status !== VP.LOADED) throw userErr('That pallet is ' + p.status + ', nothing to decide');
        if (p.status === VP.LOADED && p.loadId) {                 // taking it off a truck that is locked would knock that truck to needs_fix at confirm
            const o = data.getLoad(p.loadId);
            if (o && !isOpen(o)) throw userErr('That pallet is on ' + truckLabel(o) + ', which is waiting for ship confirmation: confirm or send back that truck first');
        }
        return p;
    }
    // The pallet physically arrived here, so it leaves the open truck it was scanned onto at Riverside (that truck's ready reverts).
    function unloadFromOther(p, c) {
        if (p.status !== VP.LOADED || !p.loadId) return;
        const o = data.getLoad(p.loadId);
        data.updatePallet(p, { status: VP.LABELED, load: '', data: { takenOffAt: c.now.stamp, takenOffBy: c.actor, takenOffTruck: p.loadId, takenOffWhy: 'arrived_tippecanoe' } });
        if (o && isOpen(o)) touched(o.id, { lastStep: stepOf('taken_off', c) });
    }
    function corrEntry(kind, p, extra, c) {
        return Object.assign({ kind: kind, palletId: String(p.id), code: p.code, pcs: p.pieces, by: c.user, at: c.now.stamp }, extra || {});
    }
    // The pallet joins the truck: received on it, its pieces in the truck's alloc for the IF, the flag closed.
    function completeAccept(id, p, dec, c) {
        const fresh = data.getPallet(p.id);                      // a second request may have finished this pallet already: never grow the alloc twice
        if (!fresh || (fresh.data.decision && fresh.data.decision.kind === 'accepted')) throw userErr('That pallet was already decided');
        const x = mustTruck(id), item = String(dec.item), pcs = Number(dec.pcs);
        let alloc = (x.data.alloc || []).map(a => Object.assign({}, a, { lines: Object.assign({}, a.lines) }));
        let a = alloc.find(y => String(y.ifId) === String(dec.ifId));
        if (!a) { a = { ifId: String(dec.ifId), ifNum: dec.ifNum, toId: String(dec.toId), toNum: dec.toNum, lines: {}, addOn: true }; alloc.push(a); }
        a.lines[item] = (Number(a.lines[item]) || 0) + pcs;
        const ifs = (x.data.ifs || []).some(f => String(f.ifId) === String(dec.ifId)) ? x.data.ifs
            : (x.data.ifs || []).concat([{ ifId: String(dec.ifId), ifNum: dec.ifNum, toId: String(dec.toId), toNum: dec.toNum, status: 'B', lines: [{ item: item, sku: dec.sku, qty: pcs }] }]);
        data.updatePallet(p, { status: VP.RECEIVED, load: x.id, data: { flag: '', receivedAt: c.now.stamp, receivedBy: c.actor, decision: Object.assign({}, dec, { kind: 'accepted' }) } });
        const cur = mustTruck(id), d = cur.data, text = dec.text;
        const corr = (d.corrections || []).filter(k => !(k.kind === 'pallet_accept' && String(k.palletId) === String(p.id)));
        const patch = { data: { alloc: alloc, ifs: ifs, flagged: (d.flagged || []).filter(k => String(k) !== String(p.id)), lastStep: stepOf('pallet_accepted', c),
            unposted: typeof d.unposted === 'number' ? d.unposted + 1 : unpostedOf(cur),
            corrections: corr.concat([corrEntry('pallet_accept', p, { ifNum: dec.ifNum, toNum: dec.toNum, text: text }, c)]) } };
        if (cur.status === T.DEPARTED) patch.status = T.RECEIVING;
        data.updateLoad(cur, patch);
    }
    // What a pending accept waits for: the IF line at the target qty (if_qty), or the add-on IF existing (if_create).
    // taken: IF ids an earlier settle in the same pass already attached (the trucks list is read once, so it cannot know).
    function pendingDone(dec, info, trucks, taken) {
        if (dec.op && dec.op.op === 'if_qty') {
            const f = info[String(dec.op.ifId)];
            return f && (f.lines || []).filter(l => String(l.item) === String(dec.op.item)).reduce((s, l) => s + Number(l.qty || 0), 0) >= Number(dec.op.to) ? { ifId: String(dec.op.ifId), ifNum: dec.op.ifNum } : null;
        }
        if (dec.op && dec.op.op === 'if_create') {
            const skip = Object.assign({}, taken);                   // an IF this truck already took for another pending accept is not taken twice
            ((data.getLoad(dec.truckId) || { data: {} }).data.alloc || []).forEach(a => { skip[String(a.ifId)] = true; });
            const f = findAddOnIf(dec.op.toId, dec.op.lines, info, trucks, dec.truckId, skip);
            return f ? { ifId: String(f.ifId), ifNum: f.ifNum } : null;
        }
        return null;
    }
    // Settle pending accepts whose NetSuite side is done (the office acted). Called by approvals for every truck it lists.
    function settlePending(x, c, shared) {
        const pend = pendingAccepts(x);
        if (!pend.length) return x;
        const info = shared.info || (shared.info = ns.ifInfo()), trucks = shared.trucks || (shared.trucks = allTrucks()), taken = shared.taken || (shared.taken = {});
        pend.forEach(p => {
            const dec = p.data.decision, got = pendingDone(Object.assign({}, dec, { truckId: x.id }), info, trucks, taken);
            if (!got) return;
            const cur = mustTruck(x.id);
            if (inFlight(cur)) return;
            let cl;                                                  // a claim serialises overlapping approvals/dashboard requests settling the same pallet
            try { cl = claimLoad(cur, null, 'settle', decideGuard, {}); } catch (e) { if (e.user) return; throw e; }
            try {
                const fresh = data.getPallet(p.id);                  // another request may have settled, rejected or reloaded it before our claim
                if (fresh && fresh.data.decision && fresh.data.decision.kind === 'accepted_pending' && fresh.data.flag === 'never_loaded') {
                    completeAccept(x.id, fresh, Object.assign({}, dec, got, { text: acceptText(Object.assign({}, dec, got)) }), c);
                    taken[got.ifId] = true;                          // the cached trucks list does not show this attach: the next truck must not take the same IF
                }
            } catch (e) { dropClaim(x.id, cl.claim); throw e; }
            const rel = data.getLoad(x.id);                          // fresh read: completeAccept just wrote the truck
            if (rel && rel.data.claim === cl.claim) data.updateLoad(rel, { data: { claim: '', workingAt: 0, phase: '' } });
        });
        return mustTruck(x.id);
    }
    function acceptText(dec) {
        if (dec.op && dec.op.op === 'if_create') return '✅ Accepted · ' + dec.ifNum + ' · new IF on ' + dec.toNum;
        return dec.op && dec.op.op === 'if_qty' ? '✅ Accepted · ' + dec.ifNum + ' ' + verify._fmt(dec.op.from) + ' → ' + verify._fmt(dec.op.to) : '✅ Accepted · ' + dec.ifNum;
    }
    // The IF on this truck that carries the pallet's SKU (lowest IF number), read fresh from NetSuite for the from-qty.
    function ifForItem(x, item, info) {
        const cands = (x.data.alloc || []).filter(a => String(a.ifId).indexOf('new:') !== 0 && Number(a.lines[item]) > 0).sort((p, q) => Number(p.ifId) - Number(q.ifId));
        for (let i = 0; i < cands.length; i++) {
            const f = info[String(cands[i].ifId)];
            if (f) return { ifId: String(cands[i].ifId), ifNum: f.ifNum, status: String(f.status || ''), toId: String(f.toId), toNum: cands[i].toNum, alloc: Number(cands[i].lines[item]) || 0, from: (f.lines || []).filter(l => String(l.item) === item).reduce((s, l) => s + Number(l.qty || 0), 0) };
        }
        return null;
    }
    // An IF on this TO (Picked, Packed or already Shipped), on no truck, with exactly these lines: how a pending add-on is recognised once the office created it.
    // Shipped wins over Packed over Picked, then the lowest id. The office can tag the IF with the memo token shown on the pending line.
    // (Stage 2: match by that token once move_ns exposes memos. An office-planned IF with identical lines can be taken over by mistake; accepted.)
    function linesSig(lines) { const m = {}; (lines || []).forEach(l => { const k = String(l.item); m[k] = (m[k] || 0) + (Number(l.qty) || 0); }); return JSON.stringify(Object.keys(m).sort().map(k => [k, m[k]])); }
    const ADDON_RANK = { C: 0, B: 1, A: 2 };
    function findAddOnIf(toId, lines, info, trucks, exceptId, taken) {
        const want = JSON.stringify(Object.keys(lines).sort().map(k => [k, Number(lines[k])])), held = takenByOthers(trucks, exceptId);
        return Object.keys(info || {}).map(id => Object.assign({ ifId: id }, info[id]))
            .filter(f => String(f.toId) === String(toId) && ADDON_RANK[f.status] !== undefined && !held[f.ifId] && !(taken || {})[f.ifId] && linesSig(f.lines) === want)
            .sort((p, q) => (ADDON_RANK[p.status] - ADDON_RANK[q.status]) || (Number(p.ifId) - Number(q.ifId)))[0] || null;
    }
    // The open TO line (oldest first) that has room for this pallet, after what the other trucks will need.
    function coveringTo(x, item, pcs, c) {
        return reservedToLines(x.id, allTrucks(), null, c).filter(r => String(r.item) === item && Number(r.remaining) >= pcs).sort(verify._oldestFirst)[0] || null;
    }
    function noCoverText(sk) { return '⛔ Can\'t accept · no open TO covers ' + sk + ' · Reject or office adds a TO line'; }
    // A pallet whose SKU is on none of the truck's IFs: it goes on a new add-on IF on an open TO (on), or waits for the office to make one (off / qty).
    function acceptOffIf(x0, p0, item, sk, pcs, c) {
        if (!coveringTo(x0, item, pcs, c)) return { outcome: 'refused', text: noCoverText(sk), view: unloadView(x0, c) };   // fail-fast: nothing claimed
        const cl = claimLoad(x0, null, 'accept', decideGuard, {});
        const id = cl.Ld.id, claim = cl.claim, label = truckLabel(cl.Ld);
        const release = patch => { assertClaim(id, claim, label, 'accept'); data.updateLoad(data.getLoad(id), { data: Object.assign({ claim: '', workingAt: 0, phase: '' }, patch) }); };
        let to;
        try {
            mustFlaggedOn(cl.Ld, p0.id);                            // another decision may have landed between the first check and the claim
            if (ns.resetCache) ns.resetCache();
            to = coveringTo(cl.Ld, item, pcs, c);                   // the real TO: from the claimed truck and NetSuite as they are now
        } catch (e) { dropClaim(id, claim); throw e; }
        if (!to) { dropClaim(id, claim); return { outcome: 'refused', text: noCoverText(sk), view: unloadView(mustTruck(id), c) }; }
        const dep = cl.Ld.data.depart || {}, st = { trailer: dep.trailer, seal: dep.seal, memo: verify.memoFor(dep.truckNo, dep.day) };
        const create = Object.assign({ op: 'if_create', toId: String(to.toId), toNum: to.toNum, lines: { [item]: pcs }, ship: false }, st);
        create.token = createToken(id, create);
        const stamp = Object.assign({ op: 'if_stamp', ifId: 'new:' + String(to.toId), ifNum: '(new)', toId: String(to.toId) }, st, { lines: { [item]: pcs } });
        const dec = { kind: 'accepted_pending', toId: String(to.toId), toNum: to.toNum, item: item, sku: sk, pcs: pcs, op: create, by: c.user, at: c.now.stamp };
        // A retry: an earlier attempt created the IF (and maybe stamped it) but died before the pallet was received. An IF already on this truck was completed,
        // and one another truck holds is not ours any more, so neither is reused (a new IF is created).
        const cw = cl.Ld.data.correctionWrites || {}, onTruck = {}, writes = {}, done = {};
        (cl.Ld.data.alloc || []).forEach(a => { onTruck[String(a.ifId)] = true; });
        const prior = cw[verify.opKey(create) + '|' + corrSig(create)], heldElsewhere = takenByOthers(allTrucks(), id);
        if (prior && !onTruck[String(prior.id)] && !heldElsewhere[String(prior.id)]) {
            writes[verify.opKey(create)] = done[verify.opKey(create)] = String(prior.id);
            if (cw['if_stamp:' + prior.id + '|' + corrSig(stamp)]) done[verify.opKey(stamp)] = String(prior.id);
        }
        let res, err = null;
        try {
            res = verify.runOps([create, stamp], writeMode(c), o => {
                assertClaim(id, claim, label, 'accept');
                const r = verify.resolveNew(o, writes);
                return tx.apply(r.ifNum === '(new)' ? Object.assign({}, r, { ifNum: 'IF ' + r.ifId }) : r);
            }, done, (k, newId) => {
                const isCreate = k.indexOf('if_create:') === 0, op = isCreate ? create : stamp;
                if (isCreate) writes[k] = String(newId);
                const key = isCreate ? k : 'if_stamp:' + writes[verify.opKey(create)];   // a stamp is recorded under the IF it stamped
                const cur = data.getLoad(id);
                data.updateLoad(cur, { data: { correctionWrites: Object.assign({}, cur.data.correctionWrites, { [key + '|' + corrSig(op)]: { key: key, op: op.op, id: String(newId), sig: corrSig(op), at: c.now.stamp, by: c.user } }) } });
            });
        } catch (e) {
            if (e.user) throw e;
            log.error({ title: 'move pallet_accept ' + id, details: (e && e.stack) || String(e) });
            err = e.message || String(e);
        }
        if (err) { release({}); throw userErr('Accept refused: ' + err + ' — fix it in NetSuite'); }
        try {
            const p = data.getPallet(p0.id);
            unloadFromOther(p, c);
            const newId = writes[verify.opKey(create)];
            if (res.planOnly.length || !newId) {                  // plan-only: the office creates the IF; settlePending attaches it when it appears
                dec.text = '⏳ Accepted · office creates IF for ' + verify._fmt(pcs) + ' ' + sk + ' on ' + to.toNum + ' (memo ' + create.token + ') · receipt waits';
                data.updatePallet(data.getPallet(p.id), { data: { decision: dec } });
                const cur = data.getLoad(id);
                release({ lastStep: stepOf('pallet_accepted', c), corrections: (cur.data.corrections || []).concat([corrEntry('pallet_accept', p, { toNum: to.toNum, pending: true, text: dec.text }, c)]) });
                if (ns.resetCache) ns.resetCache();
                return { outcome: 'pending', text: dec.text, view: unloadView(mustTruck(id), c) };
            }
            const fin = Object.assign({}, dec, { ifId: String(newId), ifNum: 'IF ' + newId });
            fin.text = acceptText(fin);
            completeAccept(id, data.getPallet(p.id), fin, c);
            release({});
            if (ns.resetCache) ns.resetCache();
            return { outcome: 'accepted', text: fin.text, view: unloadView(mustTruck(id), c) };
        } catch (e) {
            dropClaim(id, claim);                                   // a retry must not be locked out (it finds the IF recorded in correctionWrites)
            throw e;
        }
    }
    act('pallet_accept', true, (a, c) => {
        const x0 = mustTruck(a.truckId);
        decideGuard(x0);
        const p0 = mustFlaggedOn(x0, a.palletId), item = String((p0.lines[0] || {}).item || ''), pcs = Number(p0.pieces) || 0;
        if (!item || !pcs || (p0.lines || []).length !== 1) throw userErr('Only a single-SKU pallet can be accepted here: reject it and call the office');
        const sk = skuNames([item])[item] || item;
        // The target is what the IF must read once every accepted pallet of this SKU on it is in: the truck's alloc plus the other pending accepts, plus this pallet.
        const planFor = (Ld, info) => {
            const target = ifForItem(Ld, item, info);
            if (!target) return null;
            const base = target.alloc + pendingAccepts(Ld).filter(q => String(q.id) !== String(p0.id) && q.data.decision.ifId === target.ifId && String(q.data.decision.item) === item)
                .reduce((n, q) => n + (Number(q.data.decision.pcs) || Number(q.pieces) || 0), 0), to = base + pcs;
            const op = { op: 'if_qty', ifId: target.ifId, ifNum: target.ifNum, toId: target.toId, item: item, from: target.from, to: to };
            return { target: target, base: base, to: to, op: op,
                dec: { kind: 'accepted_pending', ifId: target.ifId, ifNum: target.ifNum, toId: target.toId, toNum: target.toNum, item: item, sku: sk, pcs: pcs, op: op, by: c.user, at: c.now.stamp } };
        };
        // A Shipped IF is never edited (Jack 2026-10-07): the pallet goes on its own add-on IF from an open TO, like a SKU on none of the truck's IFs.
        const onIf = Ld => { const pl = planFor(Ld, ns.ifInfo()); return pl && pl.target.status !== 'C' ? pl : null; };
        if (!onIf(x0)) return acceptOffIf(x0, p0, item, sk, pcs, c);                          // no unshipped IF on the truck carries this SKU (it claims for itself)
        const cl = claimLoad(x0, null, 'accept', decideGuard, {});
        const id = cl.Ld.id, claim = cl.claim, label = truckLabel(cl.Ld);
        const release = patch => { assertClaim(id, claim, label, 'accept'); data.updateLoad(data.getLoad(id), { data: Object.assign({ claim: '', workingAt: 0, phase: '' }, patch) }); };
        let plan;
        try {
            mustFlaggedOn(cl.Ld, a.palletId);                       // another decision may have landed between the first check and the claim
            if (ns.resetCache) ns.resetCache();
            plan = onIf(cl.Ld);                                     // the real target: from the claimed truck, with the pending accepts and NetSuite as they are now
            if (!plan) throw userErr('This truck changed while it was being checked. Try again.');
        } catch (e) { dropClaim(id, claim); throw e; }
        const target = plan.target, base = plan.base, to = plan.to, op = plan.op, dec = plan.dec;
        const done = target.from >= to;                             // NetSuite already reads the target or more (a retry after a write that landed, or the office did it): never lower it
        let res = { planOnly: [] }, err = null;
        if (!done) {
            try {
                res = verify.runOps([op], writeMode(c), o => { assertClaim(id, claim, label, 'accept'); return tx.apply(o); }, {}, (k, newId) => {
                    const cur = data.getLoad(id);
                    data.updateLoad(cur, { data: { correctionWrites: Object.assign({}, cur.data.correctionWrites, { [k + '|' + corrSig(op)]: { key: k, op: op.op, id: String(newId), sig: corrSig(op), at: c.now.stamp, by: c.user } }) } });
                });
            } catch (e) {
                if (e.user) throw e;
                log.error({ title: 'move pallet_accept ' + id, details: (e && e.stack) || String(e) });
                err = e.message || String(e);
            }
            if (err) { release({}); throw userErr('Accept refused: ' + err + ' — fix it in NetSuite'); }
        }
        try {
            const p = data.getPallet(p0.id);
            unloadFromOther(p, c);
            if (res.planOnly.length) {                              // plan-only: the office edits the IF; the receipt waits (settlePending finishes it)
                dec.text = '⏳ Accepted · office sets ' + target.ifNum + ' ' + sk + ' to ' + verify._fmt(to) + ' · receipt waits';
                data.updatePallet(data.getPallet(p.id), { data: { decision: dec } });
                const cur = data.getLoad(id);
                release({ lastStep: stepOf('pallet_accepted', c), corrections: (cur.data.corrections || []).concat([corrEntry('pallet_accept', p, { ifNum: target.ifNum, pending: true, text: dec.text }, c)]) });
                if (ns.resetCache) ns.resetCache();
                return { outcome: 'pending', text: dec.text, view: unloadView(mustTruck(id), c) };
            }
            if (done) op.from = base;
            dec.text = acceptText(dec);
            completeAccept(id, data.getPallet(p.id), dec, c);
            release({});
            if (ns.resetCache) ns.resetCache();
            return { outcome: 'accepted', text: dec.text, view: unloadView(mustTruck(id), c) };
        } catch (e) {
            dropClaim(id, claim);                                   // a retry must not be locked out (and finds the IF already at the target)
            throw e;
        }
    });
    act('pallet_reject', true, (a, c) => {
        const note = String(a.note || '').trim().slice(0, 300);
        if (!note) throw userErr('Enter a note: why is this pallet rejected?');
        const x0 = mustTruck(a.truckId);
        decideGuard(x0);
        const p0 = mustFlaggedOn(x0, a.palletId, true);
        const cl = claimLoad(x0, null, 'reject', decideGuard, {});
        const id = cl.Ld.id, claim = cl.claim, label = truckLabel(cl.Ld);
        const pendingOne = !!(p0.data.decision && p0.data.decision.kind === 'accepted_pending');
        const text = '↩ Rejected · "' + note + '"' + (pendingOne ? ' · pending accept withdrawn' : '') + ' · back to labeled';
        let p;
        try {
            const again = mustFlaggedOn(cl.Ld, a.palletId, true);   // another decision may have landed between the first check and the claim
            if (!!(again.data.decision && again.data.decision.kind === 'accepted_pending') !== pendingOne) throw userErr('That pallet was just decided by someone else. Refresh.');
            p = data.getPallet(p0.id);
            unloadFromOther(p, c);
            data.updatePallet(data.getPallet(p.id), { status: VP.LABELED, load: '', data: { flag: '', decision: { kind: 'rejected', note: note, by: c.user, at: c.now.stamp, text: text } } });
        } catch (e) { dropClaim(id, claim); throw e; }
        assertClaim(id, claim, label, 'reject');
        const cur = data.getLoad(id);
        data.updateLoad(cur, { data: { claim: '', workingAt: 0, phase: '', flagged: (cur.data.flagged || []).filter(k => String(k) !== String(p.id)), lastStep: stepOf('pallet_rejected', c),
            corrections: (cur.data.corrections || []).filter(k => !(k.kind === 'pallet_accept' && k.pending && String(k.palletId) === String(p.id)))
                .concat([corrEntry('pallet_reject', p, { note: note, text: text }, c)]) } });
        return { outcome: 'rejected', text: text, view: unloadView(mustTruck(id), c) };
    });
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
        mustUnloadable(x.id);                               // re-check right before the pallet changes: approving closes scanning
        data.updatePallet(p, { status: VP.RECEIVED, data: { receivedAt: c.now.stamp, receivedBy: c.actor } });
        const cur = mustTruck(x.id), d = cur.data;          // fresh read: stack and counters merge over the current copy
        const patch = { data: { rstack: (d.rstack || []).concat([{ id: String(p.id), prev: prev }]).slice(-STACK_MAX),
            unposted: typeof d.unposted === 'number' ? d.unposted + 1 : unpostedOf(cur), lastStep: stepOf('unload_scanned', c) } };
        if (prev === VP.MISSING) patch.data.missing = Math.max(0, (Number(d.missing) || 0) - 1);
        if (cur.status === T.DEPARTED) patch.status = T.RECEIVING;
        data.updateLoad(cur, patch);
    }

    act('unload_list', false, () => {
        const cand = allTrucks().filter(x => UNLOADABLE.indexOf(x.status) !== -1 || x.status === T.APPROVING);
        const counts = data.palletStatusCounts(cand.map(x => x.id));
        return { trucks: cand.map(x => ({ x: x, s: truckSummary(x, counts) })).filter(o => o.x.status === T.DEPARTED || o.x.status === T.RECEIVING ||
            (o.x.status === T.APPROVING && (o.x.data.error || stale(o.x))) || (o.x.status === T.RECEIVED && (o.s.missing > 0 || unpostedOf(o.x, counts) > 0))).map(o => o.s) };
    });

    act('unload_get', false, (a, c) => ({ view: unloadView(mustViewable(a.truckId), c) }));

    act('unload_scan', false, (a, c) => {
        const x = mustUnloadable(a.truckId);
        const s = core.parseScan(a.raw);
        const p = s.palletId ? data.getPallet(s.palletId) : null;
        const r = verify.classifyUnloadScan({ pallet: p, truckId: x.id, trucks: truckMap(allTrucks()) });
        if (r.set) receiveOn(x, p, p.status, c);
        if (r.result === 'never_loaded' && !(p.data.decision && p.data.decision.kind === 'accepted_pending')) {   // a pending accept stays on the truck that holds it
            data.updatePallet(p, { data: { flag: 'never_loaded', flaggedAt: c.now.stamp, flaggedBy: c.actor, flaggedTruck: x.id } });
            const cur = mustTruck(x.id), fl = cur.data.flagged || [];
            if (fl.indexOf(String(p.id)) === -1) data.updateLoad(cur, { data: { flagged: fl.concat([String(p.id)]) } });
        }
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

    // Other-item checklist at unload: informational only.
    act('unload_other_tick', false, (a, c) => {
        const cur = mustUnloadable(a.truckId), id = String(a.id || '');     // a fresh read right before the write
        if (!((cur.data.depart || {}).otherItems || []).some(o => String(o.id) === id)) throw userErr('That item is not on this truck');
        data.updateLoad(cur, { data: { otherItemsIn: Object.assign({}, cur.data.otherItemsIn, { [id]: a.on ? { by: c.actor, at: c.now.stamp } : null }) } });
        return { view: unloadView(mustTruck(a.truckId), c) };
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
        let undone = null;
        while (st.length) {
            const e = st.pop(), p = data.getPallet(e.id);
            if (p && p.status === VP.RECEIVED && p.loadId === x.id && !p.data.postedSeq) { data.updatePallet(p, { status: e.prev, damaged: false }); undone = e; break; }
        }
        const cur = mustTruck(x.id), patch = { rstack: st };
        if (undone) {
            patch.unposted = Math.max(0, (typeof cur.data.unposted === 'number' ? cur.data.unposted : unpostedOf(cur) + 1) - 1);
            if (undone.prev === VP.MISSING) patch.missing = (Number(cur.data.missing) || 0) + 1;
        }
        data.updateLoad(cur, { data: patch });
        return { view: unloadView(mustTruck(x.id), c) };
    });

    act('unload_done', false, (a, c) => {
        const x = mustUnloadable(a.truckId);
        data.updateLoad(x, { data: { recvRequested: { by: c.actor, at: c.now.stamp }, lastStep: stepOf('unload_done', c) } });
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
        const canApprove = cur => (UNLOADABLE.indexOf(cur.status) !== -1 && !inFlight(cur)) || (cur.status === T.APPROVING && (cur.data.error || stale(cur)));
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
        data.updateLoad(data.getLoad(x.id), { data: { recvApprovedBy: c.user, recvApprovedByRoster: c.actor, recvApprovedAt: c.now.stamp } });
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
        let unposted = 0;
        data.palletsByLoad(x.id, [VP.RECEIVED]).forEach(p => {
            if (p.data.postedSeq) return;
            if (planned[String(p.id)]) data.updatePallet(p, { data: { postedSeq: seq } }); else unposted++;
        });
        data.palletsByLoad(x.id, [VP.IN_TRANSIT]).filter(p => transit[String(p.id)]).forEach(p => data.updatePallet(p, { status: VP.MISSING }));
        const missing = cnt(data.palletStatusCounts([x.id]), x.id, VP.MISSING);
        const newIrs = Object.keys(writes).filter(k => k.indexOf('receipt:') === 0 && !((x.data.writes || {})[k])).map(k => String(writes[k]));
        let irNums = Object.assign({}, x.data.irNums);
        try { if (newIrs.length && tx.tranIds) irNums = Object.assign(irNums, tx.tranIds(newIrs)); } catch (e) { log.error({ title: 'move receive ' + x.id + ' IR numbers', details: String(e) }); }
        assertClaim(x.id, claim, label, 'receive');   // right before the final write: never overwrite another request's state
        const fin = data.getLoad(x.id);
        data.updateLoad(fin, { status: T.RECEIVED, data: { rplan: (fin.data.rplan || []).concat(rp.ops), prevStatus: '', received: rp.cumulative, recvSeq: seq, recvRequested: null,
            unposted: unposted, missing: missing, error: '', writes: writes, irNums: irNums, workingAt: 0, claim: '', phase: '', lastStep: stepOf('receipt_approved', c) } });
        const after = mustTruck(x.id);
        return { perIf: rp.perIf, missing: rp.missing, written: res.written, irs: irsOf(after), view: unloadView(after, c) };
    });

    // ── v3 manager approvals and shadow report ───────────────────────────
    const FIX_KINDS = ['if_short', 'if_over', 'no_if'];
    const IF_PILL_KINDS = ['if_gone', 'if_empty'];      // shown as pills on the truck card's IF rows
    // Whole minutes from a NetSuite stamp to now (null when either can't be read).
    function minutesSince(stamp, c) {
        const abs = p => p ? Date.UTC(Number(p.dayIso.slice(0, 4)), Number(p.dayIso.slice(5, 7)) - 1, Number(p.dayIso.slice(8, 10))) / 60000 + p.hour * 60 + (p.minute || 0) : null;
        const a = abs(core.parseNsStamp(stamp)), b = abs(core.parseNsStamp(c.now.stamp));
        return a == null || b == null ? null : Math.max(0, b - a);
    }
    function whoName(w) { return w && typeof w === 'object' ? String(w.name || w.id || '') : String(w == null ? '' : w); }
    function approvalsView(c) {
        const trucks = allTrucks();
        const stuck = x => !!(x.data.error || stale(x));
        const counts = data.palletStatusCounts(trucks.filter(x => OPEN.indexOf(x.status) === -1).map(x => x.id));
        const sum = x => truckSummary(x, counts);
        // needs_fix: the stored diffs (only the manager's Re-check calls truck_verify again); one grouped read of loaded pallets.
        const fix = trucks.filter(x => x.status === T.NEEDS_FIX);
        let fixes = [], fixTrucks = [], freeIfs = [];
        if (fix.length) {
            const loaded = {}, dp = defPcs(c), planned = ns.plannedIfs(), taken = takenByOthers(trucks, null);
            // Spec §7: a manager may add any Picked/Packed IF that no truck has (the card's picker), not only the suggested ones.
            freeIfs = planned.filter(f => !taken[String(f.ifId)]).map(f => ({ ifId: f.ifId, ifNum: f.ifNum, toNum: f.toNum, lines: f.lines }));
            data.palletsByStatus([VP.LOADED]).forEach(p => { (loaded[String(p.loadId)] = loaded[String(p.loadId)] || []).push(p); });
            const sk = skuNames([...new Set(fix.reduce((s, x) => s.concat(((x.data.verify || {}).diffs || []).filter(d => d.item).map(d => String(d.item))), []))]);
            // fixes: one Correct-the-IF card per correctable diff; trucks: one card per waiting truck (its IFs, add/drop).
            fix.forEach(x => {
                const ps = loaded[String(x.id)] || [], diffs = (x.data.verify || {}).diffs || [], label = truckLabel(x), corr = x.data.corrections || [];
                const pub = pubDiffs(diffs, ps, sk);
                pub.filter(d => FIX_KINDS.indexOf(d.kind) !== -1).forEach(d => fixes.push(Object.assign({ truckId: x.id, truckLabel: label, key: d.key, kind: d.kind, text: d.text },
                    d.ifId ? { ifId: d.ifId, ifNum: d.ifNum } : {}, d.toNum ? { toNum: d.toNum } : {}, d.toId ? { toId: d.toId } : {}, d.item ? { item: d.item, sku: d.sku } : {},
                    { shortNote: x.data.shortNote || null, corrections: corr.filter(k => k.key === d.key), correctError: x.data.correctError || '' })));
                const flag = kind => { const o = {}; diffs.filter(d => d.kind === kind).forEach(d => { o[String(d.ifId)] = true; }); return o; };
                const gone = flag('if_gone'), empty = flag('if_empty');
                fixTrucks.push({ truck: truckSummary(x, countsFromPallets(x.id, ps)), trailer: x.data.trailer || '',
                    ifs: (x.data.ifs || []).map(f => ({ ifId: f.ifId, ifNum: f.ifNum, toNum: f.toNum, lines: f.lines, gone: !!(f.gone || gone[String(f.ifId)]), empty: !!empty[String(f.ifId)] })),
                    suggestions: suggestionsFor(x, x.data.ifs, diffs, dp, trucks, planned), orphans: orphanCreates(x), stuck: stuckCorrect(x), correctError: x.data.correctError || '',
                    shortNote: x.data.shortNote || null, verifiedBy: whoName((x.data.verify || {}).by), verifiedAt: (x.data.verify || {}).at || '',
                    otherDiffs: pub.filter(d => FIX_KINDS.indexOf(d.kind) === -1 && IF_PILL_KINDS.indexOf(d.kind) === -1).map(d => d.text) });   // why it waits when no Correct card or IF pill explains it
            });
        }
        const shared = {};
        const atTip = trucks.filter(x => UNLOADABLE.indexOf(x.status) !== -1 || x.status === T.APPROVING);
        const settled = atTip.map(x => {
            try { return settlePending(x, c, shared); } catch (e) {            // one bad truck must not fail the whole Approvals response
                log.error({ title: 'move settle ' + x.id, details: (e && e.stack) || String(e) });
                return x;
            }
        });
        const flagged = [].concat.apply([], settled.map(x => flaggedRows(x))).sort((p, q) => (Number(p.truckId) - Number(q.truckId)) || (Number(p.palletId) - Number(q.palletId)));   // oldest truck first
        const shipPending = trucks.filter(x => x.status === T.SHIP_PENDING && x.data.shipReq).map(x => {
            const q = x.data.shipReq;
            return { truck: sum(x), trailer: x.data.trailer || q.trailer || '', seal: q.seal, carrier: q.carrier,
                ifs: verify.liveIfs(x.data.ifs).map(f => ({ ifNum: f.ifNum, lines: f.lines })), pallets: cnt(counts, x.id, VP.LOADED), pcs: pcsOf(counts, x.id, [VP.LOADED]),
                otherItems: x.data.otherItems || [], markedBy: whoName(q.by), markedAt: q.at || '', ageMin: minutesSince(q.at, c) };
        });
        return {
            shipPending: shipPending,
            flagged: flagged,
            fixes: fixes,
            trucks: fixTrucks,
            freeIfs: freeIfs,
            writeMode: writeMode(c),
            retries: trucks.filter(x => x.status === T.DEPARTING && stuck(x)).map(x => Object.assign(sum(x), { canRelease: !stampWritten(x) })),
            receipts: settled.filter(x => UNLOADABLE.indexOf(x.status) !== -1 || (x.status === T.APPROVING && stuck(x))).map(x => {
                const isStuck = x.status === T.APPROVING;
                try {
                    const unposted = unpostedOf(x, counts);
                    const fl = flaggedRows(x), pend = pendingRows(x);
                    if (!isStuck && !fl.length && !pend.length && (!unposted || (x.status !== T.RECEIVED && !x.data.recvRequested))) return null;
                    const rp = receiptPlan(x);
                    const o = { truck: sum(x), perIf: rp.perIf, missing: rp.missing, lateOnly: x.status === T.RECEIVED, flagged: fl, pending: pend, decided: decidedRows(x),
                        canApprove: rp.ops.length > 0 || isStuck, blockReason: rp.ops.length || isStuck ? '' : 'Nothing new scanned in', warn: flaggedWarnOf(x), otherNotIn: otherNotInOf(x) };
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
    }
    act('approvals', true, (a, c) => approvalsView(c));

    // ── dashboard (spec 2026-10-06 pm §3): trucks, approvals waiting, Active loads ──
    const STAGE_ORDER = ['Receipt pending', 'Waiting for manager', 'Ready to ship', 'Needs IF fix', 'Loading', 'In transit', 'Unloading', 'Received'];
    function stageOf(x) {
        if (x.status === T.RECEIVED) return 'Received';
        if (x.status === T.APPROVING || (x.status === T.RECEIVING && x.data.recvRequested)) return 'Receipt pending';
        if (x.status === T.RECEIVING) return 'Unloading';
        if (x.status === T.DEPARTED || x.status === T.DEPARTING) return 'In transit';
        if (x.status === T.SHIP_PENDING) return 'Waiting for manager';
        if (x.status === T.READY) return 'Ready to ship';
        if (x.status === T.NEEDS_FIX) return 'Needs IF fix';
        return 'Loading';
    }
    function lastStepOf(x) {
        const s = x.data.lastStep;
        return s || (x.data.startedAt ? { kind: 'started', by: x.data.startedBy, at: x.data.startedAt } : { kind: '', by: '', at: '' });
    }
    function dayOfStamp(stamp) { const p = core.parseNsStamp(stamp); return p ? p.dayIso : ''; }
    function firstText(q, ap, c) {
        if (q === 'ship') { const s = ap.shipPending[0]; return s.truck.label + ' · marked shipped ' + (s.ageMin == null ? '' : s.ageMin + ' min ago'); }
        if (q === 'fix') return ap.fixes[0].text;
        if (q === 'trucks') return ap.trucks[0].truck.label;
        if (q === 'flagged') { const f = ap.flagged[0]; return f.code + ' on ' + f.truckLabel + ' · never loaded'; }
        if (q === 'retry') return ap.retries[0].label;
        const r = ap.receipts[0];
        return r.truck.label + (r.perIf && r.perIf.length ? ' · ' + r.perIf.reduce((s, f) => s + f.received, 0) + ' of ' + r.perIf.reduce((s, f) => s + f.shipped, 0) + ' pcs in' : '') + ((r.flagged || []).length ? ' · ' + r.flagged.length + ' flagged' : '');
    }
    act('dashboard', true, (a, c) => {
        const ap = approvalsView(c), trucks = allTrucks();
        const queues = [['ship', 'Ship confirmations', ap.shipPending], ['fix', 'Correct the IF', ap.fixes], ['trucks', 'Trucks waiting for an IF fix', ap.trucks],
            ['flagged', 'Flagged pallets', ap.flagged], ['retry', 'Retry / Release', ap.retries], ['receipts', 'Receipts', ap.receipts]];
        const waiting = queues.filter(q => q[2].length).map(q => ({ queue: q[0], title: q[1], count: q[2].length, first: firstText(q[0], ap, c),
            late: q[0] === 'ship' && ap.shipPending.some(s => s.ageMin != null && s.ageMin >= 30) }));
        // Trucks per move day: a truck counts on the day the manager confirmed it shipped (depart.day).
        const byDay = {};
        trucks.filter(x => x.data.depart).forEach(x => { byDay[x.data.depart.day] = (byDay[x.data.depart.day] || 0) + 1; });
        const todayDone = (byDay[c.now.dayIso] || 0) > 0 && c.now.hour >= 15;
        const m = core.trackerMetrics({ todayIso: c.now.dayIso, targetIso: c.S.target, startIso: c.S.start, skipDates: c.S.skip || [], remaining: 0, movedByDay: byDay, todayDone: todayDone });
        const end = c.now.dayIso < c.S.target ? c.now.dayIso : c.S.target;
        const days = core.moveDays(c.S.start, end, c.S.skip || []).map(d => ({ day: d, n: byDay[d] || 0 }));
        // Active loads: every truck not received, plus trucks received today.
        const active = trucks.filter(x => x.status !== T.RECEIVED || dayOfStamp(x.data.recvApprovedAt) === c.now.dayIso);
        const counts = data.palletStatusCounts(active.map(x => x.id));
        const loadedAll = {};
        data.palletsByStatus([VP.LOADED]).forEach(p => { (loadedAll[String(p.loadId)] = loadedAll[String(p.loadId)] || []).push(p); });
        // One grouped read for every shipped pallet, split by truck (never one search per truck).
        const shippedAll = {}, activeIds = {};
        active.forEach(x => { activeIds[String(x.id)] = true; });
        data.palletsByStatus([VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]).forEach(p => {
            if (activeIds[String(p.loadId)]) (shippedAll[String(p.loadId)] = shippedAll[String(p.loadId)] || []).push(p);
        });
        const rows = [];
        active.forEach(x => {
            const d = x.data, stage = stageOf(x), dep = d.depart || null, ls = lastStepOf(x);
            const truck = truckLabel(x), base = { truckId: x.id, truck: truck, trailer: dep ? dep.trailer : (d.trailer || ''), seal: dep ? dep.seal : ((d.shipReq || {}).seal || ''),
                truckNo: dep ? dep.truckNo : null, status: x.status, stage: stage, lastKind: ls.kind, lastBy: whoName(ls.by), lastAt: ls.at, lastMin: ls.at ? minutesSince(ls.at, c) : null,
                flagged: stillFlagged(d.flagged).filter(p => p.data.flaggedTruck === x.id).length };
            if (dep) {
                const ps = shippedAll[String(x.id)] || [];
                const rp = verify.planReceipts({ alloc: d.alloc || [], pallets: ps, received: d.received || {}, stamp: dep, seq: 0 }), got = cnt(counts, x.id, VP.RECEIVED) > 0;
                const sk = skuNames([...new Set((d.alloc || []).reduce((s, al) => s.concat(Object.keys(al.lines)), []))]), irs = irsOf(x);
                (d.alloc || []).forEach(al => {
                    const per = rp.perIf.find(f => String(f.ifId) === String(al.ifId)) || { received: 0, shipped: 0 };
                    const pcs = Object.keys(al.lines).reduce((s, k) => s + Number(al.lines[k]), 0);
                    const pal = ps.filter(p => (p.lines || []).some(l => al.lines[String(l.item)] > 0)).length;      // pallets whose SKU this IF carries (a shared SKU counts on each IF)
                    rows.push(Object.assign({}, base, { ifId: String(al.ifId), ifNum: al.ifNum, toNum: al.toNum, skus: Object.keys(al.lines).map(k => ({ sku: sk[k] || k, qty: Number(al.lines[k]) })),
                        pallets: (d.alloc || []).length === 1 ? ps.length : pal, pcs: pcs, received: got || x.status === T.RECEIVED ? per.received : null,
                        irs: irs.filter(r => r.ifId === String(al.ifId)).map(r => r.irNum) }));
                });
            } else {
                const live = verify.liveIfs(d.ifs), ps = loadedAll[String(x.id)] || [], fill = verify.fillExpected(live, verify.sumLines(ps));
                live.forEach(f => {
                    const al = fill.alloc[String(f.ifId)] || {}, pcs = Object.keys(al).reduce((s, k) => s + Number(al[k] || 0), 0);
                    const pal = ps.filter(p => (p.lines || []).some(l => al[String(l.item)] > 0)).length;
                    rows.push(Object.assign({}, base, { ifId: String(f.ifId), ifNum: f.ifNum, toNum: f.toNum, skus: (f.lines || []).map(l => ({ sku: l.sku, qty: l.qty })),
                        pallets: live.length === 1 ? ps.length : pal, pcs: pcs, received: null }));
                });
            }
        });
        rows.sort((p, q) => STAGE_ORDER.indexOf(p.stage) - STAGE_ORDER.indexOf(q.stage) || Number(q.truckId) - Number(p.truckId) || Number(p.ifId) - Number(q.ifId));
        const transit = trucks.filter(x => x.status === T.DEPARTED || x.status === T.DEPARTING);
        const exc = {
            missing: data.countPallets({ status: [VP.MISSING] }),
            neverLoaded: stillFlagged([].concat.apply([], trucks.map(x => x.data.flagged || []))).length,
            damaged: data.countPallets({ damaged: true }),
            edited: data.countPallets({ edited: true, status: [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING] }),
            stale: data.countPallets({ status: [VP.LABELED], printedBefore: core.isoAddDays(c.now.dayIso, -(Number(c.S.staleDays) || 5)) }),
            noConfig: stockModel(c).est.unknownItems.length
        };
        return { waiting: waiting, target: c.S.target, days: days, rows: rows, exc: exc, noConfigSkus: [],
            tiles: { today: m.movedToday, plan: Number(c.S.trucksPerDay) > 0 ? Number(c.S.trucksPerDay) : 8, avg7: m.avg7, avgAll: m.avgAll, total: m.moved,
                received: trucks.filter(x => x.status === T.RECEIVED).length, inTransitTrucks: transit.length,
                inTransitPallets: data.countPallets({ status: [VP.IN_TRANSIT, VP.MISSING] }), missing: exc.missing } };
    });

    act('report', true, (a, c) => {
        const every = allTrucks(), trucks = every.filter(x => x.data.depart), counts = data.palletStatusCounts(every.map(x => x.id));   // one grouped read serves the day rows and the history
        const ids = {};
        trucks.forEach(x => (x.data.alloc || []).forEach(al => Object.keys(al.lines).forEach(k => { ids[k] = 1; })));
        const rows = verify.shadowRows({ trucks: trucks, ifInfo: ns.ifInfo(), ifsByTo: ns.ifsByTo(), receipts: ns.receiptsByIf(), sku: skuNames(Object.keys(ids)) });
        // Plan-only corrections on trucks still at the dock (the write mode left them to the office), while the diff is still open.
        const mode = writeMode(c), pend = [];
        every.forEach(x => orphanCreates(x).forEach(o => rows.push({ truck: truckLabel(x), seal: (x.data.depart || {}).seal || '', ifNum: 'IF ' + o.id,
            check: 'Dropped add-on IF', portal: 'Add-on IF ' + o.id + ' was dropped: delete or reuse it in NetSuite', netsuite: '—', ok: false })));
        every.filter(x => x.status === T.NEEDS_FIX).forEach(x => {
            const open = {};
            ((x.data.verify || {}).diffs || []).forEach(d => { open[d.key] = 1; });
            (x.data.corrections || []).forEach(k => {
                if (k.op && k.op.op !== 'drop_if' && open[k.key] && !verify.opAllowed(k.op, mode)) pend.push({ x: x, op: k.op });
            });
        });
        if (pend.length) {
            const sk = skuNames([...new Set(pend.reduce((s, o) => s.concat(o.op.op === 'if_qty' ? [String(o.op.item)] : Object.keys(o.op.lines || {})), []))]);
            pend.forEach(o => {
                const op = o.op, what = op.op === 'if_qty' ? op.ifNum + ' ' + sk[String(op.item)] + ': ' + op.from + ' → ' + op.to
                    : 'new IF from ' + (op.toNum || op.toId) + ': ' + Object.keys(op.lines || {}).map(it => sk[it] + ' ×' + op.lines[it]).join(', ');
                rows.push({ truck: truckLabel(o.x), seal: '', ifNum: op.ifNum || '(new)', check: 'IF fix needed', portal: what, netsuite: '—', ok: false });
            });
        }
        const days = {}, diffsBy = {};
        rows.forEach(r => { if (r.ok === false) diffsBy[r.truck] = (diffsBy[r.truck] || 0) + 1; });
        trucks.forEach(x => {
            const dd = days[x.data.depart.day] = days[x.data.depart.day] || { day: x.data.depart.day, trucks: 0, pallets: 0, pieces: 0, diffs: 0 };
            const sts = [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING];
            dd.trucks++; dd.pallets += sts.reduce((s, st) => s + cnt(counts, x.id, st), 0); dd.pieces += pcsOf(counts, x.id, sts);
            dd.diffs += diffsBy[truckLabel(x)] || 0;
        });
        // Truck history (spec §4): every v3 truck, newest first.
        const skAll = skuNames([...new Set(every.reduce((s, x) => s.concat((x.data.corrections || []).filter(k => k.op && k.op.op === 'if_qty').map(k => String(k.op.item))), []))]);
        const corrText = k => {
            if (k.kind === 'pallet_accept') return '+ ' + k.code + ' accepted' + (k.ifNum ? ' · ' + k.ifNum : k.toNum ? ' · new IF on ' + k.toNum : '') + (k.pending ? ' (office IF pending)' : '');
            if (k.kind === 'pallet_reject') return '↩ ' + k.code + ' rejected · "' + (k.note || '') + '"';
            const op = k.op || {};
            if (op.op === 'if_qty') return (op.to < op.from ? '⬇ ' : '⬆ ') + op.ifNum + ' ' + (skAll[String(op.item)] || op.item) + ' ' + verify._fmt(op.from) + '→' + verify._fmt(op.to);
            if (op.op === 'if_create') return '➕ add-on IF on ' + (op.toNum || op.toId);
            if (op.op === 'drop_if') return '✕ ' + op.ifNum + ' dropped';
            return String(op.op || k.kind || '');
        };
        const history = every.slice().sort((p, q) => Number(q.id) - Number(p.id)).map(x => {
            const d = x.data, dep = d.depart || null, q = d.shipReq || {}, sts = [VP.LOADED, VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING];
            return { truckId: x.id, day: dep ? dep.day : dayOfStamp(d.startedAt), truck: truckLabel(x), truckNo: dep ? dep.truckNo : null, trailer: dep ? dep.trailer : (d.trailer || ''),
                seal: dep ? dep.seal : (q.seal || ''), ifs: verify.liveIfs(d.ifs).map(f => f.ifNum), pallets: sts.reduce((s, st) => s + cnt(counts, x.id, st), 0), pcs: pcsOf(counts, x.id, sts),
                status: x.status, stage: stageOf(x), startedBy: whoName(d.startedBy), startedAt: d.startedAt || '', markedBy: whoName(q.by), markedAt: q.at || (dep && dep.markedBy ? dep.at : ''),
                confirmedBy: dep ? whoName(dep.approvedBy) || dep.approvedByRoster || '' : '', confirmedAt: dep ? dep.at : '', receivedAt: d.recvApprovedAt || '',
                irs: dep ? irsOf(x).map(r => r.irNum + (r.pcs != null ? ' (' + verify._fmt(r.pcs) + ')' : '')) : [],
                corrections: (d.corrections || []).map(corrText) };
        });
        return { rows: rows, days: Object.values(days).sort((p, q) => (p.day < q.day ? 1 : -1)), history: history, pulledAt: ns.pulledAt(), writeMode: writeMode(c) };
    });

    // ── entry points ─────────────────────────────────────────────────────
    function runAction(action, a, mgr) {
        const def = A[action];
        if (!def) throw userErr('Unknown action: ' + action);
        if (onFloorDeploy()) mgr = false;
        if (def.m && !mgr) throw userErr('Managers only');
        data.resetCache();
        if (ns.resetCache) ns.resetCache();
        const body = a || {};
        const u = runtime.getCurrentUser();
        const c = { mgr: !!mgr, S: settings(), now: nowInfo(), user: { id: String(u.id), name: u.name },
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
            out = Object.assign({ ok: true }, runAction(q.action, a, !onFloorDeploy() && isManager()));
        } catch (e) {
            if (!e.user) log.error({ title: 'move ' + q.action, details: (e && e.stack) || String(e) });
            out = { ok: false, error: e.user ? e.message : 'Error: ' + (e.message || e.name || String(e)) };
        }
        ctx.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        ctx.response.write(JSON.stringify(out));
    }

    function page(ctx) {
        const S = data.getSettings();
        const script = runtime.getCurrentScript(), floor = onFloorDeploy();
        // The external (no-login) URL only when the request itself is anonymous (user id -4): a logged-in user on the floor deployment stays on the internal URL.
        const external = script.deploymentId === FLOOR_DEPLOY_ID && !(Number(runtime.getCurrentUser().id) > 0);
        ctx.response.write(ui.buildPage({   // the no-login floor deployment: API calls go to its external URL
            url: url.resolveScript(Object.assign({ scriptId: script.id, deploymentId: script.deploymentId }, external ? { returnExternalUrl: true } : {})),
            mode: !floor && isManager() ? 'manager' : 'floor', me: runtime.getCurrentUser().name, roster: S.roster || [],
            fromName: S.fromName, toName: S.toName, maxPrint: Number(S.maxPrint) || 250
        }));
    }

    function pdf(ctx) {
        const q = ctx.request.parameters;
        if (onFloorDeploy() || !isManager()) { ctx.response.write('Managers only'); return; }
        const S = data.getSettings();
        const ps = q.job ? data.palletsByJob(String(q.job)).filter(p => p.status !== VP.VOID) : data.palletsByIds(String(q.ids || '').split(','));
        if (!ps.length) { ctx.response.write('No labels to print'); return; }
        const xml = tpl.labelsXml(ps.map(p => ({ code: p.code, lines: p.lines, pieces: p.pieces, edited: p.edited, printedDay: p.printedDay,
            by: p.data.printedBy || '', summary: p.summary })), { codeMode: S.labelCode, header: q.header === '1', fromName: S.fromName, toName: S.toName });
        ctx.response.writeFile({ file: render.xmlToPdf({ xmlString: xml }), isInline: true });
    }

    return { onRequest: onRequest, _runAction: runAction };
});
