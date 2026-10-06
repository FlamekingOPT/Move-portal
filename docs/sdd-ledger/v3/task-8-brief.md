### Task 8: Suitelet: unload and receipt approval

**Files:**
- Modify: `move_portal/sl_move_portal.js`
- Modify: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `classifyUnloadScan`, `planReceipts`, `runOps`, `resolveNew`, plus Task 7 helpers (`mustTruck`, `truckMap`, `allTrucks`, `truckSummary`, `pushStack`, `writeMode`).
- Produces:
  - Actions:

    | Action | Body | Returns |
    |---|---|---|
    | `unload_list` | — | `{trucks: [truckSummary]}`: departed/receiving trucks, plus received trucks that still have missing pallets |
    | `unload_get` | `{truckId}` | `{view: unloadView}` |
    | `unload_scan` | `{truckId, raw}` | the scan result + `{raw, tone, pallet, view}` |
    | `unload_other` | `{palletId}` | `{view}` of the pallet's own truck |
    | `unload_damaged` | `{palletId}` | `{ok}` |
    | `unload_undo` | `{truckId}` | `{view}` |
    | `unload_done` | `{truckId}` | `{view}` |
    | `receipt_preview` | `{truckId}`, manager only | `{perIf, missing, ops}` |
    | `receipt_approve` | `{truckId}`, manager only | `{perIf, missing, written, view}` |

  - `unloadView`: `{truck, perIf: [{ifNum, shipped, received, short}], expected: [pubPallet], recent: [pubPallet], counts: {in, of}, flagged: [pubPallet]}`
  - Pallet `data` gains `postedSeq` (set at approval), `flag: 'never_loaded'`, `flaggedAt`, `flaggedBy`.
  - Truck `data` gains `received` (cumulative), `recvSeq`, `rplan` (all receipt ops), `recvRequested: {by, at}|null`, `rstack: [{id, prev}]`.

- [ ] **Step 1: Write the failing tests** (append to `portal.test.js`)

