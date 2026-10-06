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

