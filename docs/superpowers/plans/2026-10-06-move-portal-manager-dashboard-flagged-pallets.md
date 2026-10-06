# Move Portal v3: Manager Dashboard, Flagged Pallets, Labels Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the manager an Accept / Reject decision on never-loaded pallets scanned at Tippecanoe (decidable on a Flagged pallets card or on the receipt card; Approve receipt waits for it), rebuild the manager Dashboard around trucks and approvals with a tracker-style Active loads table, add a truck history to the Report, make Dashboard the first tab, and put Print a SKU first on Labels.

**Architecture:** Server changes go in `move_portal/sl_move_portal.js`, reusing its helpers: `mustTruck`, `claimLoad(Ld, status, phase, mustBe, extraData)`, `assertClaim`, `stale`, `touched`, `stillFlagged`, `unloadView`, `receiptPlan`, `truckSummary(x, counts)`, `truckLabel`, `pubPallet`, `reservedToLines`, `corrSig`, `createToken`, `minutesSince`, `whoName`, `writeMode(c)`, `skuNames`, and `verify.runOps` / `verify.resolveNew` / `verify.opKey` / `verify.liveIfs` / `verify.fillExpected` / `verify.sumLines` / `verify.planReceipts`. Pallet decisions live on the pallet (`data.decision`) and on the truck (`data.corrections` entries of kind `pallet_accept` / `pallet_reject`, and `data.flagged` shrinking). Every truck write that is a user step also carries `lastStep` (no extra NetSuite writes: it rides on writes that already happen). UI changes go in `move_portal/move_ui.js`. The local beta's snapshot stand-in (`move_portal/local/snapshot_ns.js`) learns `if_create` / `if_stamp` so `on` mode can be walked locally. Read each helper before you call it: the file evolves.

**Tech Stack:** SuiteScript 2.1 AMD, node 18 `node:test`, the fakes in `move_portal/test/` (`fake_data`, `fake_tx`, `fixtures/snapshot_sample.json`), the local preview server.

**Spec:** `docs/superpowers/specs/2026-10-06-move-portal-manager-dashboard-flagged-pallets-design.md` (D1–D10). **Mockup:** `docs/mockups/2026-10-06 move portal manager dashboard + flagged pallets mockup.html`.

## Global Constraints

- **Tests:** run `node --test "move_portal/test/*.test.js"` from the repo root `G:\My Drive\Move-portal`. The quoted glob is required on Windows. The suite starts at **239/239** and must end green with pristine output.
- **Branch:** `feat/v3-verification`. Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Don't push until the controller says to.
- **Truck statuses:** `loading · needs_fix · ready · ship_pending · departing · departed · receiving · approving · received`. `UNLOADABLE = [departed, receiving, received]`.
- **Pallet statuses:** `labeled · loaded · in_transit · received · missing · void`.
- **Write modes:** `off | qty | on`. `verify.opAllowed(op, mode)`: `on` allows everything, `qty` allows only `if_qty`. Anything not allowed is plan-only.
- **Flag:** a never-loaded pallet has `data.flag === 'never_loaded'`, `data.flaggedTruck === <truckId>`, and its id is in that truck's `data.flagged`. `stillFlagged(ids)` returns the undecided ones (flag still set, status `labeled` or `loaded`).
- **Decision:** `pallet.data.decision = {kind: 'accepted' | 'accepted_pending' | 'rejected', ifId?, ifNum?, toId?, toNum?, item?, pcs?, op?, note?, by, at}`. `by` is `c.user` (`{id, name}`), `at` is `c.now.stamp`.
- **Truck correction entries** gain `{kind: 'pallet_accept' | 'pallet_reject', palletId, code, pcs, ifNum?, toNum?, note?, pending?: true, by, at}` in `data.corrections` (existing entries have `{key, op, by, at}` and no `kind`).
- **lastStep:** `{kind, by: c.actor, at: c.now.stamp}` where `kind ∈ started · scanned · taken_off · verified · corrected · if_added · if_dropped · marked_shipped · confirmed · sent_back · unload_scanned · unload_done · receipt_approved · pallet_accepted · pallet_rejected`.
- **Settings:** `trucksPerDay` (number, default 8 when missing or not > 0).
- **Lesson:** `data.updateLoad(L, patch)` merges `patch.data` over the copy passed in. Always re-read with `data.getLoad(id)` right before an update, and re-check status and claim.
- **Never kill node processes by image name.** Jack's beta runs on :8765. Smoke-test on :8799 with `--port 8799 --store move_portal/local/smoke-store.json` (delete the store afterwards), and stop only your own PID.
- **Wording is exact** where quoted in this plan: tests assert on it.

---

## File map

| File | Change |
|---|---|
| `move_portal/sl_move_portal.js` | `stepOf` + `lastStep` on existing writes; `pallet_accept` / `pallet_reject`; `settlePending`; approvals `flagged` + receipt `flagged/pending/decided/canApprove/blockReason`; `receipt_approve` gate; `unloadView.decided`; `approvalsView(c)` shared; `dashboard` rebuilt; `report.history` |
| `move_portal/move_ui.js` | Manager tabs reordered, default `dash`; Labels order; Approvals Flagged card + receipt rows + anchors; new Dashboard screen; Report history; shared table toolbar |
| `move_portal/local/snapshot_ns.js`, `move_portal/test/fake_tx.js` | `applyOp` handles `if_create` (returns the new id) and `if_stamp`; `onApply` may return the id |
| `move_portal/test/portal.test.js`, `move_portal/test/ui.test.js` | Tests (and the two existing assertions the tab/dashboard changes break) |
| `CLAUDE.md`, `docs/sdd-ledger/progress.md` | Handoff (last task) |

---

### Task 1: `lastStep` on truck writes, accept / reject (on-IF), receipt gate, approvals `flagged`

**Files:**
- Modify: `move_portal/sl_move_portal.js`
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Produces `stepOf(kind, c)`, `pendingAccepts(x)`, `flaggedRows(x, ps)`, `decideGuard(x)`, `completeAccept(id, p, dec, c)`, actions `pallet_accept {truckId, palletId}` → `{outcome: 'accepted' | 'pending' | 'refused', text, view}`, `pallet_reject {truckId, palletId, note}` → `{outcome: 'rejected', text, view}`; `approvals.flagged` rows; receipt entries with `flagged`, `pending`, `decided`, `canApprove`, `blockReason`; `unloadView.decided`.
- Task 2 adds the off-IF branch inside `pallet_accept` and `settlePending`.

- [ ] **Step 1: Write the failing tests** (append to `move_portal/test/portal.test.js`; the helpers `setup`, `printLabels`, `departed`, `L975`, `LINE201` already exist at the top of the file)

```js
// ── 2026-10-06 pm: flagged pallets (spec D1–D3) ──
function strayOn(ctx, t, lines) {                       // a labeled pallet scanned at Tippecanoe that was never loaded
    const s = printLabels(ctx, 1, 'Jstray' + Math.random().toString(36).slice(2, 6), [lines || L975])[0];
    const r = ctx.run('unload_scan', { truckId: t.id, raw: s.code }, false);
    assert.equal(r.result, 'never_loaded');
    return ctx.data.getPallet(s.id);
}

test('pallet_accept (qty mode, SKU on a truck IF): if_qty written, pallet received, alloc grown, receipt includes it', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t, ps } = departed(ctx, 42, '5260001');                        // IF9001 = 504 = 42 × 12
    const stray = strayOn(ctx, t);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }, false), /Managers only/);
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'accepted');
    assert.equal(r.text, '✅ Accepted · IF9001 504 → 516');
    const op = ctx.tx._t.ops.find(o => o.op === 'if_qty' && o.ifId === '9001');
    assert.deepEqual([op.item, op.from, op.to], ['975', 504, 516]);
    const p = ctx.data.getPallet(stray.id), x = ctx.data.getLoad(t.id);
    assert.deepEqual([p.status, p.loadId, p.data.flag, p.data.decision.kind, p.data.decision.ifNum], ['received', t.id, '', 'accepted', 'IF9001']);
    assert.equal(x.data.alloc[0].lines['975'], 516);
    assert.deepEqual(x.data.flagged, []);
    assert.equal(x.data.corrections.filter(k => k.kind === 'pallet_accept').length, 1);
    assert.ok(x.data.correctionWrites['if_qty:9001:975|504>516']);
    assert.deepEqual(x.data.lastStep.kind, 'pallet_accepted');
    assert.deepEqual(ctx.run('receipt_preview', { truckId: t.id }).perIf, [{ ifId: '9001', ifNum: 'IF9001', shipped: 516, received: 516, short: 0 }]);
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }), /not flagged/);
});

test('pallet_accept in off mode is pending: receipt blocked until the IF reads as written, then settled by approvals', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 42, '5260002');
    const stray = strayOn(ctx, t);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'pending');
    assert.equal(r.text, '⏳ Accepted · office sets IF9001 YSN100 to 516 · receipt waits');
    assert.equal(ctx.data.getPallet(stray.id).data.decision.kind, 'accepted_pending');
    assert.equal(ctx.data.getPallet(stray.id).status, 'labeled');
    ctx.run('unload_done', { truckId: t.id }, false);
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }), /Decide 1 flagged pallet/);
    let ap = ctx.run('approvals');
    assert.deepEqual([ap.flagged.length, ap.receipts[0].pending.length, ap.receipts[0].canApprove, ap.receipts[0].blockReason], [0, 1, false, 'Decide 1 flagged pallet first']);
    const realInfo = ctx.ns.ifInfo;                                       // the office edits the IF in NetSuite
    ctx.ns.ifInfo = () => { const o = realInfo(); o['9001'].lines = [{ item: '975', sku: 'YSN100', qty: 516 }]; return o; };
    ap = ctx.run('approvals');
    assert.deepEqual([ap.receipts[0].pending.length, ap.receipts[0].canApprove, ap.receipts[0].decided.length], [0, true, 1]);
    assert.equal(ctx.data.getPallet(stray.id).status, 'received');
    assert.equal(ctx.data.getLoad(t.id).data.alloc[0].lines['975'], 516);
    assert.equal(ctx.run('receipt_approve', { truckId: t.id }).perIf[0].received, 516);
});

test('pallet_reject: note required; pallet back to labeled; scanning it again flags it again', () => {
    const ctx = setup();
    const { t } = departed(ctx, 42, '5260003');
    const stray = strayOn(ctx, t);
    assert.throws(() => ctx.run('pallet_reject', { truckId: t.id, palletId: stray.id, note: '  ' }), /note/i);
    const r = ctx.run('pallet_reject', { truckId: t.id, palletId: stray.id, note: 'belongs to Trailer 537224' });
    assert.equal(r.text, '↩ Rejected · "belongs to Trailer 537224" · back to labeled');
    const p = ctx.data.getPallet(stray.id);
    assert.deepEqual([p.status, p.loadId, p.data.flag, p.data.decision.kind, p.data.decision.note], ['labeled', '', '', 'rejected', 'belongs to Trailer 537224']);
    assert.deepEqual(ctx.data.getLoad(t.id).data.flagged, []);
    assert.equal(ctx.run('unload_get', { truckId: t.id }, false).view.decided[0].text, '↩ Rejected · "belongs to Trailer 537224" · back to labeled');
    assert.equal(ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false).result, 'never_loaded');
    assert.deepEqual(ctx.data.getLoad(t.id).data.flagged, [String(p.id)]);
});

test('approvals.flagged lists undecided pallets across trucks; the receipt card repeats its own and blocks approval', () => {
    const ctx = setup();
    const a = departed(ctx, 42, '5260004'), b = departed(ctx, 42, '5260005', '9002');
    const s1 = strayOn(ctx, a.t), s2 = strayOn(ctx, b.t);
    a.ps.forEach(p => ctx.run('unload_scan', { truckId: a.t.id, raw: p.code }, false));
    ctx.run('unload_done', { truckId: a.t.id }, false);
    const ap = ctx.run('approvals');
    assert.deepEqual(ap.flagged.map(f => [f.palletId, f.truckId, f.sku, f.pcs, f.by]), [[s1.id, a.t.id, 'YSN100', 12, 'Miguel'], [s2.id, b.t.id, 'YSN100', 12, 'Miguel']]);
    const rec = ap.receipts.find(x => x.truck.id === a.t.id);
    assert.deepEqual([rec.flagged.map(f => f.palletId), rec.canApprove, rec.blockReason], [[s1.id], false, 'Decide 1 flagged pallet first']);
    assert.throws(() => ctx.run('receipt_approve', { truckId: a.t.id }), /Decide 1 flagged pallet first/);
    assert.equal(ctx.run('approvals').receipts.some(x => x.truck.id === b.t.id), true, 'a truck with only a flagged pallet still gets a receipt card');
});

test('lastStep rides on the existing writes: start, scan, verify, mark, confirm, unload scan, done, approve', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jls', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'LS1' }, false).view.truck;
    const step = () => ctx.data.getLoad(t.id).data.lastStep;
    assert.deepEqual([step().kind, step().by], ['started', 'Miguel']);
    ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code }, false);
    assert.equal(step().kind, 'scanned');
    ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false);
    assert.equal(step().kind, 'taken_off');
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.equal(step().kind, 'verified');
    ctx.run('ship_mark', { truckId: t.id, seal: '5260006' }, false);
    assert.equal(step().kind, 'marked_shipped');
    ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(step().kind, 'confirmed');
    ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false);
    assert.equal(step().kind, 'unload_scanned');
    ctx.run('unload_done', { truckId: t.id }, false);
    assert.equal(step().kind, 'unload_done');
    ctx.run('receipt_approve', { truckId: t.id });
    assert.equal(step().kind, 'receipt_approved');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: the six new tests FAIL (`Unknown action: pallet_accept`, `lastStep` undefined, etc.). Everything else passes.

- [ ] **Step 3: `stepOf` and `lastStep` on the existing writes** (`move_portal/sl_move_portal.js`)

Add next to `pubPallet`:

```js
    // The truck's last user step, for the Dashboard's Active loads. Rides on writes that already happen: never its own write.
    function stepOf(kind, c) { return { kind: kind, by: c.actor, at: c.now.stamp }; }
