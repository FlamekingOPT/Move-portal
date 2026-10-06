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

