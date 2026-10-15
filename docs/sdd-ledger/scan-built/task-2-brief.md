### Task 2: Approve plan, write keys and scan classification (move_verify)

**Files:**
- Modify: `move_portal/move_verify.js` (`classifyLoadScan`, `opKey`, `resolveNew`, new `scanTag`, `scanApprovePlan`)
- Test: `move_portal/test/verify.test.js`

**Interfaces:**
- Consumes: `memoFor(truckNo, dayIso)` (existing).
- Produces:
  - `verify.scanTag(ref) → '[MV-<ref>]'`
  - `verify.scanApprovePlan({ ref, lines: {item: pcs}, stamp: { trailer, seal, truckNo, dayIso }, S: { locFrom, locTo, toStatus } }) → { ops: [toOp, ifOp], alloc: [{ ifId: 'new:<ref>', ifNum: '(new)', toId: 'new:to:<ref>', toNum: '(new TO)', lines, addOn: false }], unplanned: [], corrections: [], bol: null }`
  - `toOp = { op: 'to_create', ref, token, fromLoc, toLoc, orderStatus, lines, memo }`
  - `ifOp = { op: 'if_create', ref, toId: 'new:to:<ref>', ship: true, token, lines, trailer, seal, memo }`
  - `opKey(toOp) = 'to_create:<ref>'`; `opKey(ifOp) = 'if_create:new:to:<ref>'` (existing rule)
  - `resolveNew(op, writes)` also resolves `toId: 'new:to:<ref>'` → `writes['to_create:<ref>']`
  - `classifyLoadScan({ pallet, truckId, trucks, scanBuilt: true })` → `{ result: 'ok', set: { status: 'loaded', loadId } }` for a labeled pallet

- [ ] **Step 1: Write the failing tests**

Append to `move_portal/test/verify.test.js`:

