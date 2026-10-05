# Move Portal v3 (Verification Only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Move Portal into a verification tool. The office's Picked/Packed IFs are the planned trucks. Pallets are scanned on and off. Departure and receipt corrections become a "would write" plan, and in beta only manager-approved IF qty edits are written. It runs first locally against a prod snapshot, then as a Suitelet on prod.

**Architecture:** All new rules live in one pure module, `move_verify.js` (no `N/` modules, unit-tested in node). The Suitelet gets two new injected modules:
- **`move_ns`:** NetSuite reads (Stage 2: live SuiteQL; locally: `local/snapshot_ns.js` reads a prod snapshot JSON).
- **`move_tx.apply(op)`:** NetSuite writes, gated by `WRITE_MODE` (`off | qty | on`).

Trucks reuse the existing load record type (`data.v3 = true`), and pallets reuse the pallet record. Old load/ship/receive/catch-up code is removed at the end, once the new flow is green.

**Tech Stack:** SuiteScript 2.1 AMD modules, node 18+ `node:test`, in-memory fakes (`test/fake_data.js`, `test/fake_tx.js`), a local preview HTTP server (`test/preview_server.js`, port 8765), and the NetSuite SuiteQL MCP connector (read-only) for the snapshot.

**Spec:** `docs/superpowers/specs/2026-10-01-move-portal-verification-design.md` (V1–V12).

## Global Constraints

- **Tests:** `node --test "move_portal/test/*.test.js"`, run from the repo root `G:\My Drive\Move-portal`. The quoted glob is required on Windows.
- **Locations:** Riverside = **35** in both prod and sandbox. **Tippecanoe = 46 in prod** (`CA - Tippecanoe`) and 42 in sandbox. Both come from Move Settings (`locFrom`, `locTo`) and are never hard-coded in logic.
- **IF statuses:** `A` = Picked, `B` = Packed, `C` = Shipped. **Planned truck = an IF with status A or B** on a move TO. (The spec says "Packed". Prod shows the office also leaves IFs at Picked, so both count.)
- **TO statuses open for add-ons:** `B` Pending Fulfillment, `D` Partially Fulfilled, `E` Pending Receipt/Partially Fulfilled.
- **Fields:** trailer → `custbody_rsm_container_no`. Seal → `custbody7`, written as `SEAL: <n>` (confirmed in prod on IR20597 and IR20593).
- **Memo on stamped IFs:** `Truck <N> · MM/DD`.
- **Receipt→IF link:** `previoustransactionlink`, with `linktype = 'TOrdCost'`, `previousdoc` = IF id and `nextdoc` = receipt id (verified 2026-10-05: IF 7675338 → IR 7680843).
- **Write modes:**
  - `off`: nothing is written to NetSuite.
  - `qty`: only `if_qty` ops are written.
  - `on`: everything is written.
  - The default when unset is `off`.
- **Default carrier:** `Armstrong Group`.
- **Pallet statuses (v3):** `labeled · loaded · in_transit · received · missing · void`.
- **Truck statuses:** `loading · departing · departed · receiving · approving · received`.
- **Manager:** existing `isManager()` (Administrator, manager role script ids, or `custentity_portal_manager`). Every receipt and every correction needs a manager, and manager actions are rejected server-side for floor users.
- **Never** write to prod NetSuite during Stage 1. Stage 2 deploys only on Jack's explicit go.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Run `git pull` before starting and `git push` when done (Drive-synced working copy).

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `move_portal/move_verify.js` | **create** | Pure v3 rules: capacity, load/unload scan rules, departure plan, receipt plan, write gate, shadow compare, snapshot→reads builder, SuiteQL text |
| `move_portal/test/verify.test.js` | **create** | Unit tests for `move_verify` |
| `move_portal/test/fixtures/snapshot_sample.json` | **create** | Small synthetic snapshot used by tests and the preview fallback |
| `move_portal/local/snapshot_ns.js` | **create** | Node-only `move_ns` stand-in built from a snapshot JSON |
| `move_portal/local/local_store.js` | **create** | Node-only persistence: wraps `fake_data` and saves `db` to `local/store.json` |
| `move_portal/move_ns.js` | **create (Stage 2)** | NetSuite `move_ns`: runs the same SuiteQL live through `N/query` |
| `move_portal/move_tx.js` | modify | Add `apply(op)` (`if_qty`, `if_stamp`, `if_create`, `receipt`). Old TO/IF/receipt functions are removed in Task 10 |
| `move_portal/test/fake_tx.js` | modify | Add `apply(op)` fake that records ops |
| `move_portal/sl_move_portal.js` | modify | Truck, unload, approvals and report actions. Old actions are removed in Task 10 |
| `move_portal/move_core.js` | modify (Task 10) | `PALLET` statuses become the v3 set; dead load helpers removed |
| `move_portal/move_ui.js` | modify | Screens: Load out, Unload, Approvals, Report. Old Load/To ship/Receive/To receive/Catch-ups removed |
| `move_portal/test/preview_server.js` | modify | Snapshot + local store, `?floor=1` per request |
| `move_portal/test/portal.test.js` | modify | Truck flow tests. Old load/ship/receive tests removed in Task 10 |
| `.gitignore` | modify | Ignore `move_portal/local/store.json` and `move_portal/snapshot/` |
| `CLAUDE.md` | modify | Handoff updated at the end of each stage |

---

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

### Task 2: Departure plan, Truck # of the day, seal check

**Files:**
- Modify: `move_portal/move_verify.js`
- Modify: `move_portal/test/verify.test.js`

**Interfaces:**
- Consumes: `fillExpected`, `_byIfOrder`, `_ifQty`, `_oldestFirst` (Task 1).
- Produces:
  - `memoFor(truckNo, dayIso) → 'Truck 3 · 10/05'`
  - `normSeal(s)`
  - `sealUsed(trucks, seal, exceptId) → bool`
  - `truckNoForDay(trucks, dayIso, exceptId) → int`. Here `trucks` = load rows `{id, status, data: {depart: {seal, day, truckNo}}}`.
  - `planDeparture({ifs, pallets, toLines, stamp: {trailer, seal, truckNo, dayIso}})` returns:
    `{ops, alloc, unplanned, corrections, needsManager, bol: {number, changed, ifNums}}`
    - `ops` entries:
      - `{op:'if_qty', ifId, ifNum, toId, item, from, to}`
      - `{op:'if_stamp', ifId, ifNum, trailer, seal, memo}`
      - `{op:'if_create', toId, toNum, lines: {item: qty}, trailer, seal, memo}`
    - `alloc` entries: `{ifId, ifNum, toId, toNum, lines: {item: qty}, addOn}`. Add-on rows use `ifId = 'new:<toId>'` and `ifNum = '(new)'`.
    - `unplanned` entries: `{ifId, ifNum}`, for IFs with nothing scanned. They are taken off the truck, never lowered to 0.
    - Throws `Error('No open transfer order covers N pcs of item K')` if scans exceed all capacity. Scans are already blocked earlier, so this only fires if NetSuite changed in between.

- [ ] **Step 1: Write the failing tests** (append to `verify.test.js`)

