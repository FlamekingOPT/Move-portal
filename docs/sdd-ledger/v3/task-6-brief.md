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

