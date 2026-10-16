# Drop-Trailer Docs Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On scan-built trucks (`officeIfs: false`), the floor sends a verified trailer for docs. The manager's Approve writes the TO plus an IF at **Picked**. The trailer then waits at the dock, where it stays editable: every scan updates the TO and IF live. When the carrier takes the trailer, the floor taps **Picked up**, and that ships the IF.

**Architecture:** Most of the existing machinery is reused. The spec's `docs_pending` is the existing `ship_pending` status, and `docs_writing` is the existing `departing` status with its claim, Retry and Release. Only one status is new: `at_dock`. Approve's `finishDepart` stops at `at_dock` for scan trucks, and the pallets stay loaded. A new `picked_up` action runs `if_stamp` (Picked → Shipped), moves the pallets to in transit and sets the truck to `departed`, after which receiving works as before. At-dock edits are planned by a pure `verify.dockOps`, then applied one op at a time through `tx.apply`, with an undo on failure.

**Tech Stack:** NetSuite SuiteScript 2.1 (AMD), node `node:test` with the in-memory fakes in `move_portal/test/`.

**Spec:** `docs/superpowers/specs/2026-10-16-move-portal-drop-trailer-docs-design.md`

## Global Constraints

- Repo: `G:\My Drive\Move-portal`, branch `feat/v3-verification`. `git pull` before you start, `git push` when you're done.
- Tests: `node --test "move_portal/test/*.test.js"`. The quoted glob is required on Windows. All tests must pass after every task, and they were 345/345 before this plan.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Only scan-built trucks (`data.kind === 'scan'`) change. The office-IF flow (`officeIfs: true`) must behave exactly as today, so existing office-flow tests stay green, unedited.
- TO status B, Riverside `S.locFrom` → Tippecanoe `S.locTo`. The memo tag `[MV-<ref>]` is unchanged.
- IF at docs = shipstatus **'A' (Picked)**. Shipped ('C') happens only at Picked up.
- The seal # is optional at Send for docs and while at the dock, and required at Picked up. The 30-character max and the `sealTaken` uniqueness check stay.
- At-dock NetSuite writes happen only when `writeMode === 'on'`. In `off`/`qty`, at-dock edits change portal data only ("plan saved"), all or nothing (never a TO write without its IF write).
- Every user-facing error goes through `userErr(...)`. Floor copy is plain English with no jargon.
- No new custom fields. State lives in the load record's `data` JSON.

## File map

- `move_portal/move_verify.js`: `TRUCK.AT_DOCK`; `scanApprovePlan` `picked` option; pure `dockOps`, `inverseOp`, `docLinesFromAlloc`, `allocFromDocLines`; unload lock for at-dock pallets.
- `move_portal/move_tx.js`: `if_create` with `ship: 'picked'`; `stampOn` skips a blank seal; `to_line` op; `if_qty` raises `NO_IF_LINE`; `if_seal` op; `findIf(token, toId, statuses)`.
- `move_portal/test/fake_tx.js`: return ids for the new ops; `findIf` takes statuses.
- `move_portal/sl_move_portal.js`: Send for docs (seal optional), Approve → `at_dock`, at-dock edits, `dock_resync`, `dock_seal`, `picked_up`, lists and stages.
- `move_portal/move_ui.js`: Shipments tab (Ready for docs / Waiting for docs / At dock / Shipped today), the at-dock load screen, the approvals card copy, pills and Dashboard stages.
- Tests: `test/verify.test.js`, `test/move_tx.test.js`, `test/portal.test.js`, `test/ui.test.js`.
- Docs: `CLAUDE.md` handoff and `docs/sdd-ledger/progress.md`.

---

### Task 1: Pure rules in `move_verify`

**Files:**
- Modify: `move_portal/move_verify.js` (TRUCK const line 11, `scanApprovePlan` ~line 139, `classifyUnloadScan` ~line 291, the export list ~line 562)
- Test: `move_portal/test/verify.test.js`

**Interfaces:**
- Produces:
  - `TRUCK.AT_DOCK === 'at_dock'`
  - `scanApprovePlan(o)`, where `o.picked === true` makes the IF op `ship: 'picked'` (otherwise unchanged).
  - `dockOps({ toId, primaryIfId, primaryIfNum, docLines, delta })` → array of ops, where `docLines = { [item]: { qty, ifId, ifNum } }` and `delta = { [item]: signed pcs }`.
  - `inverseOp(op)` → op, or `null` when the op can't be undone (`if_create`).
  - `applyDelta(docLines, delta, primaryIfId, primaryIfNum)` → new docLines (an item at 0 is deleted).
  - `docLinesFromAlloc(alloc)` → docLines.
  - `allocFromDocLines(docLines, meta)` → alloc array, where `meta = { toId, toNum }`.

- [ ] **Step 1: Write the failing tests** (append to `test/verify.test.js`; it already loads `verify` via `loadAmd`):

```js
test('dock: AT_DOCK state and picked IF in the scan approve plan', () => {
    assert.equal(verify.TRUCK.AT_DOCK, 'at_dock');
    const p = verify.scanApprovePlan({ ref: '7', lines: { '11': 240 }, stamp: { trailer: 'T1', seal: '', truckNo: 1, dayIso: '2026-10-16' }, S: { locFrom: 35, locTo: 46 }, picked: true });
    assert.equal(p.ops[1].ship, 'picked');
    const q = verify.scanApprovePlan({ ref: '7', lines: { '11': 240 }, stamp: { trailer: 'T1', seal: 'S', truckNo: 1, dayIso: '2026-10-16' }, S: {} });
    assert.equal(q.ops[1].ship, true);                     // late pallet / default unchanged
});

test('dockOps: raise = TO then IF; lower = IF then TO; new SKU = IF new line on the primary IF', () => {
    const docLines = { '11': { qty: 240, ifId: '502', ifNum: 'IF502' } };
    const base = { toId: '501', primaryIfId: '502', primaryIfNum: 'IF502', docLines };
    assert.deepEqual(verify.dockOps(Object.assign({ delta: { '11': 120 } }, base)), [
        { op: 'to_line', toId: '501', item: '11', from: 240, to: 360 },
        { op: 'if_qty', ifId: '502', ifNum: 'IF502', toId: '501', item: '11', from: 240, to: 360 }]);
    assert.deepEqual(verify.dockOps(Object.assign({ delta: { '11': -120 } }, base)), [
        { op: 'if_qty', ifId: '502', ifNum: 'IF502', toId: '501', item: '11', from: 240, to: 120 },
        { op: 'to_line', toId: '501', item: '11', from: 240, to: 120 }]);
    assert.deepEqual(verify.dockOps(Object.assign({ delta: { '12': 60 } }, base)), [
        { op: 'to_line', toId: '501', item: '12', from: 0, to: 60 },
        { op: 'if_qty', ifId: '502', ifNum: 'IF502', toId: '501', item: '12', from: 0, to: 60, newLine: true }]);
    assert.throws(() => verify.dockOps(Object.assign({ delta: { '11': -300 } }, base)), /below zero/);
});

test('dock: inverseOp swaps from/to; if_create cannot be undone', () => {
    assert.deepEqual(verify.inverseOp({ op: 'to_line', toId: '501', item: '11', from: 240, to: 360 }), { op: 'to_line', toId: '501', item: '11', from: 360, to: 240 });
    assert.deepEqual(verify.inverseOp({ op: 'if_qty', ifId: '5', ifNum: 'IF5', toId: '501', item: '12', from: 0, to: 60, newLine: true }),
        { op: 'if_qty', ifId: '5', ifNum: 'IF5', toId: '501', item: '12', from: 60, to: 0 });
    assert.equal(verify.inverseOp({ op: 'if_create', toId: '501' }), null);
});

test('dock: applyDelta and alloc round trip', () => {
    const d0 = verify.docLinesFromAlloc([{ ifId: '502', ifNum: 'IF502', toId: '501', toNum: 'TO501', lines: { '11': 240 }, addOn: false }]);
    assert.deepEqual(d0, { '11': { qty: 240, ifId: '502', ifNum: 'IF502' } });
    const d1 = verify.applyDelta(d0, { '11': -240, '12': 60 }, '502', 'IF502');
    assert.deepEqual(d1, { '12': { qty: 60, ifId: '502', ifNum: 'IF502' } });
    assert.deepEqual(verify.allocFromDocLines(Object.assign({}, d1, { '13': { qty: 5, ifId: '600', ifNum: 'IF600' } }), { toId: '501', toNum: 'TO501' }), [
        { ifId: '502', ifNum: 'IF502', toId: '501', toNum: 'TO501', lines: { '12': 60 }, addOn: false },
        { ifId: '600', ifNum: 'IF600', toId: '501', toNum: 'TO501', lines: { '13': 5 }, addOn: true }]);
});

test('unload: a pallet still loaded on an at-dock truck is locked', () => {
    const r = verify.classifyUnloadScan({ truckId: '9', pallet: { status: 'loaded', loadId: '4' }, trucks: { '4': { status: 'at_dock', label: 'Trailer X' } } });
    assert.equal(r.result, 'locked');
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL (`AT_DOCK` undefined, `dockOps is not a function`).

- [ ] **Step 3: Implement** in `move_verify.js`:

```js
// line 11: add AT_DOCK
const TRUCK = { LOADING: 'loading', NEEDS_FIX: 'needs_fix', READY: 'ready', SHIP_PENDING: 'ship_pending', DEPARTING: 'departing', AT_DOCK: 'at_dock', DEPARTED: 'departed', RECEIVING: 'receiving', APPROVING: 'approving', RECEIVED: 'received' };
```

In `scanApprovePlan`, set the IF op's ship flag from `o.picked`:

```js
        const f = { op: 'if_create', ref: ref, toId: 'new:to:' + ref, ship: o.picked ? 'picked' : true, token: tag, lines: Object.assign({}, lines), trailer: st.trailer, seal: st.seal,
            memo: memo + ' · ' + tag };
