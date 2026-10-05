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

    function mustPallet(id) { const p = data.getPallet(id); if (!p) throw userErr('Label not found'); return p; }
    function stale(Ld) { return Date.now() - (Number(Ld.data.workingAt) || 0) > STALE_MS; }

    // Flips the load to a working status under a fresh claim token, then re-reads it to confirm
    // no other request's write interleaved. Returns the fresh load and the claim to re-check later.
    function claimLoad(Ld, status, phase, mustBe, extraData) {
        const cur = data.getLoad(Ld.id);               // never merge over a stale copy: re-read, then guard, then claim
        if (!cur) throw userErr('Load not found');
        if (mustBe) mustBe(cur);
        Ld = cur;
        const extra = typeof extraData === 'function' ? extraData(cur) : extraData;   // computed from the guarded copy, written with the claim
        const claim = String(Date.now()) + Math.random().toString(36).slice(2, 8);
        data.updateLoad(Ld, { status: status, data: Object.assign({ workingAt: Date.now(), error: '', phase: phase, claim: claim }, extra || {}) });
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
            trailers: c.S.trailers || ['537224', '416460', '105488', '522051', '211659'], carrier: c.S.defaultCarrier || 'Armstrong Group', writeMode: writeMode(c),
            trailer: d.trailer || '', otherItems: d.otherItems || [], shortNote: d.shortNote || null };
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
    function pushStack(id, entry) {
        touched(id, cur => ({ stack: (cur.data.stack || []).concat([entry]).slice(-STACK_MAX) }));
    }
    // Load scans: a pallet on another open truck (any open stage) can be moved here, so it reads as a loading truck.
    function scanTruckMap(list) {
        const o = truckMap(list);
        Object.keys(o).forEach(k => { if (OPEN.indexOf(o[k].status) !== -1) o[k].status = T.LOADING; });
        return o;
    }
    // Open TO lines minus the room other trucks will need (loading surplus, planned-but-unwritten raises and add-ons).
    function reservedToLines(exceptId, trucks, loadedAll, c, openTo) {
        const byTruck = {}, toLines = openTo || ns.openToLines();
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
            status === T.READY ? { correctError: '' } : {}, opt.note ? { shortNote: { text: opt.note, by: c.actor, at: c.now.stamp } } : {}) });      // a ready truck has nothing left to correct
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
    function sealTaken(seal, id) { if (verify.sealUsed(allTrucks(), seal, id)) throw userErr('Seal ' + seal + ' was already used on another truck'); }
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
        const every = allTrucks(), trucks = every.slice(0, 15), counts = data.palletStatusCounts(trucks.map(x => x.id));
        const exc = {
            missing: data.countPallets({ status: [VP.MISSING] }),
            neverLoaded: stillFlagged([].concat.apply([], every.map(x => x.data.flagged || []))).length,
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
            target: c.S.target, days: days, trucks: trucks.map(x => truckSummary(x, counts)), exc: exc, bySku: bySku,
            noConfigSkus: sm.est.unknownItems.map(skuOf)
        };
    });

    act('truck_planned', false, (a, c) => {
        const trucks = allTrucks(), taken = {}, dp = defPcs(c);
        trucks.forEach(x => (x.data.ifs || []).forEach(f => { taken[f.ifId] = true; }));
        const open = trucks.filter(x => OPEN.indexOf(x.status) !== -1 || x.status === T.SHIP_PENDING || x.status === T.DEPARTING), counts = data.palletStatusCounts(open.map(x => x.id));
        return { planned: ns.plannedIfs().filter(f => !taken[f.ifId]).map(f => pubIf(f, dp)),
            open: open.map(x => truckSummary(x, counts)), pulledAt: ns.pulledAt() };
    });

    // A trailer is on one truck at a time until it leaves.
    const TRAILER_BUSY = [T.LOADING, T.NEEDS_FIX, T.READY, T.SHIP_PENDING, T.DEPARTING];
    const normTrailer = t => String(t || '').trim().toUpperCase();
    act('truck_start', false, (a, c) => {
        const ids = (a.ifIds || []).map(String), trailer = String(a.trailer || '').trim();
        if (!trailer) throw userErr('Enter the trailer #');
        if (trailer.length > 20) throw userErr('The trailer # is too long (20 characters max)');
        if (!ids.length) throw userErr('Pick at least one IF');
        if (data.loadsByStatus(TRAILER_BUSY).some(x => x.data && x.data.v3 && normTrailer(x.data.trailer) === normTrailer(trailer))) throw userErr('Trailer ' + trailer + ' is already on an open truck');
        const planned = ns.plannedIfs(), taken = {};
        allTrucks().forEach(x => (x.data.ifs || []).forEach(f => { taken[f.ifId] = true; }));
        const ifs = ids.map(id => {
            const f = planned.find(y => y.ifId === id);
            if (taken[id]) throw userErr((f ? f.ifNum : 'IF ' + id) + ' is already on a truck');
            if (!f) throw userErr('IF ' + id + ' is not Picked/Packed any more. Refresh the list.');
            return f;
        });
        const id = data.createLoad({ number: ifs.map(f => f.ifNum).join('+').slice(0, 290), status: T.LOADING,
            data: { v3: true, ifs: ifs, trailer: trailer, startedBy: c.actor, startedAt: c.now.stamp, stack: [] } });
        return { view: truckView(mustTruck(id), c) };
    });

    act('truck_get', false, (a, c) => ({ view: truckView(mustTruck(a.truckId), c) }));

    // Take off: only a pallet loaded on this truck goes back to labeled. No capacity check is needed.
    function takeOff(x, s, p, c) {
        let result = 'not_on_truck';
        if (p && p.status === VP.LOADED && String(p.loadId) === String(x.id)) {
            mustOpenTruck(x.id);
            data.updatePallet(p, { status: VP.LABELED, load: '', data: { takenOffAt: c.now.stamp, takenOffBy: c.actor, takenOffTruck: x.id } });
            touched(x.id);
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
            pushStack(x.id, String(p.id));
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
        pushStack(x.id, String(p.id));
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
        const v = verifyTruck(a.truckId, c, { newIfs: (x, planned, trucks) => {
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
        const v = verifyTruck(a.truckId, c, { newIfs: x => {
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
        release({ correctError: err || '' });
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
            bol: d.plan.bol, ifs: d.ifs, departPallets: d.palletKey, writes: {} };
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
        const inp = { trailer: String(x.data.trailer || '').trim(), seal: String(a.seal || '').trim(), carrier: String(a.carrier || '').trim() || c.S.defaultCarrier || 'Armstrong Group' };
        if (!inp.seal) throw userErr('Enter the seal #');
        sealTaken(inp.seal, x.id);
        const v = verifyTruck(x.id, c, { truck: x, poll: true });    // an unchanged load keeps verify at/by
        if (!v.r.match) return Object.assign({ needsFix: true }, verifyOut(v, c));
        const d = departPlan(v.x, inp, c, v), pm = planMismatch(d.plan);
        if (pm.length) return toNeedsFix(x.id, { keep: v.r.keep, diffs: pm, ps: v.ps, seenIfs: v.x.data.ifs }, c);
        const cur = data.getLoad(x.id);               // right before the write: never merge over a stale copy
        mustReady(cur);
        if (ifSig(cur.data.ifs) !== ifSig(v.x.data.ifs) || palletKey(data.palletsByLoad(x.id, [VP.LOADED])) !== d.palletKey) throw userErr('This truck changed while it was being checked. Verify again.');
        data.updateLoad(cur, { status: T.SHIP_PENDING, data: { shipReq: Object.assign(inp, { by: c.actor, at: c.now.stamp }), sentBack: null } });
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
        data.updateLoad(cur, { status: T.LOADING, data: { sentBack: { note: note, by: c.user, at: c.now.stamp }, shipReq: null } });
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
            recent: got.slice(-5).reverse().map(p => pubPallet(p)), counts: { in: got.length, of: ps.length }, flagged: flagged.map(p => pubPallet(p)) };
    }
    // Never-loaded pallets are listed on the truck that flagged them (data.flagged) and read back by id.
    function stillFlagged(ids) {
        const u = [...new Set((ids || []).map(String))];
        return u.length ? data.palletsByIds(u).filter(p => p.data.flag === 'never_loaded' && (p.status === VP.LABELED || p.status === VP.LOADED)) : [];
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
        mustUnloadable(x.id);                               // re-check right before the pallet changes: approving closes scanning
        data.updatePallet(p, { status: VP.RECEIVED, data: { receivedAt: c.now.stamp, receivedBy: c.actor } });
        const cur = mustTruck(x.id), d = cur.data;          // fresh read: stack and counters merge over the current copy
        const patch = { data: { rstack: (d.rstack || []).concat([{ id: String(p.id), prev: prev }]).slice(-STACK_MAX),
            unposted: typeof d.unposted === 'number' ? d.unposted + 1 : unpostedOf(cur) } };
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
        if (r.result === 'never_loaded') {
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
        assertClaim(x.id, claim, label, 'receive');   // right before the final write: never overwrite another request's state
        const fin = data.getLoad(x.id);
        data.updateLoad(fin, { status: T.RECEIVED, data: { rplan: (fin.data.rplan || []).concat(rp.ops), prevStatus: '', received: rp.cumulative, recvSeq: seq, recvRequested: null,
            unposted: unposted, missing: missing, error: '', writes: writes, workingAt: 0, claim: '', phase: '' } });
        return { perIf: rp.perIf, missing: rp.missing, written: res.written, view: unloadView(mustTruck(x.id), c) };
    });

    // ── v3 manager approvals and shadow report ───────────────────────────
    function whoName(w) { return w && typeof w === 'object' ? String(w.name || w.id || '') : String(w == null ? '' : w); }
    act('approvals', true, (a, c) => {
        const trucks = allTrucks();
        const stuck = x => !!(x.data.error || stale(x));
        const counts = data.palletStatusCounts(trucks.filter(x => OPEN.indexOf(x.status) === -1).map(x => x.id));
        const sum = x => truckSummary(x, counts);
        // needs_fix: the stored diffs (only the manager's Re-check calls truck_verify again); one grouped read of loaded pallets.
        const fix = trucks.filter(x => x.status === T.NEEDS_FIX);
        let needsFix = [], freeIfs = [];
        if (fix.length) {
            const loaded = {}, dp = defPcs(c), planned = ns.plannedIfs(), taken = takenByOthers(trucks, null);
            // Spec §7: a manager may add any Picked/Packed IF that no truck has (the card's picker), not only the suggested ones.
            freeIfs = planned.filter(f => !taken[String(f.ifId)]).map(f => ({ ifId: f.ifId, ifNum: f.ifNum, toNum: f.toNum, lines: f.lines }));
            data.palletsByStatus([VP.LOADED]).forEach(p => { (loaded[String(p.loadId)] = loaded[String(p.loadId)] || []).push(p); });
            const sk = skuNames([...new Set(fix.reduce((s, x) => s.concat(((x.data.verify || {}).diffs || []).filter(d => d.item).map(d => String(d.item))), []))]);
            needsFix = fix.map(x => {
                const ps = loaded[String(x.id)] || [], diffs = (x.data.verify || {}).diffs || [];
                return { truck: truckSummary(x, countsFromPallets(x.id, ps)), diffs: pubDiffs(diffs, ps, sk), suggestions: suggestionsFor(x, x.data.ifs, diffs, dp, trucks, planned),
                    corrections: x.data.corrections || [], correctError: x.data.correctError || '', orphans: orphanCreates(x), stuck: stuckCorrect(x), writeMode: writeMode(c), verifiedBy: whoName((x.data.verify || {}).by), verifiedAt: (x.data.verify || {}).at || '' };
            });
        }
        const shipPending = trucks.filter(x => x.status === T.SHIP_PENDING && x.data.shipReq).map(x => {
            const q = x.data.shipReq;
            return { truck: sum(x), trailer: x.data.trailer || q.trailer || '', seal: q.seal, carrier: q.carrier,
                ifs: verify.liveIfs(x.data.ifs).map(f => ({ ifNum: f.ifNum, lines: f.lines })), pallets: cnt(counts, x.id, VP.LOADED), pcs: pcsOf(counts, x.id, [VP.LOADED]),
                otherItems: x.data.otherItems || [], markedBy: whoName(q.by), markedAt: q.at || '' };
        });
        return {
            shipPending: shipPending,
            needsFix: needsFix,
            freeIfs: freeIfs,
            retries: trucks.filter(x => x.status === T.DEPARTING && stuck(x)).map(x => Object.assign(sum(x), { canRelease: !stampWritten(x) })),
            receipts: trucks.filter(x => UNLOADABLE.indexOf(x.status) !== -1 || (x.status === T.APPROVING && stuck(x))).map(x => {
                const isStuck = x.status === T.APPROVING;
                try {
                    const unposted = unpostedOf(x, counts);
                    if (!isStuck && (!unposted || (x.status !== T.RECEIVED && !x.data.recvRequested))) return null;
                    const rp = receiptPlan(x);
                    const o = { truck: sum(x), perIf: rp.perIf, missing: rp.missing, lateOnly: x.status === T.RECEIVED };
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
        const trucks = allTrucks().filter(x => x.data.depart), counts = data.palletStatusCounts(trucks.map(x => x.id));
        const ids = {};
        trucks.forEach(x => (x.data.alloc || []).forEach(al => Object.keys(al.lines).forEach(k => { ids[k] = 1; })));
        const rows = verify.shadowRows({ trucks: trucks, ifInfo: ns.ifInfo(), ifsByTo: ns.ifsByTo(), receipts: ns.receiptsByIf(), sku: skuNames(Object.keys(ids)) });
        // Plan-only corrections on trucks still at the dock (the write mode left them to the office), while the diff is still open.
        const mode = writeMode(c), pend = [], every = allTrucks();
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
        return { rows: rows, days: Object.values(days).sort((p, q) => (p.day < q.day ? 1 : -1)), pulledAt: ns.pulledAt(), writeMode: writeMode(c) };
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
        const script = runtime.getCurrentScript(), floor = onFloorDeploy(), external = script.deploymentId === FLOOR_DEPLOY_ID;
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
