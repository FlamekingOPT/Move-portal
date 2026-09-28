### Task 2: Core scan rules, aggregation, numbering, tokens

**Files:**
- Modify: `move_portal/move_core.js` (fill the `(Task 2)` section and extend the `return`)
- Test: `move_portal/test/core.test.js` (append)

**Interfaces:**
- Consumes: `PALLET`, `LOAD` from Task 1.
- Produces:
  - `loadScanRule(pallet|null, loadId, loads) → {result, set?, otherLoadId?, otherNumber?}`
  - `receiveScanRule(pallet|null, loadId, loads) → {result, set?, otherLoadId?, otherNumber?, fromLoadNumber?}`
  - `pallet` is `{status, loadId}`; `loads` is `{[loadId]: {status, number}}`.
  - `toneFor(result) → 'ok'|'warn'|'bad'`
  - `aggregate(pallets) → {itemId: qty}`
  - `shortages(agg, avail) → [{item, need, avail}]`
  - `nextLoadNumber(numbers) → 'MV-001'`
  - `catchupNumber(parent, numbers) → 'MV-011-C1'`
  - `txToken(loadId, kind) → '[mv:17:to]'`

**Result values used by the UI:**
- load mode: `ok, dup, other_load, locked_load, void, shipped, unknown`
- receive mode: `ok, late, dup, dup_other, other_load, other_load_pending, arrived_unshipped, dup_catchup, void, unknown`

- [ ] **Step 1: Append the failing tests**

