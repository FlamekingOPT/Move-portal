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