```

In `classifyUnloadScan`, `case VP.LOADED`, add the at-dock lock before the departing one:

```js
                if (other.status === TRUCK.AT_DOCK) return Object.assign({ result: 'locked', reason: 'at_dock' }, ref);
```

New section after `scanApprovePlan` (drop trailer, spec 2026-10-16 §4):

```js
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
            if (q > 0) out[item] = { qty: (out[item] ? out[item].qty : 0) + q, ifId: String(a.ifId), ifNum: a.ifNum };
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
            byIf[k].lines[item] = l.qty;
        });
        return order.map(k => byIf[k]);
    }
```

Add `dockOps, inverseOp, applyDelta, docLinesFromAlloc, allocFromDocLines` to the returned export object (line ~562).

- [ ] **Step 4: Run all tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, including the 5 new tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(dock): at_dock state, picked IF plan, pure dock edit ops"
```

---

### Task 2: NetSuite ops in `move_tx` (+ fake)

**Files:**
- Modify: `move_portal/move_tx.js`
- Modify: `move_portal/test/fake_tx.js`
- Test: `move_portal/test/move_tx.test.js`

**Interfaces:**
- Consumes: op shapes from Task 1.
- Produces:
  - `apply({ op:'if_create', ship:'picked', toId, token, lines, trailer, seal, memo })` → IF id. Saved shipstatus 'A' and stamped; the seal is skipped when blank. If an IF with this token already exists on the TO in status A/B/C, its id is returned and nothing is created.
  - `apply({ op:'to_line', toId, item, from, to })` → TO id. Already at `to` → returns without saving. Current ≠ `from` → `changed(...)` error. `to > 0` on a missing line → a new line. `to > 0` on a closed line → reopened. `to === 0` → line `isclosed = true`.
  - `apply({ op:'if_qty', ..., newLine:true })` when the IF has no line for the item → throws an Error whose message starts `NO_IF_LINE`.
  - `apply({ op:'if_seal', ifId, ifNum, seal })` → IF id. Sets the seal field only. Status must be A/B.
  - `findIf(token, toId, statuses)`, where `statuses` defaults to `['ItemShip:C']`.
  - `verify.opKey` keys: `to_line:<toId>:<item>` and `if_seal:<ifId>` (from the default branch, so no change is needed for `if_seal`).

- [ ] **Step 1: Write the failing tests** (append to `test/move_tx.test.js`; reuse its `setup`/`makeRec`):

```js
test('if_create ship:picked saves Picked (A), stamps trailer + memo, skips a blank seal', () => {
    const s = setup({});
    s.tx.apply({ op: 'if_create', ship: 'picked', toId: '600', token: '[MV-7]', lines: { '975': 24 }, trailer: 'T1', seal: '', memo: 'Truck 1 · 10/16 · [MV-7]' });
    const r = s.log.last;
    assert.deepEqual([r.values.shipstatus, r.values.custbody_rsm_container_no, r.values.memo, 'custbody7' in r.values], ['A', 'T1', 'Truck 1 · 10/16 · [MV-7]', false]);
});

test('if_create ship:picked finds an earlier IF by token (A/B/C) and creates nothing', () => {
    const s = setup({ found: '4242' });
    assert.equal(s.tx.apply({ op: 'if_create', ship: 'picked', toId: '600', token: '[MV-7]', lines: { '975': 24 }, trailer: 'T1', memo: 'm' }), '4242');
    assert.equal(s.log.transforms.length, 0);
    assert.deepEqual(JSON.stringify(s.log.searches[0].filters).includes('ItemShip:A'), true);
});

test('to_line raises, adds, closes at 0, reopens, and refuses a stale from', () => {
    let s = setup({ to: [{ item: '975', quantity: 240, quantityfulfilled: 0 }] });
    s.tx.apply({ op: 'to_line', toId: '600', item: '975', from: 240, to: 360 });
    const rec = s.log.toRec;
    assert.equal(rec.lines[0].quantity, 360);
    s.tx.apply({ op: 'to_line', toId: '600', item: '111', from: 0, to: 60 });
    assert.deepEqual([rec.lines[1].item, rec.lines[1].quantity], ['111', 60]);
    s.tx.apply({ op: 'to_line', toId: '600', item: '111', from: 60, to: 0 });
    assert.equal(rec.lines[1].isclosed, true);
    s.tx.apply({ op: 'to_line', toId: '600', item: '111', from: 0, to: 12 });
    assert.deepEqual([rec.lines[1].isclosed, rec.lines[1].quantity], [false, 12]);
    const saves = rec.saved;
    s.tx.apply({ op: 'to_line', toId: '600', item: '111', from: 0, to: 12 });   // already at target: done, no save
    assert.equal(rec.saved, saves);
    assert.throws(() => s.tx.apply({ op: 'to_line', toId: '600', item: '975', from: 100, to: 200 }), /^Error: IF changed in NetSuite/);
});

test('if_qty newLine on an IF without that item throws NO_IF_LINE and saves nothing', () => {
    const s = setup({ status: 'A', ifLines: [{ item: '975', quantity: 24 }] });
    assert.throws(() => s.tx.apply({ op: 'if_qty', ifId: '9', ifNum: 'IF9', toId: '600', item: '111', from: 0, to: 5, newLine: true }), /^Error: NO_IF_LINE/);
    assert.equal(s.f.saved, 0);
});

test('if_seal sets only the seal on a Picked IF; refuses a Shipped one', () => {
    let s = setup({ status: 'A', ifLines: [{ item: '975', quantity: 24 }] });
    s.tx.apply({ op: 'if_seal', ifId: '9', ifNum: 'IF9', seal: '5249330' });
    assert.deepEqual([s.f.values.custbody7, s.f.values.shipstatus, s.f.saved], ['SEAL: 5249330', 'A', 1]);
    s = setup({ status: 'C', ifLines: [{ item: '975', quantity: 24 }] });
    assert.throws(() => s.tx.apply({ op: 'if_seal', ifId: '9', ifNum: 'IF9', seal: 'x' }), /no longer Picked/);
});
```

For the `to_line` test, `makeRec` needs `selectNewLine`, and the test needs the TO record handle. In `setup`, change the TO line to:

```js
    recs['transferorder:600'] = makeRec({}, spec.to || [{ item: '975', quantity: 600, quantityfulfilled: 0 }]);
    recs['transferorder:600'].selectNewLine = () => { const r = recs['transferorder:600']; r.lines.push({ itemreceive: true }); r.cur = r.lines.length - 1; };
    log.toRec = recs['transferorder:600'];
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test "move_portal/test/move_tx.test.js"`
Expected: FAIL (`Unknown op to_line`, wrong shipstatus).

- [ ] **Step 3: Implement in `move_tx.js`**

`stampOn`: write the seal only when it's non-blank:

```js
    function stampOn(rec, op) {
        if (hasField(rec, TRAILER_FLD)) rec.setValue({ fieldId: TRAILER_FLD, value: op.trailer });
        if (hasField(rec, SEAL_FLD) && String(op.seal || '').trim()) rec.setValue({ fieldId: SEAL_FLD, value: 'SEAL: ' + op.seal });
        rec.setValue({ fieldId: 'memo', value: op.memo });
    }
```

Check this doesn't break the existing `if_stamp` or `receipt` tests. Both always pass a seal there; the receipt seal comes via `Object.assign`. If a receipt test expects `'SEAL: undefined'`, it's wrong. Update it, and record that in the ledger.

`setIfItemQty`: right after `const lines = itemLines(f, op.item);`:

```js
        if (!lines.length && op.newLine && Number(op.to) > 0) throw new Error('NO_IF_LINE ' + op.ifNum + ' has no line for item ' + op.item);
```

The `to` vs remaining check uses `toRemaining`. A raise runs after its `to_line`, so the TO room is already there.

New `setToLine`:

```js
    // Drop trailer at the dock (spec 2026-10-16 §4): one TO line to an exact qty. 0 closes the line (no removeLine on a TO with an IF).
    function setToLine(op) {
        const to = record.load({ type: record.Type.TRANSFER_ORDER, id: op.toId, isDynamic: true });
        const lines = itemLines(to, op.item);
        const open = lines.filter(i => to.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i }) !== true);
        const cur = open.reduce((a, i) => a + (Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0), 0);
        if (cur === Number(op.to)) return String(op.toId);
        if (cur !== Number(op.from)) throw changed('TO ' + op.toId + ' item ' + op.item + ' is ' + cur + ', expected ' + op.from);
        if (Number(op.to) <= 0) {
            open.forEach(i => { to.selectLine({ sublistId: 'item', line: i }); to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'isclosed', value: true }); to.commitLine({ sublistId: 'item' }); });
        } else if (lines.length) {
            const i = open.length ? open[open.length - 1] : lines[lines.length - 1];
            const others = open.filter(j => j !== i).reduce((a, j) => a + (Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: j })) || 0), 0);
            to.selectLine({ sublistId: 'item', line: i });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'isclosed', value: false });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: Number(op.to) - others });
            to.commitLine({ sublistId: 'item' });
        } else {
            to.selectNewLine({ sublistId: 'item' });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: op.item });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: Number(op.to) });
            to.commitLine({ sublistId: 'item' });
        }
        return String(to.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    function stampSeal(op) {
        const f = record.load({ type: record.Type.ITEM_FULFILLMENT, id: op.ifId, isDynamic: true });
        const st = String(f.getValue({ fieldId: 'shipstatus' }));
        if (st !== 'A' && st !== 'B') throw changed(op.ifNum + ' is no longer Picked/Packed (status ' + st + ')');
        if (!hasField(f, SEAL_FLD)) return String(op.ifId);
        f.setValue({ fieldId: SEAL_FLD, value: 'SEAL: ' + op.seal });
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
```

`createIf`: handle `ship === 'picked'` first:

```js
        if (op.ship === 'picked' && op.token) {       // drop trailer: a Picked IF an earlier request saved on this TO (any status)
            const found = findIf(op.token, op.toId, ['ItemShip:A', 'ItemShip:B', 'ItemShip:C']);
            if (found) return found;
        }
```

Then replace the status branch:

```js
        if (op.ship === false) {
            f.setValue({ fieldId: 'shipstatus', value: 'B' });
            if (op.token) f.setValue({ fieldId: 'memo', value: op.token });
        }
        else if (op.ship === 'picked') { f.setValue({ fieldId: 'shipstatus', value: 'A' }); stampOn(f, op); }
        else { f.setValue({ fieldId: 'shipstatus', value: 'C' }); stampOn(f, op); }
```

`apply`: add the two ops:

```js
        if (op.op === 'to_line') return setToLine(op);
        if (op.op === 'if_seal') return stampSeal(op);
```

`findIf`:

```js
    function findIf(token, toId, statuses) { return findByToken(token, 'ItemShip', ['AND', ['createdfrom', 'anyof', String(toId)], 'AND', ['status', 'anyof', statuses || ['ItemShip:C']]]); }
```

`move_verify.opKey`: add a line before the default:

```js
        if (op.op === 'to_line') return 'to_line:' + op.toId + ':' + op.item;
```

`fake_tx.js`: `to_line` and `if_seal` return their record ids, `findIf` takes statuses, and `failOn` keeps working:

```js
            return op.op === 'if_qty' || op.op === 'if_stamp' || op.op === 'if_seal' ? String(op.ifId) : op.op === 'to_line' ? String(op.toId) : String(++t.seq);
        ...
        findIf: (tok, toId, statuses) => t.ifTags[tok + '|' + toId] || null,
```

- [ ] **Step 4: Run all tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_tx.js move_portal/move_verify.js move_portal/test/fake_tx.js move_portal/test/move_tx.test.js
git commit -m "feat(dock): Picked IF create, to_line, if_seal, NO_IF_LINE on new IF line"
```

---

### Task 3: Send for docs + Approve docs → `at_dock`

**Files:**
- Modify: `move_portal/sl_move_portal.js`: `ship_mark` (~1023), `ship_confirm` (~1055), `departPlan` (~418), `finishDepart` (~452), `depart_release` (~1100), `truck_planned` (~687), `TRAILER_BUSY` (~702), `stageOf` / `STAGE_ORDER` (~1758), approvals `retries` (~1732)
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `verify.scanApprovePlan({..., picked:true})`, `verify.docLinesFromAlloc`, `T.AT_DOCK`, `tx.findIf(tag, toId, statuses)`.
- Produces, for scan trucks after Approve (on mode):
  - `status === 'at_dock'`, pallets still `loaded`.
  - `data.docLines = { item: { qty, ifId, ifNum } }`, `data.alloc` (the same shape as today), `data.toId/toNum/ifId/ifNum` (as today).
  - `data.depart.seal` = the seal from Send for docs, or `''`.
  - `data.departPallets = null`.
  - The Approve response includes `atDock: true`.
- Off/qty mode: same, but the ids are the `new:` placeholders, and docLines get `ifId: ''`.

- [ ] **Step 1: Write the failing tests.** Append near the scan-built tests (~line 2770), after `shipScan`. The existing `scan-built Approve (on)` test asserts `departed` and the receipt; it gets rewritten in this task (see Step 3c).

```js
function docsScan(ctx, n, mode, seal) {
    ctx.data.db.settings.writeMode = mode || 'on';
    const t = scanTruck(ctx, n || 2);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', Object.assign({ truckId: t.id }, seal ? { seal: seal } : {}), false);
    return t;
}

test('drop trailer: Send for docs needs no seal; Approve writes TO (B) + Picked IF and parks the truck at the dock', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 2);
    assert.equal(ctx.data.getLoad(t.id).status, 'ship_pending');
    const r = ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(r.atDock, true);
    const x = ctx.data.getLoad(t.id), d = x.data;
    const [to, f] = ctx.tx._t.ops;
    assert.deepEqual([to.op, to.orderStatus, f.op, f.ship, f.seal], ['to_create', 'B', 'if_create', 'picked', '']);
    assert.deepEqual([x.status, d.depart.seal, d.departPallets], ['at_dock', '', null]);
    assert.deepEqual(d.docLines, { '11': { qty: 240, ifId: d.ifId, ifNum: 'IF' + d.ifId } });
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'loaded'));
});

test('drop trailer: a seal given at Send for docs is stamped on the Picked IF', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 1, 'on', '5249330');
    ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(ctx.tx._t.ops[1].seal, '5249330');
    assert.equal(ctx.data.getLoad(t.id).data.depart.seal, '5249330');
});

test('drop trailer: off mode parks at the dock with a plan only', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 2, 'off');
    const r = ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getLoad(t.id).status, 'at_dock');
    assert.deepEqual(ctx.data.getLoad(t.id).data.docLines, { '11': { qty: 240, ifId: '', ifNum: '' } });
    assert.ok(r.planOnly.length > 0);
});