```js
// ── Task 2 ──
const LOADS = {
    '1': { status: L.LOADING, number: 'MV-001' }, '2': { status: L.LOADING, number: 'MV-002' },
    '3': { status: L.READY, number: 'MV-003' }, '4': { status: L.SHIPPED, number: 'MV-004' }
};

test('loadScanRule covers every pallet state', () => {
    assert.deepEqual(core.loadScanRule(null, '1', LOADS), { result: 'unknown' });
    assert.deepEqual(core.loadScanRule({ status: P.LABELED, loadId: '' }, '1', LOADS), { result: 'ok', set: { status: P.LOADED, loadId: '1' } });
    assert.deepEqual(core.loadScanRule({ status: P.LOADED, loadId: '1' }, 1, LOADS), { result: 'dup' });
    assert.deepEqual(core.loadScanRule({ status: P.LOADED, loadId: '2' }, '1', LOADS), { result: 'other_load', otherLoadId: '2', otherNumber: 'MV-002' });
    assert.deepEqual(core.loadScanRule({ status: P.LOADED, loadId: '3' }, '1', LOADS), { result: 'locked_load', otherLoadId: '3', otherNumber: 'MV-003' });
    assert.deepEqual(core.loadScanRule({ status: P.VOID, loadId: '' }, '1', LOADS), { result: 'void' });
    assert.deepEqual(core.loadScanRule({ status: P.SHIPPED, loadId: '4' }, '1', LOADS), { result: 'shipped', otherLoadId: '4', otherNumber: 'MV-004' });
    assert.equal(core.loadScanRule({ status: P.RECEIVED, loadId: '4' }, '1', LOADS).result, 'shipped');
    assert.equal(core.loadScanRule({ status: P.ARRIVED_UNSHIPPED, loadId: '' }, '1', LOADS).result, 'shipped');
});

test('receiveScanRule covers every pallet state', () => {
    assert.deepEqual(core.receiveScanRule(null, '4', LOADS), { result: 'unknown' });
    assert.deepEqual(core.receiveScanRule({ status: P.SHIPPED, loadId: '4' }, '4', LOADS), { result: 'ok', set: { status: P.RECEIVED } });
    assert.deepEqual(core.receiveScanRule({ status: P.MISSING, loadId: '4' }, '4', LOADS), { result: 'late', set: { status: P.RECEIVED } });
    assert.deepEqual(core.receiveScanRule({ status: P.SHIPPED, loadId: '4' }, '9', LOADS), { result: 'other_load', otherLoadId: '4', otherNumber: 'MV-004' });
    assert.deepEqual(core.receiveScanRule({ status: P.MISSING, loadId: '4' }, '9', LOADS), { result: 'other_load', otherLoadId: '4', otherNumber: 'MV-004' });
    assert.deepEqual(core.receiveScanRule({ status: P.RECEIVED, loadId: '4' }, '4', LOADS), { result: 'dup' });
    assert.deepEqual(core.receiveScanRule({ status: P.RECEIVED, loadId: '4' }, '9', LOADS), { result: 'dup_other', otherLoadId: '4', otherNumber: 'MV-004' });
    assert.deepEqual(core.receiveScanRule({ status: P.LABELED, loadId: '' }, '4', LOADS),
        { result: 'arrived_unshipped', set: { status: P.ARRIVED_UNSHIPPED, loadId: '' }, fromLoadNumber: '' });
    assert.deepEqual(core.receiveScanRule({ status: P.LOADED, loadId: '1' }, '4', LOADS),
        { result: 'arrived_unshipped', set: { status: P.ARRIVED_UNSHIPPED, loadId: '' }, fromLoadNumber: 'MV-001' });
    assert.deepEqual(core.receiveScanRule({ status: P.LOADED, loadId: '3' }, '4', LOADS), { result: 'other_load_pending', otherLoadId: '3', otherNumber: 'MV-003' });
    assert.deepEqual(core.receiveScanRule({ status: P.ARRIVED_UNSHIPPED, loadId: '' }, '4', LOADS), { result: 'dup_catchup' });
    assert.deepEqual(core.receiveScanRule({ status: P.VOID, loadId: '' }, '4', LOADS), { result: 'void' });
});

test('toneFor', () => {
    assert.equal(core.toneFor('ok'), 'ok');
    assert.equal(core.toneFor('late'), 'ok');
    assert.equal(core.toneFor('dup'), 'warn');
    assert.equal(core.toneFor('arrived_unshipped'), 'warn');
    assert.equal(core.toneFor('void'), 'bad');
    assert.equal(core.toneFor('whatever'), 'bad');
});

test('aggregate and shortages', () => {
    const pallets = [
        { lines: [{ item: '11', pcs: 120 }] },
        { lines: [{ item: 11, pcs: 120 }, { item: '12', pcs: 30 }] }
    ];
    const agg = core.aggregate(pallets);
    assert.deepEqual(agg, { '11': 240, '12': 30 });
    assert.deepEqual(core.shortages(agg, { '11': 200, '12': 30 }), [{ item: '11', need: 240, avail: 200 }]);
    assert.deepEqual(core.shortages(agg, { '11': 240 }), [{ item: '12', need: 30, avail: 0 }]);
});

test('load numbers, catch-up numbers and transaction tokens', () => {
    assert.equal(core.nextLoadNumber([]), 'MV-001');
    assert.equal(core.nextLoadNumber(['MV-009', 'MV-010', 'junk', 'MV-003-C1']), 'MV-011');
    assert.equal(core.catchupNumber('MV-011', ['MV-011']), 'MV-011-C1');
    assert.equal(core.catchupNumber('MV-011', ['MV-011', 'MV-011-C1', 'MV-012-C4']), 'MV-011-C2');
    assert.equal(core.txToken('17', 'to'), '[mv:17:to]');
    assert.equal(core.txToken(17, 'r2'), '[mv:17:r2]');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `core.loadScanRule is not a function`.

- [ ] **Step 3: Replace the `// ── (Task 2) …` line in `move_core.js` with:**

