/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal v3 (verification only): pure rules, no N/ modules, unit-tested in node.
 * Spec: docs/superpowers/specs/2026-10-01-move-portal-verification-design.md
 */
define([], function () {
    'use strict';

    const TRUCK = { LOADING: 'loading', NEEDS_FIX: 'needs_fix', READY: 'ready', SHIP_PENDING: 'ship_pending', DEPARTING: 'departing', AT_DOCK: 'at_dock', PICKUP_PENDING: 'pickup_pending', DEPARTED: 'departed', RECEIVING: 'receiving', APPROVING: 'approving', RECEIVED: 'received' };
    const VP = { LABELED: 'labeled', LOADED: 'loaded', IN_TRANSIT: 'in_transit', RECEIVED: 'received', MISSING: 'missing', VOID: 'void' };
    const PLANNED_IF_STATUS = ['A', 'B'];
    const OPEN_TO_STATUS = ['B', 'D', 'E'];

    // ── helpers ──────────────────────────────────────────────────────────
    function sumLines(pallets) {
        const out = {};
        (pallets || []).forEach(p => (p.lines || []).forEach(l => { const k = String(l.item); out[k] = (out[k] || 0) + (Number(l.pcs) || 0); }));
        return out;
    }
    // ── scan-built trucks (spec 2026-10-14) ──────────────────────────────
    // NetSuite weightunit: an id (1 lb, 2 oz, 3 kg, 4 g) or its text. Blank unit = lb. Anything else, or no weight, = null ("no weight").
    const LB_PER = { '': 1, '1': 1, lb: 1, lbs: 1, '2': 1 / 16, oz: 1 / 16, '3': 2.20462, kg: 2.20462, '4': 0.00220462, g: 0.00220462 };
    function lbs(weight, unit) {
        const w = Number(weight), f = LB_PER[String(unit == null ? "" : unit).trim().toLowerCase()];
        if (!(w > 0) || f == null) return null;
        return Math.round(w * f * 100) / 100;
    }
    // Pallets and pieces per SKU. A mixed pallet counts once on each SKU it carries.
    function truckLines(pallets) {
        const out = {};
        (pallets || []).forEach(p => {
            const seen = {};
            (p.lines || []).forEach(l => {
                const k = String(l.item), r = (out[k] = out[k] || { pallets: 0, pcs: 0 });
                r.pcs += Number(l.pcs) || 0;
                if (!seen[k]) { r.pallets++; seen[k] = true; }
            });
        });
        return out;
    }
    // Portal unit weights from the Move settings (spec 2026-10-18) win over the NetSuite item weight: { item: info } with weight/wunit/cyl replaced.
    function withWts(info, wts) {
        const out = {};
        Object.keys(info || {}).forEach(k => {
            const i = info[k], w = (wts || {})[String(i.sku || '').toUpperCase()];
            out[k] = w ? Object.assign({}, i, { weight: w[0], wunit: 'lb', cyl: !!w[1] }) : Object.assign({}, i, { cyl: null });
        });
        return out;
    }
    // Truck weight limit check: over = total above max; atLeast = some SKUs have no weight, so the total is a floor.
    function overweight(total, noWeight, max) { return { max: max, over: total > max, atLeast: noWeight > 0 }; }
    // VICS BOL rows (spec 2026-10-18): one carrier line per SKU. Each pallet's handling unit (and its tare) goes to its first line's SKU,
    // so the line handling units add up to the pallet count. Weight = pcs × unit weight + handling units × tare; a SKU with no weight
    // prints a blank weight and blanks the grand total (the office writes it in).
    function bolPlan(o) {
        const info = o.info || {}, tare = Number(o.tare) || 0, by = {}, order = [];
        (o.pallets || []).forEach(p => (p.lines || []).forEach((l, i) => {
            const k = String(l.item);
            if (!by[k]) { by[k] = { units: 0, pcs: 0 }; order.push(k); }
            by[k].pcs += Number(l.pcs) || 0;
            if (i === 0) by[k].units++;
        }));
        const missing = [], unknownType = [];
        const lines = order.map(k => {
            const i = info[k] || {}, per = lbs(i.weight, i.wunit), r = by[k];
            if (per == null) missing.push(i.sku || k);
            if (i.cyl == null) unknownType.push(i.sku || k);   // no uploaded row: never print it as non-hazmat
            return { item: k, sku: i.sku || k, desc: i.desc || i.sku || k, units: r.units, pcs: r.pcs, type: i.cyl == null ? '?' : i.cyl ? 'CYL' : 'PCS', hm: i.cyl == null ? false : !!i.cyl,
                lbs: per == null ? null : Math.round(per * r.pcs + tare * r.units) };
        }).sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0));
        const sum = f => lines.reduce((s, l) => s + l[f], 0);
        return { lines: lines, units: sum('units'), pcs: sum('pcs'), lbs: missing.length ? null : sum('lbs'), missing: missing, unknownType: unknownType.sort() };
    }
    function linesPcs(tl) { const o = {}; Object.keys(tl || {}).forEach(k => { o[k] = tl[k].pcs; }); return o; }
    // info: { item: { weight, wunit } }. Line weights are rounded to the pound; the tare is palletCount × tare.
    function truckWeight(tl, info, tare, palletCount) {
        const rows = {};
        let total = 0, noWeight = 0;
        Object.keys(tl || {}).forEach(k => {
            const i = (info || {})[k] || {}, per = lbs(i.weight, i.wunit);
            if (per == null) { rows[k] = null; noWeight++; return; }
            rows[k] = Math.round(per * tl[k].pcs);
            total += rows[k];
        });
        const t = Math.round((Number(tare) || 0) * (Number(palletCount) || 0));
        return { rows: rows, tare: t, total: total + t, noWeight: noWeight };
    }
    function stockCheck(pcsByItem, avail) {
        return Object.keys(pcsByItem || {}).filter(k => (Number(pcsByItem[k]) || 0) > (Number((avail || {})[k]) || 0))
            .map(k => ({ item: k, need: Number(pcsByItem[k]) || 0, avail: Number((avail || {})[k]) || 0 }));
    }
    function stockText(shorts, sk) {
        return (shorts || []).map(s => ((sk || {})[s.item] || s.item) + " on truck " + fmt(s.need) + ", available " + fmt(s.avail)).join("; ");
    }
    // IFs flagged gone (no longer Picked/Packed in NetSuite) stay on a truck until a manager drops them, but cover nothing.
    function liveIfs(ifs) { return (ifs || []).filter(f => !f.gone); }
    function byIfOrder(ifs) { return (ifs || []).slice().sort((a, b) => Number(a.ifId) - Number(b.ifId)); }
    function ifQty(f, item) { return (f.lines || []).filter(l => String(l.item) === String(item)).reduce((a, l) => a + (Number(l.qty) || 0), 0); }
    function oldestFirst(a, b) { return a.trandate < b.trandate ? -1 : a.trandate > b.trandate ? 1 : Number(a.toId) - Number(b.toId); }

    // Fill each IF line (in IF id order) up to its qty from what was scanned; `left` is what didn't fit.
    function fillExpected(ifs, scannedByItem) {
        const alloc = {}, left = Object.assign({}, scannedByItem);
        byIfOrder(ifs).forEach(f => {
            const a = alloc[String(f.ifId)] = {};
            (f.lines || []).forEach(l => {
                const k = String(l.item);
                if (k in a) return;
                const g = Math.min(left[k] || 0, ifQty(f, k));
                a[k] = g;
                if (k in left) left[k] -= g;
            });
        });
        return { alloc, left };
    }

    // ── capacity and the load-out scan rule ──────────────────────────────
    // What this truck may carry of `item`: its IFs' qty, plus what those IFs' TOs still have (a raise),
    // plus what other open office TOs have (an add-on IF from the oldest one).
    function itemCapacity(item, ifs, toLines) {
        const k = String(item), own = {};
        let expected = 0;
        (ifs || []).forEach(f => { const q = ifQty(f, k); if (q > 0) { own[String(f.toId)] = true; expected += q; } });
        const rows = (toLines || []).filter(r => String(r.item) === k && Number(r.remaining) > 0);
        const raise = rows.filter(r => own[String(r.toId)]).reduce((a, r) => a + Number(r.remaining), 0);
        const others = rows.filter(r => !own[String(r.toId)]).sort(oldestFirst);
        const addon = others.reduce((a, r) => a + Number(r.remaining), 0);
        return { expected, raise, addon, addonTo: others[0] ? { toId: String(others[0].toId), toNum: others[0].toNum } : null };
    }

    const RANK = { ok: 0, over: 1, addon: 2, no_to: 3 };
    function fitOnTruck(p, o) {
        let worst = 'ok', sku = '', addonTo = null;
        (p.lines || []).forEach(l => {
            const cap = itemCapacity(l.item, o.ifs, o.toLines);
            const after = (Number(o.loadedByItem && o.loadedByItem[String(l.item)]) || 0) + (Number(l.pcs) || 0);
            let r = 'ok';
            if (after > cap.expected + cap.raise + cap.addon) r = 'no_to';
            else if (after > cap.expected + cap.raise) r = 'addon';
            else if (after > cap.expected) r = 'over';
            if (RANK[r] > RANK[worst]) { worst = r; sku = l.sku || String(l.item); if (r === 'addon') addonTo = cap.addonTo; }
        });
        if (worst === 'no_to') return { result: 'no_to', sku: sku };
        return { result: worst, addonTo: addonTo, set: { status: VP.LOADED, loadId: String(o.truckId) } };
    }

    function classifyLoadScan(o) {
        const p = o.pallet;
        if (!p) return { result: 'unknown' };
        if (p.status === VP.VOID) return { result: 'void' };
        const me = String(o.truckId), pt = p.loadId ? String(p.loadId) : '';
        const other = (o.trucks && o.trucks[pt]) || {};
        if (p.status === VP.LOADED) {
            if (pt === me) return { result: 'dup' };
            if (other.status === TRUCK.LOADING) return { result: 'other_truck', otherTruckId: pt, otherLabel: other.label || '' };
            return Object.assign({ result: 'locked', otherTruckId: pt, otherLabel: other.label || '' }, other.status === TRUCK.AT_DOCK || other.status === TRUCK.PICKUP_PENDING ? { reason: 'at_dock' } : {});
        }
        if (p.status !== VP.LABELED) return { result: 'shipped', otherTruckId: pt, otherLabel: other.label || '' };
        if (o.scanBuilt) return { result: 'ok', set: { status: VP.LOADED, loadId: String(o.truckId) } };   // the scans are the order: no TO to fit
        return fitOnTruck(p, o);
    }

    const TONE = { ok: 'ok', late: 'ok', over: 'warn', addon: 'warn', dup: 'warn', other_truck: 'warn', dup_other: 'warn' };
    function toneFor(result) { return TONE[result] || 'bad'; }

    // ── departure ────────────────────────────────────────────────────────
    function memoFor(truckNo, dayIso) { return 'Truck ' + truckNo + ' · ' + String(dayIso).slice(5, 7) + '/' + String(dayIso).slice(8, 10); }
    function scanTag(ref) { return '[MV-' + ref + ']'; }
    // Approve on a scan-built truck (spec 2026-10-14 §3): a new TO for what was scanned, then its IF saved Shipped with the stamp
    // (o.packed: drop trailer, saved Packed and stamped Shipped at the manager's ship confirm, spec 2026-10-17; o.picked: the older Picked IF).
    function scanApprovePlan(o) {
        const ref = String(o.ref), tag = scanTag(ref), st = o.stamp || {}, S = o.S || {}, memo = memoFor(st.truckNo, st.dayIso);
        const lines = Object.assign({}, o.lines);
        const to = { op: 'to_create', ref: ref, token: tag, fromLoc: String(S.locFrom), toLoc: String(S.locTo), orderStatus: S.toStatus || 'B', lines: lines,
            memo: tag + ' Trailer ' + st.trailer + ' · ' + memo };
        const f = { op: 'if_create', ref: ref, toId: 'new:to:' + ref, ship: o.packed ? 'packed' : o.picked ? 'picked' : true, token: tag, lines: Object.assign({}, lines), trailer: st.trailer, seal: st.seal,
            memo: memo + ' · ' + tag };
        return { ops: [to, f], alloc: [{ ifId: 'new:' + ref, ifNum: '(new)', toId: 'new:to:' + ref, toNum: '(new TO)', lines: Object.assign({}, lines), addOn: false }],
            unplanned: [], corrections: [], bol: null };
    }
    function normSeal(s) { return String(s == null ? '' : s).trim().toUpperCase(); }
    function sealKey(s) { return String(s == null ? '' : s).toUpperCase().replace(/^\s*SEAL\s*:?\s*/, '').replace(/\s+/g, ''); }
    function departOf(t) { return (t && t.data && t.data.depart) || null; }
    // A seal is taken once a truck departed with it, or while the floor's Mark shipped holds it (shipReq).
    function sealOf(t) { const d = departOf(t), q = t && t.data && t.data.shipReq; return d ? d.seal : q ? q.seal : null; }
    // The other truck holding this seal (or null).
    function sealHolder(trucks, seal, exceptId) {
        const n = sealKey(seal);
        return (n && (trucks || []).find(t => String(t.id) !== String(exceptId) && sealOf(t) != null && sealKey(sealOf(t)) === n)) || null;
    }
    function sealUsed(trucks, seal, exceptId) { return !!sealHolder(trucks, seal, exceptId); }
    function truckNoForDay(trucks, dayIso, exceptId) {
        return 1 + (trucks || []).filter(t => String(t.id) !== String(exceptId) && departOf(t) && departOf(t).day === dayIso).length;
    }

    // Place what didn't fit on the IFs: raise on the IFs' own TOs first, then add-ons from the oldest other open TOs. Never throws.
    function placeSurplus(ifsIn, leftByItem, toLines) {
        const ifs = byIfOrder(ifsIn), toLeft = {}, raises = {}, addOns = {}, uncovered = {};
        (toLines || []).forEach(r => { toLeft[String(r.toId) + '|' + String(r.item)] = Number(r.remaining) || 0; });
        Object.keys(leftByItem || {}).forEach(k => {
            let left = leftByItem[k];
            if (!(left > 0)) return;
            const own = {};
            ifs.filter(f => ifQty(f, k) > 0).forEach(f => {
                own[String(f.toId)] = true;
                const key = String(f.toId) + '|' + k, g = Math.min(left, toLeft[key] || 0);
                if (g) { const r = raises[String(f.ifId)] = raises[String(f.ifId)] || {}; r[k] = (r[k] || 0) + g; toLeft[key] -= g; left -= g; }
            });
            (toLines || []).filter(r => String(r.item) === k && !own[String(r.toId)]).sort(oldestFirst).forEach(r => {
                const key = String(r.toId) + '|' + k, g = Math.min(left, toLeft[key] || 0);
                if (!g) return;
                const a = addOns[String(r.toId)] = addOns[String(r.toId)] || { toId: String(r.toId), toNum: r.toNum, lines: {} };
                a.lines[k] = (a.lines[k] || 0) + g; toLeft[key] -= g; left -= g;
            });
            if (left > 0) uncovered[k] = left;
        });
        return { raises, addOns, uncovered };
    }

    function planDeparture(o) {
        const ifs = byIfOrder(o.ifs), scanned = sumLines(o.pallets);
        const fill = fillExpected(ifs, scanned), alloc = fill.alloc;
        const sp = placeSurplus(ifs, fill.left, o.toLines), addOns = sp.addOns;
        const bad = Object.keys(sp.uncovered)[0];
        if (bad) throw new Error('No open transfer order covers ' + sp.uncovered[bad] + ' pcs of item ' + bad);
        Object.keys(sp.raises).forEach(id => Object.keys(sp.raises[id]).forEach(k => { alloc[id][k] += sp.raises[id][k]; }));

        const st = { trailer: o.stamp.trailer, seal: o.stamp.seal, memo: memoFor(o.stamp.truckNo, o.stamp.dayIso) };
        const ops = [], allocOut = [], unplanned = [], kept = [];
        ifs.forEach(f => {
            const a = alloc[String(f.ifId)];
            if (!Object.keys(a).some(k => a[k] > 0)) { unplanned.push({ ifId: String(f.ifId), ifNum: f.ifNum }); return; }
            kept.push(f);
            Object.keys(a).forEach(k => {
                const from = ifQty(f, k);
                if (a[k] !== from) ops.push({ op: 'if_qty', ifId: String(f.ifId), ifNum: f.ifNum, toId: String(f.toId), item: k, from: from, to: a[k] });
            });
            const expect = {};                         // what the IF must hold when it is stamped (after any qty edit)
            Object.keys(a).forEach(k => { if (a[k] > 0) expect[k] = a[k]; });
            ops.push(Object.assign({ op: 'if_stamp', ifId: String(f.ifId), ifNum: f.ifNum }, st, { lines: expect }));
            allocOut.push({ ifId: String(f.ifId), ifNum: f.ifNum, toId: String(f.toId), toNum: f.toNum, lines: a, addOn: false });
        });
        Object.keys(addOns).sort((x, y) => Number(x) - Number(y)).forEach(t => {
            const a = addOns[t];
            ops.push(Object.assign({ op: 'if_create', toId: a.toId, toNum: a.toNum, lines: a.lines }, st));
            allocOut.push({ ifId: 'new:' + a.toId, ifNum: '(new)', toId: a.toId, toNum: a.toNum, lines: a.lines, addOn: true });
        });
        const corrections = ops.filter(x => x.op !== 'if_stamp');
        return { ops, alloc: allocOut, unplanned, corrections, needsManager: corrections.length > 0 || unplanned.length > 0,
            bol: { number: kept[0] ? kept[0].toNum : '', changed: corrections.length > 0 || unplanned.length > 0,
                ifNums: kept.map(f => f.ifNum).concat(Object.keys(addOns).sort((x, y) => Number(x) - Number(y)).map(t => '(new from ' + addOns[t].toNum + ')')) } };
    }

    // Re-read IFs at departure: plan from NetSuite's current lines; an IF no longer Picked/Packed drops out.
    function ifPcs(f) { return (f.lines || []).reduce((a, l) => a + (Number(l.qty) || 0), 0); }
    function linesKey(f) {
        const m = {};
        (f.lines || []).forEach(l => { const k = String(l.item); m[k] = (m[k] || 0) + (Number(l.qty) || 0); });
        return JSON.stringify(Object.keys(m).sort().map(k => [k, m[k]]));
    }
    function refreshIfs(saved, fresh) {
        const byId = {}, ifs = [], gone = [], changes = [];
        (fresh || []).forEach(f => { byId[String(f.ifId)] = f; });
        (saved || []).forEach(s => {
            const id = String(s.ifId), f = byId[id];
            if (!f) {
                gone.push({ ifId: id, ifNum: s.ifNum });
                changes.push({ ifId: id, ifNum: s.ifNum, was: s.lines, now: 'not Packed', wasPcs: ifPcs(s), nowPcs: null });
                return;
            }
            if (linesKey(f) !== linesKey(s)) changes.push({ ifId: id, ifNum: f.ifNum, was: s.lines, now: f.lines, wasPcs: ifPcs(s), nowPcs: ifPcs(f) });
            ifs.push(f);
        });
        return { ifs, gone, changes };
    }

    // ── TO room reserved by other trucks ─────────────────────────────────
    // NetSuite's TO "remaining" doesn't yet know about raises/add-ons that other trucks will need (loading) or
    // planned but haven't written (departed in off/qty mode, or a key not in writes). Reserve them first.
    const RESERVING = [TRUCK.DEPARTING, TRUCK.DEPARTED, TRUCK.RECEIVING, TRUCK.APPROVING];
    function addRes(res, toId, item, q) { if (q > 0) { const k = String(toId) + '|' + String(item); res[k] = (res[k] || 0) + q; } }
    function reserveToLines(toLines, res) {
        return (toLines || []).map(r => Object.assign({}, r, { remaining: Math.max(0, (Number(r.remaining) || 0) - ((res || {})[String(r.toId) + '|' + String(r.item)] || 0)) }));
    }
    function inNetSuite(op, mode, writes) {
        const w = writes && writes[opKey(op)];
        return opAllowed(op, mode) && !!w && String(w).indexOf('skipped:') !== 0;
    }
    function reservationsFromTrucks(o) {
        // A scan-built truck never uses office TO room (spec S3): its pallets go on its own new TO at Approve.
        const res = {}, others = (o.trucks || []).filter(t => String(t.id) !== String(o.exceptId) && t.data && t.data.v3 && t.data.kind !== 'scan');
        others.filter(t => RESERVING.indexOf(t.status) !== -1 && t.data.plan).forEach(t => t.data.plan.forEach(op => {
            if (inNetSuite(op, o.mode, t.data.writes)) return;
            if (op.op === 'if_qty') addRes(res, op.toId, op.item, Number(op.to) - Number(op.from));
            if (op.op === 'if_create') Object.keys(op.lines || {}).forEach(k => addRes(res, op.toId, k, Number(op.lines[k]) || 0));
        }));
        // data.corrections (needs_fix) are NOT reserved separately: the truck's loaded surplus is already placed and reserved below,
        // so adding them would double-count. Once a qty write lands, the IF qty covers it and the surplus drops to 0.
        const room = reserveToLines(o.toLines, res), out = Object.assign({}, res);
        others.filter(t => [TRUCK.LOADING, TRUCK.NEEDS_FIX, TRUCK.READY, TRUCK.SHIP_PENDING].indexOf(t.status) !== -1).forEach(t => {
            const ifs = liveIfs(t.data.ifs);
            const fill = fillExpected(ifs, (o.loadedByTruck || {})[String(t.id)] || {});
            const sp = placeSurplus(ifs, fill.left, room), byIf = {};
            ifs.forEach(f => { byIf[String(f.ifId)] = f; });
            Object.keys(sp.raises).forEach(id => Object.keys(sp.raises[id]).forEach(k => addRes(out, byIf[id].toId, k, sp.raises[id][k])));
            Object.keys(sp.addOns).forEach(to => Object.keys(sp.addOns[to].lines).forEach(k => addRes(out, to, k, sp.addOns[to].lines[k])));
        });
        return out;
    }

    // ── unload and receipts ──────────────────────────────────────────────
    function classifyUnloadScan(o) {
        const p = o.pallet;
        if (!p) return { result: 'unknown' };
        if (p.status === VP.VOID) return { result: 'void' };
        const me = String(o.truckId), pt = p.loadId ? String(p.loadId) : '';
        const other = (o.trucks && o.trucks[pt]) || {};
        const ref = { otherTruckId: pt, otherLabel: other.label || '' };
        switch (p.status) {
            case VP.IN_TRANSIT: return pt === me ? { result: 'ok', set: { status: VP.RECEIVED } } : Object.assign({ result: 'other_truck' }, ref);
            case VP.MISSING: return pt === me ? { result: 'late', set: { status: VP.RECEIVED } } : Object.assign({ result: 'other_truck' }, ref);
            case VP.RECEIVED: return pt === me ? { result: 'dup' } : Object.assign({ result: 'dup_other' }, ref);
            case VP.LOADED: if (other.status === TRUCK.SHIP_PENDING) return Object.assign({ result: 'locked', reason: 'ship_pending' }, ref);
                if (other.status === TRUCK.AT_DOCK || other.status === TRUCK.PICKUP_PENDING) return Object.assign({ result: 'locked', reason: 'at_dock' }, ref);   // waiting for the manager's ship confirm too
                if (other.status === TRUCK.DEPARTING) return Object.assign({ result: 'locked' }, ref);
                return { result: 'never_loaded' };
            default: return { result: 'never_loaded' };
        }
    }

    function planReceipts(o) {
        const left = sumLines((o.pallets || []).filter(p => p.status === VP.RECEIVED));
        const ops = [], perIf = [], cumulative = {};
        (o.alloc || []).forEach(a => {
            const lines = {}, cum = cumulative[a.ifId] = {};
            let shipped = 0, got = 0;
            Object.keys(a.lines).forEach(k => {
                const g = Math.min(left[k] || 0, Number(a.lines[k]) || 0);
                left[k] = (left[k] || 0) - g;
                const before = Number(((o.received || {})[a.ifId] || {})[k]) || 0;
                if (g > before) lines[k] = g - before;
                cum[k] = Math.max(g, before);                  // never below what an earlier receipt already posted
                shipped += Number(a.lines[k]) || 0;
                got += g;
            });
            if (Object.keys(lines).length) ops.push({ op: 'receipt', ifId: a.ifId, ifNum: a.ifNum, toId: a.toId, lines: lines, trailer: o.stamp.trailer, seal: o.stamp.seal, seq: o.seq });
            perIf.push({ ifId: a.ifId, ifNum: a.ifNum, shipped: shipped, received: got, short: shipped - got });
        });
        const missing = (o.pallets || []).filter(p => p.status === VP.IN_TRANSIT || p.status === VP.MISSING).map(p => p.code);
        return { ops, perIf, missing, cumulative };
    }

    // ── write gate ───────────────────────────────────────────────────────
    function opKey(op) {
        if (op.op === 'if_qty') return 'if_qty:' + op.ifId + ':' + op.item;
        if (op.op === 'to_create') return 'to_create:' + op.ref;
        if (op.op === 'if_create') return 'if_create:' + op.toId;
        if (op.op === 'receipt') return 'receipt:' + op.ifId + ':' + op.seq;
        if (op.op === 'to_line') return 'to_line:' + op.toId + ':' + op.item;
        return op.op + ':' + op.ifId;
    }
    function normMode(m) { return m === 'qty' || m === 'on' ? m : 'off'; }
    function opAllowed(op, mode) { const m = normMode(mode); return m === 'on' || (m === 'qty' && op.op === 'if_qty'); }
    function runOps(ops, mode, apply, done, onWrite) {
        const written = [], planOnly = [];
        (ops || []).forEach(op => {
            const key = opKey(op);
            if (!opAllowed(op, mode)) { planOnly.push(key); return; }
            if (done && done[key]) return;
            const ret = apply(op);
            if (ret === undefined || ret === null || ret === '') throw new Error('NetSuite write returned no id for ' + key);
            const id = String(ret);
            if (onWrite) onWrite(key, id);
            written.push(key);
        });
        return { written, planOnly };
    }
    // 'new:' placeholders in a stored plan: an add-on IF (ifId 'new:<toId>', key if_create:<toId>) and, on a scan-built truck,
    // its new TO (toId 'new:to:<ref>', key to_create:<ref>). The IF is resolved first, by the op's toId as stored.
    function resolveNew(op, writes) {
        let out = op;
        if (out.ifId && String(out.ifId).indexOf('new:') === 0) {
            const id = writes && writes['if_create:' + out.toId];
            if (!id) throw new Error('The add-on IF from TO ' + out.toId + ' was not created yet');
            out = Object.assign({}, out, { ifId: String(id) });
        }
        if (out.toId && String(out.toId).indexOf('new:to:') === 0) {
            const ref = String(out.toId).slice(7), id = writes && writes['to_create:' + ref];
            if (!id) throw new Error('The TO for ' + ref + ' was not created yet');
            out = Object.assign({}, out, { toId: String(id) });
        }
        return out;
    }

    // ── shadow compare (beta) ────────────────────────────────────────────
    function shadowRows(o) {
        const rows = [], sku = o.sku || {};
        const planned = {};
        (o.trucks || []).forEach(t => ((t.data && t.data.alloc) || []).forEach(a => { if (!a.addOn) planned[a.ifId] = true; }));
        (o.trucks || []).forEach(t => {
            const d = t.data || {}, dep = d.depart;
            if (!dep) return;
            const label = memoFor(dep.truckNo, dep.shippedDay || dep.day), sealK = sealKey(dep.seal);   // real ship day wins once known (dock-confirm day is stale for a dropped-trailer truck)
            const row = (ifNum, check, portal, netsuite, ok) => rows.push({ truck: label, seal: dep.seal, ifNum: ifNum, check: check, portal: String(portal), netsuite: netsuite == null ? '—' : String(netsuite), ok: ok });
            (d.alloc || []).forEach(a => {
                let realId = a.addOn ? null : a.ifId;
                if (a.addOn) {
                    realId = ((o.ifsByTo || {})[a.toId] || []).find(id => !planned[id] && ((o.receipts || {})[id] || []).some(r => sealKey(r.seal) === sealK)) || null;
                    const f = realId && o.ifInfo[realId];
                    row(f ? f.ifNum : '(new)', 'Add-on IF on ' + a.toNum, 'needed', f ? f.ifNum : null, f ? true : null);
                }
                const info = realId ? (o.ifInfo || {})[realId] : null;
                const ifNum = info ? info.ifNum : a.ifNum;
                if (!info) return;
                // At the dock the IF is Packed (B) until pickup stamps it Shipped (C).
                const atDock = t.status === TRUCK.AT_DOCK || t.status === TRUCK.PICKUP_PENDING;
                const done = info.status === 'C' || (atDock && info.status === 'B');
                Object.keys(a.lines).forEach(k => {
                    const ns = (info.lines || []).filter(l => String(l.item) === k).reduce((s, l) => s + Number(l.qty || 0), 0);
                    row(ifNum, 'IF qty ' + (sku[k] || k), a.lines[k], ns, done ? Number(ns) === Number(a.lines[k]) : null);
                });
                row(ifNum, atDock ? 'Packed' : 'Shipped', 'yes', done ? 'yes' : info.status, done ? true : null);
                const rs = (o.receipts || {})[realId] || [];
                if (!rs.length) return;
                row(ifNum, 'Trailer', dep.trailer, rs.map(r => r.trailer).join(', '), rs.every(r => normSeal(r.trailer) === normSeal(dep.trailer)));
                row(ifNum, 'Seal', dep.seal, rs.map(r => r.seal).join(', '), rs.every(r => sealKey(r.seal) === sealK));
                const mine = (d.received || {})[a.ifId] || null;
                Object.keys(a.lines).forEach(k => {
                    const ns = rs.reduce((s, r) => s + (Number(r.lines[k]) || 0), 0);
                    const p = mine ? Number(mine[k]) || 0 : null;
                    row(ifNum, 'Receipt qty ' + (sku[k] || k), p == null ? 'not approved' : p, ns, p == null ? null : Number(p) === Number(ns));
                });
            });
        });
        return rows;
    }

    // ── NetSuite reads: SuiteQL text + a builder shared by the live module and the snapshot ──
    function SQL(locFrom, locTo) {
        const F = Number(locFrom), T = Number(locTo);
        const moveTos = "SELECT t.id FROM transaction t WHERE t.type = 'TrnfrOrd' AND t.transferlocation = " + T;
        return {
            toLines: "SELECT t.id AS toid, t.tranid AS tonum, t.status AS tostatus, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS trandate, " +
                "tl.item AS item, BUILTIN.DF(tl.item) AS sku, tl.quantity AS qty FROM transaction t JOIN transactionline tl ON tl.transaction = t.id " +
                "WHERE t.type = 'TrnfrOrd' AND t.transferlocation = " + T + " AND tl.location = " + T + " AND tl.quantity > 0 " +
                "AND t.id IN (SELECT x.transaction FROM transactionline x WHERE x.mainline = 'T' AND x.location = " + F + ")",
            ifLines: "SELECT f.id AS ifid, f.tranid AS ifnum, f.status AS status, TO_CHAR(f.trandate, 'YYYY-MM-DD') AS trandate, tl.createdfrom AS toid, " +
                "tl.item AS item, BUILTIN.DF(tl.item) AS sku, tl.quantity AS qty FROM transaction f JOIN transactionline tl ON tl.transaction = f.id " +
                "WHERE f.type = 'ItemShip' AND tl.mainline = 'F' AND tl.location = " + F + " AND tl.quantity > 0 AND tl.createdfrom IN (" + moveTos + ")",
            links: "SELECT ptl.previousdoc AS ifid, ptl.nextdoc AS rcptid FROM previoustransactionlink ptl WHERE ptl.linktype = 'TOrdCost' AND ptl.previousdoc IN ({IDS})",
            receipts: "SELECT r.id AS rcptid, r.tranid AS tranid, r.custbody_rsm_container_no AS trailer, r.custbody7 AS seal, tl.item AS item, tl.quantity AS qty " +
                "FROM transaction r JOIN transactionline tl ON tl.transaction = r.id WHERE r.type = 'ItemRcpt' AND tl.location = " + T + " AND tl.quantity > 0 AND r.id IN ({IDS})",
            items: "SELECT i.id AS item, i.itemid AS sku, i.displayname AS descr, i.upccode AS upc, i.weight AS weight, i.weightunit AS wunit FROM item i WHERE i.id IN ({IDS})",
            // Riverside on hand, for the local print plan (in NetSuite the plan reads live stock through move_data).
            onHand: "SELECT ail.item AS item, SUM(ail.quantityonhand) AS onhand FROM aggregateItemLocation ail WHERE ail.location = " + F + " AND ail.quantityonhand > 0 GROUP BY ail.item"
        };
    }

    function buildReads(raw) {
        raw = raw || {};
        const S = x => String(x == null ? '' : x);
        const toQty = {}, toMeta = {}, used = {}, ifs = {}, byTo = {};
        (raw.toLines || []).forEach(r => {
            const key = S(r.toid) + '|' + S(r.item);
            toQty[key] = (toQty[key] || 0) + Number(r.qty || 0);
            toMeta[S(r.toid)] = { toNum: S(r.tonum), trandate: S(r.trandate), toStatus: S(r.tostatus) };
            toMeta[key] = { sku: S(r.sku) };
        });
        (raw.ifLines || []).forEach(r => {
            const id = S(r.ifid), to = S(r.toid), it = S(r.item);
            const f = ifs[id] = ifs[id] || { ifId: id, ifNum: S(r.ifnum), status: S(r.status), trandate: S(r.trandate), toId: to, toNum: (toMeta[to] || {}).toNum || '', lines: [] };
            const l = f.lines.find(x => x.item === it);
            if (l) l.qty += Number(r.qty || 0); else f.lines.push({ item: it, sku: S(r.sku), qty: Number(r.qty || 0) });
            used[to + '|' + it] = (used[to + '|' + it] || 0) + Number(r.qty || 0);
            if ((byTo[to] = byTo[to] || []).indexOf(id) === -1) byTo[to].push(id);
        });
        Object.keys(byTo).forEach(k => byTo[k].sort((a, b) => Number(a) - Number(b)));
        const rcptIf = {};
        (raw.links || []).forEach(l => { if (ifs[S(l.ifid)]) rcptIf[S(l.rcptid)] = S(l.ifid); });
        const recs = {};
        (raw.receipts || []).forEach(r => {
            const ifId = rcptIf[S(r.rcptid)];
            if (!ifId) return;
            const list = recs[ifId] = recs[ifId] || [];
            let x = list.find(y => y.id === S(r.rcptid));
            if (!x) { x = { id: S(r.rcptid), tranid: S(r.tranid), trailer: S(r.trailer), seal: S(r.seal), lines: {} }; list.push(x); }
            x.lines[S(r.item)] = (x.lines[S(r.item)] || 0) + Number(r.qty || 0);
        });
        const byNum = (a, b) => Number(a.ifId) - Number(b.ifId);
        return {
            plannedIfs: () => Object.values(ifs).filter(f => PLANNED_IF_STATUS.indexOf(f.status) !== -1 && toMeta[f.toId]).sort(byNum).map(f => JSON.parse(JSON.stringify(f))),
            openToLines: () => Object.keys(toQty).map(key => {
                const p = key.split('|'), m = toMeta[p[0]];
                return { toId: p[0], toNum: m.toNum, trandate: m.trandate, toStatus: m.toStatus, item: p[1], sku: toMeta[key].sku, qty: toQty[key], remaining: toQty[key] - (used[key] || 0) };
            }).filter(r => OPEN_TO_STATUS.indexOf(r.toStatus) !== -1 && r.remaining > 0).sort((a, b) => Number(a.toId) - Number(b.toId)),
            ifInfo: () => { const o = {}; Object.values(ifs).forEach(f => { o[f.ifId] = { ifNum: f.ifNum, status: f.status, toId: f.toId, lines: f.lines.map(l => Object.assign({}, l)) }; }); return o; },
            ifsByTo: () => JSON.parse(JSON.stringify(byTo)),
            receiptsByIf: () => JSON.parse(JSON.stringify(recs)),
            items: () => (raw.items || []).map(i => ({ item: S(i.item), sku: S(i.sku), desc: S(i.descr), upc: S(i.upc), weight: Number(i.weight) || 0, wunit: S(i.wunit) })),
            onHand: () => { const o = {}; (raw.onHand || []).forEach(r => { o[S(r.item)] = (o[S(r.item)] || 0) + Number(r.onhand || 0); }); return o; },
            pulledAt: () => S(raw.pulledAt),
            resetCache: () => {}
        };
    }

    // ── Verify Load (spec 2026-10-05 amendment §4) ───────────────────────
    function verifyLoad(o) {
        const fr = refreshIfs(o.savedIfs, o.freshIfs), ifs = byIfOrder(fr.ifs), diffs = [];
        fr.gone.forEach(g => diffs.push({ key: 'if_gone:' + g.ifId, kind: 'if_gone', ifId: String(g.ifId), ifNum: g.ifNum }));
        if (!ifs.length) diffs.push({ key: 'no_ifs', kind: 'no_ifs' });          // no live IF: never ready, so never an empty departure
        const fill = fillExpected(ifs, sumLines(o.pallets));
        ifs.forEach(f => {
            const a = fill.alloc[String(f.ifId)] || {};
            if (!Object.keys(a).some(k => a[k] > 0)) { diffs.push({ key: 'if_empty:' + f.ifId, kind: 'if_empty', ifId: String(f.ifId), ifNum: f.ifNum }); return; }
            Object.keys(a).forEach(k => {
                const q = ifQty(f, k);
                if (a[k] < q) diffs.push({ key: 'if_short:' + f.ifId + ':' + k, kind: 'if_short', ifId: String(f.ifId), ifNum: f.ifNum, toId: String(f.toId), toNum: f.toNum, item: k, ifQty: q, loaded: a[k] });
            });
        });
        Object.keys(fill.left).forEach(k => {
            const left = fill.left[k];
            if (!(left > 0)) return;
            const carriers = ifs.filter(f => ifQty(f, k) > 0);
            if (carriers.length) {
                const f = carriers[carriers.length - 1], q = ifQty(f, k);
                diffs.push({ key: 'if_over:' + f.ifId + ':' + k, kind: 'if_over', ifId: String(f.ifId), ifNum: f.ifNum, toId: String(f.toId), toNum: f.toNum, item: k, ifQty: q, loaded: q + left });
                return;
            }
            const to = (o.toLines || []).filter(r => String(r.item) === k && Number(r.remaining) > 0).sort(oldestFirst)[0];
            diffs.push({ key: 'no_if:' + k, kind: 'no_if', item: k, qty: left, toId: to ? String(to.toId) : null, toNum: to ? to.toNum : null });
        });
        // keep: what the truck saves: the fresh IFs plus the last saved copy of each gone IF, flagged, so if_gone repeats until dropped.
        const savedById = {};
        (o.savedIfs || []).forEach(f => { savedById[String(f.ifId)] = f; });
        const keep = ifs.concat(fr.gone.map(g => Object.assign({}, savedById[String(g.ifId)], { gone: true })));
        return { match: diffs.length === 0, diffs: diffs, ifs: ifs, keep: keep };
    }

    function fmt(n) { return Number(n).toLocaleString('en-US'); }
    function diffText(d, sku, pcsPerPallet) {
        const s = sku || d.item;
        if (d.kind === 'no_ifs') return 'This truck has no IF → add one';
        if (d.kind === 'plan_mismatch') return (d.ifNum ? d.ifNum + ': ' : '') + 'the departure plan still needs a change (' + d.op + ') → Verify again';
        if (d.kind === 'if_gone') return d.ifNum + ' is no longer Packed in NetSuite → take it off this truck';
        if (d.kind === 'if_empty') return d.ifNum + ' has nothing loaded → take it off this truck';
        if (d.kind === 'no_if') return s + ' ×' + fmt(d.qty) + ' loaded, not on any IF → ' + (d.toNum ? 'needs an IF from ' + d.toNum + ' (oldest open TO)' : 'no open TO: take it off the truck');
        const delta = d.loaded - d.ifQty, n = Math.abs(delta);
        const pal = pcsPerPallet && n % pcsPerPallet === 0 ? ' (' + (n / pcsPerPallet) + ' pallet' + (n / pcsPerPallet === 1 ? '' : 's') + ')' : '';
        return d.ifNum + ' ' + s + ': IF ' + fmt(d.ifQty) + ' · loaded ' + fmt(d.loaded) + ' → IF needs ' + (delta < 0 ? '−' : '+') + fmt(n) + pal;
    }

    function ifSuggestions(o) {
        const tos = {}, onTruck = {};
        (o.truckIfs || []).forEach(f => { tos[String(f.toId)] = true; onTruck[String(f.ifId)] = true; });
        (o.diffs || []).forEach(d => { if (d.kind === 'no_if' && d.toId) tos[String(d.toId)] = true; });
        return (o.planned || []).filter(f => tos[String(f.toId)] && !onTruck[String(f.ifId)] && !(o.takenIfIds || {})[String(f.ifId)]);
    }

    function correctionOps(diffs) {
        const ops = [];
        (diffs || []).forEach(d => {
            if (d.kind === 'if_short' || d.kind === 'if_over') ops.push({ op: 'if_qty', ifId: d.ifId, ifNum: d.ifNum, toId: d.toId, item: d.item, from: d.ifQty, to: d.loaded, key: d.key });
            else if (d.kind === 'no_if' && d.toId) ops.push({ op: 'if_create', toId: d.toId, toNum: d.toNum, lines: { [d.item]: d.qty }, ship: false, key: d.key });
            else if (d.kind === 'if_empty' || d.kind === 'if_gone') ops.push({ op: 'drop_if', ifId: d.ifId, ifNum: d.ifNum, key: d.key });
        });
        return ops;
    }

    // Excel / single-SKU label preview (spec 2026-10-14 §6). Warnings never block; only an unmatched row is skipped.
    function labelRows(rows, ctx) {
        const out = [], used = {};
        let labels = 0;
        const blank = v => v == null || String(v).trim() === '';
        const whole = v => { const s = String(v).trim().replace(/,/g, ''); const x = /^\d+$/.test(s) ? Number(s) : NaN; return isFinite(x) ? x : NaN; };
        (rows || []).forEach((r, i) => {
            if (r == null || typeof r !== 'object') return;                                  // a null sheet entry
            const n = i + 2, raw = String(r.sku == null ? '' : r.sku).trim();
            if (!raw && blank(r.pcs) && blank(r.pallets) && blank(r.odd)) return;            // a blank sheet row
            const pcs = blank(r.pcs) ? 0 : whole(r.pcs), pallets = blank(r.pallets) ? 0 : whole(r.pallets), odd = blank(r.odd) ? 0 : whole(r.odd);
            const item = (ctx.skuMap || {})[raw.toUpperCase()] || '', sku = item && ctx.items[item] ? ctx.items[item].sku : raw;
            const row = { n: n, sku: sku, item: item, pcs: isNaN(pcs) ? 0 : pcs, pallets: isNaN(pallets) ? 0 : pallets, odd: isNaN(odd) ? 0 : odd, total: 0, labels: 0, status: 'ok', msg: '', cfg: (ctx.cfg || {})[item] || '' };
            if (!item) { row.status = 'skip'; row.msg = 'Unknown SKU ' + (raw || '(blank)'); out.push(row); return; }
            if (isNaN(pcs)) { row.status = 'skip'; row.msg = 'Pcs per pallet must be a whole number'; out.push(row); return; }
            if (isNaN(pallets)) { row.status = 'skip'; row.msg = 'Pallets must be a whole number'; out.push(row); return; }
            if (isNaN(odd)) { row.status = 'skip'; row.msg = 'Odd pallet pcs must be a whole number'; out.push(row); return; }
            if (!(pcs >= 1)) { row.status = 'skip'; row.msg = 'Pcs per pallet must be 1 or more'; out.push(row); return; }
            if (!(pallets >= 1) && !(odd >= 1)) { row.status = 'skip'; row.msg = 'Pallets must be 1 or more'; out.push(row); return; }
            row.labels = Math.max(0, pallets) + (row.odd ? 1 : 0);
            row.total = Math.max(0, pallets) * pcs + row.odd;
            used[item] = (used[item] || 0) + row.total;
            const left = (Number((ctx.avail || {})[item]) || 0) - (Number((ctx.labeled || {})[item]) || 0);
            if (used[item] > left) { row.status = 'warn'; row.msg = sku + ': ' + fmt(used[item]) + ' pcs to print, Riverside has ' + fmt(Math.max(0, left)) + ' not yet on a truck'; }
            labels += row.labels;
            out.push(row);
        });
        return { rows: out, labels: labels, over: labels > (Number(ctx.maxPrint) || 250) };
    }

    // ── drop trailer at the dock (spec 2026-10-16 §4) ────────────────────
    // docLines: what NetSuite holds for this truck, per item: { qty, ifId, ifNum }. A raise writes the TO first, a lower the IF first,
    // so the IF never asks for more than its TO line. A new SKU goes on the primary IF as a new line (newLine: tx may refuse → add-on IF).
    function dockOps(o) {
        const out = [], dl = o.docLines || {};
        Object.keys(o.delta || {}).sort().forEach(item => {
            const d = Number(o.delta[item]) || 0;
            if (!d) return;
            const cur = dl[item] ? Number(dl[item].qty) || 0 : 0, next = cur + d;
            if (next < 0) throw new Error('Item ' + item + ' would go below zero on the TO');
            const toOp = { op: 'to_line', toId: String(o.toId), item: String(item), from: cur, to: next };
            const ifOp = dl[item]
                ? { op: 'if_qty', ifId: String(dl[item].ifId), ifNum: dl[item].ifNum, toId: String(o.toId), item: String(item), from: cur, to: next }
                : { op: 'if_qty', ifId: String(o.primaryIfId), ifNum: o.primaryIfNum, toId: String(o.toId), item: String(item), from: 0, to: next, newLine: true };
            if (d > 0) out.push(toOp, ifOp); else out.push(ifOp, toOp);
        });
        return out;
    }
    function inverseOp(op) {
        if (op.op !== 'to_line' && op.op !== 'if_qty') return null;
        const inv = Object.assign({}, op, { from: op.to, to: op.from });
        delete inv.newLine;
        return inv;
    }
    function applyDelta(docLines, delta, primaryIfId, primaryIfNum) {
        const out = JSON.parse(JSON.stringify(docLines || {}));
        Object.keys(delta || {}).forEach(item => {
            const cur = out[item] ? out[item].qty : 0, next = cur + (Number(delta[item]) || 0);
            if (next <= 0) { delete out[item]; return; }
            out[item] = out[item] ? Object.assign(out[item], { qty: next }) : { qty: next, ifId: String(primaryIfId || ''), ifNum: primaryIfNum || '' };
        });
        return out;
    }
    function docLinesFromAlloc(alloc) {
        const out = {};
        (alloc || []).forEach(a => Object.keys(a.lines || {}).forEach(item => {
            const q = Number(a.lines[item]) || 0;
            if (q > 0) out[item] = Object.assign({ qty: (out[item] ? out[item].qty : 0) + q, ifId: String(a.ifId), ifNum: a.ifNum }, a.token ? { token: a.token } : {});
        }));
        return out;
    }
    // The first IF seen (in item order) is the primary; any other IF on this TO is an add-on.
    function allocFromDocLines(docLines, meta) {
        const byIf = {}, order = [];
        Object.keys(docLines || {}).sort().forEach(item => {
            const l = docLines[item];
            if (!(l.qty > 0)) return;
            const k = String(l.ifId);
            if (!byIf[k]) { byIf[k] = { ifId: k, ifNum: l.ifNum, toId: String(meta.toId), toNum: meta.toNum, lines: {}, addOn: order.length > 0 }; order.push(k); }
            if (l.token && !byIf[k].token) byIf[k].token = l.token;     // an add-on IF's own memo token (Picked up stamps it)
            byIf[k].lines[item] = l.qty;
        });
        return order.map(k => byIf[k]);
    }

    return { _fmt: fmt, TRUCK, VP, PLANNED_IF_STATUS, OPEN_TO_STATUS, sumLines, fillExpected, itemCapacity, fitOnTruck, classifyLoadScan, toneFor,
        _byIfOrder: byIfOrder, _ifQty: ifQty, _oldestFirst: oldestFirst, memoFor, normSeal, sealKey, sealUsed, sealHolder, truckNoForDay, planDeparture, refreshIfs, placeSurplus, reserveToLines, reservationsFromTrucks,
        verifyLoad, liveIfs, diffText, ifSuggestions, correctionOps, scanTag, scanApprovePlan,
        lbs, truckLines, linesPcs, truckWeight, withWts, bolPlan, overweight, stockCheck, stockText,
        classifyUnloadScan, planReceipts, labelRows, opKey, opAllowed, normMode, runOps, resolveNew, shadowRows, SQL, buildReads,
        dockOps, inverseOp, applyDelta, docLinesFromAlloc, allocFromDocLines };
});