```js
const stamp = { trailer: '537224', seal: '5249330', truckNo: 3, dayIso: '2026-10-05' };
const loaded = (n, item, pcs) => Array.from({ length: n }, (_, i) => pal(100 + i, VP.LOADED, '1', [{ item: item || '975', sku: 'YSN100', pcs: pcs || 12 }]));

test('memoFor, sealUsed, truckNoForDay', () => {
    assert.equal(v.memoFor(3, '2026-10-05'), 'Truck 3 · 10/05');
    const trucks = [{ id: '1', data: { depart: { seal: '5249330 ', day: '2026-10-05', truckNo: 1 } } }, { id: '2', data: {} },
        { id: '4', data: { depart: { seal: 'X1', day: '2026-10-04', truckNo: 7 } } }];
    assert.equal(v.sealUsed(trucks, ' 5249330', '9'), true);
    assert.equal(v.sealUsed(trucks, '5249330', '1'), false);   // its own seal
    assert.equal(v.sealUsed(trucks, '', '9'), false);
    assert.equal(v.truckNoForDay(trucks, '2026-10-05', '9'), 2);
    assert.equal(v.truckNoForDay(trucks, '2026-10-06', '9'), 1);
});

test('planDeparture: exact match → only stamps, no manager', () => {
    const p = v.planDeparture({ ifs: IFS, pallets: loaded(42), toLines: TOS, stamp });
    assert.deepEqual(p.ops, [{ op: 'if_stamp', ifId: '9001', ifNum: 'IF9001', trailer: '537224', seal: '5249330', memo: 'Truck 3 · 10/05' }]);
    assert.equal(p.needsManager, false);
    assert.deepEqual(p.bol, { number: 'TO500', changed: false, ifNums: ['IF9001'] });
    assert.deepEqual(p.alloc, [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', lines: { 975: 504 }, addOn: false }]);
});

test('planDeparture: short lowers, over raises within TO, beyond goes to add-on from the oldest other TO', () => {
    const short = v.planDeparture({ ifs: IFS, pallets: loaded(40), toLines: TOS, stamp });
    assert.deepEqual(short.ops[0], { op: 'if_qty', ifId: '9001', ifNum: 'IF9001', toId: '500', item: '975', from: 504, to: 480 });
    assert.equal(short.needsManager, true);
    assert.equal(short.bol.changed, true);
    const over = v.planDeparture({ ifs: IFS, pallets: loaded(44), toLines: TOS, stamp });          // 528 = 504 + 24 raise
    assert.deepEqual(over.ops.map(o => [o.op, o.to]), [['if_qty', 528], ['if_stamp', undefined]]);
    const addon = v.planDeparture({ ifs: IFS, pallets: loaded(46), toLines: TOS, stamp });         // 552 = 504 + 24 + 24 add-on
    assert.deepEqual(addon.ops.map(o => o.op), ['if_qty', 'if_stamp', 'if_create']);
    assert.deepEqual(addon.ops[2], { op: 'if_create', toId: '600', toNum: 'TO600', lines: { 975: 24 }, trailer: '537224', seal: '5249330', memo: 'Truck 3 · 10/05' });
    assert.deepEqual(addon.alloc[1], { ifId: 'new:600', ifNum: '(new)', toId: '600', toNum: 'TO600', lines: { 975: 24 }, addOn: true });
    assert.deepEqual(addon.bol.ifNums, ['IF9001', '(new from TO600)']);
});

test('planDeparture: extra SKU → add-on; empty IF → unplanned; over capacity throws', () => {
    const two = IFS.concat([{ ifId: '9002', ifNum: 'IF9002', toId: '500', toNum: 'TO500', lines: [{ item: '975', qty: 504 }] }]);
    const p = v.planDeparture({ ifs: two, pallets: loaded(42).concat(loaded(1, '11', 120)), toLines: TOS, stamp });
    assert.deepEqual(p.unplanned, [{ ifId: '9002', ifNum: 'IF9002' }]);
    assert.deepEqual(p.ops.map(o => o.op + ':' + (o.ifId || o.toId)), ['if_stamp:9001', 'if_create:700']);
    assert.equal(p.needsManager, true);
    assert.throws(() => v.planDeparture({ ifs: IFS, pallets: loaded(1, '999', 1), toLines: TOS, stamp }), /No open transfer order covers 1 pcs of item 999/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `v.memoFor is not a function`.

- [ ] **Step 3: Implement** (add to `move_verify.js` before `return`, then add the new names to the returned object)

```js
    // ── departure ────────────────────────────────────────────────────────
    function memoFor(truckNo, dayIso) { return 'Truck ' + truckNo + ' · ' + String(dayIso).slice(5, 7) + '/' + String(dayIso).slice(8, 10); }
    function normSeal(s) { return String(s == null ? '' : s).trim().toUpperCase(); }
    function departOf(t) { return (t && t.data && t.data.depart) || null; }
    function sealUsed(trucks, seal, exceptId) {
        const n = normSeal(seal);
        return !!n && (trucks || []).some(t => String(t.id) !== String(exceptId) && departOf(t) && normSeal(departOf(t).seal) === n);
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
```

Add `memoFor, normSeal, sealUsed, truckNoForDay, planDeparture` to the returned object.

> Note: in the exact-match test `bol.changed` is `false` because there are no corrections and no unplanned IFs. In the extra-SKU test, IF9002 has an `alloc` entry `{975: 0}`, so it lands in `unplanned`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(v3): departure plan, truck # of the day, seal reuse check"
```

---

### Task 3: Unload scan rule and receipt plan

**Files:**
- Modify: `move_portal/move_verify.js`
- Modify: `move_portal/test/verify.test.js`

**Interfaces:**
- Produces:
  - `classifyUnloadScan({pallet, truckId, trucks}) → {result, set?, otherTruckId?, otherLabel?}`. `result` ∈ `unknown · void · ok · late · dup · dup_other · other_truck · locked · never_loaded`.
  - `planReceipts({alloc, pallets, received, stamp: {trailer, seal}, seq})` returns `{ops, perIf, missing, cumulative}`:
    - `ops`: `[{op:'receipt', ifId, ifNum, toId, lines: {item: qty}, trailer, seal, seq}]`. Each op has only the **new** qty, above what earlier approved receipts (`received`) already took.
    - `perIf`: `[{ifId, ifNum, shipped, received, short}]`
    - `missing`: codes of pallets still `in_transit` or `missing`
    - `cumulative`: `{ifId: {item: qty}}`, to be saved as the truck's new `received`.

- [ ] **Step 1: Write the failing tests** (append)

```js
test('classifyUnloadScan rows', () => {
    const tr = { 1: { status: T.RECEIVING, label: 'Truck 1 · 10/05' }, 2: { status: T.DEPARTED, label: 'Truck 2 · 10/05' }, 5: { status: T.DEPARTING, label: 'IF9' } };
    const c = p => v.classifyUnloadScan({ pallet: p, truckId: '1', trucks: tr });
    assert.equal(c(null).result, 'unknown');
    assert.equal(c(pal(1, VP.VOID)).result, 'void');
    assert.deepEqual(c(pal(1, VP.IN_TRANSIT, '1')), { result: 'ok', set: { status: VP.RECEIVED } });
    assert.deepEqual(c(pal(1, VP.MISSING, '1')), { result: 'late', set: { status: VP.RECEIVED } });
    assert.deepEqual(c(pal(1, VP.IN_TRANSIT, '2')), { result: 'other_truck', otherTruckId: '2', otherLabel: 'Truck 2 · 10/05' });
    assert.equal(c(pal(1, VP.RECEIVED, '1')).result, 'dup');
    assert.equal(c(pal(1, VP.RECEIVED, '2')).result, 'dup_other');
    assert.equal(c(pal(1, VP.LOADED, '5')).result, 'locked');
    assert.equal(c(pal(1, VP.LABELED)).result, 'never_loaded');
    assert.equal(c(pal(1, VP.LOADED, '7')).result, 'never_loaded');
});

test('planReceipts: per IF, short leaves missing, a late second receipt only carries the new qty', () => {
    const alloc = [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', lines: { 975: 504 }, addOn: false },
        { ifId: 'new:600', ifNum: '(new)', toId: '600', toNum: 'TO600', lines: { 975: 24 }, addOn: true }];
    const ps = loaded(44).map((p, i) => Object.assign(p, { status: i < 41 ? VP.RECEIVED : VP.IN_TRANSIT }));   // 41 × 12 = 492 in
    const r1 = v.planReceipts({ alloc, pallets: ps, received: {}, stamp: { trailer: '537224', seal: '5249330' }, seq: 1 });
    assert.deepEqual(r1.ops, [{ op: 'receipt', ifId: '9001', ifNum: 'IF9001', toId: '500', lines: { 975: 492 }, trailer: '537224', seal: '5249330', seq: 1 }]);
    assert.deepEqual(r1.perIf, [{ ifId: '9001', ifNum: 'IF9001', shipped: 504, received: 492, short: 12 }, { ifId: 'new:600', ifNum: '(new)', shipped: 24, received: 0, short: 24 }]);
    assert.deepEqual(r1.missing, ['PLT141', 'PLT142', 'PLT143']);
    assert.deepEqual(r1.cumulative, { 9001: { 975: 492 }, 'new:600': { 975: 0 } });
    ps.forEach(p => { p.status = VP.RECEIVED; });                                                    // the 3 missing arrive late
    const r2 = v.planReceipts({ alloc, pallets: ps, received: r1.cumulative, stamp: { trailer: '537224', seal: '5249330' }, seq: 2 });
    assert.deepEqual(r2.ops.map(o => [o.ifId, o.lines[975], o.seq]), [['9001', 12, 2], ['new:600', 24, 2]]);
    assert.deepEqual(r2.missing, []);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `v.classifyUnloadScan is not a function`.

- [ ] **Step 3: Implement** (add before `return`, and export `classifyUnloadScan, planReceipts`)

```js
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
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(v3): unload scan rule + per-IF receipt plan with late second receipt"
```

---

### Task 4: Write gate (`runOps`) and shadow compare

**Files:**
- Modify: `move_portal/move_verify.js`
- Modify: `move_portal/test/verify.test.js`

**Interfaces:**
- Produces:
  - `opKey(op)`: `if_qty:<ifId>:<item>`, `if_stamp:<ifId>`, `if_create:<toId>`, `receipt:<ifId>:<seq>`
  - `opAllowed(op, mode) → bool`
  - `normMode(m) → 'off'|'qty'|'on'`
  - `runOps(ops, mode, apply, done, onWrite) → {written: [keys], planOnly: [keys]}`. `apply(op)` returns an id string. Keys already in `done` are skipped, and `onWrite(key, id)` is called right after each write.
  - `resolveNew(op, writes)`: swaps `ifId: 'new:<toId>'` for `writes['if_create:<toId>']`, and throws if that's missing.
  - `shadowRows({trucks, ifInfo, ifsByTo, receipts, sku})` → `[{truck, seal, ifNum, check, portal, netsuite, ok}]`, where `ok` ∈ `true · false · null` (null = NetSuite hasn't caught up yet). The inputs:
    - `trucks`: departed truck rows
    - `ifInfo`: `{ifId: {ifNum, status, toId, lines: [{item, qty}]}}`
    - `ifsByTo`: `{toId: [ifId]}`
    - `receipts`: `{ifId: [{id, tranid, trailer, seal, lines: {item: qty}}]}`
    - `sku`: `{item: sku}`

- [ ] **Step 1: Write the failing tests** (append)

```js
test('opKey / opAllowed / normMode', () => {
    assert.equal(v.opKey({ op: 'if_qty', ifId: '9', item: '975' }), 'if_qty:9:975');
    assert.equal(v.opKey({ op: 'if_stamp', ifId: '9' }), 'if_stamp:9');
    assert.equal(v.opKey({ op: 'if_create', toId: '600' }), 'if_create:600');
    assert.equal(v.opKey({ op: 'receipt', ifId: '9', seq: 2 }), 'receipt:9:2');
    assert.deepEqual(['if_qty', 'if_stamp', 'if_create', 'receipt'].map(op => [v.opAllowed({ op }, 'off'), v.opAllowed({ op }, 'qty'), v.opAllowed({ op }, 'on')]),
        [[false, true, true], [false, false, true], [false, false, true], [false, false, true]]);
    assert.equal(v.normMode('weird'), 'off');
    assert.equal(v.normMode('qty'), 'qty');
});

test('runOps writes only what the mode allows, skips done keys, reports each write', () => {
    const ops = [{ op: 'if_qty', ifId: '9', item: '975', from: 504, to: 480 }, { op: 'if_stamp', ifId: '9' }, { op: 'if_qty', ifId: '8', item: '975', from: 10, to: 5 }];
    const calls = [], saved = {};
    const r = v.runOps(ops, 'qty', op => { calls.push(v.opKey(op)); return 'id' + calls.length; }, { 'if_qty:8:975': 'old' }, (k, id) => { saved[k] = id; });
    assert.deepEqual(calls, ['if_qty:9:975']);
    assert.deepEqual(saved, { 'if_qty:9:975': 'id1' });
    assert.deepEqual(r, { written: ['if_qty:9:975'], planOnly: ['if_stamp:9'] });
    assert.deepEqual(v.runOps(ops, 'off', () => { throw new Error('no'); }, {}, null).written, []);
});

test('resolveNew', () => {
    assert.deepEqual(v.resolveNew({ op: 'receipt', ifId: 'new:600', toId: '600' }, { 'if_create:600': '77' }), { op: 'receipt', ifId: '77', toId: '600' });
    assert.throws(() => v.resolveNew({ op: 'receipt', ifId: 'new:600', toId: '600' }, {}), /add-on IF from TO 600 was not created/);
    const op = { op: 'receipt', ifId: '9' };
    assert.equal(v.resolveNew(op, {}), op);
});

test('shadowRows compares plan vs NetSuite and leaves not-yet-done checks as null', () => {
    const truck = { id: '1', data: { depart: { truckNo: 3, day: '2026-10-05', trailer: '537224', seal: '5249330' },
        alloc: [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', lines: { 975: 480 }, addOn: false },
            { ifId: 'new:600', ifNum: '(new)', toId: '600', toNum: 'TO600', lines: { 975: 24 }, addOn: true }],
        received: { 9001: { 975: 480 } } } };
    const rows = v.shadowRows({ trucks: [truck], sku: { 975: 'YSN100' },
        ifInfo: { 9001: { ifNum: 'IF9001', status: 'C', toId: '500', lines: [{ item: '975', qty: 504 }] }, 9100: { ifNum: 'IF9100', status: 'C', toId: '600', lines: [{ item: '975', qty: 24 }] } },
        ifsByTo: { 500: ['9001'], 600: ['9100'] },
        receipts: { 9001: [{ id: '1', tranid: 'IR1', trailer: '537224', seal: 'SEAL: 5249330', lines: { 975: 480 } }],
            9100: [{ id: '2', tranid: 'IR2', trailer: '537224', seal: 'SEAL: 5249330', lines: { 975: 24 } }] } });
    const pick = (ifNum, check) => rows.find(r => r.ifNum === ifNum && r.check === check);
    assert.deepEqual(pick('IF9001', 'IF qty YSN100'), { truck: 'Truck 3 · 10/05', seal: '5249330', ifNum: 'IF9001', check: 'IF qty YSN100', portal: '480', netsuite: '504', ok: false });
    assert.equal(pick('IF9001', 'Shipped').ok, true);
    assert.equal(pick('IF9001', 'Trailer').ok, true);
    assert.equal(pick('IF9001', 'Seal').ok, true);
    assert.equal(pick('IF9001', 'Receipt qty YSN100').ok, true);
    assert.equal(pick('IF9100', 'Add-on IF on TO600').ok, true);                // found by the seal on its receipt
    assert.equal(pick('IF9100', 'Receipt qty YSN100').ok, null);               // portal hasn't approved that receipt yet
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `v.opKey is not a function`.

- [ ] **Step 3: Implement** (add before `return`, and export `opKey, opAllowed, normMode, runOps, resolveNew, shadowRows`)

```js
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
            const id = String(apply(op));
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
            const label = memoFor(dep.truckNo, dep.day), sealTxt = 'SEAL: ' + normSeal(dep.seal);
            const row = (ifNum, check, portal, netsuite, ok) => rows.push({ truck: label, seal: dep.seal, ifNum: ifNum, check: check, portal: String(portal), netsuite: netsuite == null ? '—' : String(netsuite), ok: ok });
            (d.alloc || []).forEach(a => {
                let realId = a.addOn ? null : a.ifId;
                if (a.addOn) {
                    realId = ((o.ifsByTo || {})[a.toId] || []).find(id => !planned[id] && ((o.receipts || {})[id] || []).some(r => normSeal(r.seal) === sealTxt)) || null;
                    const f = realId && o.ifInfo[realId];
                    row(f ? f.ifNum : '(new)', 'Add-on IF on ' + a.toNum, 'needed', f ? f.ifNum : null, f ? true : null);
                }
                const info = realId ? (o.ifInfo || {})[realId] : null;
                const ifNum = info ? info.ifNum : a.ifNum;
                if (!info) return;
                Object.keys(a.lines).forEach(k => {
                    const ns = (info.lines || []).filter(l => String(l.item) === k).reduce((s, l) => s + Number(l.qty || 0), 0);
                    row(ifNum, 'IF qty ' + (sku[k] || k), a.lines[k], ns, info.status === 'C' ? ns === a.lines[k] : null);
                });
                row(ifNum, 'Shipped', 'yes', info.status === 'C' ? 'yes' : info.status, info.status === 'C' ? true : null);
                const rs = (o.receipts || {})[realId] || [];
                if (!rs.length) return;
                row(ifNum, 'Trailer', dep.trailer, rs.map(r => r.trailer).join(', '), rs.every(r => normSeal(r.trailer) === normSeal(dep.trailer)));
                row(ifNum, 'Seal', dep.seal, rs.map(r => r.seal).join(', '), rs.every(r => normSeal(r.seal) === sealTxt));
                const mine = (d.received || {})[a.ifId] || null;
                Object.keys(a.lines).forEach(k => {
                    const ns = rs.reduce((s, r) => s + (Number(r.lines[k]) || 0), 0);
                    const p = mine ? Number(mine[k]) || 0 : null;
                    row(ifNum, 'Receipt qty ' + (sku[k] || k), p == null ? 'not approved' : p, ns, p == null ? null : p === ns);
                });
            });
        });
        return rows;
    }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(v3): write gate (off|qty|on) + shadow compare rows"
```

---

### Task 5: Snapshot → reads (`buildReads`), SuiteQL text, `local/snapshot_ns.js`

**Files:**
- Modify: `move_portal/move_verify.js` (add `SQL` and `buildReads`)
- Create: `move_portal/test/fixtures/snapshot_sample.json`
- Create: `move_portal/local/snapshot_ns.js`
- Modify: `move_portal/test/verify.test.js`

**Interfaces:**
- Produces:
  - `SQL(locFrom, locTo) → {toLines, ifLines, links, receipts, items}`: SuiteQL strings. `links`, `receipts` and `items` take a comma list via `.replace('{IDS}', ids)`.
  - `buildReads(raw)` → the **`move_ns` interface**, used by everything later:
    - `plannedIfs() → [{ifId, ifNum, status, trandate, toId, toNum, lines: [{item, sku, qty}]}]` (status A/B, IF id order)
    - `openToLines() → [{toId, toNum, trandate, toStatus, item, sku, qty, remaining}]` (status B/D/E and remaining > 0)
    - `ifInfo() → {ifId: {ifNum, status, toId, lines}}`, covering every IF in the snapshot
    - `ifsByTo() → {toId: [ifId]}`
    - `receiptsByIf() → {ifId: [{id, tranid, trailer, seal, lines: {item: qty}}]}`
    - `items() → [{item, sku, desc, upc}]`
    - `pulledAt() → string`
    - `resetCache()`: a no-op here
  - `makeSnapshotNs(verify, rawOrPath)` in `local/snapshot_ns.js` returns the same interface. A path is read with `fs`.
- **Raw snapshot format.** Keys are lowercase because SuiteQL returns them that way. Rows are copied straight from query output:
  ```json
  { "pulledAt": "2026-10-05T14:00:00-07:00", "locFrom": "35", "locTo": "46",
    "toLines":  [{ "toid": 1, "tonum": "TO1", "tostatus": "D", "trandate": "2026-10-01", "item": 975, "sku": "YSN100", "qty": 10080 }],
    "ifLines":  [{ "ifid": 2, "ifnum": "IF2", "status": "B", "trandate": "2026-10-05", "toid": 1, "item": 975, "sku": "YSN100", "qty": 504 }],
    "links":    [{ "ifid": 2, "rcptid": 3 }],
    "receipts": [{ "rcptid": 3, "tranid": "IR3", "trailer": "537224", "seal": "SEAL: 1", "item": 975, "qty": 504 }],
    "items":    [{ "item": 975, "sku": "YSN100", "descr": "...", "upc": "..." }] }
  ```
  `remaining` = Σ TO qty − Σ IF qty, for every IF status. Picked/Packed IFs already count as fulfilled on the TO.

- [ ] **Step 1: Create the fixture `move_portal/test/fixtures/snapshot_sample.json`**

```json
{
  "pulledAt": "2026-10-05T14:00:00-07:00", "locFrom": "35", "locTo": "46",
  "toLines": [
    { "toid": 500, "tonum": "TO500", "tostatus": "D", "trandate": "2026-10-01", "item": 975, "sku": "YSN100", "qty": 1560 },
    { "toid": 600, "tonum": "TO600", "tostatus": "B", "trandate": "2026-09-29", "item": 975, "sku": "YSN100", "qty": 504 },
    { "toid": 700, "tonum": "TO700", "tostatus": "B", "trandate": "2026-09-28", "item": 11, "sku": "YSN201", "qty": 1200 },
    { "toid": 800, "tonum": "TO800", "tostatus": "G", "trandate": "2026-09-20", "item": 11, "sku": "YSN201", "qty": 100 }
  ],
  "ifLines": [
    { "ifid": 9000, "ifnum": "IF9000", "status": "C", "trandate": "2026-10-03", "toid": 500, "item": 975, "sku": "YSN100", "qty": 504 },
    { "ifid": 9001, "ifnum": "IF9001", "status": "B", "trandate": "2026-10-05", "toid": 500, "item": 975, "sku": "YSN100", "qty": 504 },
    { "ifid": 9002, "ifnum": "IF9002", "status": "A", "trandate": "2026-10-05", "toid": 500, "item": 975, "sku": "YSN100", "qty": 288 },
    { "ifid": 9002, "ifnum": "IF9002", "status": "A", "trandate": "2026-10-05", "toid": 500, "item": 975, "sku": "YSN100", "qty": 216 },
    { "ifid": 9050, "ifnum": "IF9050", "status": "C", "trandate": "2026-09-21", "toid": 800, "item": 11, "sku": "YSN201", "qty": 100 }
  ],
  "links": [{ "ifid": 9000, "rcptid": 7000 }, { "ifid": 1234, "rcptid": 7999 }],
  "receipts": [{ "rcptid": 7000, "tranid": "IR7000", "trailer": "537224", "seal": "SEAL: 5249300", "item": 975, "qty": 504 }],
  "items": [{ "item": 975, "sku": "YSN100", "descr": "100# LP cylinder", "upc": "0975" }, { "item": 11, "sku": "YSN201", "descr": "20# LP cylinder", "upc": "111" }]
}
```

- [ ] **Step 2: Write the failing tests** (append to `verify.test.js`)

```js
const raw = require('./fixtures/snapshot_sample.json');

test('buildReads: planned IFs (A/B), merged lines, TO remaining after every IF, open TOs only', () => {
    const r = v.buildReads(raw);
    assert.deepEqual(r.plannedIfs().map(f => [f.ifId, f.status, f.toNum, f.lines]), [
        ['9001', 'B', 'TO500', [{ item: '975', sku: 'YSN100', qty: 504 }]],
        ['9002', 'A', 'TO500', [{ item: '975', sku: 'YSN100', qty: 504 }]]]);
    assert.deepEqual(r.openToLines().map(t => [t.toId, t.item, t.remaining]), [['500', '975', 48], ['600', '975', 504], ['700', '11', 1200]]);
    assert.deepEqual(r.ifsByTo(), { 500: ['9000', '9001', '9002'], 800: ['9050'] });
    assert.deepEqual(r.receiptsByIf(), { 9000: [{ id: '7000', tranid: 'IR7000', trailer: '537224', seal: 'SEAL: 5249300', lines: { 975: 504 } }] });
    assert.equal(r.ifInfo()['9000'].status, 'C');
    assert.deepEqual(r.items()[0], { item: '975', sku: 'YSN100', desc: '100# LP cylinder', upc: '0975' });
    assert.equal(r.pulledAt(), '2026-10-05T14:00:00-07:00');
});

test('SQL builds location-specific queries', () => {
    const q = v.SQL('35', '46');
    assert.match(q.toLines, /t\.transferlocation = 46/);
    assert.match(q.toLines, /x\.location = 35/);
    assert.match(q.ifLines, /tl\.location = 35/);
    assert.match(q.links, /linktype = 'TOrdCost'/);
    assert.match(q.receipts, /\{IDS\}/);
});

test('local snapshot_ns reads a file path', () => {
    const { makeSnapshotNs } = require('../local/snapshot_ns');
    const ns = makeSnapshotNs(v, require('path').join(__dirname, 'fixtures', 'snapshot_sample.json'));
    assert.equal(ns.plannedIfs().length, 2);
    ns.resetCache();
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `v.buildReads is not a function`.

- [ ] **Step 4: Implement in `move_verify.js`** (before `return`, and export `SQL, buildReads`)

```js
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
```

- [ ] **Step 5: Create `move_portal/local/snapshot_ns.js`**

```js
// move_portal/local/snapshot_ns.js — node only, NOT deployed. A move_ns stand-in that reads a prod snapshot JSON.
const fs = require('fs');

function makeSnapshotNs(verify, rawOrPath) {
    const raw = typeof rawOrPath === 'string' ? JSON.parse(fs.readFileSync(rawOrPath, 'utf8')) : rawOrPath;
    return verify.buildReads(raw);
}

module.exports = { makeSnapshotNs };
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: PASS (19 tests). TO500 remaining = 1560 − 504 − 504 − 504 = 48. TO800 (status G) is excluded.

- [ ] **Step 7: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js move_portal/test/fixtures/snapshot_sample.json move_portal/local/snapshot_ns.js
git commit -m "feat(v3): snapshot reads builder + SuiteQL text + local snapshot_ns"
```

---

### Task 6: `move_tx.apply(op)` and the fake

**Files:**
- Modify: `move_portal/move_tx.js`
- Modify: `move_portal/test/fake_tx.js`
- Create: `move_portal/test/tx.test.js`

**Interfaces:**
- Produces: `tx.apply(op) → id string`:
  - `if_qty`:
    - Loads the IF and refuses unless its status is `A`/`B` and the item's total qty is `op.from`.
    - For a raise, refuses unless the extra (`to − from`) is ≤ the TO line's `quantity − quantityfulfilled`.
    - Sets the qty, filling the item's lines in order. A line that ends at 0 is removed.
    - Returns the IF id.
  - `if_stamp`: sets `custbody_rsm_container_no`, `custbody7 = 'SEAL: ' + seal`, `memo`, and `shipstatus = 'C'`. Returns the IF id.
  - `if_create`: transforms the TO into an IF with Shipped status and the same stamp, ticking only `op.lines`. Returns the new IF id.
  - `receipt`: transforms the TO into an Item Receipt with `defaultValues: {itemfulfillment: op.ifId}`, the trailer, `SEAL: n` and memo, ticking only `op.lines`. Returns the receipt id.
  - Refusals throw `Error` whose message starts with `IF changed in NetSuite`.
- The fake keeps `_t.ops` (applied ops in order) and `_t.failOn` (an op key that throws once). Ids start at 901. The fake also keeps the old functions until Task 10.

- [ ] **Step 1: Write the failing test `move_portal/test/tx.test.js`** (for the fake contract, which the portal tests rely on)

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeTx } = require('./fake_tx');

test('fake tx.apply records ops, returns ids, can fail once on a key', () => {
    const tx = makeFakeTx();
    assert.equal(tx.apply({ op: 'if_qty', ifId: '9', item: '975', from: 504, to: 480 }), '9');
    assert.equal(tx.apply({ op: 'if_create', toId: '600', lines: { 975: 24 } }), '901');
    tx._t.failOn = 'if_stamp:9';
    assert.throws(() => tx.apply({ op: 'if_stamp', ifId: '9' }), /IF changed in NetSuite/);
    assert.equal(tx.apply({ op: 'if_stamp', ifId: '9' }), '9');
    assert.deepEqual(tx._t.ops.map(o => o.op), ['if_qty', 'if_create', 'if_stamp']);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test "move_portal/test/tx.test.js"`
Expected: FAIL with `tx.apply is not a function`.

- [ ] **Step 3: Add to `fake_tx.js`** (inside the returned object; also add `ops: [], failOn: null` to `t`)

```js
        apply: op => {
            const key = op.op === 'if_qty' ? 'if_qty:' + op.ifId + ':' + op.item : op.op === 'if_create' ? 'if_create:' + op.toId
                : op.op === 'receipt' ? 'receipt:' + op.ifId + ':' + op.seq : op.op + ':' + op.ifId;
            if (t.failOn === key) { t.failOn = null; throw new Error('IF changed in NetSuite (fake failure on ' + key + ')'); }
            t.ops.push(JSON.parse(JSON.stringify(op)));
            return op.op === 'if_qty' || op.op === 'if_stamp' ? String(op.ifId) : String(++t.seq);
        },
```

- [ ] **Step 4: Add `apply` to `move_tx.js`** (before `return`, then add `apply` to the returned object)

```js
    // ── v3 write ops (spec §6). Each re-reads NetSuite and refuses if it changed since the plan. ──
    function changed(msg) { return new Error('IF changed in NetSuite, review: ' + msg); }
    function stampOn(rec, op) {
        rec.setValue({ fieldId: 'custbody_rsm_container_no', value: op.trailer });
        rec.setValue({ fieldId: 'custbody7', value: 'SEAL: ' + op.seal });
        rec.setValue({ fieldId: 'memo', value: op.memo });
    }
    function itemLines(rec, item) {
        const out = [], n = rec.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < n; i++) if (String(rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i })) === String(item)) out.push(i);
        return out;
    }
    function toRemaining(toId, item) {
        const to = record.load({ type: record.Type.TRANSFER_ORDER, id: toId });
        let left = 0;
        itemLines(to, item).forEach(i => {
            left += (Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0) -
                (Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantityfulfilled', line: i })) || 0);
        });
        return left;
    }
    function setIfItemQty(op) {
        const f = record.load({ type: record.Type.ITEM_FULFILLMENT, id: op.ifId, isDynamic: true });
        const st = String(f.getValue({ fieldId: 'shipstatus' }));
        if (st !== 'A' && st !== 'B') throw changed(op.ifNum + ' is no longer Picked/Packed (status ' + st + ')');
        const lines = itemLines(f, op.item);
        const cur = lines.reduce((a, i) => a + (Number(f.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0), 0);
        if (cur !== Number(op.from)) throw changed(op.ifNum + ' item ' + op.item + ' is ' + cur + ', expected ' + op.from);
        if (op.to > op.from && op.to - op.from > toRemaining(op.toId, op.item)) throw changed('TO ' + op.toId + ' has no room to raise ' + op.ifNum + ' to ' + op.to);
        let left = Number(op.to);
        const caps = lines.map(i => Number(f.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0);
        const want = lines.map((i, n) => { const last = n === lines.length - 1; const g = last ? left : Math.min(left, caps[n]); left -= g; return g; });
        for (let n = lines.length - 1; n >= 0; n--) {
            if (want[n] > 0) {
                f.selectLine({ sublistId: 'item', line: lines[n] });
                f.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: want[n] });
                f.commitLine({ sublistId: 'item' });
            } else f.removeLine({ sublistId: 'item', line: lines[n] });
        }
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    function stampShip(op) {
        const f = record.load({ type: record.Type.ITEM_FULFILLMENT, id: op.ifId, isDynamic: true });
        const st = String(f.getValue({ fieldId: 'shipstatus' }));
        if (st !== 'A' && st !== 'B') throw changed(op.ifNum + ' is no longer Picked/Packed (status ' + st + ')');
        stampOn(f, op);
        f.setValue({ fieldId: 'shipstatus', value: 'C' });
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    function createIf(op) {
        const f = record.transform({ fromType: record.Type.TRANSFER_ORDER, fromId: op.toId, toType: record.Type.ITEM_FULFILLMENT, isDynamic: true });
        f.setValue({ fieldId: 'shipstatus', value: 'C' });
        stampOn(f, op);
        setLines(f, op.lines);
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    function createReceipt(op) {
        const r = record.transform({ fromType: record.Type.TRANSFER_ORDER, fromId: op.toId, toType: record.Type.ITEM_RECEIPT, isDynamic: true,
            defaultValues: { itemfulfillment: op.ifId } });
        stampOn(r, Object.assign({ memo: 'Move receipt · ' + op.ifNum }, op));
        setLines(r, op.lines);
        return String(r.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    function apply(op) {
        if (op.op === 'if_qty') return setIfItemQty(op);
        if (op.op === 'if_stamp') return stampShip(op);
        if (op.op === 'if_create') return createIf(op);
        if (op.op === 'receipt') return createReceipt(op);
        throw new Error('Unknown op ' + op.op);
    }
```

> ⚠ Stage 2 must check these in prod on a test IF before using `qty` mode with real trucks: `removeLine` on an IF item line, the Packed IF qty edit, `defaultValues.itemfulfillment`. Record what happened in the ledger (Task 16).

- [ ] **Step 5: Run the full suite**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass (62 old + 19 verify + 1 tx).

- [ ] **Step 6: Commit**

```bash
git add move_portal/move_tx.js move_portal/test/fake_tx.js move_portal/test/tx.test.js
git commit -m "feat(v3): move_tx.apply ops (if_qty, if_stamp, if_create, receipt) + fake"
```

---

### Task 7: Suitelet: load-out and departure actions

**Files:**
- Modify: `move_portal/sl_move_portal.js` (define deps, helpers, new actions)
- Modify: `move_portal/test/portal.test.js` (`setup()` deps, new tests)
- Modify: `move_portal/test/preview_server.js` (add the two new deps so it still loads; fully reworked in Task 13)

**Interfaces:**
- Consumes: `move_verify` (Tasks 1–5), the `move_ns` interface (Task 5), `tx.apply` (Task 6).
- Produces:
  - Actions (all take `{actor}`):

    | Action | Body | Returns |
    |---|---|---|
    | `truck_planned` | — | `{planned: [pubIf], open: [truckSummary], pulledAt}` |
    | `truck_start` | `{ifIds}` | `{view}` |
    | `truck_get` | `{truckId}` | `{view}` |
    | `truck_scan` | `{truckId, raw}` | the scan result + `{raw, tone, pallet, view}` |
    | `truck_move_here` | `{truckId, palletId}` | `{view}` |
    | `truck_remove` | `{truckId, palletId}` | `{view}` |
    | `truck_undo` | `{truckId}` | `{view}` |
    | `depart_preview` | `{truckId, trailer, seal, carrier}` | `{input, truckNo, plan}` |
    | `depart_confirm` | `{truckId, trailer?, seal?, carrier?}` | `{waiting: true, plan, view}` or `{departed: true, view}` |
    | `depart_cancel` | `{truckId}` | `{view}` |
    | `depart_retry` | `{truckId}`, manager only | `{departed: true, view}` |

  - `view` shape: `{truck: {id, label, status, pending, depart, error, bol}, lines: [{ifNum, item, sku, expected, scanned, estPallets}], extras: [{item, sku, scanned}], pallets: [pubPallet], totals: {pallets, pieces}, trailers, carrier, writeMode}`
  - `plan` (public) shape: `{ops: [op + {sku}], unplanned, needsManager, bol, corrections: n}`

- [ ] **Step 1: Wire the dependencies**

In `sl_move_portal.js`, change the `define` list and the factory signature:

```js
define(['N/runtime', 'N/log', 'N/render', 'N/url', 'N/format',
        './move_core', './move_data', './move_tx', './move_label_template', './move_ui', './move_verify', './move_ns'],
function (runtime, log, render, url, format, core, data, tx, tpl, ui, verify, ns) {
```

In `portal.test.js` `setup()`, load and inject them, and return `ns` too:

```js
const verify = loadAmd('move_verify.js');
const { makeSnapshotNs } = require('../local/snapshot_ns');
// inside setup():
    const ns = makeSnapshotNs(verify, JSON.parse(JSON.stringify(require('./fixtures/snapshot_sample.json'))));
    data.db.items.push({ item: '975', sku: 'YSN100', desc: '100# cylinder', upc: '0975' });
    data.db.configs.push({ item: '975', code: 'A', pcs: 12, isDefault: true, batch: 'B1' });
    // add to the loadAmd deps object:
    //   './move_verify': verify, './move_ns': ns
    return { data, tx, run, ns };
```

In `preview_server.js`, add the same two deps to its `loadAmd('sl_move_portal.js', {...})` call. Use `const verify = loadAmd('move_verify.js')` and `require('../local/snapshot_ns').makeSnapshotNs(verify, require('path').join(__dirname, 'fixtures', 'snapshot_sample.json'))`.

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass (no behavior changed yet).

- [ ] **Step 2: Write the failing tests** (append to `portal.test.js`)

```js
const L975 = { item: '975', sku: 'YSN100', cfg: 'A', pcs: 12 };
function truckWith(ctx, n, ifId) {
    const ps = printLabels(ctx, n, 'Jt' + n + Math.random().toString(36).slice(2, 6), [L975]);
    const t = ctx.run('truck_start', { ifIds: [ifId || '9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    return { t, ps };
}

test('truck_planned lists A/B IFs not on a truck; truck_start takes one', () => {
    const ctx = setup();
    const r = ctx.run('truck_planned');
    assert.deepEqual(r.planned.map(f => [f.ifNum, f.pcs, f.estPallets]), [['IF9001', 504, 42], ['IF9002', 504, 42]]);
    const v1 = ctx.run('truck_start', { ifIds: ['9001'] }).view;
    assert.deepEqual([v1.truck.status, v1.truck.label, v1.lines[0].expected, v1.lines[0].scanned], ['loading', 'IF9001', 504, 0]);
    assert.deepEqual(ctx.run('truck_planned').planned.map(f => f.ifNum), ['IF9002']);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9001'] }), /already on a truck/);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9000'] }), /not Picked\/Packed/);
});

test('truck_scan: ok, dup, no_to blocked, undo and remove', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2, 'Jscan', [L975]);
    const bad = printLabels(ctx, 1, 'Jbad', [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 60 }]);
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    const r = ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code });
    assert.deepEqual([r.result, r.tone, r.view.lines[0].scanned], ['ok', 'ok', 12]);
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code }).result, 'dup');
    const b = ctx.run('truck_scan', { truckId: t.id, raw: bad[0].code });
    assert.deepEqual([b.result, b.sku, b.tone], ['no_to', 'YSN301', 'bad']);
    assert.equal(ctx.data.getPallet(bad[0].id).status, 'labeled');
    ctx.run('truck_scan', { truckId: t.id, raw: ps[1].code });
    assert.equal(ctx.run('truck_undo', { truckId: t.id }).view.lines[0].scanned, 12);
    assert.equal(ctx.run('truck_remove', { truckId: t.id, palletId: ps[0].id }).view.lines[0].scanned, 0);
    assert.equal(ctx.data.db.scans.length, 4);
});

test('truck_scan: pallet on another loading truck → other_truck → move here', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 1, 'Jmv', [L975]);
    const a = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    const b = ctx.run('truck_start', { ifIds: ['9002'] }).view.truck;
    ctx.run('truck_scan', { truckId: a.id, raw: ps[0].code });
    const r = ctx.run('truck_scan', { truckId: b.id, raw: ps[0].code });
    assert.deepEqual([r.result, r.otherLabel], ['other_truck', 'IF9001']);
    assert.equal(ctx.run('truck_move_here', { truckId: b.id, palletId: ps[0].id }).view.lines[0].scanned, 12);
    assert.equal(ctx.data.getPallet(ps[0].id).loadId, b.id);
});

test('depart: exact match → floor departs, stamps planned only in off mode, pallets in transit, truck # 1', () => {
    const ctx = setup();
    const { t, ps } = truckWith(ctx, 42);
    const pv = ctx.run('depart_preview', { truckId: t.id, trailer: '537224', seal: '5249330' }, false);
    assert.deepEqual([pv.truckNo, pv.plan.needsManager, pv.plan.ops.length], [1, false, 1]);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249330' }, false);
    assert.equal(r.departed, true);
    assert.deepEqual([r.view.truck.status, r.view.truck.label, r.view.truck.depart.carrier], ['departed', 'Truck 1 · 10/14', 'Armstrong Group']);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'in_transit');
    const t2 = truckWith(ctx, 1, '9002').t;                                   // IF9001 is taken by the departed truck
    assert.throws(() => ctx.run('depart_confirm', { truckId: t2.id, trailer: '1', seal: '5249330' }), /already used/);
});

test('depart: short needs a manager; floor request waits; manager approval writes only if_qty in qty mode', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    const w = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249331' }, false);
    assert.equal(w.waiting, true);
    assert.equal(w.view.truck.pending.seal, '5249331');
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: 'PLT1' }), /Scanning is closed/);
    const r = ctx.run('depart_confirm', { truckId: t.id }, true);
    assert.equal(r.departed, true);
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.to]), [['if_qty', 480]]);
    assert.deepEqual(ctx.data.getLoad(t.id).data.writes, { 'if_qty:9001:975': '9001' });
    assert.equal(r.view.truck.bol.changed, true);
});

test('depart: a failed write leaves the truck departing with an error; a manager retry finishes without rewriting', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = truckWith(ctx, 42);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249332' }), /NetSuite write failed/);
    assert.equal(ctx.data.getLoad(t.id).status, 'departing');
    assert.throws(() => ctx.run('depart_retry', { truckId: t.id }, false), /Managers only/);
    assert.equal(ctx.run('depart_retry', { truckId: t.id }).departed, true);
    assert.deepEqual(ctx.tx._t.ops.map(o => o.op), ['if_stamp']);
});
```

> The fake `N/format` returns `10/14/2026 2:14:05 pm`, so the day is `2026-10-14` and the label is `Truck 1 · 10/14`.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL with `Unknown action: truck_planned`.

- [ ] **Step 4: Implement**

Put this block in `sl_move_portal.js` after the existing `claimLoad`/claim helpers and before `const A = {};`:

```js
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
        } catch (e) { throw userErr(e.message); }
    }
    function finishDepart(x, c) {
        const writes = Object.assign({}, x.data.writes);
        try {
            verify.runOps(x.data.plan, writeMode(c), op => tx.apply(verify.resolveNew(op, writes)), writes,
                (k, id) => { writes[k] = id; data.updateLoad(x, { data: { writes: writes } }); });
        } catch (e) {
            data.updateLoad(x, { data: { error: e.message || String(e), writes: writes } });
            throw userErr('Departure saved but a NetSuite write failed: ' + (e.message || e) + '. A manager can press Retry.');
        }
        data.palletsByLoad(x.id, [VP.LOADED]).forEach(p => data.updatePallet(p, { status: VP.IN_TRANSIT, shippedDay: x.data.depart.day }));
        data.updateLoad(x, { status: T.DEPARTED, data: { error: '', writes: writes } });
        return { departed: true, view: truckView(mustTruck(x.id), c) };
    }
```

Then add the actions (with the other `act(...)` calls, before `// ── entry points`):

```js
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
        const x = claimLoad(x0, T.DEPARTING, 'depart').Ld;
        const gone = {};
        d.plan.unplanned.forEach(u => { gone[u.ifId] = true; });
        data.updateLoad(x, { data: { depart: Object.assign({ truckNo: d.truckNo, day: c.now.dayIso, at: c.now.stamp, by: c.actor,
            approvedBy: d.plan.needsManager ? c.actor : '' }, inp), plan: d.plan.ops, alloc: d.plan.alloc, unplanned: d.plan.unplanned,
            bol: d.plan.bol, ifs: x.data.ifs.filter(f => !gone[f.ifId]), writes: {}, pending: null } });
        return finishDepart(mustTruck(x.id), c);
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
        return finishDepart(x, c);
    });
```

> `claimLoad`'s error text says "shipped/received". Change its message line to `throw userErr((Ld.number || 'This truck') + ' is already being processed by someone else. Refresh in a minute.');` (the old tests match on `/already being/`, so they still pass).

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass. If an old test asserted the exact `claimLoad` message, update its regex to `/already being/`.

- [ ] **Step 6: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js move_portal/test/preview_server.js
git commit -m "feat(v3): truck load-out + departure actions with manager gate and write modes"
```

---

### Task 8: Suitelet: unload and receipt approval

**Files:**
- Modify: `move_portal/sl_move_portal.js`
- Modify: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `classifyUnloadScan`, `planReceipts`, `runOps`, `resolveNew`, plus Task 7 helpers (`mustTruck`, `truckMap`, `allTrucks`, `truckSummary`, `pushStack`, `writeMode`).
- Produces:
  - Actions:

    | Action | Body | Returns |
    |---|---|---|
    | `unload_list` | — | `{trucks: [truckSummary]}`: departed/receiving trucks, plus received trucks that still have missing pallets |
    | `unload_get` | `{truckId}` | `{view: unloadView}` |
    | `unload_scan` | `{truckId, raw}` | the scan result + `{raw, tone, pallet, view}` |
    | `unload_other` | `{palletId}` | `{view}` of the pallet's own truck |
    | `unload_damaged` | `{palletId}` | `{ok}` |
    | `unload_undo` | `{truckId}` | `{view}` |
    | `unload_done` | `{truckId}` | `{view}` |
    | `receipt_preview` | `{truckId}`, manager only | `{perIf, missing, ops}` |
    | `receipt_approve` | `{truckId}`, manager only | `{perIf, missing, written, view}` |

  - `unloadView`: `{truck, perIf: [{ifNum, shipped, received, short}], expected: [pubPallet], recent: [pubPallet], counts: {in, of}, flagged: [pubPallet]}`
  - Pallet `data` gains `postedSeq` (set at approval), `flag: 'never_loaded'`, `flaggedAt`, `flaggedBy`.
  - Truck `data` gains `received` (cumulative), `recvSeq`, `rplan` (all receipt ops), `recvRequested: {by, at}|null`, `rstack: [{id, prev}]`.

- [ ] **Step 1: Write the failing tests** (append to `portal.test.js`)

```js
function departed(ctx, n, seal, ifId) {
    const { t, ps } = truckWith(ctx, n, ifId);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: seal || '5249340' }, true);
    return { t, ps };
}

test('unload: ok, dup, never loaded flagged, undo, done → manager receipt with missing pallets', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 42);
    const stray = printLabels(ctx, 1, 'Jstray', [L975]);
    assert.deepEqual(ctx.run('unload_list').trucks.map(x => x.label), ['Truck 1 · 10/14']);
    const r = ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.view.counts], ['ok', { in: 1, of: 42 }]);
    assert.equal(ctx.data.getLoad(t.id).status, 'receiving');
    assert.equal(ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false).result, 'dup');
    const nl = ctx.run('unload_scan', { truckId: t.id, raw: stray[0].code }, false);
    assert.equal(nl.result, 'never_loaded');
    assert.equal(ctx.data.getPallet(stray[0].id).data.flag, 'never_loaded');
    ps.slice(1, 40).forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('unload_scan', { truckId: t.id, raw: ps[40].code }, false);
    assert.equal(ctx.run('unload_undo', { truckId: t.id }, false).view.counts.in, 40);
    ctx.run('unload_done', { truckId: t.id }, false);
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }, false), /Managers only/);
    const pv = ctx.run('receipt_preview', { truckId: t.id });
    assert.deepEqual(pv.perIf, [{ ifId: '9001', ifNum: 'IF9001', shipped: 504, received: 480, short: 24 }]);
    const ap = ctx.run('receipt_approve', { truckId: t.id });
    assert.equal(ap.missing.length, 2);
    assert.deepEqual(ap.written, []);                                     // off mode: plan only
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.recvSeq, x.data.received], ['received', 1, { 9001: { 975: 480 } }]);
    assert.deepEqual(x.data.rplan.map(o => [o.op, o.lines[975], o.seal]), [['receipt', 480, '5249340']]);
    assert.equal(ctx.data.getPallet(ps[41].id).status, 'missing');
    assert.equal(ctx.data.getPallet(ps[0].id).data.postedSeq, 1);
});