```

Then add `lastStep` to these existing writes (find each by the text shown; keep everything else as it is):

| Where | Change |
|---|---|
| `truck_start` → `data.createLoad({... data: { v3: true, ifs, trailer, startedBy, startedAt, stack: [] } })` | add `lastStep: stepOf('started', c)` to that `data` |
| `pushStack(id, entry)` | becomes `function pushStack(id, entry, c) { touched(id, cur => ({ stack: ..., lastStep: stepOf('scanned', c) })); }` and both callers pass `c`: `pushStack(x.id, String(p.id), c)` |
| `takeOff` → `touched(x.id);` | `touched(x.id, { lastStep: stepOf('taken_off', c) });` |
| `verifyTruck` final `data.updateLoad(cur, { status, data: Object.assign({ ifs: r.keep, verify: {...} }, ...) })` | add `lastStep: stepOf(opt.auto ? 'verified' : 'verified', c)` into the first object of that `Object.assign` **only when `changed`** (`changed ? { lastStep: stepOf('verified', c) } : {}` as one more argument), so a poll that changes nothing writes nothing new |
| `truck_add_if` / `truck_drop_if` | after `verifyOut(v, c)` is computed, no extra write: instead pass `opt.stepKind` through `verifyTruck`: in both actions add `stepKind: 'if_added'` / `'if_dropped'` to the opt object, and in `verifyTruck` use `stepOf(opt.stepKind || 'verified', c)` |
| `truck_correct` → `release({ correctError: err || '' })` | `release({ correctError: err || '', lastStep: stepOf('corrected', c) })` |
| `ship_mark` final `data.updateLoad(cur, { status: T.SHIP_PENDING, data: Object.assign({ shipReq: ..., sentBack: null }, ...) })` | add `lastStep: stepOf('marked_shipped', c)` to the first object |
| `departData(d, inp, c)` | add `lastStep: stepOf('confirmed', c)` to the returned object |
| `ship_sendback` write | add `lastStep: stepOf('sent_back', c)` |
| `receiveOn` patch `{ data: { rstack, unposted } }` | add `lastStep: stepOf('unload_scanned', c)` |
| `unload_done` write | `{ data: { recvRequested: {...}, lastStep: stepOf('unload_done', c) } }` |
| `receipt_approve` final `data.updateLoad(fin, { status: T.RECEIVED, data: {...} })` | add `lastStep: stepOf('receipt_approved', c)` |

- [ ] **Step 4: Decision helpers and the two actions** (`move_portal/sl_move_portal.js`, after `stillFlagged`)

```js
    // ── Flagged pallets: manager Accept / Reject (spec 2026-10-06 pm §2) ──
    // Undecided never-loaded pallets on this truck, as rows for Approvals and the receipt card.
    function flaggedRows(x, ps) {
        const label = truckLabel(x);
        return (ps || stillFlagged(x.data.flagged).filter(p => p.data.flaggedTruck === x.id && !(p.data.decision && p.data.decision.kind === 'accepted_pending')))
            .map(p => ({ palletId: p.id, code: p.code, summary: p.summary, sku: core.headline(p.lines), item: String((p.lines[0] || {}).item || ''), pcs: p.pieces,
                truckId: x.id, truckLabel: label, truckStatus: x.status, by: whoName(p.data.flaggedBy), at: p.data.flaggedAt || '' }));
    }
    // Accepted, but the IF op was plan-only (write mode) and the office has not done it yet in NetSuite.
    function pendingAccepts(x) {
        return stillFlagged(x.data.flagged).filter(p => p.data.flaggedTruck === x.id && p.data.decision && p.data.decision.kind === 'accepted_pending');
    }
    function pendingRows(x) {
        return pendingAccepts(x).map(p => Object.assign(flaggedRows(x, [p])[0], { text: p.data.decision.text || '' }));
    }
    function decidedRows(x) {
        return (x.data.corrections || []).filter(k => k.kind === 'pallet_accept' || k.kind === 'pallet_reject').map(k => ({ code: k.code, text: k.text || '', at: k.at, by: whoName(k.by) }));
    }
    function blockReasonOf(x) {
        const n = flaggedRows(x).length + pendingAccepts(x).length;
        return n ? 'Decide ' + n + ' flagged pallet' + (n === 1 ? '' : 's') + ' first' : '';
    }
    // A decision runs only on a truck at Tippecanoe that nobody is processing (an approve or another decision in flight holds the claim).
    function decideGuard(cur) {
        if (UNLOADABLE.indexOf(cur.status) === -1) throw userErr('This truck is ' + cur.status + ', its pallets cannot be decided yet');
        if (cur.data.claim && !stale(cur)) throw userErr((truckLabel(cur) || 'This truck') + ' is already being processed by someone else. Refresh in a minute.');
    }
    function mustFlaggedOn(x, palletId) {
        const p = data.getPallet(palletId);
        if (!p || p.data.flag !== 'never_loaded' || String(p.data.flaggedTruck) !== String(x.id) || (x.data.flagged || []).indexOf(String(p.id)) === -1) throw userErr('That pallet is not flagged on this truck');
        if (p.data.decision && p.data.decision.kind === 'accepted_pending') throw userErr('That pallet is already accepted: the office finishes it in NetSuite');
        if (p.status !== VP.LABELED && p.status !== VP.LOADED) throw userErr('That pallet is ' + p.status + ', nothing to decide');
        return p;
    }
    // The pallet physically arrived here, so it leaves the open truck it was scanned onto at Riverside (that truck's ready reverts).
    function unloadFromOther(p, c) {
        if (p.status !== VP.LOADED || !p.loadId) return;
        const o = data.getLoad(p.loadId);
        data.updatePallet(p, { status: VP.LABELED, load: '', data: { takenOffAt: c.now.stamp, takenOffBy: c.actor, takenOffTruck: p.loadId, takenOffWhy: 'arrived_tippecanoe' } });
        if (o && isOpen(o)) touched(o.id, { lastStep: stepOf('taken_off', c) });
    }
    function corrEntry(kind, p, extra, c) {
        return Object.assign({ kind: kind, palletId: String(p.id), code: p.code, pcs: p.pieces, by: c.user, at: c.now.stamp }, extra || {});
    }
    // The pallet joins the truck: received on it, its pieces in the truck's alloc for the IF, the flag closed.
    function completeAccept(id, p, dec, c) {
        const x = mustTruck(id), item = String(dec.item), pcs = Number(dec.pcs);
        let alloc = (x.data.alloc || []).map(a => Object.assign({}, a, { lines: Object.assign({}, a.lines) }));
        let a = alloc.find(y => String(y.ifId) === String(dec.ifId));
        if (!a) { a = { ifId: String(dec.ifId), ifNum: dec.ifNum, toId: String(dec.toId), toNum: dec.toNum, lines: {}, addOn: true }; alloc.push(a); }
        a.lines[item] = (Number(a.lines[item]) || 0) + pcs;
        const ifs = (x.data.ifs || []).some(f => String(f.ifId) === String(dec.ifId)) ? x.data.ifs
            : (x.data.ifs || []).concat([{ ifId: String(dec.ifId), ifNum: dec.ifNum, toId: String(dec.toId), toNum: dec.toNum, status: 'B', lines: [{ item: item, sku: dec.sku, qty: pcs }] }]);
        data.updatePallet(p, { status: VP.RECEIVED, load: x.id, data: { flag: '', receivedAt: c.now.stamp, receivedBy: c.actor, decision: Object.assign({}, dec, { kind: 'accepted' }) } });
        const cur = mustTruck(id), d = cur.data, text = dec.text;
        const corr = (d.corrections || []).filter(k => !(k.kind === 'pallet_accept' && String(k.palletId) === String(p.id)));
        const patch = { data: { alloc: alloc, ifs: ifs, flagged: (d.flagged || []).filter(k => String(k) !== String(p.id)), lastStep: stepOf('pallet_accepted', c),
            unposted: (typeof d.unposted === 'number' ? d.unposted : unpostedOf(cur)) + 1,
            corrections: corr.concat([corrEntry('pallet_accept', p, { ifNum: dec.ifNum, toNum: dec.toNum, text: text }, c)]) } };
        if (cur.status === T.DEPARTED) patch.status = T.RECEIVING;
        data.updateLoad(cur, patch);
    }
    // What a pending accept waits for: the IF line at the target qty (if_qty), or the add-on IF existing (if_create, Task 2).
    function pendingDone(dec, info, planned, trucks) {
        if (dec.op && dec.op.op === 'if_qty') {
            const f = info[String(dec.op.ifId)];
            return f && (f.lines || []).filter(l => String(l.item) === String(dec.op.item)).reduce((s, l) => s + Number(l.qty || 0), 0) === Number(dec.op.to) ? { ifId: String(dec.op.ifId), ifNum: dec.op.ifNum } : null;
        }
        return null;
    }
    // Settle pending accepts whose NetSuite side is done (the office acted). Called by approvals for every truck it lists.
    function settlePending(x, c, shared) {
        const pend = pendingAccepts(x);
        if (!pend.length) return x;
        const info = shared.info || (shared.info = ns.ifInfo()), planned = shared.planned || (shared.planned = ns.plannedIfs()), trucks = shared.trucks || (shared.trucks = allTrucks());
        pend.forEach(p => {
            const dec = p.data.decision, got = pendingDone(dec, info, planned, trucks);
            if (!got) return;
            const cur = mustTruck(x.id);
            if (cur.data.claim && !stale(cur)) return;
            completeAccept(x.id, data.getPallet(p.id), Object.assign({}, dec, got, { text: acceptText(Object.assign({}, dec, got)) }), c);
        });
        return mustTruck(x.id);
    }
    function acceptText(dec) {
        return dec.op && dec.op.op === 'if_qty' ? '✅ Accepted · ' + dec.ifNum + ' ' + verify._fmt(dec.op.from) + ' → ' + verify._fmt(dec.op.to) : '✅ Accepted · ' + dec.ifNum;
    }
    // The IF on this truck that carries the pallet's SKU (lowest IF number), read fresh from NetSuite for the from-qty.
    function ifForItem(x, item, info) {
        const cands = (x.data.alloc || []).filter(a => String(a.ifId).indexOf('new:') !== 0 && Number(a.lines[item]) > 0).sort((p, q) => Number(p.ifId) - Number(q.ifId));
        for (let i = 0; i < cands.length; i++) {
            const f = info[String(cands[i].ifId)];
            if (f) return { ifId: String(cands[i].ifId), ifNum: f.ifNum, toId: String(f.toId), toNum: cands[i].toNum, from: (f.lines || []).filter(l => String(l.item) === item).reduce((s, l) => s + Number(l.qty || 0), 0) };
        }
        return null;
    }
    act('pallet_accept', true, (a, c) => {
        const x0 = mustTruck(a.truckId);
        decideGuard(x0);
        const p0 = mustFlaggedOn(x0, a.palletId), item = String((p0.lines[0] || {}).item || ''), pcs = Number(p0.pieces) || 0;
        if (!item || !pcs || (p0.lines || []).length !== 1) throw userErr('Only a single-SKU pallet can be accepted here: reject it and call the office');
        const info = ns.ifInfo(), sk = skuNames([item])[item] || item;
        const target = ifForItem(x0, item, info);
        let op, dec;
        if (target) {
            op = { op: 'if_qty', ifId: target.ifId, ifNum: target.ifNum, toId: target.toId, item: item, from: target.from, to: target.from + pcs };
            dec = { kind: 'accepted_pending', ifId: target.ifId, ifNum: target.ifNum, toId: target.toId, toNum: target.toNum, item: item, sku: sk, pcs: pcs, op: op, by: c.user, at: c.now.stamp };
        } else {
            return acceptOffIf(x0, p0, item, sk, pcs, c);           // Task 2
        }
        const cl = claimLoad(x0, x0.status, 'accept', decideGuard, {});
        const id = cl.Ld.id, claim = cl.claim, label = truckLabel(cl.Ld);
        const release = patch => { assertClaim(id, claim, label, 'accept'); data.updateLoad(data.getLoad(id), { data: Object.assign({ claim: '', workingAt: 0, phase: '' }, patch) }); };
        let res, err = null;
        try {
            res = verify.runOps([op], writeMode(c), o => { assertClaim(id, claim, label, 'accept'); return tx.apply(o); }, {}, (k, newId) => {
                const cur = data.getLoad(id);
                data.updateLoad(cur, { data: { correctionWrites: Object.assign({}, cur.data.correctionWrites, { [k + '|' + corrSig(op)]: { key: k, op: op.op, id: String(newId), sig: corrSig(op), at: c.now.stamp, by: c.user } }) } });
            });
        } catch (e) {
            if (e.user) throw e;
            log.error({ title: 'move pallet_accept ' + id, details: (e && e.stack) || String(e) });
            err = e.message || String(e);
        }
        if (err) { release({}); throw userErr('Accept refused: ' + err + ' — fix it in NetSuite'); }
        const p = data.getPallet(p0.id);
        unloadFromOther(p, c);
        if (res.planOnly.length) {                                  // plan-only: the office edits the IF; the receipt waits (settlePending finishes it)
            dec.text = '⏳ Accepted · office sets ' + target.ifNum + ' ' + sk + ' to ' + verify._fmt(op.to) + ' · receipt waits';
            data.updatePallet(data.getPallet(p.id), { data: { decision: dec } });
            const cur = data.getLoad(id);
            release({ lastStep: stepOf('pallet_accepted', c), corrections: (cur.data.corrections || []).concat([corrEntry('pallet_accept', p, { ifNum: target.ifNum, pending: true, text: dec.text }, c)]) });
            if (ns.resetCache) ns.resetCache();
            return { outcome: 'pending', text: dec.text, view: unloadView(mustTruck(id), c) };
        }
        dec.text = acceptText(dec);
        completeAccept(id, data.getPallet(p.id), dec, c);
        release({});
        if (ns.resetCache) ns.resetCache();
        return { outcome: 'accepted', text: dec.text, view: unloadView(mustTruck(id), c) };
    });
    act('pallet_reject', true, (a, c) => {
        const note = String(a.note || '').trim().slice(0, 300);
        if (!note) throw userErr('Enter a note: why is this pallet rejected?');
        const x0 = mustTruck(a.truckId);
        decideGuard(x0);
        const p0 = mustFlaggedOn(x0, a.palletId);
        const cl = claimLoad(x0, x0.status, 'reject', decideGuard, {});
        const id = cl.Ld.id, claim = cl.claim, label = truckLabel(cl.Ld);
        const p = data.getPallet(p0.id);
        unloadFromOther(p, c);
        const text = '↩ Rejected · "' + note + '" · back to labeled';
        data.updatePallet(data.getPallet(p.id), { status: VP.LABELED, load: '', data: { flag: '', decision: { kind: 'rejected', note: note, by: c.user, at: c.now.stamp, text: text } } });
        assertClaim(id, claim, label, 'reject');
        const cur = data.getLoad(id);
        data.updateLoad(cur, { data: { claim: '', workingAt: 0, phase: '', flagged: (cur.data.flagged || []).filter(k => String(k) !== String(p.id)), lastStep: stepOf('pallet_rejected', c),
            corrections: (cur.data.corrections || []).concat([corrEntry('pallet_reject', p, { note: note, text: text }, c)]) } });
        return { outcome: 'rejected', text: text, view: unloadView(mustTruck(id), c) };
    });
