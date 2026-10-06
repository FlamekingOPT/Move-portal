### Task 1: `move_verify` core: capacity and load-out scan rule

**Files:**
- Create: `move_portal/move_verify.js`
- Create: `move_portal/test/verify.test.js`

**Interfaces:**
- Produces:
  - `TRUCK`, `VP`: status maps (see Global Constraints).
  - `sumLines(pallets) → {itemId: pcs}`
  - `fillExpected(ifs, scannedByItem) → {alloc: {ifId: {item: qty}}, left: {item: qty}}`, filled in IF id order, each IF line up to its qty.
  - `itemCapacity(item, ifs, toLines) → {expected, raise, addon, addonTo: {toId, toNum}|null}`
  - `classifyLoadScan({pallet, truckId, trucks, ifs, toLines, loadedByItem}) → {result, set?, addonTo?, sku?, otherTruckId?, otherLabel?}`. `result` ∈ `unknown · void · dup · other_truck · locked · shipped · ok · over · addon · no_to`.
  - `fitOnTruck(pallet, {truckId, ifs, toLines, loadedByItem})`: the capacity part alone, used by "move here".
  - `toneFor(result) → 'ok'|'warn'|'bad'`
- Shapes:
  - `ifs`: `[{ifId, ifNum, toId, toNum, status, lines: [{item, sku, qty}]}]`, with ids as strings.
  - `toLines`: `[{toId, toNum, trandate:'YYYY-MM-DD', toStatus, item, sku, qty, remaining}]`.
  - `pallet`: the `fake_data`/`move_data` pallet `{id, code, status, loadId, lines: [{item, sku, pcs}]}`.
  - `trucks`: `{truckId: {status, label}}`.

- [ ] **Step 1: Write the failing tests**

