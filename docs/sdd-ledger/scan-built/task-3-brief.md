### Task 3: NetSuite writes: create TO, find by tag, TO closed check (move_tx + fake_tx)

**Files:**
- Modify: `move_portal/move_tx.js`
- Modify: `move_portal/test/fake_tx.js`
- Test: `move_portal/test/move_tx.test.js`

**Interfaces:**
- Consumes: ops from Task 2.
- Produces:
  - fake `_t.failOn` may be a key string (as today) or a predicate `op => boolean` (used by Task 6).
  - `tx.apply(toOp) → toId string`. Finds an existing TO whose memo contains the token, else creates one.
  - `tx.apply(ifOp with ship: true and token) → ifId string`. Finds an existing Shipped IF created from `toId` whose memo contains the token, else transforms, stamps and saves it.
  - `tx.toClosed(toId) → boolean`. True when the TO is Closed (`orderstatus` `H`), every line is closed, or the TO no longer exists.
  - `tx.tranIds(ids, 'to') → { id: 'TO8812' }`
  - fake: `makeFakeTx()._t.closed = {}` (ids the fake treats as closed); `to_create` returns a new seq id.

- [ ] **Step 1: Write the failing tests**

In `move_portal/test/move_tx.test.js`, extend `setup` so the fakes support create, lookupFields and the TO type:

```js
// in setup(): add to fakeRecord
        create: o => { const r = makeRec({}, []); r.id = '650'; r.type = o.type; log.created = r;
            r.selectNewLine = () => { r.lines.push({}); r.cur = r.lines.length - 1; }; return r; },
// and in fakeSearch: add the transfer-order type and lookupFields
    fakeSearch.Type.TRANSFER_ORDER = 'transferorder';
    fakeSearch.Type.LOCATION = 'location';
    fakeSearch.lookupFields = o => (o.type === 'location' ? { subsidiary: [{ value: '2', text: 'Flame King' }] } : { tranid: 'TO8812' });
```

(`fakeSearch` is declared with `const`; add the two `Type` keys and `lookupFields` right after it is built, before `loadAmd`.) Then append:

```js
const toOp = () => ({ op: 'to_create', ref: '12', token: '[MV-12]', fromLoc: '35', toLoc: '46', orderStatus: 'B', lines: { '975': 504, '111': 36 }, memo: '[MV-12] Trailer 537224 · Truck 3 · 11/02' });

test('to_create makes an approved TO 35 → 46 with one line per item', () => {
    const s = setup({});
    assert.equal(s.tx.apply(toOp()), '777');
    const r = s.log.created;
    assert.deepEqual([r.values.subsidiary, r.values.location, r.values.transferlocation, r.values.orderstatus, r.values.memo], ['2', '35', '46', 'B', '[MV-12] Trailer 537224 · Truck 3 · 11/02']);
    assert.deepEqual(r.lines.map(l => [l.item, l.quantity]), [['975', 504], ['111', 36]]);
    assert.equal(r.saved, 1);
});

test('to_create finds a TO an earlier request made, by its tag, and creates nothing', () => {
    const s = setup({ found: '640' });
    assert.equal(s.tx.apply(toOp()), '640');
    assert.equal(s.log.created, undefined);
    const f = JSON.stringify(s.log.searches[0].filters);
    assert.ok(f.indexOf('[MV-12]') !== -1 && f.indexOf('TrnfrOrd') !== -1);
});

test('if_create Shipped with a token finds an earlier Shipped IF on that TO, else stamps a new one', () => {
    let s = setup({ found: '901' });
    const op = { op: 'if_create', ref: '12', toId: '600', ship: true, token: '[MV-12]', lines: { '975': 24 }, trailer: '537224', seal: '0048812', memo: 'Truck 3 · 11/02 · [MV-12]' };
    assert.equal(s.tx.apply(op), '901');
    assert.equal(s.log.transforms.length, 0);
    assert.ok(JSON.stringify(s.log.searches[0].filters).indexOf('ItemShip:C') !== -1);
    s = setup({ toLines: [{ item: '975', quantity: 24 }] });
    assert.equal(s.tx.apply(op), '888');
    assert.deepEqual([s.log.last.values.shipstatus, s.log.last.values.memo, s.log.last.values.custbody7], ['C', 'Truck 3 · 11/02 · [MV-12]', 'SEAL: 0048812']);
});

test('toClosed: Closed status, every line closed, or gone', () => {
    const s = setup({ to: [{ item: '975', quantity: 600, isclosed: true }] });
    assert.equal(s.tx.toClosed('600'), true);
    const s2 = setup({ to: [{ item: '975', quantity: 600, isclosed: false }] });
    assert.equal(s2.tx.toClosed('600'), false);
    assert.equal(s2.tx.toClosed('999'), true);                     // no such TO (deleted)
    assert.deepEqual(s2.tx.tranIds(['5'], 'to'), { '5': 'TO8812' });
});
```