```

Export `fmt` from `move_verify.js` as `_fmt` (add `_fmt: fmt` to its return object) so the texts use the same thousands formatting as `diffText`.

Add `decided: decidedRows(x)` to the object `unloadView` returns, and change nothing else there (its `flagged` stays `stillFlagged(...)` filtered by truck, which now includes pending ones; that's fine for the floor list, which shows the decision text per pallet in Task 5).

- [ ] **Step 5: Receipt gate and approvals** (`move_portal/sl_move_portal.js`)

In `receipt_approve`, right after `if (!canApprove(x0)) throw ...`, add:

```js
        const block = blockReasonOf(x0);
        if (block) throw userErr(block);
```

and make `canApprove` also refuse an in-flight decision: `const canApprove = cur => (UNLOADABLE.indexOf(cur.status) !== -1 && !(cur.data.claim && !stale(cur))) || (cur.status === T.APPROVING && (cur.data.error || stale(cur)));`

In `approvals`: before `shipPending`, add

```js
        const shared = {};
        const atTip = trucks.filter(x => UNLOADABLE.indexOf(x.status) !== -1 || x.status === T.APPROVING);
        const settled = atTip.map(x => settlePending(x, c, shared));
        const flagged = [].concat.apply([], settled.map(x => flaggedRows(x)));
```

Add `flagged: flagged,` to the returned object, and change `receipts:` to iterate `settled` instead of `trucks.filter(...)`, and inside its map, after `const unposted = unpostedOf(x, counts);` replace the early-return line with:

```js
                    const fl = flaggedRows(x), pend = pendingRows(x);
                    if (!isStuck && !fl.length && !pend.length && (!unposted || (x.status !== T.RECEIVED && !x.data.recvRequested))) return null;
                    const rp = receiptPlan(x), block = blockReasonOf(x);
                    const o = { truck: sum(x), perIf: rp.perIf, missing: rp.missing, lateOnly: x.status === T.RECEIVED, flagged: fl, pending: pend, decided: decidedRows(x), canApprove: !block, blockReason: block };
