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

