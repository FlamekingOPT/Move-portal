### Task 1: Pure rules for truck contents, weight and stock (move_core + move_verify)

**Files:**
- Modify: `move_portal/move_core.js` (add 2 functions + export)
- Modify: `move_portal/move_verify.js` (add functions near `sumLines`, export)
- Test: `move_portal/test/core.test.js`, `move_portal/test/verify.test.js`

**Interfaces:**
- Produces:
  - `core.officeIfs(S) → boolean`. True only when `S.officeIfs === true`.
  - `core.palletTare(S) → number`. `Number(S.palletTare)` if > 0, else 45.
  - `verify.lbs(weight, unit) → number|null`
  - `verify.truckLines(pallets) → { [item]: { pallets, pcs } }`
  - `verify.linesPcs(tl) → { [item]: pcs }`
  - `verify.truckWeight(tl, info, tare, palletCount) → { rows: { [item]: number|null }, tare, total, noWeight }`
  - `verify.stockCheck(pcsByItem, avail) → [{ item, need, avail }]`
  - `verify.stockText(shorts, sk) → string`

- [ ] **Step 1: Write the failing tests**

Append to `move_portal/test/core.test.js`:

```js
test('officeIfs is on only when set true; palletTare defaults to 45', () => {
    assert.equal(core.officeIfs({}), false);
    assert.equal(core.officeIfs({ officeIfs: 'true' }), false);
    assert.equal(core.officeIfs({ officeIfs: true }), true);
    assert.equal(core.palletTare({}), 45);
    assert.equal(core.palletTare({ palletTare: 50 }), 50);
    assert.equal(core.palletTare({ palletTare: 0 }), 45);
});
```

Append to `move_portal/test/verify.test.js`:

```js
test('lbs converts NetSuite weight units by id or text; unknown is null', () => {
    assert.equal(verify.lbs(20, '1'), 20);
    assert.equal(verify.lbs(20, 'lb'), 20);
    assert.equal(verify.lbs(32, '2'), 2);
    assert.equal(verify.lbs(32, 'oz'), 2);
    assert.equal(verify.lbs(10, 'kg'), 22.05);
    assert.equal(verify.lbs(1000, '4'), 2.2);
    assert.equal(verify.lbs(0, 'lb'), null);
    assert.equal(verify.lbs('', 'lb'), null);
    assert.equal(verify.lbs(20, 'stone'), null);
    assert.equal(verify.lbs(20, ''), 20);          // NetSuite leaves the unit blank for lb on some items
});

test('truckLines counts pallets and pieces per SKU; truckWeight adds tare and counts SKUs without weight', () => {
    const ps = [{ lines: [{ item: '11', pcs: 72 }] }, { lines: [{ item: '11', pcs: 72 }] }, { lines: [{ item: '12', pcs: 36 }] }];
    const tl = verify.truckLines(ps);
    assert.deepEqual(tl, { '11': { pallets: 2, pcs: 144 }, '12': { pallets: 1, pcs: 36 } });
    assert.deepEqual(verify.linesPcs(tl), { '11': 144, '12': 36 });
    const w = verify.truckWeight(tl, { '11': { weight: 10, wunit: 'lb' }, '12': { weight: 0, wunit: '' } }, 45, 3);
    assert.deepEqual(w, { rows: { '11': 1440, '12': null }, tare: 135, total: 1575, noWeight: 1 });
});

test('stockCheck lists every SKU the truck needs more of than is available', () => {
    const shorts = verify.stockCheck({ '11': 504, '12': 36 }, { '11': 360, '12': 36 });
    assert.deepEqual(shorts, [{ item: '11', need: 504, avail: 360 }]);
    assert.deepEqual(verify.stockCheck({ '13': 5 }, {}), [{ item: '13', need: 5, avail: 0 }]);
    assert.equal(verify.stockText(shorts, { '11': 'YSN201' }), 'YSN201 on truck 504, available 360');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/core.test.js" "move_portal/test/verify.test.js"`
Expected: FAIL with `core.officeIfs is not a function` and `verify.lbs is not a function`.

- [ ] **Step 3: Implement**

In `move_portal/move_core.js`, add before the `return {` at the end:

```js
    // Settings switches for the scan-built flow (spec 2026-10-14). officeIfs: only an explicit true turns the office-IF screens on.
    function officeIfs(S) { return !!S && S.officeIfs === true; }
    function palletTare(S) { const n = Number(S && S.palletTare); return n > 0 ? n : 45; }
```

and add `officeIfs, palletTare` to the returned object.

In `move_portal/move_verify.js`, add after `sumLines`:

```js
    // ── scan-built trucks (spec 2026-10-14) ──────────────────────────────
    // NetSuite weightunit: an id (1 lb, 2 oz, 3 kg, 4 g) or its text. Blank unit = lb. Anything else, or no weight, = null ("no weight").
    const LB_PER = { '': 1, '1': 1, lb: 1, lbs: 1, '2': 1 / 16, oz: 1 / 16, '3': 2.20462, kg: 2.20462, '4': 0.00220462, g: 0.00220462 };
    function lbs(weight, unit) {
        const w = Number(weight), f = LB_PER[String(unit == null ? '' : unit).trim().toLowerCase()];
        if (!(w > 0) || f == null) return null;
        return Math.round(w * f * 100) / 100;
    }
    // Pallets and pieces per SKU. A mixed pallet counts once on each SKU it carries.
    function truckLines(pallets) {
        const out = {};
        (pallets || []).forEach(p => {
            const seen = {};
            (p.lines || []).forEach(l => {
                const k = String(l.item), r = (out[k] = out[k] || { pallets: 0, pcs: 0 });
                r.pcs += Number(l.pcs) || 0;
                if (!seen[k]) { r.pallets++; seen[k] = true; }
            });
        });
        return out;
    }
    function linesPcs(tl) { const o = {}; Object.keys(tl || {}).forEach(k => { o[k] = tl[k].pcs; }); return o; }
    // info: { item: { weight, wunit } }. Line weights are rounded to the pound; the tare is palletCount × tare.
    function truckWeight(tl, info, tare, palletCount) {
        const rows = {};
        let total = 0, noWeight = 0;
        Object.keys(tl || {}).forEach(k => {
            const i = (info || {})[k] || {}, per = lbs(i.weight, i.wunit);
            if (per == null) { rows[k] = null; noWeight++; return; }
            rows[k] = Math.round(per * tl[k].pcs);
            total += rows[k];
        });
        const t = Math.round((Number(tare) || 0) * (Number(palletCount) || 0));
        return { rows: rows, tare: t, total: total + t, noWeight: noWeight };
    }
    function stockCheck(pcsByItem, avail) {
        return Object.keys(pcsByItem || {}).filter(k => (Number(pcsByItem[k]) || 0) > (Number((avail || {})[k]) || 0))
            .map(k => ({ item: k, need: Number(pcsByItem[k]) || 0, avail: Number((avail || {})[k]) || 0 }));
    }
    function stockText(shorts, sk) {
        return (shorts || []).map(s => ((sk || {})[s.item] || s.item) + ' on truck ' + fmt(s.need) + ', available ' + fmt(s.avail)).join('; ');
    }
```

(`fmt` is the module's existing number formatter, exported as `_fmt`.) Add `lbs, truckLines, linesPcs, truckWeight, stockCheck, stockText` to the returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 294 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_core.js move_portal/move_verify.js move_portal/test/core.test.js move_portal/test/verify.test.js
git commit -m "feat(scan): pure rules for truck lines, weight and stock check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