In the gone case the fake `load` throws `no rec …`. `toClosed` treats any load error whose message contains `RCRD_DSNT_EXIST` **or** `no rec` as gone. The real NetSuite error code is `RCRD_DSNT_EXIST`; the `no rec` match exists only for the fake, and a comment in the code says so.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/move_tx.test.js"`
Expected: FAIL. `to_create` throws `Unknown op to_create`, and `s.tx.toClosed is not a function`.

- [ ] **Step 3: Implement**

In `move_portal/move_tx.js`, add after `findPackedByToken`:

```js
    // A transaction the portal made earlier, found by the [MV-<ref>] tag in its memo (a request that died after the save, before it was recorded).
    function findByToken(tok, typeCode, more) {
        const r = search.create({ type: search.Type.TRANSACTION,
            filters: [['memo', 'contains', tok], 'AND', ['mainline', 'is', 'T'], 'AND', ['type', 'anyof', typeCode]].concat(more || []),
            columns: ['internalid'] }).run().getRange({ start: 0, end: 1 });
        return r && r[0] ? String(r[0].id) : null;
    }
    function locationSubsidiary(locId) {
        const f = search.lookupFields({ type: search.Type.LOCATION, id: locId, columns: ['subsidiary'] });
        const s = f && f.subsidiary;
        return Array.isArray(s) && s.length ? s[0].value : null;
    }
    // Scan-built truck (spec 2026-10-14 §3.1): an approved TO from Riverside to Tippecanoe, one line per item.
    function createTransferOrder(op) {
        const found = findByToken(op.token, 'TrnfrOrd');
        if (found) return found;
        const to = record.create({ type: record.Type.TRANSFER_ORDER, isDynamic: true });
        const sub = locationSubsidiary(op.fromLoc);
        if (sub) to.setValue({ fieldId: 'subsidiary', value: sub });
        to.setValue({ fieldId: 'location', value: op.fromLoc });
        to.setValue({ fieldId: 'transferlocation', value: op.toLoc });
        to.setValue({ fieldId: 'orderstatus', value: op.orderStatus || 'B' });
        to.setValue({ fieldId: 'memo', value: op.memo });
        Object.keys(op.lines).forEach(item => {
            to.selectNewLine({ sublistId: 'item' });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: item });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: op.lines[item] });
            to.commitLine({ sublistId: 'item' });
        });
        return String(to.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    // Release check: a TO the manager closed (or deleted) in NetSuite. "no rec" is the test fake's not-found message.
    function toClosed(toId) {
        let to;
        try { to = record.load({ type: record.Type.TRANSFER_ORDER, id: toId }); }
        catch (e) { const m = String((e && (e.name || '')) + ' ' + (e && e.message || '')); if (/RCRD_DSNT_EXIST|no rec/.test(m)) return true; throw e; }
        if (String(to.getValue({ fieldId: 'orderstatus' }) || '') === 'H') return true;
        const n = to.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < n; i++) if (to.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i }) !== true) return false;
        return n > 0;
    }
```

At the top of `createIf`, after the Packed-token block, add:

```js
        if (op.ship === true && op.token) {           // scan-built: a Shipped IF an earlier request saved on this TO
            const found = findByToken(op.token, 'ItemShip', ['AND', ['createdfrom', 'anyof', String(op.toId)], 'AND', ['status', 'anyof', ['ItemShip:C']]]);
            if (found) return found;
        }
```

In `apply`, add `if (op.op === 'to_create') return createTransferOrder(op);` as the first line. In `tranIds`, replace the type/prefix line with:

```js
        const isIf = kind === 'if', isTo = kind === 'to';
        const type = isTo ? search.Type.TRANSFER_ORDER : isIf ? search.Type.ITEM_FULFILLMENT : search.Type.ITEM_RECEIPT, pre = isTo ? 'TO' : isIf ? 'IF' : 'IR';
```

and change the replace regex to `/^(I[FR]|TO)/i`. Export `toClosed`.

In `move_portal/test/fake_tx.js`: set `const t = { seq: 900, ops: [], failOn: null, closed: {} };`. Let `failOn` also be a predicate on the op, because a scan truck's IF op reaches `apply` already resolved, so its key isn't known in advance:
`if (t.failOn && (typeof t.failOn === 'function' ? t.failOn(op) : t.failOn === key)) { t.failOn = null; throw … }`. Keep `apply` (it already returns `++seq` for any op other than `if_qty` / `if_stamp`, so `to_create` gets an id), add `toClosed: id => !!t.closed[String(id)]`, and change `tranIds` to `(kind === 'to' ? 'TO' : kind === 'if' ? 'IF' : 'IR') + id`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 301 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_tx.js move_portal/test/fake_tx.js move_portal/test/move_tx.test.js
git commit -m "feat(scan): create the move TO, find TO/IF by tag on retry, TO closed check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