test('unload: late arrival → second receipt for only the new pallets; pallet from another truck', () => {
    const ctx = setup();
    const a = departed(ctx, 42, 'S1');
    a.ps.slice(0, 41).forEach(p => ctx.run('unload_scan', { truckId: a.t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: a.t.id });
    const late = ctx.run('unload_scan', { truckId: a.t.id, raw: a.ps[41].code }, false);
    assert.equal(late.result, 'late');
    const ap = ctx.run('receipt_approve', { truckId: a.t.id });
    assert.deepEqual(ctx.data.getLoad(a.t.id).data.rplan.map(o => [o.lines[975], o.seq]), [[492, 1], [12, 2]]);
    assert.deepEqual(ap.missing, []);
    // a pallet of truck A scanned while unloading truck B
    const ctx2 = setup();
    const A = departed(ctx2, 1, 'S2');
    const B = departed(ctx2, 1, 'S3', '9002');
    const o = ctx2.run('unload_scan', { truckId: B.t.id, raw: A.ps[0].code }, false);
    assert.equal(o.result, 'other_truck');
    assert.equal(ctx2.run('unload_other', { palletId: A.ps[0].id }, false).view.counts.in, 1);
});

test('receipt_approve in on mode writes one receipt per IF with the add-on IF id resolved', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const ps = printLabels(ctx, 2, 'Jon', [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }]).concat(printLabels(ctx, 42, 'Jon2', [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'S9' }, true);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const rc = ctx.tx._t.ops.filter(o => o.op === 'receipt');
    assert.deepEqual(rc.map(o => [o.ifId, o.toId, JSON.stringify(o.lines)]), [['9001', '500', '{"975":504}'], ['901', '700', '{"11":240}']]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL with `Unknown action: unload_list`.

- [ ] **Step 3: Implement** (after the Task 7 actions)

```js
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
    function receiveOn(x, p, prev, c) {
        data.updatePallet(p, { status: VP.RECEIVED, data: { receivedAt: c.now.stamp, receivedBy: c.actor } });
        pushStack(x, { id: String(p.id), prev: prev }, 'rstack');
        if (x.status === T.DEPARTED) data.updateLoad(mustTruck(x.id), { status: T.RECEIVING });
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
        data.updateLoad(x, { data: { rstack: st } });
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
        const rp0 = receiptPlan(x0);
        if (!rp0.ops.length) throw userErr('Nothing new scanned in on this truck');
        const prevStatus = x0.status === T.DEPARTED ? T.RECEIVING : x0.status;
        const x = claimLoad(x0, T.APPROVING, 'receive').Ld;
        const rp = receiptPlan(x), seq = (Number(x.data.recvSeq) || 0) + 1;
        const writes = Object.assign({}, x.data.writes);
        data.updateLoad(x, { data: { rplan: (x.data.rplan || []).concat(rp.ops), recvApprovedBy: c.actor, recvApprovedAt: c.now.stamp } });
        let res;
        try {
            res = verify.runOps(rp.ops, writeMode(c), op => tx.apply(verify.resolveNew(op, writes)), writes,
                (k, id) => { writes[k] = id; data.updateLoad(mustTruck(x.id), { data: { writes: writes } }); });
        } catch (e) {
            data.updateLoad(mustTruck(x.id), { status: prevStatus, data: { error: e.message || String(e), writes: writes } });
            throw userErr('Receipt write failed: ' + (e.message || e) + '. Fix it and approve again; finished receipts are not repeated.');
        }
        data.palletsByLoad(x.id, [VP.RECEIVED]).filter(p => !p.data.postedSeq).forEach(p => data.updatePallet(p, { data: { postedSeq: seq } }));
        data.palletsByLoad(x.id, [VP.IN_TRANSIT]).forEach(p => data.updatePallet(p, { status: VP.MISSING }));
        data.updateLoad(mustTruck(x.id), { status: T.RECEIVED, data: { received: rp.cumulative, recvSeq: seq, recvRequested: null, error: '', writes: writes } });
        return { perIf: rp.perIf, missing: rp.missing, written: res.written, view: unloadView(mustTruck(x.id), c) };
    });
```

> The second-receipt retry is safe because the op key includes `seq`. A failed approval resets the status and doesn't bump `recvSeq`, so a re-approve reuses the same `seq` and skips keys already in `writes`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(v3): unload scanning, never-loaded flag, manager receipt approval per IF"
```

---

### Task 9: Suitelet: approvals list and shadow report

**Files:**
- Modify: `move_portal/sl_move_portal.js`
- Modify: `move_portal/test/portal.test.js`

**Interfaces:**
- Produces:

  | Action | Who | Returns |
  |---|---|---|
  | `approvals` | manager | `{departures: [{truck, pending, plan|null, error|null}], retries: [truckSummary], receipts: [{truck, perIf, missing, lateOnly}]}` |
  | `report` | manager | `{rows: shadowRows, days: [{day, trucks, pallets, pieces, diffs}], pulledAt, writeMode}` |

- [ ] **Step 1: Write the failing tests** (append)

```js
test('approvals lists pending departures, failed departures and receipts waiting', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'P1' }, false);
    const d = departed(ctx, 1, 'P2', '9002');
    ctx.run('unload_scan', { truckId: d.t.id, raw: d.ps[0].code }, false);
    ctx.run('unload_done', { truckId: d.t.id }, false);
    const r = ctx.run('approvals');
    assert.deepEqual(r.departures.map(x => [x.truck.id, x.pending.seal, x.plan.corrections]), [[t.id, 'P1', 1]]);
    assert.deepEqual(r.receipts.map(x => [x.truck.id, x.perIf[0].received]), [[d.t.id, 12]]);
    assert.throws(() => ctx.run('approvals', {}, false), /Managers only/);
});