```js
    // ── scan rules ────────────────────────────────────────────────────────
    // pallet: { status, loadId } | null   loads: { [loadId]: { status, number } }
    function loadScanRule(pallet, loadId, loads) {
        if (!pallet) return { result: 'unknown' };
        const me = String(loadId);
        const pl = pallet.loadId ? String(pallet.loadId) : '';
        const other = (loads && loads[pl]) || {};
        switch (pallet.status) {
            case PALLET.LABELED:
                return { result: 'ok', set: { status: PALLET.LOADED, loadId: me } };
            case PALLET.LOADED:
                if (pl === me) return { result: 'dup' };
                if (other.status === LOAD.LOADING) return { result: 'other_load', otherLoadId: pl, otherNumber: other.number || '' };
                return { result: 'locked_load', otherLoadId: pl, otherNumber: other.number || '' };
            case PALLET.VOID:
                return { result: 'void' };
            default:
                return { result: 'shipped', otherLoadId: pl, otherNumber: other.number || '' };
        }
    }

    function receiveScanRule(pallet, loadId, loads) {
        if (!pallet) return { result: 'unknown' };
        const me = String(loadId);
        const pl = pallet.loadId ? String(pallet.loadId) : '';
        const other = (loads && loads[pl]) || {};
        const elsewhere = { otherLoadId: pl, otherNumber: other.number || '' };
        switch (pallet.status) {
            case PALLET.SHIPPED:
                return pl === me ? { result: 'ok', set: { status: PALLET.RECEIVED } } : Object.assign({ result: 'other_load' }, elsewhere);
            case PALLET.MISSING:
                return pl === me ? { result: 'late', set: { status: PALLET.RECEIVED } } : Object.assign({ result: 'other_load' }, elsewhere);
            case PALLET.RECEIVED:
                return pl === me ? { result: 'dup' } : Object.assign({ result: 'dup_other' }, elsewhere);
            case PALLET.LABELED:
                return { result: 'arrived_unshipped', set: { status: PALLET.ARRIVED_UNSHIPPED, loadId: '' }, fromLoadNumber: '' };
            case PALLET.LOADED:
                if (other.status === LOAD.LOADING) {
                    return { result: 'arrived_unshipped', set: { status: PALLET.ARRIVED_UNSHIPPED, loadId: '' }, fromLoadNumber: other.number || '' };
                }
                return Object.assign({ result: 'other_load_pending' }, elsewhere);
            case PALLET.ARRIVED_UNSHIPPED:
                return { result: 'dup_catchup' };
            case PALLET.VOID:
                return { result: 'void' };
            default:
                return { result: 'unknown' };
        }
    }

    const TONE = { ok: 'ok', late: 'ok', dup: 'warn', other_load: 'warn', dup_other: 'warn', dup_catchup: 'warn', arrived_unshipped: 'warn' };
    function toneFor(result) { return TONE[result] || 'bad'; }

    // ── aggregation and numbering ────────────────────────────────────────
    function aggregate(pallets) {
        const out = {};
        (pallets || []).forEach(p => (p.lines || []).forEach(l => {
            const k = String(l.item);
            out[k] = (out[k] || 0) + (Number(l.pcs) || 0);
        }));
        return out;
    }

    function shortages(agg, avail) {
        return Object.keys(agg)
            .filter(k => (Number(avail && avail[k]) || 0) < agg[k])
            .map(k => ({ item: k, need: agg[k], avail: Number(avail && avail[k]) || 0 }));
    }

    function nextLoadNumber(numbers) {
        let max = 0;
        (numbers || []).forEach(n => { const m = /^MV-(\d+)$/.exec(String(n)); if (m) max = Math.max(max, Number(m[1])); });
        return 'MV-' + String(max + 1).padStart(3, '0');
    }

    function catchupNumber(parent, numbers) {
        const re = new RegExp('^' + String(parent).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '-C(\\d+)$');
        let max = 0;
        (numbers || []).forEach(n => { const m = re.exec(String(n)); if (m) max = Math.max(max, Number(m[1])); });
        return parent + '-C' + (max + 1);
    }

    function txToken(loadId, kind) { return '[mv:' + loadId + ':' + kind + ']'; }
```

In the `return` object, add: `loadScanRule, receiveScanRule, toneFor, aggregate, shortages, nextLoadNumber, catchupNumber, txToken`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_core.js move_portal/test/core.test.js
git commit -m "feat(move): scan rules, aggregation, load numbers, tx tokens"
```

---

