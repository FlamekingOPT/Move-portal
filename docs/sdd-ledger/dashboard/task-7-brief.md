### Task 7: Local beta `if_create` / `if_stamp` stand-in, browser smoke, handoff

**Files:**
- Modify: `move_portal/local/snapshot_ns.js`, `move_portal/test/fake_tx.js`, `move_portal/test/preview_server.js`
- Modify: `CLAUDE.md`, `docs/sdd-ledger/progress.md`
- Test: `move_portal/test/verify.test.js`

- [ ] **Step 1: Write the failing test** (append to `move_portal/test/verify.test.js`)

```js
test('local snapshot_ns.applyOp: if_qty rewrites the line, if_create adds a Packed IF and returns its id, if_stamp ships it', () => {
    const { makeSnapshotNs } = require('../local/snapshot_ns');
    const ns = makeSnapshotNs(v, JSON.parse(JSON.stringify(require('./fixtures/snapshot_sample.json'))));
    ns.applyOp({ op: 'if_qty', ifId: '9001', item: '975', from: 504, to: 516 });
    assert.equal(ns.ifInfo()['9001'].lines[0].qty, 516);
    const id = ns.applyOp({ op: 'if_create', toId: '700', toNum: 'TO700', lines: { '11': 120 }, memo: 'Truck 1 · 10/14' });
    const f = ns.plannedIfs().find(x => x.ifId === String(id));
    assert.deepEqual([f.status, f.toId, f.lines[0].item, f.lines[0].qty, f.ifNum], ['B', '700', '11', 120, 'IF' + id]);
    ns.applyOp({ op: 'if_stamp', ifId: String(id), lines: { '11': 120 } });
    assert.equal(ns.ifInfo()[String(id)].status, 'C');
    assert.equal(ns.plannedIfs().some(x => x.ifId === String(id)), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL (`if_create` returns undefined).

- [ ] **Step 3: Implement**

`move_portal/local/snapshot_ns.js` `applyOp`:

```js
    ns.applyOp = function (op) {
        if (!op) return;
        const rows = raw.ifLines = raw.ifLines || [];
        if (op.op === 'if_qty') {
            const mine = rows.filter(r => String(r.ifid) === String(op.ifId) && String(r.item) === String(op.item));
            if (!mine.length) throw new Error('IF ' + op.ifId + ' item ' + op.item + ' is not in the snapshot');
            mine.forEach((r, i) => { r.qty = i === 0 ? Number(op.to) : 0; });
        } else if (op.op === 'if_create') {
            const id = rows.reduce((m, r) => Math.max(m, Number(r.ifid) || 0), 90000) + 1, items = (raw.items || []);
            Object.keys(op.lines || {}).forEach(k => rows.push({ ifid: id, ifnum: 'IF' + id, status: 'B', trandate: new Date().toISOString().slice(0, 10), toid: Number(op.toId), item: Number(k),
                sku: (items.find(i => String(i.item) === String(k)) || {}).sku || String(k), qty: Number(op.lines[k]), memo: op.memo || '' }));
            reads = verify.buildReads(raw);
            return String(id);
        } else if (op.op === 'if_stamp') {
            rows.filter(r => String(r.ifid) === String(op.ifId)).forEach(r => { r.status = 'C'; });
        } else return;
        reads = verify.buildReads(raw);
    };
```

`move_portal/test/fake_tx.js`: let the hook supply the id:

```js
            t.ops.push(JSON.parse(JSON.stringify(op)));
            const hooked = t.onApply ? t.onApply(op) : undefined;
            if (hooked != null && hooked !== '') return String(hooked);
            return op.op === 'if_qty' || op.op === 'if_stamp' ? String(op.ifId) : String(++t.seq);
```

`move_portal/test/preview_server.js`: the hook line becomes `tx._t.onApply = op => ns.applyOp(op);   // qty/on mode locally: if_qty / if_create / if_stamp land in the in-memory snapshot` (already there from this morning; just update the comment).

- [ ] **Step 4: Run the whole suite**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass (239 + 14 = 253 or more; report the exact count).

- [ ] **Step 5: Browser smoke on :8799** (the controller may do this instead; if you do it, use the Claude browser tools, never kill node by name)