```js
function departed(ctx, n, seal, ifId) {
    const { t, ps } = truckWith(ctx, n, ifId);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: seal || '5249340' }, true);
    return { t, ps };
}

test('unload: ok, dup, never loaded flagged, undo, done → manager receipt with missing pallets', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 42);
    const stray = printLabels(ctx, 1, 'Jstray', [L975]);
    assert.deepEqual(ctx.run('unload_list').trucks.map(x => x.label), ['Truck 1 · 10/14']);
    const r = ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.view.counts], ['ok', { in: 1, of: 42 }]);
    assert.equal(ctx.data.getLoad(t.id).status, 'receiving');
    assert.equal(ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false).result, 'dup');
    const nl = ctx.run('unload_scan', { truckId: t.id, raw: stray[0].code }, false);
    assert.equal(nl.result, 'never_loaded');
    assert.equal(ctx.data.getPallet(stray[0].id).data.flag, 'never_loaded');
    ps.slice(1, 40).forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('unload_scan', { truckId: t.id, raw: ps[40].code }, false);
    assert.equal(ctx.run('unload_undo', { truckId: t.id }, false).view.counts.in, 40);
    ctx.run('unload_done', { truckId: t.id }, false);
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }, false), /Managers only/);
    const pv = ctx.run('receipt_preview', { truckId: t.id });
    assert.deepEqual(pv.perIf, [{ ifId: '9001', ifNum: 'IF9001', shipped: 504, received: 480, short: 24 }]);
    const ap = ctx.run('receipt_approve', { truckId: t.id });
    assert.equal(ap.missing.length, 2);
    assert.deepEqual(ap.written, []);                                     // off mode: plan only
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.recvSeq, x.data.received], ['received', 1, { 9001: { 975: 480 } }]);
    assert.deepEqual(x.data.rplan.map(o => [o.op, o.lines[975], o.seal]), [['receipt', 480, '5249340']]);
    assert.equal(ctx.data.getPallet(ps[41].id).status, 'missing');
    assert.equal(ctx.data.getPallet(ps[0].id).data.postedSeq, 1);
});

test('unload: late arrival → second receipt for only the new pallets; pallet from another truck', () => {
    const ctx = setup();
    const a = departed(ctx, 42, 'S1');
    a.ps.slice(0, 41).forEach(p => ctx.run('unload_scan', { truckId: a.t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: a.t.id });
    const late = ctx.run('unload_scan', { truckId: a.t.id, raw: a.ps[41].code }, false);
    assert.equal(late.result, 'late');
    const ap = ctx.run('receipt_approve', { truckId: a.t.id });
    assert.deepEqual(ctx.data.getLoad(a.t.id).data.rplan.map(o => [o.lines[975], o.seq]), [[492, 1], [12, 2]]);
    assert.deepEqual(ap.missing, []);
    // a pallet of truck A scanned while unloading truck B
    const ctx2 = setup();
    const A = departed(ctx2, 1, 'S2');
    const B = departed(ctx2, 1, 'S3', '9002');
    const o = ctx2.run('unload_scan', { truckId: B.t.id, raw: A.ps[0].code }, false);
    assert.equal(o.result, 'other_truck');
    assert.equal(ctx2.run('unload_other', { palletId: A.ps[0].id }, false).view.counts.in, 1);
});

test('receipt_approve in on mode writes one receipt per IF with the add-on IF id resolved', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const ps = printLabels(ctx, 2, 'Jon', [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }]).concat(printLabels(ctx, 42, 'Jon2', [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'S9' }, true);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const rc = ctx.tx._t.ops.filter(o => o.op === 'receipt');
    assert.deepEqual(rc.map(o => [o.ifId, o.toId, JSON.stringify(o.lines)]), [['9001', '500', '{"975":504}'], ['901', '700', '{"11":240}']]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL with `Unknown action: unload_list`.

- [ ] **Step 3: Implement** (after the Task 7 actions)

```js
    const UNLOADABLE = [T.DEPARTED, T.RECEIVING, T.RECEIVED];
    function unloadView(x, c) {
        const ps = data.palletsByLoad(x.id, [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
        const rp = verify.planReceipts({ alloc: x.data.alloc || [], pallets: ps, received: x.data.received || {}, stamp: x.data.depart || {}, seq: 0 });
        const got = ps.filter(p => p.status === VP.RECEIVED);
        const flagged = data.findPalletsWhere({ status: [VP.LABELED, VP.LOADED] }).filter(p => p.data.flag === 'never_loaded' && p.data.flaggedTruck === x.id);
        return { truck: truckSummary(x), perIf: rp.perIf, expected: ps.filter(p => p.status !== VP.RECEIVED).map(p => pubPallet(p)),
            recent: got.slice(-5).reverse().map(p => pubPallet(p)), counts: { in: got.length, of: ps.length }, flagged: flagged.map(p => pubPallet(p)) };
    }
    function mustUnloadable(id) {
        const x = mustTruck(id);
        if (UNLOADABLE.indexOf(x.status) === -1) throw userErr('This truck is ' + x.status + ', not ready to unload');
        return x;
    }
    function receiveOn(x, p, prev, c) {
        data.updatePallet(p, { status: VP.RECEIVED, data: { receivedAt: c.now.stamp, receivedBy: c.actor } });
        pushStack(x, { id: String(p.id), prev: prev }, 'rstack');
        if (x.status === T.DEPARTED) data.updateLoad(mustTruck(x.id), { status: T.RECEIVING });
    }

    act('unload_list', false, () => ({ trucks: allTrucks().filter(x => x.status === T.DEPARTED || x.status === T.RECEIVING ||
        (x.status === T.RECEIVED && truckSummary(x).missing > 0)).map(truckSummary) }));

    act('unload_get', false, (a, c) => ({ view: unloadView(mustUnloadable(a.truckId), c) }));

    act('unload_scan', false, (a, c) => {
        const x = mustUnloadable(a.truckId);
        const s = core.parseScan(a.raw);
        const p = s.palletId ? data.getPallet(s.palletId) : null;
        const r = verify.classifyUnloadScan({ pallet: p, truckId: x.id, trucks: truckMap(allTrucks()) });
        if (r.set) receiveOn(x, p, p.status, c);
        if (r.result === 'never_loaded') data.updatePallet(p, { data: { flag: 'never_loaded', flaggedAt: c.now.stamp, flaggedBy: c.actor, flaggedTruck: x.id } });
        data.logScan({ pallet: p ? p.id : '', load: x.id, result: r.result, data: { raw: s.raw, mode: 'unload', actor: c.actor, at: c.now.stamp } });
        return Object.assign({}, r, { raw: s.raw, tone: verify.toneFor(r.result), pallet: p ? pubPallet(data.getPallet(p.id)) : null, view: unloadView(mustTruck(x.id), c) });
    });

    act('unload_other', false, (a, c) => {
        const p = mustPallet(a.palletId);
        const x = mustUnloadable(p.loadId);
        if (p.status !== VP.IN_TRANSIT && p.status !== VP.MISSING) throw userErr('That pallet is ' + p.status);
        receiveOn(x, p, p.status, c);
        return { view: unloadView(mustTruck(x.id), c) };
    });

    act('unload_damaged', false, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== VP.RECEIVED) throw userErr('Scan the pallet in first');
        data.updatePallet(p, { damaged: true, data: { damagedAt: c.now.stamp, damagedBy: c.actor } });
        return {};
    });

    act('unload_undo', false, (a, c) => {
        const x = mustUnloadable(a.truckId), st = (x.data.rstack || []).slice();
        while (st.length) {
            const e = st.pop(), p = data.getPallet(e.id);
            if (p && p.status === VP.RECEIVED && p.loadId === x.id && !p.data.postedSeq) { data.updatePallet(p, { status: e.prev, damaged: false }); break; }
        }
        data.updateLoad(x, { data: { rstack: st } });
        return { view: unloadView(mustTruck(x.id), c) };
    });

    act('unload_done', false, (a, c) => {
        const x = mustUnloadable(a.truckId);
        data.updateLoad(x, { data: { recvRequested: { by: c.actor, at: c.now.stamp } } });
        return { view: unloadView(mustTruck(x.id), c) };
    });

    function receiptPlan(x) {
        return verify.planReceipts({ alloc: x.data.alloc || [], pallets: data.palletsByLoad(x.id, [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]),
            received: x.data.received || {}, stamp: x.data.depart, seq: (Number(x.data.recvSeq) || 0) + 1 });
    }

    act('receipt_preview', true, (a) => {
        const x = mustUnloadable(a.truckId), rp = receiptPlan(x);
        return { perIf: rp.perIf, missing: rp.missing, ops: rp.ops };
    });

    act('receipt_approve', true, (a, c) => {
        const x0 = mustUnloadable(a.truckId);
        const rp0 = receiptPlan(x0);
        if (!rp0.ops.length) throw userErr('Nothing new scanned in on this truck');
        const prevStatus = x0.status === T.DEPARTED ? T.RECEIVING : x0.status;
        const x = claimLoad(x0, T.APPROVING, 'receive').Ld;
        const rp = receiptPlan(x), seq = (Number(x.data.recvSeq) || 0) + 1;
        const writes = Object.assign({}, x.data.writes);
        data.updateLoad(x, { data: { rplan: (x.data.rplan || []).concat(rp.ops), recvApprovedBy: c.actor, recvApprovedAt: c.now.stamp } });
        let res;
        try {
            res = verify.runOps(rp.ops, writeMode(c), op => tx.apply(verify.resolveNew(op, writes)), writes,
                (k, id) => { writes[k] = id; data.updateLoad(mustTruck(x.id), { data: { writes: writes } }); });
        } catch (e) {
            data.updateLoad(mustTruck(x.id), { status: prevStatus, data: { error: e.message || String(e), writes: writes } });
            throw userErr('Receipt write failed: ' + (e.message || e) + '. Fix it and approve again; finished receipts are not repeated.');
        }
        data.palletsByLoad(x.id, [VP.RECEIVED]).filter(p => !p.data.postedSeq).forEach(p => data.updatePallet(p, { data: { postedSeq: seq } }));
        data.palletsByLoad(x.id, [VP.IN_TRANSIT]).forEach(p => data.updatePallet(p, { status: VP.MISSING }));
        data.updateLoad(mustTruck(x.id), { status: T.RECEIVED, data: { received: rp.cumulative, recvSeq: seq, recvRequested: null, error: '', writes: writes } });
        return { perIf: rp.perIf, missing: rp.missing, written: res.written, view: unloadView(mustTruck(x.id), c) };
    });
```

> The second-receipt retry is safe because the op key includes `seq`. A failed approval resets the status and doesn't bump `recvSeq`, so a re-approve reuses the same `seq` and skips keys already in `writes`.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(v3): unload scanning, never-loaded flag, manager receipt approval per IF"
```

---