```

(`receiptPlan(x)` on a truck with nothing scanned in returns empty `perIf`/`ops`: that's fine, the card shows the flagged rows and a disabled Approve.)

- [ ] **Step 6: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: the Task 1 tests pass except the two that need Task 2 paths (none in this task use off-IF); all 239 earlier tests still pass. If `fix9`'s `exc.neverLoaded` assertion changed, you touched `stillFlagged`: don't.

- [ ] **Step 7: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/move_verify.js move_portal/test/portal.test.js
git commit -m "feat(flagged): manager Accept/Reject on never-loaded pallets (on-IF path), receipt gate, approvals flagged rows, lastStep on truck writes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Accept a SKU on no truck IF (add-on IF), pending completion, loaded-elsewhere case

**Files:**
- Modify: `move_portal/sl_move_portal.js`
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes Task 1's `completeAccept`, `pendingDone`, `settlePending`, `corrEntry`, `unloadFromOther`, `acceptText`.
- Produces `acceptOffIf(x0, p0, item, sk, pcs, c)` (called from `pallet_accept`), `findAddOnIf(toId, lines, planned, trucks, exceptId)`, and `pendingDone` handling `if_create`.

- [ ] **Step 1: Write the failing tests**

```js
test('pallet_accept off-IF (on mode): add-on IF created on the covering TO, stamped, pallet received, alloc has the new IF', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t, ps } = departed(ctx, 42, '5260010');
    const stray = strayOn(ctx, t, LINE201);                              // YSN201: no IF on this truck; TO700 (open) covers it
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'accepted');
    assert.match(r.text, /^✅ Accepted · IF 90\d · new IF on TO700$/);
    const ops = ctx.tx._t.ops.filter(o => o.toId === '700' || o.ifNum === 'IF 901');
    assert.deepEqual(ops.map(o => o.op), ['if_create', 'if_stamp']);
    assert.deepEqual([ops[0].lines, ops[0].seal, ops[1].ifId, ops[1].lines], [{ '11': 120 }, '5260010', '901', { '11': 120 }]);
    const x = ctx.data.getLoad(t.id);
    const add = x.data.alloc.find(a => a.addOn);
    assert.deepEqual([add.ifId, add.toId, add.lines['11'], x.data.ifs.length], ['901', '700', 120, 2]);
    assert.equal(ctx.data.getPallet(stray.id).status, 'received');
    assert.equal(ctx.run('receipt_preview', { truckId: t.id }).perIf.length, 2);
});

test('pallet_accept off-IF (qty mode): pending; approvals settles it once a Packed IF with those lines appears on the TO', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t, ps } = departed(ctx, 42, '5260011');
    const stray = strayOn(ctx, t, LINE201);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.deepEqual([r.outcome, r.text], ['pending', '⏳ Accepted · office creates IF for 120 YSN201 on TO700 · receipt waits']);
    ctx.run('unload_done', { truckId: t.id }, false);
    assert.equal(ctx.run('approvals').receipts[0].canApprove, false);
    const real = ctx.ns.plannedIfs;                                       // the office creates the IF in NetSuite
    ctx.ns.plannedIfs = () => real().concat([{ ifId: '9100', ifNum: 'IF9100', status: 'B', trandate: '2026-10-14', toId: '700', toNum: 'TO700', lines: [{ item: '11', sku: 'YSN201', qty: 120 }] }]);
    const ap = ctx.run('approvals');
    assert.equal(ap.receipts[0].canApprove, true);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.data.alloc.find(a => a.addOn).ifId, ctx.data.getPallet(stray.id).status], ['9100', 'received']);
    assert.equal(ctx.run('receipt_approve', { truckId: t.id }).perIf.find(f => f.ifId === '9100').received, 120);
});

test('pallet_accept with no covering TO is refused and leaves the pallet undecided', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    ctx.data.db.items.push({ item: '77', sku: 'YSN777', desc: 'odd', upc: '' });
    const { t } = departed(ctx, 42, '5260012');
    const stray = strayOn(ctx, t, { item: '77', sku: 'YSN777', cfg: '', pcs: 10 });
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.deepEqual([r.outcome, r.text], ['refused', '⛔ Can\'t accept · no open TO covers YSN777 · Reject or office adds a TO line']);
    assert.deepEqual([ctx.data.getPallet(stray.id).data.flag, ctx.data.getPallet(stray.id).data.decision], ['never_loaded', undefined]);
    assert.equal(ctx.run('approvals').flagged.length, 1);
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_create').length, 0);
});