test('drop trailer: Shipments lists at-dock trucks as open, not shipped; Dashboard stages say Waiting for docs / At dock', () => {
    const ctx = scanSetup();
    const a = docsScan(ctx, 1);
    let pl = ctx.run('truck_planned', {}, false);
    assert.deepEqual(pl.open.map(x => x.status), ['ship_pending']);
    ctx.run('ship_confirm', { truckId: a.id });
    pl = ctx.run('truck_planned', {}, false);
    assert.deepEqual([pl.open.map(x => x.status), pl.shippedToday.length], [['at_dock'], 0]);
    const rows = ctx.run('dashboard', {}).rows || [];
    assert.ok(rows.some(r => r.stage === 'At dock'));
});
```

Before writing the last test, read the existing dashboard test near line 188 to confirm the action name and row shape (`act('dashboard'`, rows with `stage`). If they differ, adapt the assertion to the actual names. Don't rename existing actions.

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: the 4 new tests FAIL (seal required, status `departed`).

- [ ] **Step 3: Implement**

(a) `ship_mark`: the seal is optional on scan trucks. Replace the `if (!inp.seal) ...` line and the `sealTaken` call:

```js
        if (!inp.seal && !isScan(x)) throw userErr('Enter the seal #');
        if (inp.seal.length > 30) throw userErr('The seal # is too long (30 characters max)');
        if (inp.carrier.length > 60) throw userErr('The carrier is too long (60 characters max)');
        if (inp.seal) sealTaken(inp.seal, x.id);
```

In `ship_confirm`, guard `sealTaken(inp.seal, x0.id)` the same way: `if (inp.seal) sealTaken(...)`.

(b) `departPlan`: pass `picked: true` for scan trucks:

```js
            const plan = verify.scanApprovePlan({ ref: x.data.approveRef || x.id, lines: verify.linesPcs(verify.truckLines(ps)), picked: true,
                stamp: { trailer: inp.trailer, seal: inp.seal || '', truckNo: truckNo, dayIso: c.now.dayIso }, S: c.S });
```

(c) `finishDepart`: scan trucks park at the dock. Move the pallet loop into a helper, `shipPallets(x, c, planned, day)`, with the same body as today: `planned` null = every loaded pallet, and `shippedDay = day || x.data.depart.day`. Call it only for non-scan trucks, plus from `picked_up` in Task 5. The tail becomes:

```js
        if (isScan(x)) {
            const docIds = ids.toId ? ids : { toId: '', toNum: '', ifId: '', ifNum: '', alloc: (x.data.alloc || []).map(a => Object.assign({}, a, { ifId: '', ifNum: '' })) };
            data.updateLoad(data.getLoad(x.id), Object.assign({ status: T.AT_DOCK, data: Object.assign({ error: '', writes: writes, workingAt: 0, claim: '', phase: '', shortNote: null,
                departPallets: null, docLines: verify.docLinesFromAlloc(docIds.alloc), lastStep: stepOf('docs_written', c) }, docIds) }, ids.toId ? { to: ids.toId, if: ids.ifId } : {}));
            return Object.assign({ atDock: true, written: res.written, planOnly: res.planOnly, view: truckView(mustTruck(x.id), c) }, ids.toId ? { toNum: ids.toNum, ifNum: ids.ifNum } : {});
        }
        shipPallets(x, c, planned, null);
        // ... existing DEPARTED update and return, unchanged
```

`stepOf('docs_written', c)` has to exist. Check how `stepOf` maps step keys to text, and add `docs_written: 'Docs written'`, `picked_up: 'Picked up'` and `dock_edit: 'Changed at the dock'` in the same table.

Existing scan-built tests that asserted `departed` and receipts right after `ship_confirm` (around lines 2777–2900: Approve (on), Retry, Release, `-R1`) must now go through `at_dock`. Update the status assertions to `'at_dock'`, and insert a `picked_up` call (Task 5) before any unload/receipt step. Until Task 5 lands, mark those receipt-dependent assertions `test.todo`-free by **splitting**: keep the TO/IF write asserts here, and move the unload/receipt half into Task 5's tests. List every edited test in the ledger.

(d) `depart_release`: a Picked IF now counts as "already in NetSuite":

```js
                if (toId && tx.findIf && tx.findIf(tag, toId, ['ItemShip:A', 'ItemShip:B', 'ItemShip:C'])) throw userErr('This truck is already in NetSuite (IF found). Press Retry to finish the departure.');
```

(e) Lists: in `truck_planned`, add `x.status === T.AT_DOCK` to `open`, and exclude it from `shipped`:

```js
        const open = trucks.filter(x => OPEN.indexOf(x.status) !== -1 || x.status === T.SHIP_PENDING || x.status === T.DEPARTING || x.status === T.AT_DOCK);
        const shipped = trucks.filter(x => x.status !== T.DEPARTING && x.status !== T.AT_DOCK && x.data.depart && x.data.depart.day === c.now.dayIso);
```

Add `T.AT_DOCK` to `TRAILER_BUSY`.

(f) Stages: `STAGE_ORDER = ['Receipt pending', 'Waiting for manager', 'Waiting for docs', 'At dock', 'Ready to ship', 'Needs IF fix', 'Loading', 'In transit', 'Unloading', 'Received']`. In `stageOf`, put these before the existing lines:

```js
        if (x.status === T.AT_DOCK) return 'At dock';
        if (isScan(x) && (x.status === T.SHIP_PENDING || x.status === T.DEPARTING)) return 'Waiting for docs';
        if (isScan(x) && x.status === T.READY) return 'Ready for docs';
```

Add `'Ready for docs'` to `STAGE_ORDER` right after `'At dock'`. Mirror the same list in `move_ui.js` `STAGES` (line 1486) in Task 6.

`summary` / `truckSummary`: add `scan: isScan(x)` to the returned object, so the UI can relabel pills.

- [ ] **Step 4: Run all tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS. Office-flow tests are untouched.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(dock): Send for docs without seal; Approve writes TO + Picked IF and parks at the dock"
```

---

### Task 4: Editing at the dock (scan on, take off, other items, out of sync, resync)

**Files:**
- Modify: `move_portal/sl_move_portal.js`: `truck_scan` (~757), `takeOff` (~749), `truck_remove`, `truck_undo`, `editOther` (~822); new `dockEdit`, `dock_resync`
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `verify.dockOps`, `verify.inverseOp`, `verify.applyDelta`, `verify.allocFromDocLines`, `verify.stockCheck`, `verify.stockText`, `tx.apply`.
- Produces:
  - `truck_scan` on an `at_dock` truck → `{ result: 'ok' | 'short' | 'refused' | ..., tone, view }`. A `truck_scan` with `mode:'off'` on an `at_dock` truck → `{ result: 'taken_off' | 'refused' | 'not_on_truck', ... }`.
  - `data.docsSync = { error, pending: [ops], at, by }` while out of sync.
  - `act('dock_resync', true, ...)` → `{ view }`.

Pallet item lines: each pallet carries `p.lines = [{ item, pcs, sku, ... }]`. Check `verify.truckLines` / `sumLines` for how pallet lines are read, and reuse `verify.sumLines([p])` to get `{item: pcs}` for one pallet.

- [ ] **Step 1: Write the failing tests:**

```js
function atDock(ctx, n) {
    const t = docsScan(ctx, n || 2);
    ctx.run('ship_confirm', { truckId: t.id });
    ctx.tx._t.ops = [];
    return t;
}

test('at dock: scanning a pallet on raises the TO line then the IF line', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2), d0 = ctx.data.getLoad(t.id).data;
    const p = printLabels(ctx, 1, 'Jdock1')[0];
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false);
    assert.equal(r.result, 'ok');
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['to_line', 240, 360], ['if_qty', 240, 360]]);
    const d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([ctx.data.getPallet(p.id).status, d.docLines['11'].qty, d.alloc[0].lines['11']], ['loaded', 360, 360]);
    assert.equal(d.ifId, d0.ifId);
});

test('at dock: taking a pallet off lowers the IF then the TO', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    const r = ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code, mode: 'off' }, false);
    assert.equal(r.result, 'taken_off');
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['if_qty', 240, 120], ['to_line', 240, 120]]);
    assert.equal(ctx.data.getPallet(t.ps[0].id).status, 'labeled');
});

test('at dock: the last pallet cannot be taken off', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code, mode: 'off' }, false), /last pallet/i);
    assert.equal(ctx.tx._t.ops.length, 0);
});

test('at dock: a new SKU adds a TO line and an IF line; NO_IF_LINE falls back to a Picked add-on IF', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const p = printLabels(ctx, 1, 'Jdock2', [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 60 }])[0];
    ctx.tx._t.failOn = op => op.op === 'if_qty' && op.newLine ? (() => { throw new Error('NO_IF_LINE IF has no line'); })() : false;
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false);
    assert.equal(r.result, 'ok');
    const ops = ctx.tx._t.ops.map(o => o.op + (o.ship ? ':' + o.ship : ''));
    assert.deepEqual(ops, ['to_line', 'if_create:picked']);
    const d = ctx.data.getLoad(t.id).data;
    assert.equal(d.alloc.length, 2);
    assert.equal(d.alloc[1].addOn, true);
    assert.notEqual(d.docLines['12'].ifId, d.ifId);
});

test('at dock: a stock short refuses the scan and writes nothing', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.data.db.stock['35']['11'].avail = 50;
    const p = printLabels(ctx, 1, 'Jdock3')[0];
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false);
    assert.equal(r.result, 'short');
    assert.match(r.message, /Can't add: YSN201/);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getPallet(p.id).status, 'labeled');
});

test('at dock: IF failure undoes the TO change and refuses the scan', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_qty';
    const p = printLabels(ctx, 1, 'Jdock4')[0];
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false);
    assert.equal(r.result, 'refused');
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['to_line', 120, 240], ['to_line', 240, 120]]);
    assert.equal(ctx.data.getPallet(p.id).status, 'labeled');
    assert.equal(ctx.data.getLoad(t.id).data.docsSync, null);
});

test('at dock: a failed undo leaves Docs out of sync, pauses scans, and Retry finishes the edit', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const orig = ctx.tx.apply;
    let n = 0;
    ctx.tx.apply = op => { n++; if (n === 2 || n === 3) throw new Error('boom ' + n); return orig(op); };   // the IF write fails, then the undo fails too
    const p = printLabels(ctx, 2, 'Jdock5');
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p[0].code }, false);
    assert.equal(r.result, 'out_of_sync');
    const d = ctx.data.getLoad(t.id).data;
    assert.ok(d.docsSync && d.docsSync.pending.length === 1);
    assert.equal(ctx.data.getPallet(p[0].id).status, 'loaded');   // the TO already holds it: the pallet counts on the truck
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: p[1].code }, false), /out of sync/i);
    assert.throws(() => ctx.run('dock_resync', { truckId: t.id }, false), /Managers only/);
    ctx.tx.apply = orig;
    ctx.run('dock_resync', { truckId: t.id });
    assert.equal(ctx.data.getLoad(t.id).data.docsSync, null);
    assert.equal(ctx.tx._t.ops[ctx.tx._t.ops.length - 1].op, 'if_qty');
});

test('at dock: other items are portal-only; off mode edits write nothing', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.run('truck_other_add', { truckId: t.id, desc: 'Pallet jack', qty: 1 }, false);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getLoad(t.id).data.otherItems.length, 1);
    assert.equal(ctx.data.getLoad(t.id).status, 'at_dock');
    const off = scanSetup();
    const u = docsScan(off, 1, 'off');
    off.run('ship_confirm', { truckId: u.id });
    const p = printLabels(off, 1, 'Jdock6')[0];
    assert.equal(off.run('truck_scan', { truckId: u.id, raw: p.code }, false).result, 'ok');
    assert.equal(off.tx._t.ops.length, 0);
    assert.equal(off.data.getLoad(u.id).data.docLines['11'].qty, 240);
});

test('at dock: a pallet on an at-dock truck cannot be scanned onto another truck', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const other = ctx.run('truck_start', { trailer: tr() }, false).view.truck;
    assert.equal(ctx.run('truck_scan', { truckId: other.id, raw: t.ps[0].code }, false).result, 'locked');
});
```

How these tests inject failures:
- `fake_tx`'s `failOn` throws once, and then clears itself.
- The NO_IF_LINE test's `failOn` function throws `NO_IF_LINE` itself. That simulates `tx` refusing the new line, and leaves `failOn` armed but returning false afterwards.
- The failed-undo test wraps `ctx.tx.apply` directly, because it needs two failures in a row. The Suitelet looks up `tx.apply` on every call, so the wrapper takes effect.

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: the new tests FAIL ("Scanning is closed on this truck").

- [ ] **Step 3: Implement.** Add a new section before `act('truck_scan'`:

```js
    // ── drop trailer at the dock (spec 2026-10-16 §4) ────────────────────
    function mustAtDock(cur) {
        if (cur.status !== T.AT_DOCK) throw userErr('This truck is ' + cur.status + ', not at the dock');
        if (cur.data.docsSync) throw userErr('Docs are out of sync on this truck: a manager must press Retry first');
        if (cur.data.claim && !stale(cur)) throw userErr((truckLabel(cur) || 'This truck') + ' is being updated. Try again in a moment.');
    }
    function itemOfPallet(p) { return verify.sumLines([p]); }       // { item: pcs }
    // Applies one pallet change at the dock. sign +1 = on, -1 = off. Returns a scan result.
    function dockEdit(x, p, sign, s, c) {
        const cl = claimLoad(x, null, 'dock', mustAtDock);
        const release = patch => data.updateLoad(data.getLoad(x.id), { data: Object.assign({ claim: '', workingAt: 0, phase: '' }, patch || {}) });
        const d = cl.Ld.data, delta = {};
        Object.keys(itemOfPallet(p)).forEach(k => { delta[k] = sign * itemOfPallet(p)[k]; });
        const result = (r, extra) => Object.assign({ result: r, raw: s.raw, tone: r === 'ok' || r === 'taken_off' ? (sign > 0 ? 'ok' : 'warn') : 'bad', pallet: pubPallet(data.getPallet(p.id)), view: truckView(mustTruck(x.id), c) }, extra || {});
        try {
            if (sign < 0 && data.palletsByLoad(x.id, [VP.LOADED]).length <= 1) throw userErr('This is the last pallet: ask a manager to send the truck back instead');
            if (sign > 0) {
                const items = Object.keys(delta), st = data.locationStock(c.S.locFrom, items), avail = {};
                items.forEach(k => { avail[k] = st[k] ? Number(st[k].avail) || 0 : 0; });
                const shorts = verify.stockCheck(delta, avail);
                if (shorts.length) { release(); return result('short', { message: 'Can\'t add: ' + verify.stockText(shorts, skuNames(items)) + '. Leave the pallet off and call the office.' }); }
            }
            let docLines = d.docLines || {}, extraIfs = {};
            if (writeMode(c) === 'on') {
                const ops = verify.dockOps({ toId: d.toId, primaryIfId: d.ifId, primaryIfNum: d.ifNum, docLines: docLines, delta: delta });
                const done = [];
                for (let i = 0; i < ops.length; i++) {
                    const op = ops[i];
                    try { tx.apply(op); done.push(op); }
                    catch (e) {
                        if (/^NO_IF_LINE/.test(e.message || '') && op.newLine) {   // spec §4 step 4: a one-line Picked add-on IF on the same TO
                            const tag = verify.scanTag((d.approveRef || x.id) + '-A' + op.item);
                            const id = tx.apply({ op: 'if_create', ship: 'picked', toId: d.toId, token: tag, lines: { [op.item]: op.to }, trailer: d.depart.trailer, seal: d.depart.seal || '',
                                memo: verify.memoFor(d.depart.truckNo, d.depart.day) + ' · ' + tag });
                            extraIfs[op.item] = { ifId: String(id), ifNum: newIfNum(id) };
                            done.push(Object.assign({}, op, { op: 'if_create' }));
                            continue;
                        }
                        const undo = done.slice().reverse().map(verify.inverseOp);
                        try {
                            if (undo.some(u => u === null)) throw new Error('cannot undo an add-on IF');
                            undo.forEach(u => tx.apply(u));
                        } catch (e2) {
                            log.error({ title: 'move dock undo ' + x.id, details: (e2 && e2.stack) || String(e2) });
                            data.updatePallet(p, sign > 0 ? { status: VP.LOADED, load: x.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor } } : { status: VP.LABELED, load: '' });
                            const dl = verify.applyDelta(docLines, delta, d.ifId, d.ifNum);
                            release({ docsSync: { error: e.message || String(e), pending: ops.slice(i), at: c.now.stamp, by: c.actor }, docLines: dl,
                                alloc: verify.allocFromDocLines(dl, { toId: d.toId, toNum: d.toNum }) });
                            return result('out_of_sync', { message: 'Docs are out of sync with the trailer. A manager must press Retry before more scans.' });
                        }
                        release();
                        return result('refused', { message: 'NetSuite refused the change: ' + (e.message || e) + '. The pallet stays ' + (sign > 0 ? 'off' : 'on') + ' the truck.' });
                    }
                }
            }
            let dl = verify.applyDelta(docLines, delta, d.ifId, d.ifNum);
            Object.keys(extraIfs).forEach(k => { if (dl[k]) Object.assign(dl[k], extraIfs[k]); });
            data.updatePallet(p, sign > 0 ? { status: VP.LOADED, load: x.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor } }
                : { status: VP.LABELED, load: '', data: { takenOffAt: c.now.stamp, takenOffBy: c.actor, takenOffTruck: x.id } });
            release({ docLines: dl, alloc: verify.allocFromDocLines(dl, { toId: d.toId, toNum: d.toNum }), lastStep: stepOf('dock_edit', c) });
            return result(sign > 0 ? 'ok' : 'taken_off');
        } catch (e) { if (data.getLoad(x.id).data.claim === cl.claim) release(); throw e; }
    }
    // Manager Retry for an out-of-sync truck: re-applies the pending ops (each is idempotent by its from/to).
    act('dock_resync', true, (a, c) => {
        const x = mustTruck(a.truckId);
        if (x.status !== T.AT_DOCK || !x.data.docsSync) throw userErr('Nothing to retry on this truck');
        const cl = claimLoad(x, null, 'dock', cur => { if (!cur.data.docsSync) throw userErr('Nothing to retry on this truck'); });
        try { cl.Ld.data.docsSync.pending.forEach(op => tx.apply(op)); }
        catch (e) {
            data.updateLoad(data.getLoad(x.id), { data: { claim: '', workingAt: 0, phase: '', docsSync: Object.assign({}, cl.Ld.data.docsSync, { error: e.message || String(e) }) } });
            throw userErr('Retry failed: ' + (e.message || e));
        }
        data.updateLoad(data.getLoad(x.id), { data: { claim: '', workingAt: 0, phase: '', docsSync: null } });
        return { view: truckView(mustTruck(x.id), c) };
    });
```

The pending op after a failed undo: in the "failed undo" test, ops = [to_line, if_qty]. The `if_qty` fails at i=1, and the undo of `to_line` fails. Then `pending = ops.slice(1)` = `[if_qty]`, the forward completion. Retry applies it, so the TO and IF both hold the pallet, which is on the truck. If the undo fails after a *partial* undo (more than one done op), `pending` is still the forward remainder. That's correct as long as every done op is still in place, so log it. Mixed-SKU pallets with partial undos are a known corner, so record it in the ledger as a deferred minor.

Name helpers: use `verify.memoFor` / `verify.scanTag`. If `memoFor` isn't exported yet, add it to the export list in Task 1's file (one line, same commit as this task). Check `skuNames` and `newIfNum` exist in `sl_move_portal.js`. Both are used by existing code (`ship_confirm`, `finishDepart`).

Routing. `truck_scan`:

```js
    act('truck_scan', false, (a, c) => {
        const x0 = mustTruck(a.truckId);
        if (x0.status === T.AT_DOCK) {
            const s = core.parseScan(a.raw), p = s.palletId ? data.getPallet(s.palletId) : null;
            let r;
            if (a.mode === 'off') r = p && p.status === VP.LOADED && String(p.loadId) === String(x0.id) ? dockEdit(x0, p, -1, s, c) : { result: 'not_on_truck', raw: s.raw, tone: 'bad', pallet: p ? pubPallet(p) : null, view: truckView(x0, c) };
            else if (p && p.status === VP.LABELED && !(p.data.flag === 'never_loaded' || (p.data.decision && p.data.decision.kind === 'accepted_pending'))) r = dockEdit(x0, p, 1, s, c);
            else {
                const o = p && p.loadId ? data.getLoad(p.loadId) : null;
                const c0 = verify.classifyLoadScan({ pallet: p, truckId: x0.id, trucks: o ? scanTruckMap([o]) : {}, scanBuilt: true });
                r = Object.assign({}, c0, { raw: s.raw, tone: verify.toneFor(c0.result), pallet: p ? pubPallet(p) : null, view: truckView(x0, c) });
            }
            data.logScan({ pallet: p ? p.id : '', load: x0.id, result: r.result, data: { raw: s.raw, mode: a.mode === 'off' ? 'off' : 'load', actor: c.actor, at: c.now.stamp, dock: true } });
            return r;
        }
        const x = mustOpenTruck(a.truckId);
        // ... existing body unchanged
```

- `truck_remove` on an at-dock truck routes through `dockEdit(x, p, -1, { raw: p.code }, c)`. `truck_undo` on an at-dock truck throws `userErr('At the dock, take a pallet off by scanning it in Take off mode')`.
- `editOther`: allow at-dock (portal only, status unchanged). Replace the first lines with:

```js
        const x = mustTruck(id);
        if (x.status !== T.AT_DOCK) mustOpenTruck(id);
        const cur = data.getLoad(id);
        if (!cur || (cur.status !== T.AT_DOCK && !isOpen(cur))) throw closedErr(cur);
```

- `truckView` should already expose `x.data` fields. Add `docsSync: d.docsSync || null` and `docLines` to the truck block, so the UI can render them.
- Approvals: in the approvals payload (~1732, `retries`), add `outOfSync: trucks.filter(x => x.status === T.AT_DOCK && x.data.docsSync).map(x => Object.assign(sum(x), { error: x.data.docsSync.error, at: x.data.docsSync.at }))`.

- [ ] **Step 4: Run all tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/move_verify.js move_portal/test/portal.test.js
git commit -m "feat(dock): live TO + IF edits at the dock, stock refusal, undo, out-of-sync Retry"
```

---

### Task 5: Seal at the dock + Picked up

**Files:**
- Modify: `move_portal/sl_move_portal.js`: new `dock_seal`, `picked_up`; `shipPallets` from Task 3
- Modify: `move_portal/move_verify.js`: `sealOf` reads `depart.seal` when present (it already does; confirm that an empty seal returns `''`, which never collides)
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `T.AT_DOCK`, `data.alloc`, `data.depart`, `tx.apply({op:'if_stamp'})` (existing `stampShip`: checks A/B, checks ticked qty = `op.lines`, stamps, sets C, idempotent), `tx.apply({op:'if_seal'})`.
- Produces:
  - `act('dock_seal', false, { truckId, seal })`. On a `ship_pending` scan truck it updates `shipReq.seal`. At the dock it sets `depart.seal`, then stamps each IF with `if_seal` (on mode).
  - `act('picked_up', false, { truckId, seal? })` → `{ view, written, planOnly }`. Truck goes to `departed`, pallets to `in_transit`, and `depart.pickedUpAt` / `pickedUpBy` / `seal` are set.

- [ ] **Step 1: Write the failing tests:**

```js
test('picked up: refused without a seal; with one, each IF is stamped Shipped and the truck leaves', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    assert.throws(() => ctx.run('picked_up', { truckId: t.id }, false), /Enter the seal/);
    const r = ctx.run('picked_up', { truckId: t.id, seal: '5249330' }, false);
    const st = ctx.tx._t.ops.find(o => o.op === 'if_stamp'), d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([st.ifId, st.seal, st.trailer, st.lines], [d.ifId, '5249330', d.trailer, { '11': 240 }]);
    assert.deepEqual([ctx.data.getLoad(t.id).status, d.depart.seal, d.depart.pickedUpBy], ['departed', '5249330', 'Miguel']);
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'in_transit'));
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code }, false), /closed|left/i);
    t.ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const ir = ctx.tx._t.ops.find(o => o.op === 'receipt');
    assert.deepEqual([ir.ifId, ir.toId, ir.lines], [d.ifId, d.toId, { '11': 240 }]);
});

