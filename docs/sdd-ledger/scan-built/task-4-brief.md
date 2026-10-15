### Task 4: Settings defaults and item weight in the data layers

**Files:**
- Modify: `move_portal/move_data.js` (DEFAULTS, `itemCols`, `itemRow`)
- Modify: `move_portal/move_verify.js` (`SQL.items`, `buildReads` items)
- Modify: `move_portal/test/fake_data.js` (settings `officeIfs: true`)
- Test: `move_portal/test/move_data.test.js`, `move_portal/test/verify.test.js`

**Interfaces:**
- Produces: `data.getSettings()` includes `officeIfs` (default false) and `palletTare` (default 45). `data.itemInfo(ids)[id]`, `data.itemLookup`, `data.locationStock` rows carry `weight` (number, 0 if blank) and `wunit` (string). `ns.items()` rows carry `weight`, `wunit`.

- [ ] **Step 1: Write the failing tests**

Look at `move_portal/test/move_data.test.js` for how it fakes `N/search` rows (`getValue(name)`). Add a test in that style:

```js
test('settings default to scan-built (officeIfs false, tare 45) and item rows carry weight', () => {
    // use the file's existing fake-search helper; give the settings row '{}' and one item row with weight 20, weightunit '1'
    const s = d.getSettings();
    assert.equal(s.officeIfs, false);
    assert.equal(s.palletTare, 45);
    const i = d.itemInfo(['11'])['11'];
    assert.deepEqual([i.weight, i.wunit], [20, '1']);
});
```

Before writing it, read the top of `move_data.test.js` and build `d` with the same helper its other tests use. Make the item row's `getValue('weight')` return `'20'` and `getValue('weightunit')` return `'1'`.

Append to `move_portal/test/verify.test.js`:

```js
test('the items query and reads carry weight and unit', () => {
    assert.match(verify.SQL('35', '46').items, /i\.weight AS weight, i\.weightunit AS wunit/);
    const r = verify.buildReads({ items: [{ item: 11, sku: 'YSN201', descr: 'x', upc: '', weight: '20', wunit: '1' }] });
    assert.deepEqual(r.items()[0], { item: '11', sku: 'YSN201', desc: 'x', upc: '', weight: 20, wunit: '1' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/move_data.test.js" "move_portal/test/verify.test.js"`
Expected: FAIL (no `officeIfs` default, no `weight`).

- [ ] **Step 3: Implement**

`move_portal/move_data.js`:

```js
    const DEFAULTS = { locFrom: '', locTo: '', fromName: 'Riverside', toName: 'Tippecanoe', target: '2026-11-15', start: '2026-10-01',
        skip: [], labelCode: 'both', roster: [], maxPrint: 250, staleDays: 5, toStatus: 'B', activeBatch: '', officeIfs: false, palletTare: 45 };
...
    function itemCols() { return ['itemid', 'salesdescription', 'displayname', 'upccode', 'weight', 'weightunit'].map(n => search.createColumn({ name: n })); }
    function itemRow(r) {
        return { item: String(r.id), sku: skuOfName(r.getValue('itemid')),
            desc: r.getValue('salesdescription') || r.getValue('displayname') || '', upc: r.getValue('upccode') || '',
            weight: Number(r.getValue('weight')) || 0, wunit: String(r.getValue('weightunit') || '') };
    }
```

`move_portal/move_verify.js`. Change the `items` SQL to:

```js
            items: "SELECT i.id AS item, i.itemid AS sku, i.displayname AS descr, i.upccode AS upc, i.weight AS weight, i.weightunit AS wunit FROM item i WHERE i.id IN ({IDS})",
```

and the `items` read to:

```js
            items: () => (raw.items || []).map(i => ({ item: S(i.item), sku: S(i.sku), desc: S(i.descr), upc: S(i.upc), weight: Number(i.weight) || 0, wunit: S(i.wunit) })),
```

`move_portal/test/fake_data.js`: add `officeIfs: true, palletTare: 45` to `db.settings`. The existing office-IF tests then run unchanged; scan tests set `ctx.data.db.settings.officeIfs = false`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 303 tests. If an existing `verify.test.js` test deep-equals an `items()` row, add `weight: 0, wunit: ''` to its expected value.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_data.js move_portal/move_verify.js move_portal/test/fake_data.js move_portal/test/move_data.test.js move_portal/test/verify.test.js
git commit -m "feat(scan): officeIfs/palletTare settings; items carry NetSuite weight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

