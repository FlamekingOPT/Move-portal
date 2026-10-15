### Task 11: Local beta stand-in, click-through, docs

**Files:**
- Modify: `move_portal/local/snapshot_ns.js` (`applyOp` handles `to_create` and Shipped `if_create`)
- Modify: `CLAUDE.md` (handoff: state, how scan trucks work, launch checklist additions)
- Test: `move_portal/test/move_ns.test.js` (or wherever `applyOp` is tested; search for `applyOp`)

**Interfaces:**
- Consumes: ops from Task 2.
- Produces: in the beta, `on` mode Approve returns ids and the re-read sees the new IF as Shipped (status `C`).

- [ ] **Step 1: Write the failing test**

Find the existing `applyOp` test (`grep -n applyOp move_portal/test/*.js`) and add next to it:

```js
test('snapshot stand-in: to_create returns a TO id; a Shipped if_create lands as status C on that TO', () => {
    const ns = makeSnapshotNs(verify, { toLines: [], ifLines: [], items: [{ item: 11, sku: 'YSN201' }] });
    const toId = ns.applyOp({ op: 'to_create', ref: '5', lines: { '11': 72 } });
    assert.ok(Number(toId) > 0);
    const ifId = ns.applyOp({ op: 'if_create', toId: toId, ship: true, lines: { '11': 72 }, memo: 'Truck 1 · 11/02 · [MV-5]' });
    assert.ok(Number(ifId) > 0);
    // the IF is Shipped, so it is not a planned (Picked/Packed) IF
    assert.equal(ns.plannedIfs().some(f => String(f.ifId) === String(ifId)), false);
});
```

Use whatever `makeSnapshotNs` / `verify` imports the test file already has.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL (`to_create` returns undefined).

- [ ] **Step 3: Implement**

In `applyOp`, add a branch before `if_create`:

```js
        } else if (op.op === 'to_create') {
            const tl = raw.toLines = raw.toLines || [];
            const id = tl.reduce((m, r) => Math.max(m, Number(r.toid) || 0), 80000) + 1;
            Object.keys(op.lines || {}).forEach(k => tl.push({ toid: id, tonum: 'TO' + id, tostatus: 'B', trandate: new Date().toISOString().slice(0, 10), item: Number(k),
                sku: ((raw.items || []).find(i => String(i.item) === String(k)) || {}).sku || String(k), qty: Number(op.lines[k]) }));
            created = String(id);
```

and in the `if_create` branch use `status: op.ship === true ? 'C' : 'B'`.

Then run the beta and click the whole flow through:

```bash
node move_portal/test/preview_server.js --store move_portal/local/smoke-store.json --port 8798
```

Use the launch config `move-preview-smoke` (port 8798) through the preview tools instead of a shell, if available. In the smoke store's Move Settings set `officeIfs: false` and `writeMode: 'on'`. Then:
1. Manager → Labels → Print a SKU with an odd pallet, then upload a 3-row .xlsx (one row over stock: amber; one unknown SKU: skipped). Print all.
2. Floor → Start Trailer → scan 3 labels → Finish loading → Verify shows weight → Finish → Shipments → seal → Mark shipped.
3. Manager → Approvals → Approve. The message shows the new TO/IF.
4. Floor → Unload → scan in → manager Approve receipt.
5. Repeat with a forced short (lower stock in the store) → Approve shows "Can't approve…".

Delete `move_portal/local/smoke-store.json` afterwards.

Update `CLAUDE.md`:
- Replace the "BRAINSTORM PAUSED" header with "SCAN-BUILT TO + IF BUILT (2026-10-xx)". List the commit range and the test count, and keep rulings 1–13.
- In "How the portal works now", describe the scan-built floor and manager flow, `officeIfs`, and `palletTare`.
- In the prod launch steps, add: Settings JSON gets `"officeIfs":false,"palletTare":45`; check whether **TO approval routing** lets the manager role save status B (create one test TO as that role); weight units on the move SKUs (`weight` / `weightunit` filled?); Riverside bins on the IF.

- [ ] **Step 4: Run all tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS (all).

- [ ] **Step 5: Commit and push**

```bash
git add move_portal/local/snapshot_ns.js move_portal/test CLAUDE.md
git commit -m "feat(beta): stand-in creates scan-built TOs and Shipped IFs; docs for the scan-built flow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin feat/v3-verification
```

---

## After the plan (not tasks here)

The sandbox run in `on` mode, from spec §8, needs Jack's go and happens after review:
- one clean truck;
- one truck with a forced IF failure (Retry, then Release after closing the TO);
- one late pallet;
- one Excel upload.

Upload order and recipe are the same as the prod launch section in `CLAUDE.md`.