```js
test('scanApprovePlan: a TO then a Shipped IF on it, tagged, with keys that never collide', () => {
    const p = verify.scanApprovePlan({ ref: '12', lines: { '11': 504, '12': 36 }, stamp: { trailer: '537224', seal: '0048812', truckNo: 3, dayIso: '2026-11-02' },
        S: { locFrom: '35', locTo: '46', toStatus: 'B' } });
    const [to, f] = p.ops;
    assert.deepEqual(to, { op: 'to_create', ref: '12', token: '[MV-12]', fromLoc: '35', toLoc: '46', orderStatus: 'B', lines: { '11': 504, '12': 36 },
        memo: '[MV-12] Trailer 537224 · Truck 3 · 11/02' });
    assert.deepEqual(f, { op: 'if_create', ref: '12', toId: 'new:to:12', ship: true, token: '[MV-12]', lines: { '11': 504, '12': 36 },
        trailer: '537224', seal: '0048812', memo: 'Truck 3 · 11/02 · [MV-12]' });
    assert.deepEqual(p.alloc, [{ ifId: 'new:12', ifNum: '(new)', toId: 'new:to:12', toNum: '(new TO)', lines: { '11': 504, '12': 36 }, addOn: false }]);
    assert.deepEqual([p.unplanned, p.corrections, p.bol], [[], [], null]);
    assert.equal(verify.opKey(to), 'to_create:12');
    assert.equal(verify.opKey(f), 'if_create:new:to:12');
    const late = verify.scanApprovePlan({ ref: '12-P900', lines: { '11': 72 }, stamp: { trailer: 't', seal: 's', truckNo: 3, dayIso: '2026-11-02' }, S: { locFrom: '35', locTo: '46' } });
    assert.equal(late.ops[0].orderStatus, 'B');                       // toStatus missing → B
    assert.notEqual(verify.opKey(late.ops[0]), verify.opKey(to));
    assert.notEqual(verify.opKey(late.ops[1]), verify.opKey(f));
});

test('to_create writes only in on mode; resolveNew swaps the new TO and IF ids', () => {
    const to = { op: 'to_create', ref: '12' };
    assert.deepEqual([verify.opAllowed(to, 'off'), verify.opAllowed(to, 'qty'), verify.opAllowed(to, 'on')], [false, false, true]);
    const writes = { 'to_create:12': '700', 'if_create:new:to:12': '800' };
    assert.deepEqual(verify.resolveNew({ op: 'if_create', toId: 'new:to:12', ref: '12' }, writes), { op: 'if_create', toId: '700', ref: '12' });
    assert.deepEqual(verify.resolveNew({ op: 'receipt', ifId: 'new:12', toId: 'new:to:12' }, writes), { op: 'receipt', ifId: '800', toId: '700' });
    assert.throws(() => verify.resolveNew({ op: 'if_create', toId: 'new:to:13' }, writes), /The TO for 13 was not created yet/);
    assert.deepEqual(verify.resolveNew({ op: 'receipt', ifId: 'new:600', toId: '600' }, { 'if_create:600': '901' }), { op: 'receipt', ifId: '901', toId: '600' });   // office add-on: unchanged
});

test('a scan-built truck loads any labeled pallet without a TO check', () => {
    const p = { id: 5, status: 'labeled', loadId: '', lines: [{ item: '99', pcs: 10 }] };
    assert.deepEqual(verify.classifyLoadScan({ pallet: p, truckId: '7', trucks: {}, scanBuilt: true }), { result: 'ok', set: { status: 'loaded', loadId: '7' } });
    assert.equal(verify.classifyLoadScan({ pallet: Object.assign({}, p, { status: 'void' }), truckId: '7', trucks: {}, scanBuilt: true }).result, 'void');
    assert.equal(verify.classifyLoadScan({ pallet: p, truckId: '7', trucks: {}, ifs: [], toLines: [], loadedByItem: {} }).result, 'no_to');   // office truck: unchanged
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `verify.scanApprovePlan is not a function`.

- [ ] **Step 3: Implement**

In `classifyLoadScan`, replace the last line `return fitOnTruck(p, o);` with:

```js
        if (o.scanBuilt) return { result: 'ok', set: { status: VP.LOADED, loadId: String(o.truckId) } };   // the scans are the order: no TO to fit
        return fitOnTruck(p, o);
```

In `opKey`, add as the first line:

```js
        if (op.op === 'to_create') return 'to_create:' + op.ref;
```

Replace `resolveNew` with:

```js
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
```

Add after `memoFor`:

```js
    function scanTag(ref) { return '[MV-' + ref + ']'; }
    // Approve on a scan-built truck (spec 2026-10-14 §3): a new TO for what was scanned, then its IF saved Shipped with the stamp.
    function scanApprovePlan(o) {
        const ref = String(o.ref), tag = scanTag(ref), st = o.stamp || {}, S = o.S || {}, memo = memoFor(st.truckNo, st.dayIso);
        const lines = Object.assign({}, o.lines);
        const to = { op: 'to_create', ref: ref, token: tag, fromLoc: String(S.locFrom), toLoc: String(S.locTo), orderStatus: S.toStatus || 'B', lines: lines,
            memo: tag + ' Trailer ' + st.trailer + ' · ' + memo };
        const f = { op: 'if_create', ref: ref, toId: 'new:to:' + ref, ship: true, token: tag, lines: Object.assign({}, lines), trailer: st.trailer, seal: st.seal,
            memo: memo + ' · ' + tag };
        return { ops: [to, f], alloc: [{ ifId: 'new:' + ref, ifNum: '(new)', toId: 'new:to:' + ref, toNum: '(new TO)', lines: Object.assign({}, lines), addOn: false }],
            unplanned: [], corrections: [], bol: null };
    }
```

Add `scanTag, scanApprovePlan` to the exports. (`opAllowed` already allows only `if_qty` in `qty` mode, so `to_create` is on-only with no change.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 297 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(scan): approve plan (TO then Shipped IF), new:to placeholders, scan-built load scans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