test('dock seal: saved at the dock stamps the Picked IF; Picked up then needs no seal', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.run('dock_seal', { truckId: t.id, seal: '777' }, false);
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.seal]), [['if_seal', '777']]);
    ctx.run('picked_up', { truckId: t.id }, false);
    assert.equal(ctx.data.getLoad(t.id).status, 'departed');
});

test('picked up: a stamp failure keeps the truck at the dock with an error; pressing again finishes', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_stamp';
    assert.throws(() => ctx.run('picked_up', { truckId: t.id, seal: '9' }, false), /NetSuite/);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, !!x.data.error, x.data.claim], ['at_dock', true, '']);
    ctx.run('picked_up', { truckId: t.id, seal: '9' }, false);
    assert.equal(ctx.data.getLoad(t.id).status, 'departed');
});

test('picked up: refused while docs are out of sync; a seal used by another truck is refused', () => {
    const ctx = scanSetup();
    const a = atDock(ctx, 1), b = atDock(ctx, 1);
    ctx.run('picked_up', { truckId: a.id, seal: '55' }, false);
    assert.throws(() => ctx.run('picked_up', { truckId: b.id, seal: '55' }, false), /already on/);
    ctx.data.updateLoad(ctx.data.getLoad(b.id), { data: { docsSync: { error: 'x', pending: [] } } });
    assert.throws(() => ctx.run('picked_up', { truckId: b.id, seal: '56' }, false), /out of sync/);
});
```

Move the unload/receipt half of the old scan-built Approve tests (split in Task 3) into here, with a `picked_up` call between Approve and unload.

- [ ] **Step 2: Run them and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL (`Unknown action picked_up`). Match the actual unknown-action message in `_runAction`.

- [ ] **Step 3: Implement** (after `dock_resync`):

```js
    act('dock_seal', false, (a, c) => {
        const seal = String(a.seal || '').trim();
        if (!seal) throw userErr('Enter the seal #');
        if (seal.length > 30) throw userErr('The seal # is too long (30 characters max)');
        const x = mustTruck(a.truckId);
        if (!isScan(x)) throw userErr('This truck takes its seal at Mark shipped');
        sealTaken(seal, x.id);
        if (x.status === T.SHIP_PENDING && !x.data.claim) {
            data.updateLoad(data.getLoad(x.id), { data: { shipReq: Object.assign({}, x.data.shipReq, { seal: seal }) } });
            return { view: truckView(mustTruck(x.id), c) };
        }
        const cl = claimLoad(x, null, 'dock', mustAtDock);
        try {
            if (writeMode(c) === 'on') (cl.Ld.data.alloc || []).forEach(f => tx.apply({ op: 'if_seal', ifId: f.ifId, ifNum: f.ifNum, seal: seal }));
        } catch (e) {
            data.updateLoad(data.getLoad(x.id), { data: { claim: '', workingAt: 0, phase: '' } });
            throw userErr('The seal was not saved: ' + (e.message || e));
        }
        data.updateLoad(data.getLoad(x.id), { data: { claim: '', workingAt: 0, phase: '', depart: Object.assign({}, cl.Ld.data.depart, { seal: seal }) } });
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('picked_up', false, (a, c) => {
        const x = mustTruck(a.truckId);
        if (x.status !== T.AT_DOCK) throw userErr('This truck is ' + x.status + ', not waiting at the dock');
        const seal = String(a.seal || (x.data.depart && x.data.depart.seal) || '').trim();
        if (!seal) throw userErr('Enter the seal # before the carrier leaves');
        if (seal.length > 30) throw userErr('The seal # is too long (30 characters max)');
        sealTaken(seal, x.id);
        if (!data.palletsByLoad(x.id, [VP.LOADED]).length) throw userErr('Nothing is loaded on this truck');
        const cl = claimLoad(x, null, 'pickup', mustAtDock);
        const d = cl.Ld.data, ref = d.approveRef || x.id, memo = verify.memoFor(d.depart.truckNo, d.depart.day) + ' · ' + verify.scanTag(ref);
        const ops = (d.alloc || []).map(f => ({ op: 'if_stamp', ifId: f.ifId, ifNum: f.ifNum, trailer: d.depart.trailer || d.trailer, seal: seal, memo: memo, lines: f.lines }));
        const writes = Object.assign({}, d.writes);
        let res;
        try {
            res = verify.runOps(ops, writeMode(c), op => { assertClaim(x.id, cl.claim, truckLabel(x), 'pickup'); return tx.apply(op); }, writes,
                (k, id) => { writes[k] = id; data.updateLoad(data.getLoad(x.id), { data: { writes: writes } }); });
        } catch (e) {
            if (e.user) throw e;
            log.error({ title: 'move pickup ' + x.id, details: (e && e.stack) || String(e) });
            data.updateLoad(data.getLoad(x.id), { data: { claim: '', workingAt: 0, phase: '', error: e.message || String(e), writes: writes } });
            throw userErr('Picked up was not saved: a NetSuite write failed (' + (e.message || e) + '). Press Picked up again.');
        }
        assertClaim(x.id, cl.claim, truckLabel(x), 'pickup');
        const day = c.now.dayIso;
        shipPallets(mustTruck(x.id), c, null, day);                   // every loaded pallet leaves, shippedDay = the pickup day
        data.updateLoad(data.getLoad(x.id), { status: T.DEPARTED, data: { claim: '', workingAt: 0, phase: '', error: '', writes: writes,
            depart: Object.assign({}, d.depart, { seal: seal, pickedUpAt: c.now.stamp, pickedUpBy: c.actor, shippedDay: day }), lastStep: stepOf('picked_up', c) } });
        return { written: res.written, planOnly: res.planOnly, view: truckView(mustTruck(x.id), c) };
    });
```

`shipPallets(x, c, planned, day)` comes from Task 3. Passing `day` makes the moved-per-day counts use the pickup day.

`if_stamp` writes key `if_stamp:<ifId>` into `data.writes`. A retry skips the stamps that landed, and `stampShip` itself is idempotent too. In the failure test, the `failOn` fake throws once and then clears itself, so the second press succeeds.

The receipt flow (`receiptView` / `planReceipts`) reads `data.alloc` and `depart`. Both are kept, so no change is expected. If the receipt test fails, check what `receiptView` reads (e.g. `d.departPallets`) and record the fix in the ledger.

- [ ] **Step 4: Run all tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/move_verify.js move_portal/test/portal.test.js
git commit -m "feat(dock): seal at the dock and Picked up (IF Shipped, pallets in transit)"
```

---

### Task 6: UI: Shipments, the at-dock load screen, approvals, pills, Dashboard

**Files:**
- Modify: `move_portal/move_ui.js`: `PILL` (line 135), `shipList` (~775–800), `shipCard` (801), `ACT.dmark` (833), the load-screen render for an opened truck (find where `truck_get` results paint the loading screen and where `Finish loading` renders), `shipConfirmCard` (1181), approvals paint (Approve message ~1296–1310), `STAGES` (1486)
- Test: `move_portal/test/ui.test.js`

**Interfaces:**
- Consumes: the server fields from Tasks 3–5: `truck.status === 'at_dock'`, `truck.scan`, `truck.docsSync`, `truck.docLines`, `toNum/ifNum`, `depart.seal`, approvals `outOfSync[]`, actions `ship_mark` (seal optional), `dock_seal`, `picked_up`, `dock_resync`, Approve response `atDock`.
- Produces: user-visible copy (exact strings below).

Check `test/ui.test.js` for how UI tests render (they likely `loadAmd('move_ui.js')` and assert on the HTML strings returned by a page builder, or exercise pure helpers). Follow that pattern. If the page JS is only a string, the tests assert that `clientMain.toString()` contains the strings.

- [ ] **Step 1: Write the failing UI tests** (adapt to the harness found):

```js
test('ui: drop-trailer copy is present', () => {
    const src = uiSource();   // whatever ui.test.js already uses to get the client source
    ['Ready for docs', '📄 Send for docs', 'Waiting for docs', 'At dock', '📄 Docs ready · at dock', '🚛 Picked up',
        'Approve writes the TO + IF (Picked). Shipped happens at pickup.', 'Docs out of sync', 'Every scan updates the TO + IF'].forEach(s => assert.ok(src.includes(s), s));
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `PILL`: add `at_dock: ['📄 Docs ready · at dock', 'p-green']`. For scan trucks, relabel in `statusPill(status, scan)`: `ready` → `['✅ Ready for docs','p-green']`, `ship_pending` → `['Waiting for docs','p-amber']`, `departing` → `['Writing docs…','p-amber']`. Pass `t.scan` where pills render truck summaries.
- `shipList`: buckets.
  - `ready`: status `ready`.
  - `wait`: `ship_pending` or `departing`.
  - `dock`: `at_dock`. Fetch `truck_get` for these too, for TO/IF #, seal and docsSync.
  - Headings for scan trucks: `<h3>Ready for docs</h3>`, `<h3>Waiting for docs</h3>`, `<h3>At dock</h3>`, `<h3>Shipped today</h3>`. Office trucks keep the current headings: render the office buckets as before when `!t.scan`.
  - The Waiting card text for scan: `'Sent for docs by ' + who + ' · ' + at` and `Seal ` only if present.
- `shipCard` (scan): label the seal field `Seal # (optional)`. Button `'<button class="btn go" data-act="dmark" data-id="..">📄 Send for docs</button>'`.
- `ACT.dmark`: when `v.scan`, skip the "Enter the seal #" check. The confirm text is `'Send this trailer for docs? A manager approves them in Approvals.'`, and the success flash is `'📄 ' + label + ' sent for docs'`.
- New `dockCard(t, v)`:

```js
        function dockCard(t, v) {
            const id = esc(t.id), d = (v && v.truck) || t, dep = d.depart || {};
            const sync = v && v.truck.docsSync;
            return '<div class="card ' + (sync ? 'amberc' : 'greenc') + '"><h4>🚚 ' + esc(t.label) + ' ' + statusPill('at_dock', true) + '</h4>' +
                '<div class="muted">' + esc([d.toNum, d.ifNum, 'Trailer ' + (v ? v.trailer : '')].filter(Boolean).join(' · ')) + '</div>' +
                '<div class="muted">' + num(v ? v.totals.pallets : t.pallets) + ' pallets · ' + num(v ? v.totals.pieces : 0) + ' pcs · Every scan updates the TO + IF</div>' +
                (sync ? flash('amber', '⚠ Docs out of sync', 'A manager must press Retry in Approvals before more scans.') : '') +
                '<label class="f" for="d_seal_' + id + '">Seal #</label><input class="inp" id="d_seal_' + id + '" data-keep="1" maxlength="30" value="' + esc(dep.seal || '') + '" autocomplete="off">' +
                '<div id="d_msg_' + id + '"></div><div class="row2"><button class="btn gh" data-act="dseal" data-id="' + id + '">Save seal</button>' +
                '<button class="btn go" data-act="dpicked" data-id="' + id + '"' + (sync ? ' disabled' : '') + '>🚛 Picked up</button></div></div>';
        }
        ACT.dseal = async el => {
            const id = el.dataset.id, sv = ($('d_seal_' + id).value || '').trim();
            if (needWho()) return;
            if (!sv) { tone('bad'); $('d_msg_' + id).innerHTML = errBox('Enter the seal #'); return; }
            busy(el, true);
            const r = await api('dock_seal', { truckId: id, seal: sv });
            busy(el, false);
            $('d_msg_' + id).innerHTML = r.ok ? flash('green', 'Seal saved') : errBox(r.error);
        };
        ACT.dpicked = async el => {
            const id = el.dataset.id, inp = $('d_seal_' + id), sv = inp ? inp.value.trim() : '';
            if (needWho()) return;
            if (!sv) { tone('bad'); $('d_msg_' + id).innerHTML = errBox('Enter the seal # before the carrier leaves'); inp && inp.focus(); return; }
            if (!confirm('Carrier has the trailer? This marks the IF Shipped in NetSuite.')) return;
            busy(el, true);
            const r = await api('picked_up', { truckId: id, seal: sv });
            busy(el, false);
            if (!r.ok) { tone('bad'); $('d_msg_' + id).innerHTML = errBox(r.error); return; }
            tone('ok');
            shipList(flash('green', '🚛 ' + esc(r.view.truck.label) + ' picked up', esc('Seal ' + sv), 'In transit to Tippecanoe.'));
        };
```

- **Load screen for an at-dock truck:** where the opened truck renders (search for `Finish loading` and the `opentruck` handler), when `v.truck.status === 'at_dock'`:
  - show a top banner `flash('green', '📄 Docs ready · at dock', esc([v.truck.toNum, v.truck.ifNum].join(' · ')), 'Every scan updates the TO + IF')`;
  - keep the scan input and the On/Take off toggle;
  - hide `Finish loading` and Verify;
  - for `r.result === 'short' | 'refused' | 'out_of_sync'`, show `flash('red', '❌ ' + esc(r.message))` (out_of_sync → amber with the `⚠ Docs out of sync` title).
  - The floor's "Trucks loading" list (line ~531) also lists at-dock trucks (server Task 3). Label them with the at-dock pill.
- **Approvals** `shipConfirmCard` (scan branch):
  - the subtitle is `'Seal ' + x.seal` only if present, else `'No seal yet'`;
  - the footer text is exactly `'Approve writes the TO + IF (Picked). Shipped happens at pickup.'`;
  - after Approve (`r.atDock`), the message is `'📄 Docs written: ' + (r.toNum || 'TO') + ' · ' + (r.ifNum || 'IF') + ' (Picked). The floor taps Picked up when the carrier takes the trailer.'`, or `'Plan saved (writes are off)'` when `r.planOnly.length && !r.toNum`.
- **Approvals** out-of-sync section: for each `outOfSync` row, a card `⚠ <label> · Docs out of sync`, the error text, and a button `data-act="dresync"` → `api('dock_resync', { truckId })`, then repaint.
- `STAGES` (1486): `['Receipt pending', 'Waiting for manager', 'Waiting for docs', 'At dock', 'Ready for docs', 'Ready to ship', 'Needs IF fix', 'Loading', 'In transit', 'Unloading', 'Received']`. This matches the server `STAGE_ORDER` from Task 3.

- [ ] **Step 4: Run all tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(dock): Shipments docs/at-dock UI, Picked up, at-dock scanning, approvals copy"
```

---

### Task 7: Local beta click-through + handoff docs

**Files:**
- Modify: `move_portal/test/preview_server.js` (only if the beta stand-in doesn't route the new actions; check for an explicit action allowlist)
- Modify: `move_portal/local/snapshot_ns.js` / stand-in tx (only if the beta's stand-in `tx` needs `to_line` / `if_seal` / `ship:'picked'` handling; it creates scan-built TOs and IFs per commit `4307fd9`)
- Modify: `CLAUDE.md`, `docs/sdd-ledger/progress.md`

- [ ] **Step 1:** Find the beta's stand-in transaction layer (`grep -n "to_create" move_portal/local/*.js move_portal/test/preview_server.js`). Make it handle `to_line` (adjust its stored TO line), `if_qty` with `newLine` (add the line, so the beta needs no fallback), `if_create` `ship:'picked'` (status A), `if_seal` and `if_stamp` on A. If it has its own node tests, add one per op there.
- [ ] **Step 2:** Run the beta: `node move_portal/test/preview_server.js`, then open `http://localhost:8765`. A fresh `local/store.json` seeds `officeIfs: false`.
- [ ] **Step 3:** Click through the flow:
  1. Excel labels (YSN201 + a second SKU) → start a truck → scan 2 YSN201 → Finish loading → Verify.
  2. Shipments → **Send for docs** with no seal.
  3. Manager Approvals → **Approve docs**. The message names the TO/IF (Picked). The truck shows **At dock**.
  4. Floor: open the at-dock truck → scan a third YSN201 → ✅. Scan a second-SKU pallet → ✅. Add an other item. Take a pallet off.
  5. Shipments → At dock → enter the seal → **Save seal** → **🚛 Picked up**. The truck goes to In transit.
  6. Unload at Tippecanoe → approve the receipt. The IR matches the final pallet counts.
- [ ] **Step 4:** Update `CLAUDE.md`. Add a new READ FIRST block (2026-10-16): the drop-trailer flow built, the commit range, the test count, and the sandbox checks **S1–S5** from the spec as NEXT, with S1 first (does an existing Picked IF take a new TO line?). Also record that the state mapping reuses `ship_pending` / `departing`. Add ledger entries (rulings, edited legacy tests, deferred minors: mixed-SKU partial-undo corner; an at-dock pallet on another truck can't use "move here").
- [ ] **Step 5:** Run all tests once more: `node --test "move_portal/test/*.test.js"`. Expected: PASS.
- [ ] **Step 6: Commit and push**

```bash
git add -A move_portal CLAUDE.md docs/sdd-ledger
git commit -m "docs(dock): drop-trailer flow handoff; beta stand-in supports at-dock ops"
git push
```

---

## Self-review notes

- **Spec coverage:**
  - §2 D1 (no BOL): nothing built. D2: Tasks 3 and 5. D3: Task 5 floor actions. D4: Tasks 3 and 5. D5, D7 and D8: Task 4. D6: Task 4 `editOther`.
  - §3 states: Tasks 3 and 6. §3 stages: Tasks 3 and 6. §4: Task 4. §5: all. §6 node tests: Tasks 1–6. Beta: Task 7. Sandbox S1–S5: handed off in Task 7. §7: Task 7 docs.
- **Deliberate mapping:** spec `docs_pending` = `ship_pending`, `docs_writing` = `departing`. This reuses the claim, Retry and Release machinery. The UI shows the spec's labels.
- **Watch:** `shipPallets(x, c, planned, day)` has one signature across Tasks 3 and 5. `verify.memoFor` must be exported (Task 4 notes it).
