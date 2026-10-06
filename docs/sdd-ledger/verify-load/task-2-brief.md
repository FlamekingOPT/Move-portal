### Task 2: Stages, take-off, Verify, recheck, add/drop IF (Suitelet)

**Files:**
- Modify: `move_portal/sl_move_portal.js`
- Test: `move_portal/test/portal.test.js` (append)

**Interfaces:**
- Consumes: Task 1 functions; the existing helpers listed in the plan header.
- Produces (all floor-allowed unless noted, all `{actor}`):

| Action | Body | Effect / returns |
|---|---|---|
| `truck_scan` | `{truckId, raw, mode:'load'\|'off'}` | `load`: as today, but also allowed on `needs_fix`/`ready`. `off`: the pallet must be `loaded` on this truck → `labeled`, load cleared, `logScan` with result `taken_off` (tone `warn`); otherwise result `not_on_truck` (tone `bad`). Any change on a `ready` truck sets it to `loading`. Returns `{result, tone, pallet, view}` |
| `truck_verify` | `{truckId}` | Truck must be `loading`/`needs_fix`/`ready` with no claim. Runs `verifyLoad` (fresh `ns.plannedIfs()`, the truck's loaded pallets, `reservedToLines`). Saves `data.ifs = r.ifs`, `data.verify = {at, by, diffs}`. Status → `ready` on a match, else `needs_fix`. Returns `{match, diffs: pubDiffs, suggestions, view}` |
| `trucks_recheck` | `{}` | Re-verify every `needs_fix` truck. Return `{nowReady: [{id, label}]}` for the ones that turned `ready` |
| `truck_add_if` | `{truckId, ifId}` | Floor: only an IF in the truck's current `ifSuggestions`. Manager: any Picked/Packed IF not on another truck. Append it to `data.ifs`, then verify. Returns like `truck_verify` |
| `truck_drop_if` | `{truckId, ifId}` (manager) | Remove the IF from `data.ifs`, then verify |

- `pubDiffs`: each diff plus `text` (`diffText` with the SKU name from `skuNames` and pallet pcs from the loaded pallets of that item when they all share one pcs value).
- `isOpen(x)` becomes: status in `[loading, needs_fix, ready]` and no `claim` and no `depart`. Remove the `pending` check, because pending is gone.
- `truckView` adds `verify: data.verify || null`, `suggestions` (only when `needs_fix`), and `stage: x.status`.
- `truckSummary` drops `pending`.
- Every verify write re-reads the truck and refuses if it's no longer open. Use `data.getLoad(id)` before `updateLoad`.

- [ ] **Step 1: Write the failing tests** (append to `portal.test.js`. `setup`, `printLabels`, `L975`, `truckWith(ctx, n, ifId)` and `departed` already exist. In the fixture, IF9001 and IF9002 are on TO500, YSN100, 504 each. TO500 has 48 remaining, TO600 504, TO700 item 11 1200.)

```js
test('verify: exact → ready; short → needs_fix with instructions; scanning after ready drops back to loading', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    const r = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.deepEqual([r.match, r.view.truck.status], [true, 'ready']);
    const extra = printLabels(ctx, 1, 'Jx1', [L975]);
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: extra[0].code }, false).view.truck.status, 'loading');
    const v2 = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.deepEqual([v2.match, v2.view.truck.status, v2.diffs[0].kind], [false, 'needs_fix', 'if_over']);
    assert.match(v2.diffs[0].text, /IF9001 YSN100: IF 504 · loaded 516 → IF needs \+12 \(1 pallet\)/);
});

test('take off mode: pallet back to labeled, logged; not on truck → refused; ready → loading', () => {
    const ctx = setup();
    const { t, ps } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const r = ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false);
    assert.deepEqual([r.result, r.tone, r.view.truck.status], ['taken_off', 'warn', 'loading']);
    assert.deepEqual([ctx.data.getPallet(ps[0].id).status, ctx.data.getPallet(ps[0].id).loadId], ['labeled', '']);
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false).result, 'not_on_truck');
    assert.equal(ctx.data.db.scans.filter(s => s.result === 'taken_off').length, 1);
});

test('recheck: an office fix in NetSuite turns a needs_fix truck ready', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'needs_fix');
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 480 })] }) : f);
    const r = ctx.run('trucks_recheck', {}, false);
    assert.deepEqual(r.nowReady.map(x => x.id), [t.id]);
    assert.equal(ctx.data.getLoad(t.id).status, 'ready');
});

test('new IF suggestion: floor can add a suggested IF; not an IF on another truck', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 43);                                         // 516 on a 504 IF → over
    const v1 = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.deepEqual(v1.suggestions.map(f => f.ifId), ['9002']);              // same TO500, not on a truck
    const r = ctx.run('truck_add_if', { truckId: t.id, ifId: '9002' }, false);
    assert.deepEqual(r.view.truck.status, 'needs_fix');                       // now 516 vs 1008 → short on IF9002
    assert.throws(() => ctx.run('truck_add_if', { truckId: t.id, ifId: '9000' }, false), /not a suggested IF/);
    assert.throws(() => ctx.run('truck_drop_if', { truckId: t.id, ifId: '9002' }, false), /Managers only/);
    assert.equal(ctx.run('truck_drop_if', { truckId: t.id, ifId: '9002' }).view.truck.status, 'needs_fix');
});

test('scans and verify are refused on a departing truck', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const x = ctx.data.getLoad(t.id);
    ctx.data.updateLoad(x, { data: { claim: 'other', workingAt: Date.now() } });
    assert.throws(() => ctx.run('truck_verify', { truckId: t.id }, false), /closed|departing/);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: 'PLT1', mode: 'off' }, false), /closed/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL with `Unknown action: truck_verify`.

- [ ] **Step 3: Implement** the actions and helper changes from the Interfaces block. Notes:
  - `truck_scan` with `mode: 'off'` must not call `scanCtx` (no capacity check is needed to take a pallet off).
  - The status flip `ready → loading` happens in the same re-read update that `pushStack` or the scan does. A pallet change must leave a `ready` truck in `loading`, even when the stack write is skipped.
  - `truck_move_here`, `truck_remove` and `truck_undo` follow the same rule.
  - `verifyTruck(id, c)` is a shared helper used by `truck_verify`, `trucks_recheck`, `truck_add_if`, `truck_drop_if` and (Task 3) departure. It returns `{r, x}` and does the guarded write.

- [ ] **Step 4: Run the tests and confirm they pass.** Then run the full suite. Old tests that relied on scanning only in `loading`, or on `pending`, may need updating. Keep their intent, and note each change in the report.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(verify-load): verify/needs_fix/ready stages, take-off scan mode, recheck, add/drop IF"
```

---

