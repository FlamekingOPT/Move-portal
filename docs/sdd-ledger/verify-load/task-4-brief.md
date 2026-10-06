### Task 4: Correct the IF (manager) + Packed add-on IFs

**Files:**
- Modify: `move_portal/sl_move_portal.js`, `move_portal/move_tx.js`
- Test: `move_portal/test/portal.test.js`, `move_portal/test/move_tx.test.js`

**Behavior:**
- `move_tx.createIf(op)`:
  - When `op.ship === false`, set `shipstatus` **'B'** (Packed) and skip `stampOn`.
  - Otherwise behave as today.
  - Test with the fake N/record in `move_tx.test.js`: shipstatus B, and no custbody7 or container field set.
- `truck_correct {truckId, keys?}` (manager):
  - Requires the truck in `needs_fix`.
  - Takes a claim with `claimLoad(x, x.status, 'correct', guard)`. The guard requires status `needs_fix` and no claim. Status is unchanged; the claim only serializes.
  - Re-verifies to get the current diffs, then builds `correctionOps` for the requested keys (all keys if none are given).
  - Saves the ops to `data.corrections` (append, deduped by `key`), and records `{key, by: c.user, at}`.
  - Runs `verify.runOps(ops.filter(op => op.op !== 'drop_if'), writeMode(c), op => tx.apply(op), writes, onWrite)`. The writes go to `data.correctionWrites`. `runOps` uses `opKey`, so give `if_create` correction ops `opKey` `if_create:<toId>`, and include `ship:false`.
  - `drop_if` ops are applied directly: the IF is removed from `data.ifs`.
  - For each written `if_create`, attach `{ifId: <returned id>, ifNum: 'IF ' + id, toId, toNum, status: 'B', lines: [{item, sku, qty}]}` to `data.ifs`.
  - Release the claim with `claim: ''`, `workingAt: 0`, `phase: ''`.
  - Re-verify with `verifyTruck`.
  - Return `{written, planOnly, verify: {match, diffs}, view}`.
  - A refused write leaves its error in `data.correctError`. The response is `userErr('Correction refused: … — fix it in NetSuite')`. Ops already written stay recorded.
- **Approvals:**
  - `approvals` gets a `needsFix` list: `[{truck, diffs: pubDiffs, suggestions, corrections, correctError, writeMode}]` for `needs_fix` trucks.
  - It uses the grouped counts, with no per-truck `palletsByLoad` beyond what `verifyTruck` needs.
  - To stay cheap, use the stored `data.verify.diffs`. Only the manager's Re-check button calls `truck_verify` again.
- **Report** (optional, cheap): a row per correction op that is plan-only (`off`/`qty` `if_create`), with check `IF fix needed` and `ok:false`, so the office sees it. Skip this if it complicates `shadowRows`, and note that in the report.

- [ ] **Step 1: Write the failing tests**

```js
test('truck_correct: manager only; qty mode writes if_qty and the truck verifies ready', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.throws(() => ctx.run('truck_correct', { truckId: t.id }, false), /Managers only/);
    const real = ctx.ns.plannedIfs;
    ctx.tx._t.onApply = op => { if (op.op === 'if_qty') ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: op.to })] }) : f); };
    const r = ctx.run('truck_correct', { truckId: t.id });
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.to]), [['if_qty', 480]]);
    assert.deepEqual([r.verify.match, r.view.truck.status], [true, 'ready']);
    assert.equal(ctx.data.getLoad(t.id).data.claim, '');
});

test('truck_correct: off mode is plan-only; on mode creates a Packed add-on IF and attaches it', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jc1', [L975]).concat(printLabels(ctx, 1, 'Jc2', [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }]));
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id });
    const off = ctx.run('truck_correct', { truckId: t.id });
    assert.deepEqual([off.written, off.planOnly], [[], ['if_create:700']]);
    ctx.data.db.settings.writeMode = 'on';
    const on = ctx.run('truck_correct', { truckId: t.id });
    const created = ctx.tx._t.ops.find(o => o.op === 'if_create');
    assert.deepEqual([created.toId, created.ship], ['700', false]);
    assert.deepEqual(on.written, ['if_create:700']);
    // The re-verify reads NetSuite: the snapshot fixture doesn't know the new IF, so it isn't kept on the truck here.
    // Live NetSuite returns it as Packed, so it stays. The 'on'-mode attach is checked in the Stage 2 prod checklist.
});

test('approvals lists needs_fix trucks with instruction text', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const a = ctx.run('approvals');
    assert.equal(a.needsFix[0].truck.id, t.id);
    assert.match(a.needsFix[0].diffs[0].text, /IF needs −24/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suite. It must pass.**
- [ ] **Step 5: Commit** with the message `feat(verify-load): manager Correct the IF (if_qty / Packed if_create / drop), needs-fix approvals`.

---

