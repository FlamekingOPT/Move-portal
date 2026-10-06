### Task 1: Pure rules (`verifyLoad`, `diffText`, `ifSuggestions`, `correctionOps`)

**Files:**
- Modify: `move_portal/move_verify.js`
- Test: `move_portal/test/verify.test.js` (append)

**Interfaces:**
- Consumes (existing, in-module): `refreshIfs(saved, fresh) → {ifs, gone, changes}`, `fillExpected(ifs, scannedByItem) → {alloc, left}`, `sumLines(pallets)`, `ifQty(f, item)`, `oldestFirst`, `byIfOrder`.
- Produces:
  - `TRUCK.NEEDS_FIX = 'needs_fix'` and `TRUCK.READY = 'ready'`.
  - `verifyLoad({savedIfs, freshIfs, pallets, toLines})` returns `{match, diffs, ifs}`. `ifs` = the fresh IFs still on the truck. Each `diffs` entry has `{key, kind, ...}`:
    - `if_gone`: `{ifId, ifNum}`
    - `if_empty`: `{ifId, ifNum}`
    - `if_short` / `if_over`: `{ifId, ifNum, toId, toNum, item, ifQty, loaded}`
    - `no_if`: `{item, qty, toId|null, toNum|null}`
  - `diffText(d, sku, pcsPerPallet) → string`: the instruction text from spec §4. `sku` is the SKU name. `pcsPerPallet` may be `null`.
  - `ifSuggestions({truckIfs, diffs, planned, takenIfIds}) → [planned IF]`: IFs on the truck's TOs or the `no_if` TOs, not on the truck, not taken.
  - `correctionOps(diffs)` returns ops:
    - `if_short`/`if_over` → `{op:'if_qty', ifId, ifNum, toId, item, from: ifQty, to: loaded, key}`
    - `no_if` with a `toId` → `{op:'if_create', toId, toNum, lines:{[item]: qty}, ship:false, key}`
    - `if_empty`/`if_gone` → `{op:'drop_if', ifId, ifNum, key}`
    - `no_if` without a `toId` → no op.

- [ ] **Step 1: Write the failing tests** (append to `verify.test.js`. `v`, `VP`, `pal` and `TOS` are already defined at the top of the file. `TOS` has TO500 item 975 remaining 24, TO600 item 975 remaining 504, TO700 item 11 remaining 1200.)

