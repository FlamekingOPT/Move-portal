/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal v3 (verification only): pure rules, no N/ modules, unit-tested in node.
 * Spec: docs/superpowers/specs/2026-10-01-move-portal-verification-design.md
 */
define([], function () {
    'use strict';

    const TRUCK = { LOADING: 'loading', DEPARTING: 'departing', DEPARTED: 'departed', RECEIVING: 'receiving', APPROVING: 'approving', RECEIVED: 'received' };
    const VP = { LABELED: 'labeled', LOADED: 'loaded', IN_TRANSIT: 'in_transit', RECEIVED: 'received', MISSING: 'missing', VOID: 'void' };
    const PLANNED_IF_STATUS = ['A', 'B'];
    const OPEN_TO_STATUS = ['B', 'D', 'E'];

    // ── helpers ──────────────────────────────────────────────────────────
    function sumLines(pallets) {
        const out = {};
        (pallets || []).forEach(p => (p.lines || []).forEach(l => { const k = String(l.item); out[k] = (out[k] || 0) + (Number(l.pcs) || 0); }));
        return out;
    }
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
            return { result: 'locked', otherTruckId: pt, otherLabel: other.label || '' };
        }
        if (p.status !== VP.LABELED) return { result: 'shipped', otherTruckId: pt, otherLabel: other.label || '' };
        return fitOnTruck(p, o);
    }

    const TONE = { ok: 'ok', late: 'ok', over: 'warn', addon: 'warn', dup: 'warn', other_truck: 'warn', dup_other: 'warn' };
    function toneFor(result) { return TONE[result] || 'bad'; }

    // ── departure ────────────────────────────────────────────────────────
    function memoFor(truckNo, dayIso) { return 'Truck ' + truckNo + ' · ' + String(dayIso).slice(5, 7) + '/' + String(dayIso).slice(8, 10); }
    function normSeal(s) { return String(s == null ? '' : s).trim().toUpperCase(); }
    function sealKey(s) { return String(s == null ? '' : s).toUpperCase().replace(/^\s*SEAL\s*:?\s*/, '').replace(/\s+/g, ''); }
    function departOf(t) { return (t && t.data && t.data.depart) || null; }
    function sealUsed(trucks, seal, exceptId) {
        const n = sealKey(seal);
        return !!n && (trucks || []).some(t => String(t.id) !== String(exceptId) && departOf(t) && sealKey(departOf(t).seal) === n);
    }
    function truckNoForDay(trucks, dayIso, exceptId) {
        return 1 + (trucks || []).filter(t => String(t.id) !== String(exceptId) && departOf(t) && departOf(t).day === dayIso).length;
    }

    function planDeparture(o) {
        const ifs = byIfOrder(o.ifs), scanned = sumLines(o.pallets);
        const fill = fillExpected(ifs, scanned), alloc = fill.alloc;
        const toLeft = {};
        (o.toLines || []).forEach(r => { toLeft[String(r.toId) + '|' + String(r.item)] = Number(r.remaining) || 0; });
        const addOns = {};
        Object.keys(fill.left).forEach(k => {
            let left = fill.left[k];
            if (!(left > 0)) return;
            const carriers = ifs.filter(f => ifQty(f, k) > 0), own = {};
            carriers.forEach(f => {                                   // raise: the IF's own TO still has qty
                own[String(f.toId)] = true;
                const key = String(f.toId) + '|' + k, g = Math.min(left, toLeft[key] || 0);
                if (g) { alloc[String(f.ifId)][k] += g; toLeft[key] -= g; left -= g; }
            });
            (o.toLines || []).filter(r => String(r.item) === k && !own[String(r.toId)]).sort(oldestFirst).forEach(r => {
                const key = String(r.toId) + '|' + k, g = Math.min(left, toLeft[key] || 0);
                if (!g) return;
                const a = addOns[String(r.toId)] = addOns[String(r.toId)] || { toId: String(r.toId), toNum: r.toNum, lines: {} };
                a.lines[k] = (a.lines[k] || 0) + g; toLeft[key] -= g; left -= g;
            });
            if (left > 0) throw new Error('No open transfer order covers ' + left + ' pcs of item ' + k);
        });

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
            ops.push(Object.assign({ op: 'if_stamp', ifId: String(f.ifId), ifNum: f.ifNum }, st));
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
            case VP.LOADED: if (other.status === TRUCK.DEPARTING) return Object.assign({ result: 'locked' }, ref);
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
                cum[k] = g;
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
        if (op.op === 'if_create') return 'if_create:' + op.toId;
        if (op.op === 'receipt') return 'receipt:' + op.ifId + ':' + op.seq;
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
    function resolveNew(op, writes) {
        if (!op.ifId || String(op.ifId).indexOf('new:') !== 0) return op;
        const id = writes && writes['if_create:' + op.toId];
        if (!id) throw new Error('The add-on IF from TO ' + op.toId + ' was not created yet');
        return Object.assign({}, op, { ifId: String(id) });
    }

    // ── shadow compare (beta) ────────────────────────────────────────────
    function shadowRows(o) {
        const rows = [], sku = o.sku || {};
        const planned = {};
        (o.trucks || []).forEach(t => ((t.data && t.data.alloc) || []).forEach(a => { if (!a.addOn) planned[a.ifId] = true; }));
        (o.trucks || []).forEach(t => {
            const d = t.data || {}, dep = d.depart;
            if (!dep) return;
            const label = memoFor(dep.truckNo, dep.day), sealK = sealKey(dep.seal);
            const row = (ifNum, check, portal, netsuite, ok) => rows.push({ truck: label, seal: dep.seal, ifNum: ifNum, check: check, portal: String(portal), netsuite: netsuite == null ? '—' : String(netsuite), ok: ok });
            (d.skipped || []).forEach(s => {                       // a refused edit the truck departed without: the office must fix it
                const op = (d.plan || []).find(o => opKey(o) === s.key) || {};
                row(op.ifNum || s.key, 'Skipped edit ' + (op.ifNum || s.key), op.op === 'if_qty' ? op.from + '→' + op.to : (op.op || s.key), null, false);
            });
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
                Object.keys(a.lines).forEach(k => {
                    const ns = (info.lines || []).filter(l => String(l.item) === k).reduce((s, l) => s + Number(l.qty || 0), 0);
                    row(ifNum, 'IF qty ' + (sku[k] || k), a.lines[k], ns, info.status === 'C' ? Number(ns) === Number(a.lines[k]) : null);
                });
                row(ifNum, 'Shipped', 'yes', info.status === 'C' ? 'yes' : info.status, info.status === 'C' ? true : null);
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
            items: "SELECT i.id AS item, i.itemid AS sku, i.displayname AS descr, i.upccode AS upc FROM item i WHERE i.id IN ({IDS})"
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
            items: () => (raw.items || []).map(i => ({ item: S(i.item), sku: S(i.sku), desc: S(i.descr), upc: S(i.upc) })),
            pulledAt: () => S(raw.pulledAt),
            resetCache: () => {}
        };
    }

    return { TRUCK, VP, PLANNED_IF_STATUS, OPEN_TO_STATUS, sumLines, fillExpected, itemCapacity, fitOnTruck, classifyLoadScan, toneFor,
        _byIfOrder: byIfOrder, _ifQty: ifQty, _oldestFirst: oldestFirst, memoFor, normSeal, sealKey, sealUsed, truckNoForDay, planDeparture,
        classifyUnloadScan, planReceipts, opKey, opAllowed, normMode, runOps, resolveNew, shadowRows, SQL, buildReads };
});