Start `node move_portal/test/preview_server.js --port 8799 --store move_portal/local/smoke-store.json` in the background. Set the store's `writeMode` to `qty` before starting if you want the on-IF accept to write (edit `move_portal/local/smoke-store.json` only while the server is stopped). Walk: manager Labels (Print a SKU is first) → print 3 labels for a planned IF's SKU plus 1 label for a different SKU → floor start truck, scan 3, Verify, Shipments Mark shipped → manager Dashboard (first tab; Waiting shows Ship confirmations 1; Active loads has one row) → Approvals Confirm shipped → floor Inbound Unload: scan the 3, scan the 4th (flagged) → manager Dashboard shows Flagged pallets 1 and Receipts 1 → Approvals: Accept on the Flagged card (text shows ✅ or ⏳) → receipt card Approve → Report shows the history row. Check console and server output for errors. Delete `move_portal/local/smoke-store.json` afterwards and stop your PID.

- [ ] **Step 6: Handoff docs**

Append to `docs/sdd-ledger/progress.md` a section `## 2026-10-06 pm · manager dashboard + flagged pallets` listing: tasks 1–7 done with commit hashes, the test count, and these ON-MODE GATE / Stage 2 items: (a) `setIfItemQty` on a Shipped (C) IF must be verified in prod before `qty` (spec §2.6); (b) pending add-on IFs are matched by TO + exact lines + not on a truck until `move_ns` exposes memos (then match by `createToken`); (c) `pallet_accept` claims the truck with phase `accept` while the floor may still scan: both sides re-read before writing, no lost update seen in tests, keep an eye on it in the beta.

Update `CLAUDE.md`: in **Files** add the new spec and plan to their lists; in the HANDOFF block replace the "How the portal works now" manager bullet with: **Manager** tabs **Dashboard** (default: Waiting for approval card → Approvals; truck tiles; Active loads one row per IF with search/status/sort; trucks per day; exceptions) · **Approvals** (Ship confirmations → Correct the IF → Trucks → **Flagged pallets** (Accept / Reject) → Retry/Release → Receipts; Approve receipt waits for undecided flagged pallets) · **Labels** (Print a SKU first) · **Report** (day table, NetSuite checks, **Truck history**). Add to "Decisions Jack made": trucks are the progress metric, no finish date in the portal (the Move Tracker owns it); flagged pallets get Accept/Reject in either place. Update the test count line.

- [ ] **Step 7: Commit**

```bash
git add move_portal/local/snapshot_ns.js move_portal/test/fake_tx.js move_portal/test/preview_server.js move_portal/test/verify.test.js CLAUDE.md docs/sdd-ledger/progress.md
git commit -m "beta: snapshot stand-in applies if_create/if_stamp; handoff for the manager dashboard + flagged pallets amendment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes (controller)

- Spec §2.2 floor wording → Task 5. §2.3/2.4 cards → Task 5. §2.5 rules → Tasks 1–2 (on-IF, off-IF, no TO, loaded elsewhere, reject, no undo). §2.6 prod check → ledger (Task 7). §3 dashboard → Tasks 3 + 6 (D10: no dock tile). §3.2 toolbar → Task 6. §3.3 counting → Task 3 (`trackerMetrics` reused with `remaining: 0`; only `movedToday/avg7/avgAll/moved` are read). §4 report → Tasks 4 + 6 (no "Dropped" status exists today; the column shows the real status). §5 labels → Task 5. §6 data/actions → Tasks 1–4 (`lastStep` rides on existing writes instead of a new write per action: same field, no extra NetSuite calls). §6 local beta → Task 7.
- Type consistency: `flaggedRows` fields (`palletId, code, summary, sku, item, pcs, truckId, truckLabel, truckStatus, by, at`) are what Task 5's `flagRow` and Task 3's `firstText` read. Receipt entry keys `flagged / pending / decided / canApprove / blockReason` match between Tasks 1 and 5. Dashboard payload keys match between Tasks 3 and 6. `verify._fmt` is added in Task 1 and used in Tasks 1, 2, 4.
- Deviation from the spec to flag to Jack: pending add-on IFs are recognised by TO + exact lines (not the memo token) until Stage 2's live `move_ns` exposes memos.