```js
const VIF = (id, toId, qty, item) => ({ ifId: String(id), ifNum: 'IF' + id, toId: String(toId), toNum: 'TO' + toId, status: 'B', lines: [{ item: item || '975', sku: 'YSN100', qty }] });
const onTruck = (n, item, pcs) => Array.from({ length: n }, (_, i) => pal(300 + i, VP.LOADED, '1', [{ item: item || '975', sku: 'YSN100', pcs: pcs || 12 }]));

test('verifyLoad: exact match', () => {
    const r = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual([r.match, r.diffs, r.ifs.map(f => f.ifId)], [true, [], ['9001']]);
});

test('verifyLoad: short, over, no IF (oldest open TO), empty IF, gone IF, fresh qty wins', () => {
    const short = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(40), toLines: TOS });
    assert.deepEqual(short.diffs, [{ key: 'if_short:9001:975', kind: 'if_short', ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', item: '975', ifQty: 504, loaded: 480 }]);
    const over = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(44), toLines: TOS });
    assert.deepEqual(over.diffs.map(d => [d.kind, d.loaded]), [['if_over', 528]]);
    const extra = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42).concat(onTruck(1, '11', 120)), toLines: TOS });
    assert.deepEqual(extra.diffs, [{ key: 'no_if:11', kind: 'no_if', item: '11', qty: 120, toId: '700', toNum: 'TO700' }]);
    const none = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42).concat(onTruck(1, '999', 5)), toLines: TOS });
    assert.deepEqual(none.diffs, [{ key: 'no_if:999', kind: 'no_if', item: '999', qty: 5, toId: null, toNum: null }]);
    const empty = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504), VIF(9002, 500, 504)], freshIfs: [VIF(9001, 500, 504), VIF(9002, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual(empty.diffs, [{ key: 'if_empty:9002', kind: 'if_empty', ifId: '9002', ifNum: 'IF9002' }]);
    const gone = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504), VIF(9002, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual(gone.diffs, [{ key: 'if_gone:9002', kind: 'if_gone', ifId: '9002', ifNum: 'IF9002' }]);
    const fixed = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 480)], pallets: onTruck(40), toLines: TOS });
    assert.equal(fixed.match, true);                                   // the office lowered the IF → now matches
});

test('diffText', () => {
    const d = { kind: 'if_short', ifNum: 'IF72287', item: '1031', ifQty: 1152, loaded: 1056 };
    assert.equal(v.diffText(d, 'YSN401', 48), 'IF72287 YSN401: IF 1,152 · loaded 1,056 → IF needs −96 (2 pallets)');
    assert.equal(v.diffText(Object.assign({}, d, { kind: 'if_over', loaded: 1200 }), 'YSN401', null), 'IF72287 YSN401: IF 1,152 · loaded 1,200 → IF needs +48');
    assert.equal(v.diffText({ kind: 'no_if', item: '1021', qty: 64, toNum: 'TO11710' }, 'YSN301'), 'YSN301 ×64 loaded, not on any IF → needs an IF from TO11710 (oldest open TO)');
    assert.equal(v.diffText({ kind: 'no_if', item: '9', qty: 5, toNum: null }, 'X1'), 'X1 ×5 loaded, not on any IF → no open TO: take it off the truck');
    assert.equal(v.diffText({ kind: 'if_empty', ifNum: 'IF72288' }), 'IF72288 has nothing loaded → take it off this truck');
    assert.equal(v.diffText({ kind: 'if_gone', ifNum: 'IF72288' }), 'IF72288 is no longer Packed in NetSuite → take it off this truck');
});

test('ifSuggestions: new IFs on the truck TOs or no_if TOs, not on the truck, not taken', () => {
    const planned = [VIF(9001, 500, 504), VIF(9050, 700, 120, '11'), VIF(9051, 500, 48), VIF(9052, 800, 10), VIF(9053, 700, 5, '11')];
    const diffs = [{ kind: 'no_if', item: '11', qty: 120, toId: '700', toNum: 'TO700' }];
    assert.deepEqual(v.ifSuggestions({ truckIfs: [VIF(9001, 500, 504)], diffs, planned, takenIfIds: { 9053: true } }).map(f => f.ifId), ['9050', '9051']);
});

test('correctionOps', () => {
    const ops = v.correctionOps([
        { key: 'if_short:9001:975', kind: 'if_short', ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', item: '975', ifQty: 504, loaded: 480 },
        { key: 'no_if:11', kind: 'no_if', item: '11', qty: 120, toId: '700', toNum: 'TO700' },
        { key: 'no_if:999', kind: 'no_if', item: '999', qty: 5, toId: null, toNum: null },
        { key: 'if_empty:9002', kind: 'if_empty', ifId: '9002', ifNum: 'IF9002' }]);
    assert.deepEqual(ops, [
        { op: 'if_qty', ifId: '9001', ifNum: 'IF9001', toId: '500', item: '975', from: 504, to: 480, key: 'if_short:9001:975' },
        { op: 'if_create', toId: '700', toNum: 'TO700', lines: { 11: 120 }, ship: false, key: 'no_if:11' },
        { op: 'drop_if', ifId: '9002', ifNum: 'IF9002', key: 'if_empty:9002' }]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `v.verifyLoad is not a function`.

- [ ] **Step 3: Implement.** Add `NEEDS_FIX: 'needs_fix', READY: 'ready'` to `TRUCK`. Add the functions below before the `return`, and export them.

```js
    // ── Verify Load (spec 2026-10-05 amendment §4) ───────────────────────
    function verifyLoad(o) {
        const fr = refreshIfs(o.savedIfs, o.freshIfs), ifs = byIfOrder(fr.ifs), diffs = [];
        fr.gone.forEach(g => diffs.push({ key: 'if_gone:' + g.ifId, kind: 'if_gone', ifId: String(g.ifId), ifNum: g.ifNum }));
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
        return { match: diffs.length === 0, diffs: diffs, ifs: ifs };
    }

    function fmt(n) { return Number(n).toLocaleString('en-US'); }
    function diffText(d, sku, pcsPerPallet) {
        const s = sku || d.item;
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
```

Also, in `reservationsFromTrucks`, trucks with status `needs_fix` or `ready` are placed like `loading` trucks. Their loaded surplus reserves room. Change `t.status === TRUCK.LOADING` to `[TRUCK.LOADING, TRUCK.NEEDS_FIX, TRUCK.READY].indexOf(t.status) !== -1`. And for any truck with `t.data.corrections` (ops planned by Correct the IF, Task 4), every `if_qty` raise or `if_create` whose key isn't written in NetSuite (`inNetSuite`) reserves room, the same way `t.data.plan` ops do. Add a test where a `needs_fix` truck's surplus reserves room against a second truck.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/verify.test.js"`, then the full suite.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(verify-load): verifyLoad, diffText, ifSuggestions, correctionOps"
```

---