Create `move_portal/test/verify.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const v = loadAmd('move_verify.js');
const VP = v.VP, T = v.TRUCK;

// TO 500 (YSN100, item 975) has an IF on this truck; TO 600 is an older open TO for the same item; TO 700 has YSN201 only.
const IFS = [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', status: 'B', lines: [{ item: '975', sku: 'YSN100', qty: 504 }] }];
const TOS = [
    { toId: '500', toNum: 'TO500', trandate: '2026-10-01', toStatus: 'D', item: '975', sku: 'YSN100', qty: 10080, remaining: 24 },
    { toId: '600', toNum: 'TO600', trandate: '2026-09-29', toStatus: 'B', item: '975', sku: 'YSN100', qty: 504, remaining: 504 },
    { toId: '700', toNum: 'TO700', trandate: '2026-09-28', toStatus: 'B', item: '11', sku: 'YSN201', qty: 1200, remaining: 1200 }
];
const pal = (id, status, loadId, lines) => ({ id, code: 'PLT' + id, status, loadId: loadId || '', lines: lines || [{ item: '975', sku: 'YSN100', pcs: 12 }] });
const ctx = (p, loaded, extra) => Object.assign({ pallet: p, truckId: '1', trucks: { 1: { status: T.LOADING, label: 'IF9001' }, 2: { status: T.LOADING, label: 'IF9002' }, 3: { status: T.DEPARTED, label: 'Truck 1 · 10/05' } },
    ifs: IFS, toLines: TOS, loadedByItem: loaded || {} }, extra || {});

test('sumLines and fillExpected', () => {
    assert.deepEqual(v.sumLines([pal(1, 'loaded'), pal(2, 'loaded', '', [{ item: '975', pcs: 12 }, { item: '11', pcs: 5 }])]), { 975: 24, 11: 5 });
    const two = IFS.concat([{ ifId: '9002', ifNum: 'IF9002', toId: '500', toNum: 'TO500', lines: [{ item: '975', qty: 100 }] }]);
    assert.deepEqual(v.fillExpected(two, { 975: 550, 11: 5 }), { alloc: { 9001: { 975: 504 }, 9002: { 975: 46 } }, left: { 975: 0, 11: 5 } });
});

test('itemCapacity: expected from IFs, raise from their TOs, add-on from other open TOs oldest first', () => {
    assert.deepEqual(v.itemCapacity('975', IFS, TOS), { expected: 504, raise: 24, addon: 504, addonTo: { toId: '600', toNum: 'TO600' } });
    assert.deepEqual(v.itemCapacity('11', IFS, TOS), { expected: 0, raise: 0, addon: 1200, addonTo: { toId: '700', toNum: 'TO700' } });
    assert.deepEqual(v.itemCapacity('999', IFS, TOS), { expected: 0, raise: 0, addon: 0, addonTo: null });
});

test('classifyLoadScan: state rows', () => {
    assert.equal(v.classifyLoadScan(ctx(null)).result, 'unknown');
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.VOID))).result, 'void');
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.LOADED, '1'))).result, 'dup');
    assert.deepEqual(v.classifyLoadScan(ctx(pal(5, VP.LOADED, '2'))), { result: 'other_truck', otherTruckId: '2', otherLabel: 'IF9002' });
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.LOADED, '3'))).result, 'locked');
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.IN_TRANSIT, '3'))).result, 'shipped');
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.RECEIVED, '3'))).result, 'shipped');
});

test('classifyLoadScan: capacity rows ok / over / addon / no_to', () => {
    const ok = v.classifyLoadScan(ctx(pal(5, VP.LABELED), { 975: 480 }));
    assert.deepEqual(ok, { result: 'ok', addonTo: null, set: { status: VP.LOADED, loadId: '1' } });
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.LABELED), { 975: 504 })).result, 'over');           // 516 ≤ 504 + 24
    const add = v.classifyLoadScan(ctx(pal(5, VP.LABELED), { 975: 528 }));                            // 540 > 528 → add-on
    assert.equal(add.result, 'addon');
    assert.deepEqual(add.addonTo, { toId: '600', toNum: 'TO600' });
    assert.deepEqual(v.classifyLoadScan(ctx(pal(5, VP.LABELED), { 975: 1032 })), { result: 'no_to', sku: 'YSN100' }); // > 504+24+504
    const extra = v.classifyLoadScan(ctx(pal(6, VP.LABELED, '', [{ item: '11', sku: 'YSN201', pcs: 120 }])));
    assert.equal(extra.result, 'addon');
    assert.deepEqual(v.classifyLoadScan(ctx(pal(7, VP.LABELED, '', [{ item: '999', sku: 'YSN999', pcs: 1 }]))), { result: 'no_to', sku: 'YSN999' });
});

test('classifyLoadScan: mixed pallet takes the worst line', () => {
    const p = pal(8, VP.LABELED, '', [{ item: '975', sku: 'YSN100', pcs: 12 }, { item: '999', sku: 'YSN999', pcs: 1 }]);
    assert.deepEqual(v.classifyLoadScan(ctx(p)), { result: 'no_to', sku: 'YSN999' });
});

test('toneFor', () => {
    assert.equal(v.toneFor('ok'), 'ok');
    ['over', 'addon', 'dup', 'other_truck', 'dup_other', 'late'].forEach(r => assert.equal(v.toneFor(r), r === 'late' ? 'ok' : 'warn'));
    ['no_to', 'void', 'unknown', 'locked', 'shipped', 'never_loaded'].forEach(r => assert.equal(v.toneFor(r), 'bad'));
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `ENOENT ... move_verify.js`.

- [ ] **Step 3: Write `move_portal/move_verify.js`**

```js
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

    return { TRUCK, VP, PLANNED_IF_STATUS, OPEN_TO_STATUS, sumLines, fillExpected, itemCapacity, fitOnTruck, classifyLoadScan, toneFor,
        _byIfOrder: byIfOrder, _ifQty: ifQty, _oldestFirst: oldestFirst };
});
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite and confirm nothing else broke**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass (62 existing + 6 new).

- [ ] **Step 6: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(v3): move_verify capacity + load-out scan rule"
```

---

