### Task 2: Shipments: mark shipped (floor), confirm / send back (manager)

**Files:** Modify `move_portal/move_verify.js` and `move_portal/sl_move_portal.js`; tests in `portal.test.js` and `verify.test.js`.

**Interfaces / behavior:**
- **`move_verify.js`:**
  - Add `TRUCK.SHIP_PENDING = 'ship_pending'`.
  - In `reservationsFromTrucks`, place `ship_pending` trucks like `ready` (their loaded surplus reserves room).
  - Add a test for it.
- **`isOpen`:** `ship_pending` is not open. Scans, take-off, other items, verify, add/drop IF and correct must all refuse it with "This truck is waiting for a manager to confirm shipping".
- **`ship_mark {truckId, seal, carrier}`** (floor):
  1. The truck must be `ready`: `userErr('Verify the load first')`. The seal is required and must not be reused (`sealUsed` over all trucks, including the `shipReq.seal` of `ship_pending` trucks).
  2. Re-verify, using the same check as departure (`checkTruck`, or `verifyTruck` with `poll`).
     - **Mismatch:** the truck goes to `needs_fix` and the call returns `{needsFix: true, diffs, view}`.
     - **Match:** do a guarded write that sets status `ship_pending`, `data.shipReq = {seal, carrier: carrier || default, trailer: data.trailer, by: c.actor, at: c.now.stamp}` and `data.sentBack = null`. Returns `{view}`.
- **`ship_confirm {truckId}`** (manager): this is today's `depart_confirm` internals, generalized.
  - Claim guard: status `ship_pending`, no claim, no depart.
  - Departure input comes from `shipReq`: trailer = `data.trailer`, seal and carrier from `shipReq`.
  - Re-verify inside the claim.
    - **Mismatch:** release the claim, set `needs_fix` with the new diffs, clear `shipReq`, and return `{needsFix: true, diffs, view}`.
    - **Match:** run `departData` with `depart.at = shipReq.at` (departure time is the floor's mark time), `depart.markedBy = shipReq.by`, `depart.otherItems = data.otherItems || []`, `approvedBy = c.user`, and `shortNote: null`. Then `finishDepart` as today.
  - Truck # of the day is computed at confirm, using the departure day of `shipReq.at`. Use `core.parseNsStamp(shipReq.at).dayIso` for that day.
- **`ship_sendback {truckId, note}`** (manager):
  - The note is required.
  - Guarded write, status `ship_pending` → `loading`, `data.sentBack = {note, by: c.user, at}`, `data.shipReq = null`.
  - Returns `{view}`.
- **`truckView`/`truckSummary`:** add `shipReq` and `sentBack`. `trucks_recheck` ignores `ship_pending` trucks.
- **Floor `depart_preview` / `depart_confirm`:** remove these actions. Keep `depart_retry` and `depart_release`, which act on `departing` trucks, as today. Note: a released truck still goes to `needs_fix`, as today.
- **`approvals`:** adds `shipPending: [{truck: summary, trailer, seal, carrier, ifs: [{ifNum, lines}], pallets, pcs, otherItems, markedBy, markedAt}]`. Keep the existing keys; Task 3 reshapes `needsFix`.
- **Tests:** update `departed(...)` and any test helper that departed via `depart_confirm` to go `truck_verify` → `ship_mark` (floor) → `ship_confirm` (manager). Keep every receipt, unload and report test's intent. Delete or convert tests that only covered the floor `depart_preview`/`depart_confirm` actions, and list them in the report.

- [ ] **Step 1: Write the failing tests**

```js
test('ship_mark: only from ready; locks the truck; seal reuse refused', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jsm', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'SH1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: '5250001' }, false), /Verify the load first/);
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: '' }, false), /seal/i);
    const v = ctx.run('ship_mark', { truckId: t.id, seal: '5250001' }, false).view;
    assert.deepEqual([v.truck.status, v.truck.shipReq.seal, v.truck.shipReq.trailer], ['ship_pending', '5250001', 'SH1']);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false), /waiting for a manager/);
    assert.throws(() => ctx.run('truck_verify', { truckId: t.id }, false), /waiting for a manager/);
    assert.equal(ctx.run('approvals').shipPending[0].seal, '5250001');
});

test('ship_confirm: manager only; departs with Truck # and the floor mark time; send back returns to loading', () => {
    const ctx = setup();
    const mk = (n, trailer, seal, ifId) => { const ps = printLabels(ctx, n, 'J' + trailer, [L975]); const t = ctx.run('truck_start', { ifIds: [ifId], trailer }, false).view.truck;
        ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false)); ctx.run('truck_verify', { truckId: t.id }, false); ctx.run('ship_mark', { truckId: t.id, seal }, false); return t; };
    const a = mk(42, 'C1', '5250002', '9001');
    assert.throws(() => ctx.run('ship_confirm', { truckId: a.id }, false), /Managers only/);
    const r = ctx.run('ship_confirm', { truckId: a.id });
    const d = ctx.data.getLoad(a.id).data.depart;
    assert.deepEqual([r.view.truck.status, d.seal, d.trailer, d.truckNo, d.at === ctx.data.getLoad(a.id).data.shipReq.at], ['departed', '5250002', 'C1', 1, true]);
    const b = mk(42, 'C2', '5250003', '9002');
    assert.throws(() => ctx.run('ship_sendback', { truckId: b.id, note: '' }), /note/i);
    const sb = ctx.run('ship_sendback', { truckId: b.id, note: 'wrong seal photo' });
    assert.deepEqual([sb.view.truck.status, sb.view.truck.sentBack.note], ['loading', 'wrong seal photo']);
});

test('ship_confirm re-verifies: an IF change after mark sends the truck to needs_fix', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jrv', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'RV1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id, seal: '5250004' }, false);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 456 })] }) : f);
    const r = ctx.run('ship_confirm', { truckId: t.id });
    assert.deepEqual([r.needsFix, ctx.data.getLoad(t.id).status, ctx.data.getLoad(t.id).data.claim], [true, 'needs_fix', '']);
});

test('removed: floor depart_preview / depart_confirm', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('depart_preview', { truckId: '1' }, false), /Unknown action/);
    assert.throws(() => ctx.run('depart_confirm', { truckId: '1' }, false), /Unknown action/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**, including the `reservationsFromTrucks` change and its `verify.test.js` test.
- [ ] **Step 4: Run the full suite.** It must be green.
- [ ] **Step 5: Commit** with the message `feat(rework): Shipments: floor marks shipped, manager confirms or sends back`.

---

