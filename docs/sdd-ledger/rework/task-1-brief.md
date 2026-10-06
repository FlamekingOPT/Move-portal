### Task 1: Trailer-named trucks, short-pick note, other items (server)

**Files:** Modify `move_portal/sl_move_portal.js`; test in `move_portal/test/portal.test.js`.

**Interfaces / behavior:**
- **`truck_start {ifIds, trailer}`:**
  - `trailer` is required: `userErr('Enter the trailer #')`.
  - Trim it, and refuse if any truck with status in `[loading, needs_fix, ready, ship_pending, departing]` has the same trailer (trim + upper-case): `userErr('Trailer X is already on an open truck')`.
  - Save it as `data.trailer`.
- **`truckLabel(x)`:** if `data.depart`, the label is the existing `Truck N · MM/DD`. Otherwise, if `data.trailer`, it is `'Trailer ' + data.trailer`. Otherwise it's the IF-number join (old trucks).
- **`truck_verify {truckId, shortNote?}`:**
  - Run the check. If the result has any `if_short`, and `shortNote` is empty (after trim), and the truck has no `data.shortNote`, return `{needsNote: true, diffs: pubDiffs(...)}` without writing anything.
  - Otherwise, when `shortNote` is given, save `data.shortNote = {text, by: c.actor, at: c.now.stamp}` in the same guarded write as the verify result.
  - `trucks_recheck` is unchanged (no note).
  - `data.shortNote` is cleared when the truck departs (in the departure data write).
- **`truck_other_add {truckId, desc, qty}`:**
  - The truck must be open; `desc` is 1–80 chars after trim; `qty` is a whole number ≥ 1.
  - Append `{id: String(Date.now()) + random4, desc, qty, by, at}` to `data.otherItems`, through a re-read write (`touched`-style, so `ready → loading`).
  - Returns `{view}`.
- **`truck_other_remove {truckId, id}`:** the truck must be open. Remove the item, with `ready → loading`. Returns `{view}`.
- **`truckView`:** adds `otherItems`, `shortNote` and `trailer`.
- **`unload_other_tick {truckId, id, on}` (floor):** the truck must be unloadable. Saves `data.otherItemsIn[id] = on ? {by, at} : null`. Returns `{view}` (the unload view). `unloadView` adds `otherItems` (from `data.depart.otherItems`) with an `in` flag.
- **Existing tests:** every existing `truck_start` call in the tests must pass a trailer. Update the shared helpers (`truckWith`, `readyTruck`, `departed`, …) to pass `trailer: 'T' + n` with a unique `n` per call, and keep each test's intent. The `departed(...)` helper changes again in Task 2; keep it working.

- [ ] **Step 1: Write the failing tests** (append to `portal.test.js`)

```js
test('trailer: required, unique among open trucks, names the truck', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9001'] }, false), /Enter the trailer/);
    const v = ctx.run('truck_start', { ifIds: ['9001'], trailer: ' 537224 ' }, false).view;
    assert.deepEqual([v.truck.label, v.trailer], ['Trailer 537224', '537224']);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9002'], trailer: '537224' }, false), /already on an open truck/);
    assert.equal(ctx.run('truck_planned', {}, false).open[0].label, 'Trailer 537224');
});

test('short note: required on a manual verify that finds a short; recheck does not need it', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 40, 'Jsn', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'S1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    const r1 = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.equal(r1.needsNote, true);
    assert.equal(ctx.data.getLoad(t.id).status, 'loading');
    const r2 = ctx.run('truck_verify', { truckId: t.id, shortNote: '  trailer full ' }, false);
    assert.deepEqual([r2.view.truck.status, ctx.data.getLoad(t.id).data.shortNote.text], ['needs_fix', 'trailer full']);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).needsNote, undefined);   // note already saved
    assert.doesNotThrow(() => ctx.run('trucks_recheck', {}, false));
});

test('other items: add/remove while open, ignored by verify, ready → loading', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Joi', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'O1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');
    const v = ctx.run('truck_other_add', { truckId: t.id, desc: 'Office desk', qty: 2 }, false).view;
    assert.deepEqual([v.truck.status, v.otherItems.map(o => [o.desc, o.qty])], ['loading', [['Office desk', 2]]]);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');   // other items ignored
    assert.throws(() => ctx.run('truck_other_add', { truckId: t.id, desc: '', qty: 1 }, false), /description/i);
    assert.throws(() => ctx.run('truck_other_add', { truckId: t.id, desc: 'Chair', qty: 0 }, false), /count/i);
    const id = v.otherItems[0].id;
    assert.equal(ctx.run('truck_other_remove', { truckId: t.id, id }, false).view.otherItems.length, 0);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test "move_portal/test/portal.test.js"`. Expected: FAIL on the trailer/needsNote/other-item assertions.
- [ ] **Step 3: Implement** the behavior above. Then update the existing test helpers and every `truck_start` call to pass a trailer.
- [ ] **Step 4: Run the full suite.** It must be green.
- [ ] **Step 5: Commit** with the message `feat(rework): trailer-named trucks, short-pick note, other items`.

---