test('a pallet loaded on another open truck, accepted here, leaves that truck (its ready reverts to loading)', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t, ps } = departed(ctx, 42, '5260013');
    const other = readyTruck(ctx, 2, '9002');                            // 2 pallets of YSN100 on IF9002 (matched to 24)
    const r0 = ctx.run('unload_scan', { truckId: t.id, raw: other.ps[0].code }, false);
    assert.equal(r0.result, 'never_loaded');
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: other.ps[0].id });
    assert.equal(r.outcome, 'accepted');
    const p = ctx.data.getPallet(other.ps[0].id), o = ctx.data.getLoad(other.t.id);
    assert.deepEqual([p.status, p.loadId, o.status, o.data.lastStep.kind], ['received', t.id, 'loading', 'taken_off']);
    assert.equal(ctx.data.palletsByLoad(other.t.id, ['loaded']).length, 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: the four new tests FAIL (`acceptOffIf is not defined`).

- [ ] **Step 3: Implement** (`move_portal/sl_move_portal.js`, next to `pallet_accept`)

```js
    // A Packed IF on this TO, on no truck, with exactly these lines: how a pending add-on is recognised once the office created it.
    // (Stage 2: match by the memo token once move_ns exposes memos.)
    function linesSig(lines) { const m = {}; (lines || []).forEach(l => { const k = String(l.item); m[k] = (m[k] || 0) + (Number(l.qty) || 0); }); return JSON.stringify(Object.keys(m).sort().map(k => [k, m[k]])); }
    function findAddOnIf(toId, lines, planned, trucks, exceptId) {
        const want = JSON.stringify(Object.keys(lines).sort().map(k => [k, Number(lines[k])])), taken = takenByOthers(trucks, exceptId);
        return (planned || []).filter(f => String(f.toId) === String(toId) && !taken[String(f.ifId)] && linesSig(f.lines) === want).sort((p, q) => Number(p.ifId) - Number(q.ifId))[0] || null;
    }
    function acceptOffIf(x0, p0, item, sk, pcs, c) {
        const trucks = allTrucks();
        const to = reservedToLines(x0.id, trucks, null, c).filter(r => String(r.item) === item && Number(r.remaining) >= pcs).sort(verify._oldestFirst)[0];
        if (!to) return { outcome: 'refused', text: '⛔ Can\'t accept · no open TO covers ' + sk + ' · Reject or office adds a TO line', view: unloadView(x0, c) };
        const dep = x0.data.depart || {}, st = { trailer: dep.trailer, seal: dep.seal, memo: verify.memoFor(dep.truckNo, dep.day) };
        const create = Object.assign({ op: 'if_create', toId: String(to.toId), toNum: to.toNum, lines: { [item]: pcs }, ship: false }, st);
        create.token = createToken(x0.id, create);
        const stamp = Object.assign({ op: 'if_stamp', ifId: 'new:' + String(to.toId), ifNum: '(new)' }, st, { lines: { [item]: pcs } });
        const dec = { kind: 'accepted_pending', toId: String(to.toId), toNum: to.toNum, item: item, sku: sk, pcs: pcs, op: create, by: c.user, at: c.now.stamp };
        const cl = claimLoad(x0, x0.status, 'accept', decideGuard, {});
        const id = cl.Ld.id, claim = cl.claim, label = truckLabel(cl.Ld);
        const release = patch => { assertClaim(id, claim, label, 'accept'); data.updateLoad(data.getLoad(id), { data: Object.assign({ claim: '', workingAt: 0, phase: '' }, patch) }); };
        const writes = {};
        let res, err = null;
        try {
            res = verify.runOps([create, stamp], writeMode(c), o => { assertClaim(id, claim, label, 'accept'); return tx.apply(verify.resolveNew(o, writes)); }, {}, (k, newId) => {
                writes[k] = String(newId);
                const cur = data.getLoad(id), op = k.indexOf('if_create:') === 0 ? create : stamp;
                data.updateLoad(cur, { data: { correctionWrites: Object.assign({}, cur.data.correctionWrites, { [k + '|' + corrSig(op)]: { key: k, op: op.op, id: String(newId), sig: corrSig(op), at: c.now.stamp, by: c.user } }) } });
            });
        } catch (e) {
            if (e.user) throw e;
            log.error({ title: 'move pallet_accept ' + id, details: (e && e.stack) || String(e) });
            err = e.message || String(e);
        }
        if (err) { release({}); throw userErr('Accept refused: ' + err + ' — fix it in NetSuite'); }
        const p = data.getPallet(p0.id);
        unloadFromOther(p, c);
        const newId = writes['if_create:' + String(to.toId)];
        if (!newId) {                                                 // plan-only: the office creates the IF; settlePending attaches it when it appears
            dec.text = '⏳ Accepted · office creates IF for ' + verify._fmt(pcs) + ' ' + sk + ' on ' + to.toNum + ' · receipt waits';
            data.updatePallet(data.getPallet(p.id), { data: { decision: dec } });
            const cur = data.getLoad(id);
            release({ lastStep: stepOf('pallet_accepted', c), corrections: (cur.data.corrections || []).concat([corrEntry('pallet_accept', p, { toNum: to.toNum, pending: true, text: dec.text }, c)]) });
            if (ns.resetCache) ns.resetCache();
            return { outcome: 'pending', text: dec.text, view: unloadView(mustTruck(id), c) };
        }
        const done = Object.assign({}, dec, { ifId: String(newId), ifNum: 'IF ' + newId });
        done.text = '✅ Accepted · ' + done.ifNum + ' · new IF on ' + to.toNum;
        completeAccept(id, data.getPallet(p.id), done, c);
        release({});
        if (ns.resetCache) ns.resetCache();
        return { outcome: 'accepted', text: done.text, view: unloadView(mustTruck(id), c) };
    }
```

Extend `pendingDone` (Task 1) with the `if_create` branch, before its final `return null`:

```js
        if (dec.op && dec.op.op === 'if_create') {
            const f = findAddOnIf(dec.op.toId, dec.op.lines, planned, trucks, dec.truckId);
            return f ? { ifId: String(f.ifId), ifNum: f.ifNum } : null;
        }
```

and make `acceptText` say `'✅ Accepted · ' + dec.ifNum + ' · new IF on ' + dec.toNum` for an `if_create` decision. `settlePending` must pass the truck id for the taken-check: in `settlePending`, call `pendingDone(Object.assign({}, dec, { truckId: x.id }), info, planned, trucks)`.

`verify._oldestFirst` and `verify.memoFor` are already exported.

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass (239 + 10).

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(flagged): accept a SKU on no truck IF via an add-on IF (on mode) or a pending office IF (qty), settle pending accepts, take the pallet off its Riverside truck

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Dashboard action rebuilt around trucks, approvals and Active loads

**Files:**
- Modify: `move_portal/sl_move_portal.js` (the `approvals` and `dashboard` actions)
- Test: `move_portal/test/portal.test.js` (rewrite the existing test `dashboard counts moved, remaining, days, in-transit, never-loaded and trucks`; keep `fix9`'s `exc.neverLoaded` assertion working)

**Interfaces:**
- Produces `approvalsView(c)` (the body of today's `approvals` action, returned unchanged by the action) and the new `dashboard` payload:

```
{ waiting: [{queue, title, count, first, late}],   // only count > 0, Approvals order; queue ∈ ship · fix · trucks · flagged · retry · receipts
  tiles: { today, plan, avg7, avgAll, total, received, inTransitTrucks, inTransitPallets, missing },
  rows: [{ truckId, ifId, ifNum, toNum, truck, trailer, seal, truckNo, status, stage, skus: [{sku, qty}], pallets, pcs, received, flagged, lastKind, lastBy, lastAt, lastMin }],
  days: [{day, n}], exc: { missing, neverLoaded, damaged, edited, stale, noConfig }, noConfigSkus, target }
```

- [ ] **Step 1: Replace the dashboard test** (delete the old `dashboard counts moved, remaining, ...` test; add)

```js
test('dashboard: trucks per day, waiting queues (non-zero only), one Active loads row per IF with stage and last step', () => {
    const ctx = setup();
    const a = departed(ctx, 42, '5260020');                                           // Truck 1 today, departed
    const b = readyTruck(ctx, 2, '9002');                                             // ready at the dock
    ctx.run('ship_mark', { truckId: b.t.id, seal: '5260021' }, false);                // waiting for manager
    strayOn(ctx, a.t);
    const r = ctx.run('dashboard');
    assert.deepEqual(r.waiting.map(w => [w.queue, w.count]), [['ship', 1], ['flagged', 1], ['receipts', 1]]);
    assert.equal(r.waiting[0].first.indexOf('Trailer'), 0);
    assert.deepEqual([r.tiles.today, r.tiles.plan, r.tiles.total, r.tiles.received, r.tiles.inTransitTrucks, r.tiles.inTransitPallets], [1, 8, 1, 0, 1, 42]);
    assert.deepEqual(r.days[r.days.length - 1], { day: '2026-10-14', n: 1 });
    assert.equal(r.days[0].day, '2026-10-01');
    const rows = r.rows;
    assert.deepEqual(rows.map(x => [x.ifNum, x.stage]), [['IF9001', 'In transit'], ['IF9002', 'Waiting for manager']]);
    assert.deepEqual([rows[0].truck, rows[0].seal, rows[0].pallets, rows[0].pcs, rows[0].flagged, rows[0].lastKind], ['Truck 1 · 10/14', '5260020', 42, 504, 1, 'confirmed']);
    assert.deepEqual([rows[1].pallets, rows[1].pcs, rows[1].received, rows[1].lastKind, rows[1].lastBy], [2, 24, null, 'marked_shipped', 'Miguel']);
    assert.deepEqual([r.exc.neverLoaded, r.exc.missing], [1, 0]);
    assert.equal(r.m, undefined, 'pallet tracker maths gone');
    ctx.data.db.settings.trucksPerDay = 6;
    assert.equal(ctx.run('dashboard').tiles.plan, 6);
    assert.throws(() => ctx.run('dashboard', {}, false), /Managers only/);
});

test('dashboard: a received truck stays on Active loads for its receipt day, with stage Received', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 42, '5260022');
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('unload_done', { truckId: t.id }, false);
    ctx.run('receipt_approve', { truckId: t.id });
    let r = ctx.run('dashboard');
    assert.deepEqual([r.rows.length, r.rows[0].stage, r.rows[0].received, r.tiles.received], [1, 'Received', 504, 1]);
    const x = ctx.data.getLoad(t.id);
    ctx.data.updateLoad(x, { data: { recvApprovedAt: '10/13/2026 4:00:00 pm' } });
    r = ctx.run('dashboard');
    assert.equal(r.rows.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: both FAIL (`r.waiting` undefined).

- [ ] **Step 3: Implement** (`move_portal/sl_move_portal.js`)

Rename the body of `act('approvals', true, (a, c) => { ... })` into `function approvalsView(c) { ... }` and register `act('approvals', true, (a, c) => approvalsView(c));`.

Replace the whole `act('dashboard', ...)` with:

```js
    // ── dashboard (spec 2026-10-06 pm §3): trucks, approvals waiting, Active loads ──
    const STAGE_ORDER = ['Receipt pending', 'Waiting for manager', 'Ready to ship', 'Needs IF fix', 'Loading', 'In transit', 'Unloading', 'Received'];
    function stageOf(x) {
        if (x.status === T.RECEIVED) return 'Received';
        if (x.status === T.APPROVING || (x.status === T.RECEIVING && x.data.recvRequested)) return 'Receipt pending';
        if (x.status === T.RECEIVING) return 'Unloading';
        if (x.status === T.DEPARTED || x.status === T.DEPARTING) return 'In transit';
        if (x.status === T.SHIP_PENDING) return 'Waiting for manager';
        if (x.status === T.READY) return 'Ready to ship';
        if (x.status === T.NEEDS_FIX) return 'Needs IF fix';
        return 'Loading';
    }
    function lastStepOf(x) {
        const s = x.data.lastStep;
        return s || (x.data.startedAt ? { kind: 'started', by: x.data.startedBy, at: x.data.startedAt } : { kind: '', by: '', at: '' });
    }
    function dayOfStamp(stamp) { const p = core.parseNsStamp(stamp); return p ? p.dayIso : ''; }
    function firstText(q, ap, c) {
        if (q === 'ship') { const s = ap.shipPending[0]; return s.truck.label + ' · marked shipped ' + (s.ageMin == null ? '' : s.ageMin + ' min ago'); }
        if (q === 'fix') return ap.fixes[0].text;
        if (q === 'trucks') return ap.trucks[0].truck.label;
        if (q === 'flagged') { const f = ap.flagged[0]; return f.code + ' on ' + f.truckLabel + ' · never loaded'; }
        if (q === 'retry') return ap.retries[0].label;
        const r = ap.receipts[0];
        return r.truck.label + (r.perIf && r.perIf.length ? ' · ' + r.perIf.reduce((s, f) => s + f.received, 0) + ' of ' + r.perIf.reduce((s, f) => s + f.shipped, 0) + ' pcs in' : '') + ((r.flagged || []).length ? ' · ' + r.flagged.length + ' flagged' : '');
    }
    act('dashboard', true, (a, c) => {
        const ap = approvalsView(c), trucks = allTrucks();
        const queues = [['ship', 'Ship confirmations', ap.shipPending], ['fix', 'Correct the IF', ap.fixes], ['trucks', 'Trucks waiting for an IF fix', ap.trucks],
            ['flagged', 'Flagged pallets', ap.flagged], ['retry', 'Retry / Release', ap.retries], ['receipts', 'Receipts', ap.receipts]];
        const waiting = queues.filter(q => q[2].length).map(q => ({ queue: q[0], title: q[1], count: q[2].length, first: firstText(q[0], ap, c),
            late: q[0] === 'ship' && ap.shipPending.some(s => s.ageMin != null && s.ageMin >= 30) }));
        // Trucks per move day: a truck counts on the day the manager confirmed it shipped (depart.day).
        const byDay = {};
        trucks.filter(x => x.data.depart).forEach(x => { byDay[x.data.depart.day] = (byDay[x.data.depart.day] || 0) + 1; });
        const todayDone = (byDay[c.now.dayIso] || 0) > 0 && c.now.hour >= 15;
        const m = core.trackerMetrics({ todayIso: c.now.dayIso, targetIso: c.S.target, startIso: c.S.start, skipDates: c.S.skip || [], remaining: 0, movedByDay: byDay, todayDone: todayDone });
        const end = c.now.dayIso < c.S.target ? c.now.dayIso : c.S.target;
        const days = core.moveDays(c.S.start, end, c.S.skip || []).map(d => ({ day: d, n: byDay[d] || 0 }));
        // Active loads: every truck not received, plus trucks received today.
        const active = trucks.filter(x => x.status !== T.RECEIVED || dayOfStamp(x.data.recvApprovedAt) === c.now.dayIso);
        const counts = data.palletStatusCounts(active.map(x => x.id));
        const loadedAll = {};
        data.palletsByStatus([VP.LOADED]).forEach(p => { (loadedAll[String(p.loadId)] = loadedAll[String(p.loadId)] || []).push(p); });
        const rows = [];
        active.forEach(x => {
            const d = x.data, stage = stageOf(x), dep = d.depart || null, ls = lastStepOf(x);
            const truck = truckLabel(x), base = { truckId: x.id, truck: truck, trailer: dep ? dep.trailer : (d.trailer || ''), seal: dep ? dep.seal : ((d.shipReq || {}).seal || ''),
                truckNo: dep ? dep.truckNo : null, status: x.status, stage: stage, lastKind: ls.kind, lastBy: whoName(ls.by), lastAt: ls.at, lastMin: ls.at ? minutesSince(ls.at, c) : null,
                flagged: stillFlagged(d.flagged).filter(p => p.data.flaggedTruck === x.id).length };
            if (dep) {
                const ps = data.palletsByLoad(x.id, [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
                const rp = verify.planReceipts({ alloc: d.alloc || [], pallets: ps, received: d.received || {}, stamp: dep, seq: 0 }), got = ps.some(p => p.status === VP.RECEIVED);
                const sk = skuNames([...new Set((d.alloc || []).reduce((s, al) => s.concat(Object.keys(al.lines)), []))]);
                (d.alloc || []).forEach(al => {
                    const per = rp.perIf.find(f => String(f.ifId) === String(al.ifId)) || { received: 0, shipped: 0 };
                    const pcs = Object.keys(al.lines).reduce((s, k) => s + Number(al.lines[k]), 0);
                    const pal = ps.filter(p => (p.lines || []).some(l => al.lines[String(l.item)] > 0)).length;      // pallets whose SKU this IF carries (a shared SKU counts on each IF)
                    rows.push(Object.assign({}, base, { ifId: String(al.ifId), ifNum: al.ifNum, toNum: al.toNum, skus: Object.keys(al.lines).map(k => ({ sku: sk[k] || k, qty: Number(al.lines[k]) })),
                        pallets: (d.alloc || []).length === 1 ? ps.length : pal, pcs: pcs, received: got || x.status === T.RECEIVED ? per.received : null }));
                });
            } else {
                const live = verify.liveIfs(d.ifs), ps = loadedAll[String(x.id)] || [], fill = verify.fillExpected(live, verify.sumLines(ps));
                live.forEach(f => {
                    const al = fill.alloc[String(f.ifId)] || {}, pcs = Object.keys(al).reduce((s, k) => s + Number(al[k] || 0), 0);
                    const pal = ps.filter(p => (p.lines || []).some(l => al[String(l.item)] > 0)).length;
                    rows.push(Object.assign({}, base, { ifId: String(f.ifId), ifNum: f.ifNum, toNum: f.toNum, skus: (f.lines || []).map(l => ({ sku: l.sku, qty: l.qty })),
                        pallets: live.length === 1 ? ps.length : pal, pcs: pcs, received: null }));
                });
            }
        });
        rows.sort((p, q) => STAGE_ORDER.indexOf(p.stage) - STAGE_ORDER.indexOf(q.stage) || Number(q.truckId) - Number(p.truckId) || Number(p.ifId) - Number(q.ifId));
        const transit = trucks.filter(x => x.status === T.DEPARTED || x.status === T.DEPARTING);
        const exc = {
            missing: data.countPallets({ status: [VP.MISSING] }),
            neverLoaded: stillFlagged([].concat.apply([], trucks.map(x => x.data.flagged || []))).length,
            damaged: data.countPallets({ damaged: true }),
            edited: data.countPallets({ edited: true, status: [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING] }),
            stale: data.countPallets({ status: [VP.LABELED], printedBefore: core.isoAddDays(c.now.dayIso, -(Number(c.S.staleDays) || 5)) }),
            noConfig: stockModel(c).est.unknownItems.length
        };
        return { waiting: waiting, target: c.S.target, days: days, rows: rows, exc: exc, noConfigSkus: [],
            tiles: { today: m.movedToday, plan: Number(c.S.trucksPerDay) > 0 ? Number(c.S.trucksPerDay) : 8, avg7: m.avg7, avgAll: m.avgAll, total: m.moved,
                received: trucks.filter(x => x.status === T.RECEIVED).length, inTransitTrucks: transit.length,
                inTransitPallets: data.countPallets({ status: [VP.IN_TRANSIT, VP.MISSING] }), missing: exc.missing } };
    });
```

Delete the now-unused `tracker(c, est)` helper (keep `stockModel`: the print plan and `exc.noConfig` use it). `noConfigSkus` stays an empty array so the UI needs no branch.

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass. `fix9` still reads `exc.neverLoaded`.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(dashboard): trucks per day, approvals waiting (non-zero queues), Active loads rows per IF with stage and last step; pallet tracker maths removed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Report truck history

**Files:**
- Modify: `move_portal/sl_move_portal.js` (the `report` action)
- Test: `move_portal/test/portal.test.js`

**Interfaces:** `report.history: [{ truckId, day, truck, truckNo, trailer, seal, ifs: [ifNum], pallets, pcs, status, stage, startedBy, startedAt, markedBy, markedAt, confirmedBy, confirmedAt, receivedAt, corrections: [text] }]`, newest first (by truck id).

- [ ] **Step 1: Write the failing test**

```js
test('report.history: every truck newest first with who/when per step and correction lines', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const a = departed(ctx, 42, '5260030');
    const s = strayOn(ctx, a.t);
    a.ps.forEach(p => ctx.run('unload_scan', { truckId: a.t.id, raw: p.code }, false));
    ctx.run('pallet_accept', { truckId: a.t.id, palletId: s.id });
    const b = truckWith(ctx, 3, '9002');                                             // still loading
    const h = ctx.run('report').history;
    assert.deepEqual(h.map(r => [r.truckId, r.stage]), [[b.t.id, 'Loading'], [a.t.id, 'Unloading']]);
    const ra = h[1];
    assert.deepEqual([ra.day, ra.truck, ra.truckNo, ra.trailer, ra.seal, ra.ifs, ra.pallets, ra.pcs, ra.startedBy, ra.markedBy, ra.confirmedBy],
        ['2026-10-14', 'Truck 1 · 10/14', 1, ctx.data.getLoad(a.t.id).data.trailer, '5260030', ['IF9001'], 43, 516, 'Miguel', 'Miguel', 'Jack K']);
    assert.deepEqual(ra.corrections, ['+ ' + s.code + ' accepted · IF9001']);
    assert.deepEqual([h[0].seal, h[0].markedAt, h[0].corrections], ['', '', []]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL (`history` undefined).

- [ ] **Step 3: Implement** (in the `report` action, before its `return`)

```js
        // Truck history (spec §4): every v3 truck, newest first.
        const allCounts = data.palletStatusCounts(every.map(x => x.id)), skAll = skuNames([...new Set(every.reduce((s, x) => s.concat((x.data.corrections || []).filter(k => k.op && k.op.op === 'if_qty').map(k => String(k.op.item))), []))]);
        const corrText = k => {
            if (k.kind === 'pallet_accept') return '+ ' + k.code + ' accepted' + (k.ifNum ? ' · ' + k.ifNum : k.toNum ? ' · new IF on ' + k.toNum : '') + (k.pending ? ' (office IF pending)' : '');
            if (k.kind === 'pallet_reject') return '↩ ' + k.code + ' rejected · "' + (k.note || '') + '"';
            const op = k.op || {};
            if (op.op === 'if_qty') return (op.to < op.from ? '⬇ ' : '⬆ ') + op.ifNum + ' ' + (skAll[String(op.item)] || op.item) + ' ' + verify._fmt(op.from) + '→' + verify._fmt(op.to);
            if (op.op === 'if_create') return '➕ add-on IF on ' + (op.toNum || op.toId);
            if (op.op === 'drop_if') return '✕ ' + op.ifNum + ' dropped';
            return String(op.op || k.kind || '');
        };
        const history = every.slice().sort((p, q) => Number(q.id) - Number(p.id)).map(x => {
            const d = x.data, dep = d.depart || null, q = d.shipReq || {}, sts = [VP.LOADED, VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING];
            return { truckId: x.id, day: dep ? dep.day : dayOfStamp(d.startedAt), truck: truckLabel(x), truckNo: dep ? dep.truckNo : null, trailer: dep ? dep.trailer : (d.trailer || ''),
                seal: dep ? dep.seal : (q.seal || ''), ifs: verify.liveIfs(d.ifs).map(f => f.ifNum), pallets: sts.reduce((s, st) => s + cnt(allCounts, x.id, st), 0), pcs: pcsOf(allCounts, x.id, sts),
                status: x.status, stage: stageOf(x), startedBy: whoName(d.startedBy), startedAt: d.startedAt || '', markedBy: whoName(q.by), markedAt: q.at || (dep && dep.markedBy ? dep.at : ''),
                confirmedBy: dep ? whoName(dep.approvedBy) || dep.approvedByRoster || '' : '', confirmedAt: dep ? dep.at : '', receivedAt: d.recvApprovedAt || '',
                corrections: (d.corrections || []).map(corrText) };
        });
```

and add `history: history` to the returned object. `every` is already defined earlier in the action (`const mode = writeMode(c), pend = [], every = allTrucks();`). `markedAt` after confirmation: `ship_confirm`'s `toNeedsFix`/`departData` keep `shipReq` until departure? Check: `finishDepart` does not clear `shipReq`, so `q.at` is still there; the fallback covers older trucks. `confirmedBy`: `departData` stores `approvedBy: c.user` (an object) → `whoName`.

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(report): truck history with per-step who/when and correction lines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: UI: tab order and default, Labels order, Approvals flagged card and receipt rows, floor wording

**Files:**
- Modify: `move_portal/move_ui.js`
- Test: `move_portal/test/ui.test.js`

**Interfaces:** consumes `approvals.flagged`, receipt entries' `flagged / pending / decided / canApprove / blockReason`, actions `pallet_accept` / `pallet_reject`, `unloadView.decided`. Produces `data-act` handlers `apaccept`, `apreject`, section anchors `ap_ship · ap_fix · ap_trucks · ap_flag · ap_retry · ap_rec`, and `ACT.goapprove` (used by Task 6).

- [ ] **Step 1: Update and add UI tests** (`move_portal/test/ui.test.js`)

In the test `manager rework: default Approvals, late badge, ...` change `"mgr: 'approve'"` to `"mgr: 'dash'"`. Append:

```js
test('2026-10-06 pm: Dashboard first and default; Labels start with Print a SKU', () => {
    const src = ui._clientMain.toString();
    assert.ok(src.indexOf("mgr: [['dash', 'Dashboard'], ['approve', 'Approvals'], ['labels', 'Labels'], ['report', 'Report']]") !== -1, 'tab order');
    assert.ok(src.indexOf("mgr: 'dash'") !== -1, 'default tab');
    assert.ok(src.indexOf("main(sec('lb_sku', 'Print a SKU') + sec('lb_queue', 'Label requests') + sec('lb_plan', 'Print plan') + sec('lb_reprint', 'Reprint') + sec('lb_configs', 'SKU configs'))") !== -1, 'labels order');
});

test('2026-10-06 pm: flagged pallets card and receipt rows with Accept / Reject; Approve waits; anchors for the dashboard links', () => {
    const src = ui._clientMain.toString();
    ['Flagged pallets', 'data-act="apaccept"', 'data-act="apreject"', "api('pallet_accept'", "api('pallet_reject'", 'Accept onto this truck', 'x.blockReason', 'x.canApprove', 'r.flagged', 'x.pending', 'x.decided',
        'id="ap_ship"', 'id="ap_fix"', 'id="ap_trucks"', 'id="ap_flag"', 'id="ap_retry"', 'id="ap_rec"', 'ACT.goapprove =', 'decide now, or later on the receipt card', 'waiting for the manager', 'v.decided']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    assert.equal(src.indexOf('The office will sort these out.'), -1);
    ['apaccept', 'apreject'].forEach(n => {
        const i = src.indexOf('ACT.' + n + ' =');
        assert.ok(i !== -1 && src.slice(i, i + 600).indexOf(n === 'apaccept' ? 'confirm(' : 'prompt(') !== -1, 'no dialog in ' + n);
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: the two new tests FAIL; the edited one FAILS (`mgr: 'dash'` missing).

- [ ] **Step 3: Implement** (`move_portal/move_ui.js`)

1. `TABS.mgr` → `[['dash', 'Dashboard'], ['approve', 'Approvals'], ['labels', 'Labels'], ['report', 'Report']]`; `DEF_TAB.mgr` → `'dash'`.
2. `SCREENS.labels`: `main(sec('lb_sku', 'Print a SKU') + sec('lb_queue', 'Label requests') + sec('lb_plan', 'Print plan') + sec('lb_reprint', 'Reprint') + sec('lb_configs', 'SKU configs'));` (the `labelX($('..'))` calls below it stay).
3. Floor unload (`paintUnload`): replace the flagged flash with

```js
                (v.flagged.length ? flash('amber', '🟠 ' + v.flagged.length + ' never-loaded pallet(s) · waiting for the manager', esc(v.flagged.map(p => p.code).join(', ')), 'A manager accepts or rejects them in Approvals.') : '') +
                ((v.decided || []).length ? '<div class="diffs">' + v.decided.map(d => '<div>' + esc(d.text) + ' · ' + esc(d.by) + '</div>').join('') + '</div>' : '');
```

and in `unloadResultHtml` the `never_loaded` case: `flash('amber', '🟠 Never loaded on a truck', line, 'Flagged for the manager. Set it aside.')`.

4. Approvals. Add, after `shipConfirmCard`:

```js
        // One row per undecided never-loaded pallet (spec 2026-10-06 pm §2): Accept onto the truck it was scanned on, or Reject with a note.
        function flagRow(f) {
            return '<div class="drow"><span><b>' + esc(f.code) + '</b> · ' + esc(f.sku) + ' · ' + num(f.pcs) + ' pcs <span class="pill p-violet">' + esc(f.truckLabel) + '</span>' +
                '<div class="muted">never loaded on any truck · scanned by ' + esc(f.by || '?') + (f.at ? ' · ' + esc(f.at) : '') + (f.truckStatus === 'receiving' || f.truckStatus === 'departed' ? ' · truck still unloading' : '') + '</div></span>' +
                '<span class="row2" style="margin:0"><button class="dbtn go" data-act="apaccept" data-id="' + esc(f.truckId) + '" data-pid="' + esc(f.palletId) + '" data-label="' + esc(f.code) + '" data-truck="' + esc(f.truckLabel) + '">Accept onto this truck</button>' +
                '<button class="dbtn gh" data-act="apreject" data-id="' + esc(f.truckId) + '" data-pid="' + esc(f.palletId) + '" data-label="' + esc(f.code) + '">Reject</button></span></div>';
        }
        function flaggedCard(list) {
            return '<div class="card amberc"><h4>🟠 ' + list.length + ' pallet' + (list.length === 1 ? '' : 's') + ' scanned at ' + esc(B.toName) + ' that ' + (list.length === 1 ? 'was' : 'were') + ' never loaded</h4>' +
                '<div class="muted">decide now, or later on the receipt card</div><div class="diffs">' + list.map(flagRow).join('') + '</div></div>';
        }
```

In `paintApprove`, give each section an anchor and add the Flagged section between Trucks and Stalled departures:

```js
            const ship = (r.shipPending || []).length ? '<h3 id="ap_ship">Ship confirmations</h3>' + r.shipPending.map(shipConfirmCard).join('') : '';
            const fix = (r.fixes || []).length ? '<h3 id="ap_fix">Correct the IF</h3>' + r.fixes.map(f => fixCard(f, r.writeMode)).join('') : '';
            const trk = (r.trucks || []).length ? '<h3 id="ap_trucks">Trucks waiting for an IF fix</h3>' + r.trucks.map(n => truckCard(n, r.freeIfs, r.writeMode, (r.fixes || []).some(f => String(f.truckId) === String(n.truck.id)))).join('') : '';
            const flg = (r.flagged || []).length ? '<h3 id="ap_flag">Flagged pallets</h3>' + flaggedCard(r.flagged) : '';
```

`ret` keeps its markup; its heading becomes `'<h3 id="ap_retry">Stalled departures</h3>'` and the receipts heading `'<h3 id="ap_rec">Receipts</h3>'`. The final `main(...)` concatenates `ship + fix + trk + flg + ...`.

In the receipt card builder (the `rec` map), after the `missing` line and before the Approve button, add the flagged block, and gate the button:

```js
                    ((x.flagged || []).length || (x.pending || []).length || (x.decided || []).length
                        ? '<div class="muted" style="margin-top:8px"><b>Flagged pallets' + ((x.flagged || []).length ? ' · ' + x.flagged.length + ' to decide' : '') + '</b></div>' +
                          '<div class="diffs">' + (x.flagged || []).map(flagRow).join('') + (x.pending || []).map(p => '<div><b>' + esc(p.code) + '</b> · ' + esc(p.text) + '</div>').join('') +
                          (x.decided || []).map(d => '<div class="muted">' + esc(d.text) + ' · ' + esc(d.by) + '</div>').join('') + '</div>' : '') +
                    (x.canApprove === false
                        ? '<button class="btn go" disabled>Approve receipt — ' + esc((x.blockReason || '').toLowerCase()) + '</button>'
                        : '<button class="btn go" data-act="aprecv" ...existing attributes...>' + (x.stuck ? 'Re-approve receipt' : missing.length ? 'Approve short receipt' : 'Approve receipt') + '</button>') +
```

(keep the existing button's attributes exactly; only wrap it in the `canApprove` ternary).

Handlers, next to `ACT.aprecv`:

```js
        ACT.apaccept = async el => {
            if (!confirm('Accept ' + (el.dataset.label || 'this pallet') + ' onto ' + (el.dataset.truck || 'this truck') + '? Its IF is raised (or an add-on IF is planned) as the write mode allows, and it joins the receipt.')) return;
            busy(el, true);
            const r = await api('pallet_accept', { truckId: el.dataset.id, palletId: el.dataset.pid });
            tone(r.ok && r.outcome !== 'refused' ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? flash(r.outcome === 'accepted' ? 'green' : r.outcome === 'pending' ? 'amber' : 'red', esc(r.text)) : errBox(r.error));
        };
        ACT.apreject = async el => {
            const note = prompt('Reject ' + (el.dataset.label || 'this pallet') + '. Note for the floor (required):');
            if (note == null) return;
            if (!note.trim()) { tone('bad'); SCREENS.approve(errBox('Enter a note: why is this pallet rejected?')); return; }
            busy(el, true);
            const r = await api('pallet_reject', { truckId: el.dataset.id, palletId: el.dataset.pid, note: note.trim() });
            tone(r.ok ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? flash('amber', esc(r.text)) : errBox(r.error));
        };
        // From the Dashboard's Waiting card: open Approvals scrolled to that section.
        ACT.goapprove = el => {
            S.tab = 'approve';
            S.scrollTo = el.dataset.v || '';
            renderNav();
        };
```

In `paintApprove`, after `main(...)`: `if (S.scrollTo) { const a = $(S.scrollTo); S.scrollTo = ''; if (a) a.scrollIntoView({ block: 'start' }); }`. Add `scrollTo: ''` to the `S` initialiser.

CSS: add `.pill.p-violet{background:#ede9fe;color:#5b21b6}` next to the other pill colours if `p-violet` doesn't exist (grep first).

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass, including `every client api() action exists on the server and every data-act has an ACT handler`.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(ui): Dashboard first tab, Print a SKU first, Flagged pallets card and receipt rows with Accept/Reject, floor flagged wording

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: UI: Dashboard screen and Report history with search / filter / sort

**Files:**
- Modify: `move_portal/move_ui.js`
- Test: `move_portal/test/ui.test.js`

**Interfaces:** consumes the Task 3 `dashboard` payload and Task 4 `report.history`. Produces `SCREENS.dash`, `paintLoads()`, `tableTools(...)`, `data-act="dashsort"`, `data-act="dashrow"`.

- [ ] **Step 1: Write the failing test**

```js
test('2026-10-06 pm: Dashboard shows waiting queues, truck tiles, Active loads with search/filter/sort; Report has the history table', () => {
    const src = ui._clientMain.toString();
    ['Waiting for approval', 'Nothing waiting for approval', 'Trucks shipped today', 'Trucks per day · 7-day avg', 'Trucks shipped · total', 'In transit', 'see Move Tracker', 'Active loads',
        'Trucks shipped per day', 'Flagged, waiting on manager', 'Search IF, TO, trailer, seal, Truck # or SKU', 'furthest along', 'oldest step', 'data-act="dashsort"', 'data-act="dashrow"', 'data-act="goapprove"',
        'r.waiting', 'r.tiles', 'r.rows', 'Truck history', 'r.history', 'function tableTools(']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ['Total pallets to move', 'Pallets remaining', 'Projected finish', 'Recent trucks', 'Remaining by SKU', 'r.bySku', 'm.projectedFinish'].forEach(t => assert.equal(src.indexOf(t), -1, 'still has ' + t));
    assert.ok(src.indexOf("barChart(r.days, r.tiles.plan") !== -1, 'chart counts trucks against the plan line');
    assert.equal(src.indexOf('Pallets moved per day'), -1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL.

- [ ] **Step 3: Implement** (`move_portal/move_ui.js`: replace `SCREENS.dash`, extend `SCREENS.report`)

```js
        // ── Dashboard (spec 2026-10-06 pm §3) ───────────────────────────
        const STAGES = ['Receipt pending', 'Waiting for manager', 'Ready to ship', 'Needs IF fix', 'Loading', 'In transit', 'Unloading', 'Received'];
        const SORTS = [['stage', 'Sort: furthest along'], ['newest', 'Sort: newest step'], ['oldest', 'Sort: oldest step (stuck first)'], ['if', 'Sort: IF'], ['trailer', 'Sort: trailer']];
        const COLS = [['ifNum', 'Fulfillment'], ['toNum', 'TO'], ['truck', 'Truck'], ['', 'SKUs on truck'], ['pcs', 'Pallets · pcs'], ['', 'Received'], ['stage', 'Status'], ['newest', 'Last step']];
        // Search box · status select · sort select · "n of m": shared by Active loads and the Report's truck history. Client-side only.
        function tableTools(prefix, st, n, m, sorts) {
            return '<div class="tools"><input class="inp" id="' + prefix + 'q" value="' + esc(st.q) + '" placeholder="Search IF, TO, trailer, seal, Truck # or SKU…">' +
                '<select class="inp" id="' + prefix + 'st"><option value="">All statuses</option>' + STAGES.map(s => '<option' + (st.st === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
                '<select class="inp" id="' + prefix + 'sort">' + sorts.map(s => '<option value="' + s[0] + '"' + (st.sort === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>').join('') + '</select>' +
                '<span class="muted">' + n + ' of ' + m + '</span></div>';
        }
        function wireTools(prefix, st, repaint) {
            const q = $(prefix + 'q'), s = $(prefix + 'st'), o = $(prefix + 'sort');
            if (q) q.oninput = () => { st.q = q.value; repaint(); };
            if (s) s.onchange = () => { st.st = s.value; repaint(); };
            if (o) o.onchange = () => { st.sort = o.value; st.dir = 1; repaint(); };
        }
        function rowText(x) { return [x.ifNum, x.toNum, x.truck, x.trailer, x.seal, x.truckNo ? 'Truck ' + x.truckNo : '', (x.skus || []).map(s => s.sku).join(' '), (x.ifs || []).join(' ')].join(' ').toLowerCase(); }
        function filterRows(rows, st) {
            const q = (st.q || '').trim().toLowerCase();
            return rows.filter(x => (!st.st || x.stage === st.st) && (!q || rowText(x).indexOf(q) !== -1));
        }
        function sortRows(rows, st) {
            const dir = st.dir || 1, k = st.sort || 'stage';
            const key = x => k === 'stage' ? STAGES.indexOf(x.stage) : k === 'newest' ? -(Date.parse(x.lastAt || x.confirmedAt || x.startedAt || 0) || 0) : k === 'oldest' ? (Date.parse(x.lastAt || 0) || 0)
                : k === 'if' || k === 'ifNum' ? Number(String(x.ifNum || (x.ifs || [])[0] || '').replace(/\D/g, '')) : k === 'trailer' ? String(x.trailer || '') : k === 'pcs' ? -Number(x.pcs || 0) : String(x[k] || '');
            return rows.slice().sort((p, q) => { const a = key(p), b = key(q); return (a < b ? -1 : a > b ? 1 : 0) * dir || Number(q.truckId) - Number(p.truckId); });
        }
        S.dashSt = { q: '', st: '', sort: 'stage', dir: 1 };
        S.histSt = { q: '', st: '', sort: 'newest', dir: 1 };
        function ago(min) { return min == null ? '' : min < 60 ? min + ' m ago' : Math.floor(min / 60) + ' h ' + (min % 60) + ' m ago'; }
        function loadsTable(rows) {
            const head = COLS.map(c => '<th' + (c[0] ? ' class="sortable" data-act="dashsort" data-k="' + c[0] + '"' : '') + '>' + esc(c[1]) + (c[0] && S.dashSt.sort === c[0] ? (S.dashSt.dir < 0 ? ' ↑' : ' ↓') : '') + '</th>').join('');
            return '<div style="overflow-x:auto"><table class="tbl"><tr>' + head + '</tr>' + (rows.map(x => '<tr data-act="dashrow" data-id="' + esc(x.truckId) + '" style="cursor:pointer">' +
                '<td><b>' + esc(x.ifNum) + '</b></td><td>' + esc(x.toNum || '') + '</td><td>' + esc(x.truck) + (x.truckNo && x.trailer ? ' · Trailer ' + esc(x.trailer) : '') + (x.seal ? ' · seal ' + esc(x.seal) : '') + '</td>' +
                '<td>' + (x.skus || []).map(s => esc(s.sku) + ' <span class="muted">×' + num(s.qty) + '</span>').join(', ') + '</td><td>' + num(x.pallets) + ' · ' + num(x.pcs) + '</td>' +
                '<td>' + (x.received == null ? '—' : num(x.received)) + (x.flagged ? ' <span class="warn">+' + x.flagged + ' flagged</span>' : '') + '</td><td>' + statusPill(x.status) + '</td>' +
                '<td class="muted' + (x.status === 'ship_pending' && x.lastMin >= LATE_MIN ? ' warn' : '') + '">' + esc((x.lastBy ? x.lastBy + ' ' : '') + String(x.lastKind || '').replace(/_/g, ' ')) + (x.lastMin == null ? '' : ' · ' + ago(x.lastMin)) + '</td></tr>').join('') ||
                '<tr><td colspan="8" class="muted">No active loads</td></tr>') + '</table></div>';
        }
        function paintLoads() {
            const r = S.dash;
            if (!r || !$('dashloads')) return;
            const rows = sortRows(filterRows(r.rows, S.dashSt), S.dashSt);
            $('dashloads').innerHTML = tableTools('dl', S.dashSt, rows.length, r.rows.length, SORTS) + loadsTable(rows) +
                '<div class="muted">Default sort is furthest along first; click a column header or use the Sort menu. Received trucks drop off at the end of their day; the Report keeps the full history.</div>';
            wireTools('dl', S.dashSt, paintLoads);
        }
        ACT.dashsort = el => { const k = el.dataset.k; if (S.dashSt.sort === k) S.dashSt.dir = -S.dashSt.dir; else { S.dashSt.sort = k; S.dashSt.dir = 1; } paintLoads(); };
        ACT.dashrow = el => ACT.opentruck(el);
        SCREENS.dash = async () => {
            main('<div class="muted">Loading…</div>');
            const r = await api('dashboard');
            if (S.tab !== 'dash') return;
            if (!r.ok) { main(errBox(r.error)); return; }
            S.dash = r;
            const k = (label, big, sub, cls) => '<div class="kpi ' + (cls || '') + '"><small>' + esc(label) + '</small><b>' + big + '</b><span>' + sub + '</span></div>';
            const w = r.waiting || [];
            const waiting = '<div class="card ' + (w.length ? 'amberc' : '') + '"><h4>Waiting for approval' + (w.length ? ' <span class="pill p-amber">' + w.reduce((s, x) => s + x.count, 0) + '</span>' : '') + '</h4>' +
                (w.length ? w.map(x => '<div class="warnrow" data-act="goapprove" data-v="ap_' + ({ ship: 'ship', fix: 'fix', trucks: 'trucks', flagged: 'flag', retry: 'retry', receipts: 'rec' })[x.queue] + '" style="cursor:pointer">' +
                    '<span><a href="#" class="linkbtn">' + esc(x.title) + '</a> <span class="muted">' + esc(x.first) + '</span></span><span class="pill ' + (x.late ? 'p-amber' : 'p-gray') + '">' + x.count + (x.late ? ' · over 30 min' : '') + '</span></div>').join('')
                    : '<div class="muted">Nothing waiting for approval</div>') + '</div>';
            const t = r.tiles;
            main(waiting + '<div class="grid4">' +
                k('Trucks shipped today', num(t.today), 'manager-confirmed · plan ' + t.plan + '/day', t.today >= t.plan ? 'good' : '') +
                k('Trucks per day · 7-day avg', t.avg7, 'move days Mon–Sat · all-time ' + t.avgAll) +
                k('Trucks shipped · total', num(t.total), num(t.received) + ' received at ' + esc(B.toName)) +
                k('In transit', num(t.inTransitTrucks) + ' truck' + (t.inTransitTrucks === 1 ? '' : 's'), num(t.inTransitPallets) + ' pallets · ' + t.missing + ' missing') +
                k('Finish date', '<span class="muted" style="font-size:14px">see Move Tracker</span>', 'truckloads to move live there') + '</div>' +
                '<div class="card"><h4>Active loads <span class="pill p-gray">' + new Set(r.rows.map(x => x.truckId)).size + ' trucks</span></h4><div class="muted">one row per IF, like the Move Tracker · not yet received · tap a row to open</div><div id="dashloads"></div></div>' +
                '<div class="grid3"><div class="card"><h4>Trucks shipped per day</h4>' + barChart(r.days, r.tiles.plan) + '</div>' +
                '<div class="card"><h4>Exceptions</h4>' + [['Missing pallets (in transit)', r.exc.missing], ['Flagged, waiting on manager', r.exc.neverLoaded], ['Damaged', r.exc.damaged], ['Edited at dock', r.exc.edited],
                    ['Labeled, never loaded (stale)', r.exc.stale], ['SKUs with stock but no config', r.exc.noConfig]].map(x => '<div class="warnrow"><span>' + esc(x[0]) + '</span><b>' + x[1] + '</b></div>').join('') + '</div></div>');
            paintLoads();
        };
```

Change `barChart`'s label text `' needed'` to `' plan'` and its aria-label to `Trucks shipped per day`. Add CSS: `.tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.tools .inp{flex:1 1 180px;margin:0;padding:9px;font-size:14px}.tools select.inp{flex:0 1 220px}.pill.p-gray{background:#eef2f7;color:#334155}th.sortable{cursor:pointer;color:var(--blue)}` (check `p-gray` isn't already defined).

Report: in `SCREENS.report`, keep the existing markup and append `'<div class="card"><h4>Truck history</h4><div id="hist"></div></div>'`, store `S.report = r`, then:

```js
        function histTable(rows) {
            const cols = ['Day', 'Truck', 'Trailer · seal', 'IFs', 'Pallets · pcs', 'Status', 'Started', 'Shipped', 'Confirmed', 'Received', 'Corrections'];
            return '<div style="overflow-x:auto"><table class="tbl"><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr>' + (rows.map(x => '<tr data-act="dashrow" data-id="' + esc(x.truckId) + '" style="cursor:pointer">' +
                '<td>' + esc(x.day) + '</td><td><b>' + esc(x.truck) + '</b></td><td>' + esc([x.trailer, x.seal].filter(Boolean).join(' · ')) + '</td><td>' + esc((x.ifs || []).join(', ')) + '</td><td>' + num(x.pallets) + ' · ' + num(x.pcs) + '</td>' +
                '<td>' + statusPill(x.status) + '</td><td class="muted">' + esc([x.startedBy, x.startedAt].filter(Boolean).join(' ')) + '</td><td class="muted">' + esc([x.markedBy, x.markedAt].filter(Boolean).join(' ')) + '</td>' +
                '<td class="muted">' + esc([x.confirmedBy, x.confirmedAt].filter(Boolean).join(' ')) + '</td><td class="muted">' + esc(x.receivedAt || '') + '</td><td class="muted">' + (x.corrections || []).map(esc).join('<br>') + '</td></tr>').join('') ||
                '<tr><td colspan="11" class="muted">No trucks yet</td></tr>') + '</table></div>';
        }
        function paintHist() {
            const r = S.report;
            if (!r || !$('hist')) return;
            const rows = sortRows(filterRows(r.history || [], S.histSt), S.histSt);
            $('hist').innerHTML = tableTools('hs', S.histSt, rows.length, (r.history || []).length, SORTS) + histTable(rows);
            wireTools('hs', S.histSt, paintHist);
        }
```

and call `paintHist()` after `main(...)` in `SCREENS.report`. `sortRows` must tolerate history rows: `lastAt` is absent there, hence the `x.confirmedAt || x.startedAt` fallback already in `key`.

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass. The `every data-act has an ACT handler` test covers `dashsort`, `dashrow`, `goapprove`.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(ui): Dashboard with waiting queues, truck tiles, Active loads (search/filter/sort), trucks-per-day chart; Report truck history

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

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
