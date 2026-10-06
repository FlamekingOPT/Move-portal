### Task 3: Approvals reshaped + local on-hand

**Files:** Modify `move_portal/sl_move_portal.js`, `move_portal/move_verify.js` and `move_portal/test/preview_server.js`; tests in `portal.test.js` and `verify.test.js`.

**Behavior:**
- **`approvals`** returns `{shipPending, fixes, trucks, retries, receipts, freeIfs, writeMode}`:
  - `fixes`: one entry per `if_short`/`if_over`/`no_if` diff across every `needs_fix` truck:
    `{truckId, truckLabel, key, kind, ifId?, ifNum?, toNum?, text, shortNote: data.shortNote || null, corrections (for that key), correctError}`.
    Built from the stored `data.verify.diffs` through `pubDiffs`, with batched SKU names, as today.
  - `trucks`: one entry per `needs_fix` truck:
    `{truck: summary, trailer, ifs: [{ifId, ifNum, toNum, lines, gone, empty}], suggestions, orphans, verifiedBy, verifiedAt}`.
    `empty`/`gone` come from that truck's `if_empty`/`if_gone` diffs.
  - The old `needsFix` key is removed.
- **`truck_correct {truckId, keys}`:** unchanged. The UI now sends one key per Correct card.
- **On hand, local only.** In NetSuite the print plan already uses live on-hand via `data.locationStock`.
  - `move_verify.SQL(...)` gains `onHand`:
    `"SELECT ail.item AS item, SUM(ail.quantityonhand) AS onhand FROM aggregateItemLocation ail WHERE ail.location = " + F + " AND ail.quantityonhand > 0 GROUP BY ail.item"`.
  - `buildReads(raw)` exposes `onHand() → {item: qty}` from `raw.onHand` rows `{item, onhand}`, or `{}` if the rows are absent.
  - `preview_server.js`: on every start, set `data.db.stock[locFrom] = {item: {onHand, avail: onHand}}` from `ns.onHand()`, and merge in the item SKU/desc from the snapshot items. Don't wipe the stock when the snapshot has no `onHand`.
  - Tests: `buildReads` `onHand`, plus a `SQL.onHand` string test.

- [ ] **Step 1: Write the failing tests**

```js
test('approvals: fixes per diff (with short note) and trucks per needs_fix truck', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 40, 'Jap', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'AP1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'trailer full' }, false);
    const a = ctx.run('approvals');
    assert.equal(a.needsFix, undefined);
    assert.deepEqual([a.fixes.length, a.fixes[0].truckLabel, a.fixes[0].ifNum, a.fixes[0].shortNote.text], [1, 'Trailer AP1', 'IF9001', 'trailer full']);
    assert.match(a.fixes[0].text, /IF needs −24/);
    assert.deepEqual([a.trucks.length, a.trucks[0].trailer, a.trucks[0].ifs.map(f => f.ifNum)], [1, 'AP1', ['IF9001']]);
});
```

```js
// verify.test.js
test('buildReads.onHand and SQL.onHand', () => {
    const r = v.buildReads(Object.assign({}, raw, { onHand: [{ item: 975, onhand: 12000 }, { item: 11, onhand: 300 }] }));
    assert.deepEqual(r.onHand(), { 975: 12000, 11: 300 });
    assert.deepEqual(v.buildReads(raw).onHand(), {});
    assert.match(v.SQL('35', '46').onHand, /aggregateItemLocation ail WHERE ail.location = 35/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** The preview-server seeding has no unit test. Check it with a smoke run on :8799 with a temp store and a temp snapshot that has `onHand` rows: the `plan` action should return rows for SKUs with configs, and a `noConfig` list for SKUs without them.
- [ ] **Step 4: Run the full suite.** It must be green.
- [ ] **Step 5: Commit** with the message `feat(rework): approvals split into fixes/trucks/shipPending; local on-hand for the print plan`.

---