test('report compares plan with the snapshot', () => {
    const ctx = setup();
    departed(ctx, 42, '5249300');
    const r = ctx.run('report');
    assert.ok(r.rows.some(x => x.ifNum === 'IF9001' && x.check === 'IF qty YSN100' && x.ok === null));   // IF9001 is still B in the snapshot
    assert.deepEqual([r.days[0].trucks, r.days[0].pallets, r.writeMode], [1, 42, 'off']);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL with `Unknown action: approvals`.

- [ ] **Step 3: Implement**

```js
    act('approvals', true, (a, c) => {
        const trucks = allTrucks();
        return {
            departures: trucks.filter(x => x.status === T.LOADING && x.data.pending).map(x => {
                let plan = null, error = null;
                try { plan = pubPlan(departPlan(x, x.data.pending, c).plan); } catch (e) { error = e.message; }
                return { truck: truckSummary(x), pending: x.data.pending, plan: plan, error: error };
            }),
            retries: trucks.filter(x => x.status === T.DEPARTING && x.data.error).map(truckSummary),
            receipts: trucks.filter(x => UNLOADABLE.indexOf(x.status) !== -1).map(x => {
                const unposted = data.palletsByLoad(x.id, [VP.RECEIVED]).filter(p => !p.data.postedSeq).length;
                if (!unposted || (x.status !== T.RECEIVED && !x.data.recvRequested)) return null;
                const rp = receiptPlan(x);
                return { truck: truckSummary(x), perIf: rp.perIf, missing: rp.missing, lateOnly: x.status === T.RECEIVED };
            }).filter(Boolean)
        };
    });

    act('report', true, (a, c) => {
        const trucks = allTrucks().filter(x => x.data.depart);
        const ids = {};
        trucks.forEach(x => (x.data.alloc || []).forEach(al => Object.keys(al.lines).forEach(k => { ids[k] = 1; })));
        const rows = verify.shadowRows({ trucks: trucks, ifInfo: ns.ifInfo(), ifsByTo: ns.ifsByTo(), receipts: ns.receiptsByIf(), sku: skuNames(Object.keys(ids)) });
        const days = {};
        trucks.forEach(x => {
            const dd = days[x.data.depart.day] = days[x.data.depart.day] || { day: x.data.depart.day, trucks: 0, pallets: 0, pieces: 0, diffs: 0 };
            const ps = data.palletsByLoad(x.id, [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
            dd.trucks++; dd.pallets += ps.length; dd.pieces += ps.reduce((s, p) => s + p.pieces, 0);
            const label = truckLabel(x);
            dd.diffs += rows.filter(r => r.truck === label && r.ok === false).length;
        });
        return { rows: rows, days: Object.values(days).sort((p, q) => (p.day < q.day ? 1 : -1)), pulledAt: ns.pulledAt(), writeMode: writeMode(c) };
    });
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(v3): manager approvals list + shadow report action"
```

---

### Task 10: Remove the old load/ship/receive/catch-up code

**Files:**
- Modify: `move_portal/sl_move_portal.js`, `move_portal/move_core.js`, `move_portal/move_tx.js`, `move_portal/test/fake_tx.js`, `move_portal/test/fake_data.js`, `move_portal/test/core.test.js`, `move_portal/test/portal.test.js`

**Interfaces:**
- Produces:
  - `core.PALLET = {LABELED:'labeled', LOADED:'loaded', IN_TRANSIT:'in_transit', RECEIVED:'received', MISSING:'missing', VOID:'void'}`, the same values as `verify.VP`.
  - `move_tx` exports only `apply`.
  - The dashboard counts in-transit pallets as `in_transit` + `missing`.

- [ ] **Step 1: Delete the old actions in `sl_move_portal.js`.** Remove these `act(...)` blocks completely:
  `load_list, load_create, load_get, scan_load, load_move_here, pallet_edit, pallet_remove, load_ready, load_sendback, ship_list, load_approve, inbound_list, recv_get, scan_recv, recv_other, recv_damaged, recv_undo, recv_ready, toreceive_list, recv_approve, catchup_list, catchup_approve, catchup_reject`.

  Then remove the helpers only they used. First check each with Grep (`pubLoad`, `countsFromPallets`, `mustLoad`, `stale`, `ensureClaim`, `loadSheetModel`, and any other helper defined between the old actions). A helper still used elsewhere (e.g. `pubPallet`, `mustPallet`, `claimLoad`) stays.

  In `pdf()`, delete the `q.type === 'loadsheet'` branch.

  Delete `const P = core.PALLET, L = core.LOAD;`, replace it with `const P = core.PALLET;`, and change every remaining `L.` reference (there should be none after the deletes; Grep `\bL\.` to confirm).

- [ ] **Step 2: Update the dashboard action** in `sl_move_portal.js`:

```js
    act('dashboard', true, (a, c) => {
        const sm = stockModel(c);
        const m = tracker(c, sm.est);
        const moved = data.movedByDay();
        const end = c.now.dayIso < c.S.target ? c.now.dayIso : c.S.target;
        const days = core.moveDays(c.S.start, end, c.S.skip || []).map(d => ({ day: d, n: moved[d] || 0 }));
        const trucks = allTrucks().slice(0, 15);
        const exc = {
            missing: data.countPallets({ status: [P.MISSING] }),
            neverLoaded: data.findPalletsWhere({ status: [P.LABELED, P.LOADED] }).filter(p => p.data.flag === 'never_loaded').length,
            damaged: data.countPallets({ damaged: true }),
            edited: data.countPallets({ edited: true, status: [P.IN_TRANSIT, P.RECEIVED, P.MISSING] }),
            stale: data.countPallets({ status: [P.LABELED], printedBefore: core.isoAddDays(c.now.dayIso, -(Number(c.S.staleDays) || 5)) }),
            noConfig: sm.est.unknownItems.length
        };
        const skuOf = k => (sm.stock[k] ? sm.stock[k].sku : k);
        const bySku = Object.keys(sm.est.byItem).map(k => ({ sku: skuOf(k), palletsLeft: sm.est.byItem[k] }))
            .sort((x, y) => y.palletsLeft - x.palletsLeft).slice(0, 20);
        return {
            m: Object.assign({}, m, { neededPerDay: isFinite(m.neededPerDay) ? m.neededPerDay : null }),
            labeled: data.countPallets({ status: [P.LABELED, P.LOADED] }),
            inTransit: data.countPallets({ status: [P.IN_TRANSIT, P.MISSING] }),
            received: data.countPallets({ status: [P.RECEIVED] }),
            target: c.S.target, days: days, trucks: trucks.map(truckSummary), exc: exc, bySku: bySku,
            noConfigSkus: sm.est.unknownItems.map(skuOf)
        };
    });
```

  `tracker()` and `movedByDay()` need no change: they count pallets by `shippedDay`, which `finishDepart` sets. `pubLoad` (it uses `P.SHIPPED`) goes away with the old actions; Grep `P\.SHIPPED` afterwards and expect no hits.

- [ ] **Step 3: Trim `move_core.js`**:
  - Set `PALLET` as above.
  - Delete `LOAD`, `loadScanRule`, `receiveScanRule`, `TONE`, `toneFor`, `aggregate`, `shortages`, `nextLoadNumber`, `catchupNumber` and `txToken`, and remove them from the returned object. Grep first: if `sl_move_portal.js` still uses `core.aggregate` or `core.toneFor`, switch that use to `verify.sumLines` / `verify.toneFor`.
  - Update the header comment's `Spec:` line to the 2026-10-01 spec.

- [ ] **Step 4: Trim `move_tx.js` and the fakes**:
  - `move_tx.js`: delete `findByToken`, `locationSubsidiary`, `createTransferOrder`, `committedShortfalls`, `fulfillTransferOrder` and `receiveTransferOrder`. **Keep `setLines`**, because `createIf` and `createReceipt` use it. The return becomes `return { apply };`.
  - `fake_tx.js`: keep only `_t` and `apply`.
  - `fake_data.js`: remove `arrivedOn` and `catchup` from `PKEYS`, `createPallet`'s defaults and `matchQ`, but only if Grep shows no remaining caller. `move_data.js` keeps its NetSuite field map unchanged: the record fields still exist, they're just unused.

- [ ] **Step 5: Trim the tests**:
  - `core.test.js`: delete the tests for the removed functions (scan rules, `aggregate`/`shortages`, numbering, `txToken`) and any `const ... L = core.LOAD` usage.
  - `portal.test.js`: delete every test that calls a removed action (Grep `'load_create'`, `'scan_load'`, `'load_approve'`, `'recv_`, `'catchup_'`, `'ship_list'`, `'toreceive_list'`, `'inbound_list'`). Keep the print, config, request, void/reprint, plan, dashboard and all v3 tests. If the dashboard test asserts `loads`, change it to `trucks`.

- [ ] **Step 6: Run the full suite**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass, 0 failures. Note the new total for the CLAUDE.md update in Task 14.

Run: `grep -n "SHIPPED\|ARRIVED_UNSHIPPED\|catchup\|LOAD\." move_portal/*.js`
Expected: no hits in `sl_move_portal.js` or `move_core.js`. `move_ui.js` is cleaned in Task 11; the field-map names in `move_data.js` may stay.

- [ ] **Step 7: Commit**

```bash
git add -A move_portal
git commit -m "refactor(v3): remove old load/ship/receive/catch-up flow; pallet statuses now v3"
```

---

### Task 11: UI: Load out screen (trucks, scanning, departure)

**Files:**
- Modify: `move_portal/move_ui.js`
- Modify: `move_portal/test/ui.test.js`

**Interfaces:**
- Consumes the actions from Task 7.
- Produces:
  - Client tabs: `out = [['req','Request label'], ['trucks','Load out'], ['void','Void']]`, plus for managers `[['approve','Approvals'], ['queue','Print queue'], ['plan','Print plan'], ['sku','Print a SKU'], ['configs','SKU configs'], ['reprint','Reprint'], ['report','Report'], ['dash','Dashboard']]`.
  - State `S.truckId` replaces `S.loadId`.
- Reference markup: `docs/mockups/2026-10-01 move portal v3 verification mockup.html` (Load out panel). Keep the existing CSS classes: `card`, `flash f-*`, `pill p-*`, `btn pri|go|ghost|sm`, `inp`, `totals`, `plist`, `it`, `ac`.

- [ ] **Step 1: Write the failing UI test** (append to `ui.test.js`)

```js
test('v3 screens exist and old ones are gone', () => {
    const src = ui._clientMain.toString();
    ['SCREENS.trucks', "api('truck_scan'", "api('depart_confirm'", "api('truck_planned'"].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
    ['SCREENS.ship', 'SCREENS.load ', "api('scan_load'"].forEach(s => assert.equal(src.indexOf(s), -1, 'still has ' + s));
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL with `missing SCREENS.trucks`.

- [ ] **Step 3: Replace the Outbound load section in `move_ui.js`**:
  - Delete the whole `// ── Outbound: load` section: `SCREENS.load`, `loadList`, `ACT.newload`, `ACT.openload`, `ACT.backload`, `loadDetail`, `paintLoad`, `loadResultHtml`, `doLoadScan`, `findPallet`, `ACT.pedit`/`premove`/`movehere`/`loadready`, and any other `ACT` handler in that section.
  - Delete `SCREENS.ship`, `shipCard` and their `ACT` handlers.
  - Replace the `TABS` const with the tabs above.
  - In `ACT.tab`, set `S.truckId = null; S.unloadId = null;` instead of the old ids.
  - Update `PILL`:

```js
        const PILL = { loading: ['Loading', 'p-blue'], departing: ['Departing…', 'p-amber'], departed: ['In transit', 'p-blue'],
            receiving: ['Unloading', 'p-blue'], approving: ['Receiving…', 'p-amber'], received: ['Received', 'p-green'], waiting: ['⏳ Waiting for manager', 'p-amber'] };
```

Then add the Load out section:

```js
        // ── Outbound: load out (v3) ──────────────────────────────────────
        SCREENS.trucks = () => (S.truckId ? truckDetail() : truckList());
        function ifRow(f, pick) {
            return '<label class="it"><div>' + (pick ? '<input type="checkbox" data-if="' + esc(f.ifId) + '"> ' : '') + '<b>' + esc(f.ifNum) + '</b> · ' + esc(f.toNum) +
                ' · ' + esc(f.lines.map(l => l.sku + ' ' + num(l.qty)).join(', ')) + '</div><div class="muted">' + (f.estPallets ? '≈ ' + f.estPallets + ' pallets' : '') + '</div></label>';
        }
        async function truckList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('truck_planned');
            if (!r.ok) { main(errBox(r.error)); return; }
            main((r.open.length ? '<h3>Trucks loading</h3>' + r.open.map(t => '<div class="card bl" data-act="opentruck" data-id="' + t.id + '"><h4>' + esc(t.label) + ' ' +
                statusPill(t.pending ? 'waiting' : t.status) + '</h4><div class="muted">' + t.pallets + ' pallets</div></div>').join('') : '') +
                '<h3>Planned trucks · Picked/Packed IFs</h3><div class="card plist">' + (r.planned.map(f => ifRow(f, true)).join('') || '<div class="muted">No planned IFs. The office creates them in NetSuite.</div>') + '</div>' +
                '<div id="tmsg"></div><button class="btn pri" data-act="starttruck">Start truck with selected IFs</button>' +
                (r.pulledAt ? '<div class="muted sm">Data from ' + esc(r.pulledAt) + '</div>' : ''));
        }
        ACT.starttruck = async el => {
            if (needWho()) return;
            const ids = Array.from(document.querySelectorAll('[data-if]:checked')).map(x => x.dataset.if);
            if (!ids.length) { $('tmsg').innerHTML = errBox('Tick at least one IF'); return; }
            busy(el, true);
            const r = await api('truck_start', { ifIds: ids });
            busy(el, false);
            if (!r.ok) { $('tmsg').innerHTML = errBox(r.error); return; }
            S.truckId = r.view.truck.id;
            truckDetail(r);
        };
        ACT.opentruck = el => { S.truckId = el.dataset.id; truckDetail(); };
        ACT.backtruck = () => { S.truckId = null; truckList(); };
        async function truckDetail(pre) {
            const r = pre || await api('truck_get', { truckId: S.truckId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backtruck">← All trucks</button><div class="card bl"><h4 id="thead"></h4><div class="muted" id="tsub"></div></div>' +
                '<div id="tscan"></div><div id="scanres"></div><div class="card" id="tlines"></div><div class="card plist" id="plist"></div><div id="tfoot"></div>');
            paintTruck(r.view, true);
        }
        function paintTruck(v, first) {
            S.tv = v;
            const t = v.truck, open = t.status === 'loading' && !t.pending;
            $('thead').innerHTML = esc(t.label) + ' ' + statusPill(t.pending ? 'waiting' : t.status);
            $('tsub').textContent = t.depart ? [t.depart.carrier, 'Trailer ' + t.depart.trailer, 'Seal ' + t.depart.seal].join(' · ') : v.totals.pallets + ' pallets · ' + num(v.totals.pieces) + ' pcs';
            if (first) {
                $('tscan').innerHTML = open ? scanBox('scan') : '';
                if (open) wireScan('scan', doTruckScan);
            }
            $('tlines').innerHTML = '<table class="tbl"><tr><th>IF</th><th>SKU</th><th>Scanned / expected</th></tr>' +
                v.lines.map(l => '<tr class="' + (l.scanned === l.expected ? 'okrow' : l.scanned > l.expected ? 'warnrow' : '') + '"><td>' + esc(l.ifNum) + '</td><td>' + esc(l.sku) +
                    '</td><td><b>' + num(l.scanned) + '</b> / ' + num(l.expected) + (l.estPallets ? ' <span class="muted">(' + l.estPallets + ' plt)</span>' : '') + '</td></tr>').join('') +
                v.extras.map(x => '<tr class="warnrow"><td>add-on</td><td>' + esc(x.sku) + '</td><td><b>' + num(x.scanned) + '</b> extra</td></tr>').join('') + '</table>';
            $('plist').innerHTML = v.pallets.slice().reverse().map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + '</div>' +
                (open ? '<div class="ac"><button data-act="tremove" data-id="' + p.id + '">✕</button></div>' : '') + '</div>').join('') || '<div class="muted">No pallets yet</div>';
            $('tfoot').innerHTML = t.pending ? flash('amber', '⏳ Waiting for manager approval', esc('Trailer ' + t.pending.trailer + ' · Seal ' + t.pending.seal), 'Requested by ' + esc(t.pending.by), '<button data-act="dcancel">Cancel request, keep loading</button>')
                : open ? '<button class="btn ghost sm" data-act="tundo">↶ Undo last scan</button><div class="card"><h4>Departure</h4>' +
                    '<select class="inp" id="d_trailer"><option value="">Trailer #</option>' + v.trailers.map(x => '<option>' + esc(x) + '</option>').join('') + '<option value="__other">Other…</option></select>' +
                    '<input class="inp" id="d_trailer2" placeholder="Other trailer #" style="display:none"><input class="inp" id="d_seal" placeholder="Seal #">' +
                    '<input class="inp" id="d_carrier" value="' + esc(v.carrier) + '"><div id="dmsg"></div><button class="btn pri" data-act="dpreview">Review departure</button></div>'
                : t.depart ? flash('green', '🚚 ' + esc(t.label) + ' left', esc('Seal ' + t.depart.seal), t.bol && t.bol.changed ? '<b>Reprint BOL REV 2</b> · BOL # ' + esc(t.bol.number) + ' · IFs ' + esc(t.bol.ifNums.join(', ')) : 'BOL unchanged') : '';
            const sel = $('d_trailer');
            if (sel) sel.onchange = () => { $('d_trailer2').style.display = sel.value === '__other' ? '' : 'none'; };
        }
        function departBody() {
            const sel = $('d_trailer').value;
            return { truckId: S.truckId, trailer: sel === '__other' ? $('d_trailer2').value : sel, seal: $('d_seal').value, carrier: $('d_carrier').value };
        }
        function planHtml(p) {
            const line = o => o.op === 'if_qty' ? (o.to < o.from ? '⬇ Lower ' : '⬆ Raise ') + esc(o.ifNum + ' ' + o.sku + ' ' + num(o.from) + ' → ' + num(o.to))
                : o.op === 'if_create' ? '➕ Add-on IF from ' + esc(o.toNum + ': ' + o.skus.join(', ')) : '🔖 Stamp ' + esc(o.ifNum) + ' · Shipped';
            return '<div class="card"><h4>Plan</h4>' + p.ops.map(o => '<div>' + line(o) + '</div>').join('') +
                p.unplanned.map(u => '<div>↩ ' + esc(u.ifNum) + ' has nothing scanned: back to planned</div>').join('') +
                (p.bol.changed ? '<div><b>BOL REV 2</b> · BOL # ' + esc(p.bol.number) + ' · IFs ' + esc(p.bol.ifNums.join(', ')) + '</div>' : '') + '</div>';
        }
        ACT.dpreview = async el => {
            if (needWho()) return;
            busy(el, true);
            const r = await api('depart_preview', departBody());
            busy(el, false);
            if (!r.ok) { $('dmsg').innerHTML = errBox(r.error); return; }
            $('dmsg').innerHTML = flash(r.plan.needsManager ? 'amber' : 'green', 'Truck ' + r.truckNo + ' of the day', r.plan.needsManager ? r.plan.corrections + ' correction(s): a manager must approve' : 'Matches the IFs') +
                planHtml(r.plan) + '<button class="btn go" data-act="dconfirm">' + (r.plan.needsManager && !isMgr ? 'Send to manager' : 'Confirm departure') + '</button>';
        };
        ACT.dconfirm = async el => {
            busy(el, true);
            const r = await api('depart_confirm', departBody());
            busy(el, false);
            if (!r.ok) { tone('bad'); $('dmsg').innerHTML = errBox(r.error); return; }
            tone('ok');
            paintTruck(r.view, true);
        };
        ACT.dcancel = async () => { const r = await api('depart_cancel', { truckId: S.truckId }); if (r.ok) paintTruck(r.view, true); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tundo = async () => { const r = await api('truck_undo', { truckId: S.truckId }); if (r.ok) paintTruck(r.view, false); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tremove = async el => { const r = await api('truck_remove', { truckId: S.truckId, palletId: el.dataset.id }); if (r.ok) paintTruck(r.view, false); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tmovehere = async el => { const r = await api('truck_move_here', { truckId: S.truckId, palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('green', '✅ Moved here') : errBox(r.error); if (r.ok) paintTruck(r.view, false); };
        function truckResultHtml(r) {
            const p = r.pallet, line = p ? esc(p.code + ' · ' + p.summary) : '';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), esc(p.pieces + ' pcs · ' + p.code), r.view.totals.pallets + ' pallets on the truck');
                case 'over': return flash('amber', '🟡 Over the IF qty', line, 'The IF will be raised at departure (manager OK).');
                case 'addon': return flash('amber', '🟡 Add-on IF', line, 'Not on this truck\'s IFs. An add-on IF from ' + esc(r.addonTo ? r.addonTo.toNum : 'an office TO') + ' will be made (manager OK).');
                case 'no_to': return flash('red', '❌ No open TO for ' + esc(r.sku), line, 'Set it aside and call the office.');
                case 'dup': return flash('amber', '🟡 Already on this truck', line, 'No change.');
                case 'other_truck': return flash('amber', '🟡 On ' + esc(r.otherLabel), line, '', '<button data-act="tmovehere" data-id="' + p.id + '">Move here</button><button data-act="clearres">Leave it</button>');
                case 'locked': return flash('red', '❌ On ' + esc(r.otherLabel) + ', departing', line, 'Check with the supervisor.');
                case 'shipped': return flash('red', '❌ Already left', line, 'This pallet is on a truck that departed.');
                case 'void': return flash('red', '❌ Label cancelled', line, 'Request a new label.');
                default: return flash('red', '❌ Unknown label', esc('"' + String(r.raw).replace(/\t/g, ' ⇥ ') + '"'), 'Not a move label. Maybe a product barcode?');
            }
        }
        async function doTruckScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('truck_scan', { truckId: S.truckId, raw: v });
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            $('scanres').innerHTML = truckResultHtml(r);
            if (r.view) paintTruck(r.view, false);
        }
```

Add to the `CSS` string: `.tbl{width:100%;border-collapse:collapse}.tbl td,.tbl th{padding:6px;border-bottom:1px solid #e5e7eb;text-align:left}.okrow{background:#ecfdf5}.warnrow{background:#fffbeb}`.

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass, including the existing `new Function` parse test (it proves the client script still parses).

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(v3): Load out screen: planned IFs, scan vs expected, departure + BOL REV 2"
```

---

### Task 12: UI: Unload, Approvals, Report screens; dashboard trucks

**Files:**
- Modify: `move_portal/move_ui.js`
- Modify: `move_portal/test/ui.test.js`

**Interfaces:**
- Consumes the actions from Tasks 8–10.
- Produces: `in = [['unload','Unload']]`, plus for managers `[['approve','Approvals'], ['report','Report'], ['dash','Dashboard']]`, with state `S.unloadId`.

- [ ] **Step 1: Extend the UI test**

```js
test('v3 inbound/approval/report screens exist', () => {
    const src = ui._clientMain.toString();
    ['SCREENS.unload', 'SCREENS.approve', 'SCREENS.report', "api('unload_scan'", "api('receipt_approve'", "api('report'"].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
    ['SCREENS.recv ', 'SCREENS.toreceive', "api('scan_recv'", 'SCREENS.catchup'].forEach(s => assert.equal(src.indexOf(s), -1, 'still has ' + s));
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL with `missing SCREENS.unload`.

- [ ] **Step 3: Replace the inbound section.** Delete `SCREENS.recv`, `recvList`, `recvDetail`, `paintRecv`, `recvResultHtml`, `doRecvScan`, `SCREENS.toreceive` and `SCREENS.catchup`, with their `ACT` handlers. Update the `in` tabs. `refocusScan` already checks `$('rscan')`. Then add:

```js
        // ── Inbound: unload (v3) ─────────────────────────────────────────
        SCREENS.unload = () => (S.unloadId ? unloadDetail() : unloadList());
        async function unloadList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('unload_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main(r.trucks.map(t => '<div class="card bl" data-act="openunload" data-id="' + t.id + '"><h4>' + esc(t.label) + ' ' + statusPill(t.status) + '</h4><div class="muted">' +
                esc(t.depart ? 'Seal ' + t.depart.seal + ' · Trailer ' + t.depart.trailer : '') + ' · ' + t.received + ' of ' + t.pallets + ' in' + (t.missing ? ' · ' + t.missing + ' missing' : '') + '</div></div>').join('') ||
                '<div class="muted">No trucks in transit</div>');
        }
        ACT.openunload = el => { S.unloadId = el.dataset.id; unloadDetail(); };
        ACT.backunload = () => { S.unloadId = null; unloadList(); };
        async function unloadDetail() {
            const r = await api('unload_get', { truckId: S.unloadId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backunload">← All trucks</button><div class="card bl"><h4 id="uhead"></h4><div class="muted" id="usub"></div></div>' +
                scanBox('rscan') + '<div id="scanres"></div><div class="card" id="uifs"></div><div class="card plist" id="uexp"></div><div id="ufoot"></div>');
            wireScan('rscan', doUnloadScan);
            paintUnload(r.view);
        }
        function paintUnload(v) {
            const t = v.truck;
            $('uhead').innerHTML = esc(t.label) + ' ' + statusPill(t.status);
            $('usub').textContent = (t.depart ? 'Seal ' + t.depart.seal + ' · Trailer ' + t.depart.trailer + ' · ' : '') + v.counts.in + ' of ' + v.counts.of + ' pallets in';
            $('uifs').innerHTML = '<table class="tbl"><tr><th>IF</th><th>Received / shipped</th></tr>' + v.perIf.map(f => '<tr class="' + (f.short ? '' : 'okrow') + '"><td>' + esc(f.ifNum) +
                '</td><td><b>' + num(f.received) + '</b> / ' + num(f.shipped) + '</td></tr>').join('') + '</table>' +
                (v.flagged.length ? flash('amber', '🟠 ' + v.flagged.length + ' never-loaded pallet(s) flagged', esc(v.flagged.map(p => p.code).join(', ')), 'The office will sort these out.') : '');
            $('uexp').innerHTML = '<h4>Still expected</h4>' + (v.expected.map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + '</div></div>').join('') || '<div class="muted">All in ✅</div>');
            $('ufoot').innerHTML = '<button class="btn ghost sm" data-act="uundo">↶ Undo last scan</button>' + (S.lastIn ? '<button class="btn ghost sm" data-act="udamaged" data-id="' + S.lastIn + '">Mark last pallet damaged</button>' : '') +
                '<button class="btn go" data-act="udone">Unloading done: send to manager</button>';
        }
        function unloadResultHtml(r) {
            const p = r.pallet, line = p ? esc(p.code + ' · ' + p.summary) : '';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), line, r.view.counts.in + ' of ' + r.view.counts.of + ' in');
                case 'late': return flash('green', '✅ Late arrival', line, 'It goes on a second receipt for this IF (manager OK).');
                case 'dup': return flash('amber', '🟡 Already scanned in', line, 'No change.');
                case 'dup_other': return flash('amber', '🟡 Already received on ' + esc(r.otherLabel), line, '');
                case 'other_truck': return flash('amber', '🟡 Belongs to ' + esc(r.otherLabel), line, '', '<button data-act="uother" data-id="' + p.id + '">Receive it there</button><button data-act="clearres">Set aside</button>');
                case 'never_loaded': return flash('amber', '🟠 Never loaded on a truck', line, 'Flagged for the office. Set it aside.');
                case 'locked': return flash('red', '❌ Its truck is still departing', line, 'Wait a minute and scan again.');
                case 'void': return flash('red', '❌ Label cancelled', line, 'Set aside and call the supervisor.');
                default: return flash('red', '❌ Unknown label', esc('"' + String(r.raw).replace(/\t/g, ' ⇥ ') + '"'), '');
            }
        }
        async function doUnloadScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('unload_scan', { truckId: S.unloadId, raw: v });
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            if (r.result === 'ok' || r.result === 'late') S.lastIn = r.pallet.id;
            $('scanres').innerHTML = unloadResultHtml(r);
            if (r.view) paintUnload(r.view);
        }
        ACT.uother = async el => { const r = await api('unload_other', { palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('green', '✅ Received on its own truck') : errBox(r.error); };
        ACT.udamaged = async el => { const r = await api('unload_damaged', { palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('amber', 'Marked damaged') : errBox(r.error); };
        ACT.uundo = async () => { const r = await api('unload_undo', { truckId: S.unloadId }); if (r.ok) paintUnload(r.view); else $('scanres').innerHTML = errBox(r.error); };
        ACT.udone = async () => { const r = await api('unload_done', { truckId: S.unloadId }); $('scanres').innerHTML = r.ok ? flash('green', 'Sent to the manager for receipt approval') : errBox(r.error); };

        // ── Manager: approvals (v3) ──────────────────────────────────────
        SCREENS.approve = async (msg) => {
            main((msg || '') + '<div class="muted">Loading…</div>');
            const r = await api('approvals');
            if (!r.ok) { main(errBox(r.error)); return; }
            const dep = r.departures.map(d => '<div class="card"><h4>🚚 ' + esc(d.truck.label) + ' · departure</h4><div class="muted">' + esc('Trailer ' + d.pending.trailer + ' · Seal ' + d.pending.seal + ' · by ' + d.pending.by) + '</div>' +
                (d.plan ? planHtml(d.plan) + '<button class="btn go" data-act="apdepart" data-id="' + d.truck.id + '">Approve departure</button>' : errBox(d.error)) + '</div>').join('');
            const ret = r.retries.map(t => '<div class="card"><h4>⚠ ' + esc(t.label) + '</h4>' + errBox(t.error) + '<button class="btn pri" data-act="apretry" data-id="' + t.id + '">Retry</button></div>').join('');
            const rec = r.receipts.map(x => '<div class="card"><h4>📥 ' + esc(x.truck.label) + (x.lateOnly ? ' · late arrivals' : ' · receipt') + '</h4><table class="tbl"><tr><th>IF</th><th>Received / shipped</th></tr>' +
                x.perIf.map(f => '<tr class="' + (f.short ? 'warnrow' : 'okrow') + '"><td>' + esc(f.ifNum) + '</td><td>' + num(f.received) + ' / ' + num(f.shipped) + '</td></tr>').join('') + '</table>' +
                (x.missing.length ? '<div class="muted">Missing: ' + esc(x.missing.join(', ')) + '</div>' : '') +
                '<button class="btn go" data-act="aprecv" data-id="' + x.truck.id + '">' + (x.missing.length ? 'Approve short receipt' : 'Approve receipt') + '</button></div>').join('');
            main((msg || '') + (dep + ret + rec || '<div class="muted">Nothing waiting for approval</div>'));
        };
        ACT.apdepart = async el => { busy(el, true); const r = await api('depart_confirm', { truckId: el.dataset.id }); tone(r.ok ? 'ok' : 'bad'); SCREENS.approve(r.ok ? flash('green', '✅ Departed') : errBox(r.error)); };
        ACT.apretry = async el => { busy(el, true); const r = await api('depart_retry', { truckId: el.dataset.id }); tone(r.ok ? 'ok' : 'bad'); SCREENS.approve(r.ok ? flash('green', '✅ Departed') : errBox(r.error)); };
        ACT.aprecv = async el => {
            busy(el, true);
            const r = await api('receipt_approve', { truckId: el.dataset.id });
            tone(r.ok ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? flash('green', '✅ Receipt approved', r.written.length ? r.written.length + ' written to NetSuite' : 'Plan saved (no NetSuite write in this mode)', r.missing.length ? r.missing.length + ' pallets stay in transit' : '') : errBox(r.error));
        };

        // ── Manager: shadow report (v3) ──────────────────────────────────
        SCREENS.report = async () => {
            main('<div class="muted">Loading…</div>');
            const r = await api('report');
            if (!r.ok) { main(errBox(r.error)); return; }
            const mark = ok => (ok === true ? '✅' : ok === false ? '❌' : '⏳');
            main('<div class="muted">Write mode <b>' + esc(r.writeMode) + '</b>' + (r.pulledAt ? ' · NetSuite data from ' + esc(r.pulledAt) : '') + '</div>' +
                '<div class="card"><table class="tbl"><tr><th>Day</th><th>Trucks</th><th>Pallets</th><th>Pcs</th><th>Diffs</th></tr>' +
                r.days.map(d => '<tr><td>' + esc(d.day) + '</td><td>' + d.trucks + '</td><td>' + d.pallets + '</td><td>' + num(d.pieces) + '</td><td>' + (d.diffs ? '❌ ' + d.diffs : '✅') + '</td></tr>').join('') + '</table></div>' +
                '<div class="card"><table class="tbl"><tr><th></th><th>Truck</th><th>IF</th><th>Check</th><th>Portal</th><th>NetSuite</th></tr>' +
                r.rows.map(x => '<tr class="' + (x.ok === false ? 'warnrow' : '') + '"><td>' + mark(x.ok) + '</td><td>' + esc(x.truck) + '</td><td>' + esc(x.ifNum) + '</td><td>' + esc(x.check) +
                    '</td><td>' + esc(x.portal) + '</td><td>' + esc(x.netsuite) + '</td></tr>').join('') + '</table></div>');
        };
```

In `SCREENS.dash`, replace the loads list (Grep `r.loads` in `SCREENS.dash`) with `r.trucks.map(t => ... esc(t.label) + statusPill(t.status) + t.pallets + ' pallets' ...)`. Replace the exceptions entries `arrivedUnshipped` / `catchups7` with `neverLoaded` ("Never loaded").

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass.

Run: `grep -n "loadId\|recvId\|load_\|recv_\|catchup" move_portal/move_ui.js`
Expected: no hits.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(v3): Unload, Approvals and Report screens; dashboard shows trucks"
```

---

### Task 13: Local beta: prod snapshot, local store, preview server

**Files:**
- Create: `move_portal/local/local_store.js`
- Modify: `move_portal/test/preview_server.js`
- Modify: `.gitignore`
- Modify: `.claude/launch.json` (only if it exists; add `move-preview-beta`)
- Create (not committed): `move_portal/snapshot/prod-2026-10-05.json`

**Interfaces:**
- Produces:
  - `makeLocalStore(core, file) → {data, save()}`. `data` is a `fake_data` instance whose `db` is loaded from `file` (if it exists). `save()` writes `db` back.
  - Preview server: `node move_portal/test/preview_server.js [--snapshot <file>] [--store <file>]`.
    - Defaults: newest `move_portal/snapshot/prod-*.json` (else the test fixture), and `move_portal/local/store.json`.
    - `?floor=1` in the page URL gives the floor view, and the page's own API calls carry it too.
    - The server listens on `0.0.0.0:8765`, so scanners on the same wifi can reach `http://<pc-ip>:8765/?floor=1`.

- [ ] **Step 1: Add the gitignore entries** to `.gitignore` (create the file if missing):

```
move_portal/local/store.json
move_portal/snapshot/
```

- [ ] **Step 2: Create `move_portal/local/local_store.js`**

```js
// move_portal/local/local_store.js — node only, NOT deployed. Persists the fake data layer to a JSON file.
const fs = require('fs');
const { makeFakeData } = require('../test/fake_data');

function makeLocalStore(core, file) {
    const data = makeFakeData(core);
    if (fs.existsSync(file)) Object.assign(data.db, JSON.parse(fs.readFileSync(file, 'utf8')));
    return { data, save: () => fs.writeFileSync(file, JSON.stringify(data.db, null, 1)) };
}

module.exports = { makeLocalStore };
```

- [ ] **Step 3: Test the store** (append to `move_portal/test/fake_data.test.js`)

```js
test('local store round-trips db to a file', () => {
    const os = require('os'), path = require('path'), fs = require('fs');
    const { makeLocalStore } = require('../local/local_store');
    const core = require('./amd').loadAmd('move_core.js');
    const f = path.join(os.tmpdir(), 'mv-store-' + Date.now() + '.json');
    const a = makeLocalStore(core, f);
    a.data.createLoad({ number: 'X', status: 'loading', data: { v3: true } });
    a.save();
    const b = makeLocalStore(core, f);
    assert.equal(b.data.loadsByStatus(['loading']).length, 1);
    fs.unlinkSync(f);
});
```

Run: `node --test "move_portal/test/fake_data.test.js"`
Expected: PASS.

- [ ] **Step 4: Rewrite `move_portal/test/preview_server.js`**

```js
// move_portal/test/preview_server.js — local preview / local beta. NOT deployed to NetSuite.
// node move_portal/test/preview_server.js [--snapshot file] [--store file]   → http://localhost:8765 (manager) and /?floor=1 (floor)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadAmd } = require('./amd');
const { makeLocalStore } = require('../local/local_store');
const { makeSnapshotNs } = require('../local/snapshot_ns');

const arg = k => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const snapDir = path.join(__dirname, '..', 'snapshot');
const newest = fs.existsSync(snapDir) ? fs.readdirSync(snapDir).filter(f => /^prod-.*\.json$/.test(f)).sort().pop() : null;
const snapFile = arg('--snapshot') || (newest ? path.join(snapDir, newest) : path.join(__dirname, 'fixtures', 'snapshot_sample.json'));
const storeFile = arg('--store') || path.join(__dirname, '..', 'local', 'store.json');

const core = loadAmd('move_core.js');
const verify = loadAmd('move_verify.js');
const tpl = loadAmd('move_label_template.js');
const ui = loadAmd('move_ui.js');
const tx = require('./fake_tx').makeFakeTx();
const store = makeLocalStore(core, storeFile);
const data = store.data;
const ns = makeSnapshotNs(verify, snapFile);
const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));

// Seed settings and items from the snapshot the first time the store is created.
if (!data.db.settings.v3seeded) {
    Object.assign(data.db.settings, { locFrom: String(snap.locFrom || '35'), locTo: String(snap.locTo || '46'), labelCode: 'qr', writeMode: 'off',
        defaultCarrier: 'Armstrong Group', trailers: ['537224', '416460', '105488', '522051', '211659'], v3seeded: true });
    ns.items().forEach(i => { if (!data.db.items.some(x => x.item === i.item)) data.db.items.push(i); });
    store.save();
}

let mgrNow = true;
const nowStamp = () => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const h = d.getHours(), h12 = h % 12 || 12;
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() + ' ' + h12 + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + ' ' + (h < 12 ? 'am' : 'pm');
};
const sl = loadAmd('sl_move_portal.js', {
    'N/runtime': { getCurrentUser: () => ({ id: 5, name: mgrNow ? 'Preview manager' : 'Preview floor', roleId: mgrNow ? 'administrator' : 'x', role: mgrNow ? 3 : 9 }),
        getCurrentScript: () => ({ id: 's', deploymentId: 'd' }) },
    'N/log': { error: console.error, debug() {}, audit() {} }, 'N/render': {}, 'N/url': {},
    'N/format': { format: nowStamp, Type: { DATETIMETZ: 1 }, Timezone: { AMERICA_LOS_ANGELES: 1 } },
    './move_core': core, './move_data': data, './move_tx': tx, './move_label_template': tpl, './move_ui': ui, './move_verify': verify, './move_ns': ns
});

http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const floor = u.searchParams.get('floor') === '1';
    mgrNow = !floor;
    const action = u.searchParams.get('action');
    if (!action) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(ui.buildPage({ url: '/?script=1&deploy=1' + (floor ? '&floor=1' : ''), mode: floor ? 'floor' : 'manager', me: floor ? 'Floor' : 'Manager',
            roster: data.db.settings.roster || [], fromName: 'Riverside', toName: 'Tippecanoe', maxPrint: 250 }));
        return;
    }
    if (action === 'pdf') { res.setHeader('Content-Type', 'text/plain'); res.end('PDF would render here (' + u.search + ')'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
        let out;
        try { out = Object.assign({ ok: true }, sl._runAction(action, JSON.parse(body || '{}'), !floor)); store.save(); }
        catch (e) { out = { ok: false, error: e.message }; if (!e.user) console.error(e); }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out));
    });
}).listen(8765, '0.0.0.0', () => console.log('Move Portal local beta on http://localhost:8765 (manager) · /?floor=1 (floor) · snapshot ' + path.basename(snapFile) + ' · store ' + storeFile));
```

- [ ] **Step 5: Pull the prod snapshot (controller session only; it needs the NetSuite SuiteQL connector, read-only)**

1. Build the SQL: `node -e "const v=require('./move_portal/test/amd').loadAmd('move_verify.js'); console.log(JSON.stringify(v.SQL('35','46'),null,1))"`
2. Run `toLines`, then `ifLines`, with `ns_runCustomSuiteQL` (`pageSize` 1000, every page).
3. Collect the distinct IF ids from `ifLines` and run `links` with `{IDS}` = those ids, comma-joined (chunks of 500).
4. Run `receipts` with `{IDS}` = the distinct `rcptid`s from `links`.
5. Run `items` with `{IDS}` = the distinct items from `toLines`.
6. Write `move_portal/snapshot/prod-2026-10-05.json`: `{"pulledAt": "<ISO now, LA time>", "locFrom": "35", "locTo": "46", "toLines": [...], "ifLines": [...], "links": [...], "receipts": [...], "items": [...]}`. Keep the rows exactly as returned, keys included.
7. Sanity check: `node -e "const v=require('./move_portal/test/amd').loadAmd('move_verify.js'); const r=v.buildReads(require('./move_portal/snapshot/prod-2026-10-05.json')); console.log(r.plannedIfs().length,'planned', r.openToLines().length,'open TO lines')"`
   Expected: some planned IFs. On 2026-10-05, prod had status-A/B IFs such as IF72287–IF72291 on TO 7679913.

- [ ] **Step 6: Run the full suite**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass.

- [ ] **Step 7: Commit** (the snapshot and store are gitignored)

```bash
git add .gitignore move_portal/local/local_store.js move_portal/test/preview_server.js move_portal/test/fake_data.test.js
git commit -m "feat(v3): local beta: prod snapshot + persistent local store + floor/manager preview"
```

---

### Task 14: Local beta smoke test in the browser, then handoff

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/sdd-ledger/progress.md`

- [ ] **Step 1: Start the preview.** Use preview_start with the launch config `move-preview`. If its args don't match the new server, update `.claude/launch.json` so `runtimeArgs` = `["move_portal/test/preview_server.js"]`. Delete `move_portal/local/store.json` first for a clean run.

- [ ] **Step 2: Walk the floor flow at `http://localhost:8765/?floor=1`.** Use `read_page` / `find` / `form_input` / `computer`:
  1. Pick a name.
  2. Print a SKU as manager in a second tab (`http://localhost:8765/`), choosing a SKU from a planned IF, a custom pcs value that matches its pallet size, and a label count. Read the new `PLT` codes from the Reprint screen, or get them with `javascript_tool`: `fetch('/?action=pallet_get', ...)`.
  3. Load out → tick one planned IF → Start truck.
  4. Type 2–3 `PLT` codes into the scan box (Enter after each). Check that the scanned/expected row updates, a dup shows amber, and an unknown code shows red.
  5. Fill trailer + seal → Review departure. A short shows "manager must approve" → Send to manager.
- [ ] **Step 3: Manager flow at `http://localhost:8765/`:**
  1. Approvals → Approve departure.
  2. Inbound → Unload → open the truck → scan 1 of the pallets → Unloading done.
  3. Approvals → Approve short receipt.
  4. Report shows rows with ⏳ (the snapshot doesn't have the office's actions yet).
- [ ] **Step 4: Check the console.** Run `read_console_messages` (onlyErrors) and `preview_logs` (level error). Expected: none. Take a screenshot of the Load out screen with the departure plan, and one of the Report.
- [ ] **Step 5: Phone width.** Use `resize_window` preset `mobile`: there should be no horizontal scroll on Load out or Unload. Reset to `desktop`.
- [ ] **Step 6: Update the handoff.**
  - In `CLAUDE.md`, replace the "READ FIRST" block with a 2026-10-xx block. It should say:
    - Stage 1 is done.
    - How to run the beta: `node move_portal/test/preview_server.js`, `/?floor=1`, and the snapshot refresh steps (Task 13 Step 5).
    - The new test count.
    - What's next: Stage 2 (Tasks 15–16).
  - Update the Files list: `move_verify`, `local/`, `snapshot/`.
  - Add a ledger entry in `docs/sdd-ledger/progress.md` with the task list and any rulings made during the build.
- [ ] **Step 7: Commit and push**

```bash
git add CLAUDE.md docs/sdd-ledger/progress.md .claude/launch.json
git commit -m "docs: v3 local beta handoff"
git push
```

---

## Stage 2: Suitelet beta on prod (`WRITE_MODE='qty'`)

> Start only after Jack has used the local beta and says go. Everything below touches **prod**.

### Task 15: Live `move_ns.js` (N/query)

**Files:**
- Create: `move_portal/move_ns.js`
- Create: `move_portal/test/ns.test.js`

**Interfaces:**
- Produces: the same interface as `buildReads` (Task 5), built from live SuiteQL. Results are cached per request, and `resetCache()` clears the cache. `sl_move_portal.runAction` must call `ns.resetCache()` next to `data.resetCache()`.

- [ ] **Step 1: Write the failing test `move_portal/test/ns.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const verify = loadAmd('move_verify.js');
const raw = require('./fixtures/snapshot_sample.json');

test('move_ns runs the SQL through N/query and builds the same reads as the snapshot', () => {
    const asked = [];
    const answer = sql => {
        asked.push(sql);
        if (/AS toid, t\.tranid/.test(sql)) return raw.toLines;
        if (/AS ifid, f\.tranid/.test(sql)) return raw.ifLines;
        if (/previoustransactionlink/.test(sql)) return raw.links;
        if (/ItemRcpt/.test(sql)) return raw.receipts;
        if (/FROM item i/.test(sql)) return raw.items;
        return [];
    };
    const query = { runSuiteQLPaged: o => ({ pageRanges: [{ index: 0 }], fetch: () => ({ data: { asMappedResults: () => answer(o.query) } }) }) };
    const data = { getSettings: () => ({ locFrom: '35', locTo: '46' }) };
    const ns = loadAmd('move_ns.js', { 'N/query': query, './move_verify': verify, './move_data': data });
    assert.equal(ns.plannedIfs().length, 2);
    assert.equal(ns.openToLines().length, 3);
    const n = asked.length;
    ns.plannedIfs();
    assert.equal(asked.length, n, 'cached within a request');
    ns.resetCache();
    ns.plannedIfs();
    assert.ok(asked.length > n);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test "move_portal/test/ns.test.js"`
Expected: FAIL with `ENOENT ... move_ns.js`.

- [ ] **Step 3: Create `move_portal/move_ns.js`**

```js
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal v3: live NetSuite reads (SuiteQL via N/query). Same interface as local/snapshot_ns.js.
 */
define(['N/query', './move_verify', './move_data'], function (query, verify, data) {
    'use strict';
    let cache = null;

    function rows(sql) {
        const out = [];
        const paged = query.runSuiteQLPaged({ query: sql, pageSize: 1000 });
        paged.pageRanges.forEach(r => { paged.fetch({ index: r.index }).data.asMappedResults().forEach(x => out.push(x)); });
        return out;
    }
    function inChunks(sqlTpl, ids) {
        const out = [], u = Array.from(new Set(ids.map(String)));
        for (let i = 0; i < u.length; i += 500) rows(sqlTpl.replace('{IDS}', u.slice(i, i + 500).join(','))).forEach(x => out.push(x));
        return out;
    }
    function reads() {
        if (cache) return cache;
        const S = data.getSettings();
        const q = verify.SQL(S.locFrom, S.locTo);
        const raw = { pulledAt: 'live', locFrom: S.locFrom, locTo: S.locTo, toLines: rows(q.toLines), ifLines: rows(q.ifLines) };
        raw.links = inChunks(q.links, raw.ifLines.map(r => r.ifid));
        raw.receipts = inChunks(q.receipts, raw.links.map(r => r.rcptid));
        raw.items = [];
        cache = verify.buildReads(raw);
        return cache;
    }
    const call = name => function () { return reads()[name].apply(null, arguments); };
    return {
        plannedIfs: call('plannedIfs'), openToLines: call('openToLines'), ifInfo: call('ifInfo'), ifsByTo: call('ifsByTo'),
        receiptsByIf: call('receiptsByIf'), items: call('items'), pulledAt: () => 'live', resetCache: () => { cache = null; }
    };
});
```

> Governance: about 4–6 SuiteQL calls per request at ~10 units each, which is fine. If scans feel slow at the dock, cache `ifLines` and `toLines` for the truck's TOs only. Don't do that up front.

Also edit `runAction` in `sl_move_portal.js`: after `data.resetCache();` add `if (ns.resetCache) ns.resetCache();`.

- [ ] **Step 4: Run the full suite**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass. The test's `items` branch is never hit because `move_ns` doesn't query items; that's expected, since items come from `data.itemInfo`.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ns.js move_portal/test/ns.test.js move_portal/sl_move_portal.js
git commit -m "feat(v3): live move_ns via N/query (same reads as the snapshot)"
```

### Task 16: Prod setup and the `qty` write check (needs Jack's go at each ⚠ step)

**Files:**
- Modify: `CLAUDE.md`, `docs/sdd-ledger/progress.md`

This is a checklist run in the browser with Jack. There's no code in this task unless a check fails, in which case fix it with TDD in the module concerned.

- [ ] **Step 1: ⚠ Prod custom records.** Recreate the 6 record types and their 32 fields in prod with the **exact sandbox ids** (`customrecord_mv_settings`, `_mv_config`, `_mv_load`, `_mv_pallet`, `_mv_scan`, `_mv_label_req`, and every `custrecord_mv*` field from `move_data.js`). All use Access Type = No Permission Required. Then create Move Settings row 1 with: `{locFrom:'35', locTo:'46', fromName:'Riverside', toName:'Tippecanoe', target:'2026-11-15', start:'2026-09-30', skip:[], labelCode:'qr', roster:[], maxPrint:250, staleDays:5, activeBatch:'', writeMode:'off', defaultCarrier:'Armstrong Group', trailers:['537224','416460','105488','522051','211659']}`.
- [ ] **Step 2: ⚠ File Cabinet.** Upload `move_core, move_verify, move_ns, move_data, move_tx, move_label_template, move_ui, sl_move_portal` to `SuiteScripts/MovePortal` in prod. (Upload gotchas are in CLAUDE.md: `#btn_multibutton_submitter` click, and set the folder with `nlapiSetFieldValue`.)
- [ ] **Step 3: ⚠ Script + 2 deployments.** Script `customscript_move_portal`. Deployment `customdeploy_move_portal` is logged in, with audience Administrator + Warehouse Portal Manager + FK WH Mgr variants. Deployment `customdeploy_move_portal_floor` is **Available Without Login**. Status Testing first, Execute As Current Role. Record the ids.
- [ ] **Step 4: Smoke test with `writeMode='off'`.**
  - The manager page loads with no console errors.
  - Load out lists today's real Picked/Packed IFs.
  - On the floor URL, manager actions return "Managers only".
  - Print one real label and scan it with a dock scanner.
- [ ] **Step 5: ⚠ `qty` write check on one real Packed IF (with Jack watching).**
  1. Start a truck on that IF and scan one pallet fewer than expected, so it's short.
  2. Approve the departure as manager with `writeMode='qty'`.
  3. In NetSuite, confirm the IF line qty dropped by exactly one pallet. Its status is still Packed, and its trailer/seal/memo are untouched.
  4. Have the office set it back by hand if Jack wants.
  5. Record the outcome in the ledger. Also record whether `removeLine` (qty → 0 on a mixed IF) and `defaultValues.itemfulfillment` were tested; both stay `on`-mode only until tested.
- [ ] **Step 6: Go live in beta.** Set `writeMode='qty'` and share the floor URL. Daily check: the Report screen, where diffs = office vs portal.
- [ ] **Step 7: Handoff.** Update `CLAUDE.md` with the prod ids (record types, files, script, deployments, URLs) and the beta status. Commit and push.

```bash
git add CLAUDE.md docs/sdd-ledger/progress.md
git commit -m "docs: v3 Suitelet beta on prod (writeMode=qty)"
git push
```

---

## Out of scope (from the spec, §14)

- The tracker update to count trucks by seal: a separate artifact change.
- The portal generating the VICS BOL itself.
- An offline scan queue.
- Catch-up automation (a never-loaded pallet is only flagged).
