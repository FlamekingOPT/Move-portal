### Task 3: Departure only from Ready; remove pending and skip-write

**Files:**
- Modify: `move_portal/sl_move_portal.js`, `move_portal/move_verify.js` (only if `planDeparture` needs a guard)
- Test: `move_portal/test/portal.test.js`

**Behavior:**
- `depart_preview`:
  - Refuses unless the status is `ready`, with "Verify the load first".
  - Re-verifies with `verifyTruck`. On a mismatch, returns `{needsFix: true, diffs, view}`, with the truck now `needs_fix`.
  - Otherwise returns the stamp-only plan (`departPlan`).
- `depart_confirm`:
  - Floor-allowed, with no manager gate.
  - Claims with a guard: status `ready`, no claim, no depart.
  - Re-verifies inside the claim (via `claimLoad`'s `extraData` callback, which already supports building data from the claimed state).
  - On a mismatch: release the claim, set `needs_fix` with the diffs, and return `{needsFix: true, diffs, view}`.
  - On a match: write `depart` / `plan` / `alloc` / `ifs` with the claim and run `finishDepart`.
  - The plan must contain only `if_stamp` ops. If `planDeparture` returns corrections, treat it as a mismatch, as a safety net.
- **Remove:**
  - `savePending`, `data.pending` everywhere;
  - `depart_cancel`, `depart_skip_write`, `NEEDS_MGR`;
  - the departures section of `approvals`;
  - the skip-write rows in `report` / `shadowRows`. Keep `shadowRows` working for stamps and receipts.
- `depart_retry` stays, for a failed `if_stamp` in `on` mode.
- The `retries` entries in `approvals` drop the `errorKey` / skip affordance.
- `departData` drops `requestedBy` / `pending`. `approvedBy` is `c.mgr ? c.user : ''` as today.

- [ ] **Step 1: Write the failing tests** (append, and delete or adapt the old pending, skip-write and manager-gate departure tests. List each one in the report.)

```js
test('depart only from ready; floor confirms; stamp-only plan', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'R1' }, false), /Verify the load first/);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const pv = ctx.run('depart_preview', { truckId: t.id, trailer: '537224', seal: 'R1' }, false);
    assert.deepEqual(pv.plan.ops.map(o => o.op), ['if_stamp']);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'R1' }, false);
    assert.deepEqual([r.departed, r.view.truck.status], [true, 'departed']);
});

test('confirm re-verifies: an IF changed in NetSuite after Ready sends the truck to needs_fix', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 456 })] }) : f);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'R2' }, false);
    assert.deepEqual([r.needsFix, r.view.truck.status, r.diffs[0].kind], [true, 'needs_fix', 'if_over']);
    assert.equal(ctx.data.getLoad(t.id).data.claim, '');
});

test('removed: depart_cancel, depart_skip_write, pending', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('depart_cancel', { truckId: '1' }), /Unknown action/);
    assert.throws(() => ctx.run('depart_skip_write', { truckId: '1' }), /Unknown action/);
    assert.equal(ctx.run('approvals').departures, undefined);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suite. It must pass.** The receipt, unload and report tests use `departed(ctx, …)`. Update that helper to verify before confirming: `truck_verify`, then `depart_confirm`. A short truck can no longer depart, so tests that departed short trucks must first make the IF match. Either stub `ctx.ns.plannedIfs` to the loaded qty, or load exactly. Keep each test's intent and list the changes in the report.
- [ ] **Step 5: Commit** with the message `feat(verify-load): departure only from Ready (re-verified, stamp-only); remove pending and skip-write`.

---

