### Task 6: Approve writes the TO + Shipped IF; stock block; Retry / Release; Reject; receipt

**Files:**
- Modify: `move_portal/sl_move_portal.js` (`departPlan`, `ship_confirm`, `finishDepart`, `depart_release`, `approvalsView` ship items + retries)
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `verify.scanApprovePlan`, `verify.stockCheck`, `verify.stockText`, `verify.resolveNew`, `tx.toClosed`, `tx.tranIds(…, 'to')`, `isScan`, `scanRows` (Task 5).
- Produces:
  - After `on`-mode Approve the truck has load fields `to` / `if` set, and `data.toId`, `data.toNum`, `data.ifId`, `data.ifNum` set. `data.alloc` holds the real ids.
  - Approvals `shipPending[i]` gains `scan` (boolean), `lines: [{ sku, pcs }]` and `lbs` (number).
  - Approvals `retries[i]` gains `scan` and `toNum`.
  - `depart_release` on a scan truck whose TO landed requires `tx.toClosed(toId)`.

- [ ] **Step 1: Write the failing tests**

Append to `move_portal/test/portal.test.js`:

```js
function shipScan(ctx, n, mode) {
    ctx.data.db.settings.writeMode = mode || 'on';
    const t = scanTruck(ctx, n || 2);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id, seal: 'S' + t.id }, false);
    return t;
}

test('scan-built Approve (on): writes TO then Shipped IF and the receipt lands on them', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 2);
    ctx.run('ship_confirm', { truckId: t.id });
    const x = ctx.data.getLoad(t.id), d = x.data;
    const [to, f] = ctx.tx._t.ops;
    assert.deepEqual([to.op, to.orderStatus, to.fromLoc, to.toLoc, to.lines, to.token], ['to_create', 'B', '35', '99', { '11': 240 }, '[MV-' + t.id + ']']);
    assert.deepEqual([f.op, f.ship, f.toId, f.seal, f.trailer, f.lines], ['if_create', true, d.toId, 'S' + t.id, d.trailer, { '11': 240 }]);
    assert.deepEqual([x.status, x.to, x.if, d.toNum, d.ifNum], ['departed', d.toId, d.ifId, 'TO' + d.toId, 'IF' + d.ifId]);
    assert.deepEqual(d.alloc, [{ ifId: d.ifId, ifNum: 'IF' + d.ifId, toId: d.toId, toNum: 'TO' + d.toId, lines: { '11': 240 }, addOn: false }]);
    t.ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const ir = ctx.tx._t.ops[2];
    assert.deepEqual([ir.op, ir.ifId, ir.toId, ir.lines], ['receipt', d.ifId, d.toId, { '11': 240 }]);
});

test('scan-built Approve is blocked on a stock short and writes nothing', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 2);
    ctx.data.db.stock['35']['11'].avail = 100;
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }), /Can't approve: YSN201 on truck 240, available 100/);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getLoad(t.id).status, 'ship_pending');
});

test('scan-built Approve in off / qty: plan only, the truck ships in the portal, no TO', () => {
    ['off', 'qty'].forEach(m => {
        const ctx = scanSetup();
        const t = shipScan(ctx, 1, m);
        ctx.run('ship_confirm', { truckId: t.id });
        assert.equal(ctx.tx._t.ops.length, 0);
        assert.equal(ctx.data.getLoad(t.id).status, 'departed');
    });
});

test('scan-built: TO saved, IF failed → locked; Retry makes only the IF; Release needs the TO closed', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_create';             // the fake sees the resolved op, so match by op, not by key
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }), /A manager can press Retry/);
    let x = ctx.data.getLoad(t.id);
    assert.equal(x.status, 'departing');
    assert.ok(x.data.writes['to_create:' + t.id]);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: 'PLT1' }, false), /closed|waiting/);
    assert.throws(() => ctx.run('ship_sendback', { truckId: t.id, note: 'x' }), /already being processed|not waiting/);
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /Close TO/);
    ctx.run('depart_retry', { truckId: t.id });
    assert.deepEqual(ctx.tx._t.ops.map(o => o.op), ['to_create', 'if_create']);
    assert.equal(ctx.data.getLoad(t.id).status, 'departed');
});

test('scan-built: Release after the manager closed the TO puts the truck back on the floor', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_create';
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }));
    const toId = ctx.data.getLoad(t.id).data.writes['to_create:' + t.id];
    ctx.tx._t.closed[toId] = true;
    ctx.run('depart_release', { truckId: t.id });
    const x = ctx.data.getLoad(t.id);
    assert.equal(x.status, 'ready');                     // released, re-verified (scan trucks always match)
    assert.equal(x.data.writes, null);
});

test('scan-built: Reject sends the truck back to the floor with the reason', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_sendback', { truckId: t.id, note: 'take 2 YSN201 off' });
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.sentBack.note], ['loading', 'take 2 YSN201 off']);
});

test('Approvals shows a scan truck as one plain card with lines and weight', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 2);
    const s = ctx.run('approvals').shipPending.find(q => String(q.truck.id) === String(t.id));
    assert.deepEqual([s.scan, s.lines, s.lbs], [true, [{ sku: 'YSN201', pcs: 240 }], 2490]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL. `ship_confirm` builds an office plan and throws "No open transfer order covers…".

- [ ] **Step 3: Implement**

`departPlan`: right after `if (!ps.length) throw userErr('Nothing is loaded on this truck');` add:

```js
        if (isScan(x)) {
            const plan = verify.scanApprovePlan({ ref: x.id, lines: verify.linesPcs(verify.truckLines(ps)),
                stamp: { trailer: inp.trailer, seal: inp.seal, truckNo: truckNo, dayIso: c.now.dayIso }, S: c.S });
            return { truckNo: truckNo, palletKey: palletKey(ps), plan: plan, ifs: [], otherItems: x.data.otherItems || [] };
        }
```

`ship_confirm`: after `sealTaken(inp.seal, x0.id);` add the stock block:

```js
        if (isScan(x0)) {                                // spec 2026-10-14 S4: blocked before anything is claimed or written
            const tl = verify.linesPcs(verify.truckLines(data.palletsByLoad(x0.id, [VP.LOADED]))), items = Object.keys(tl);
            const st = data.locationStock(c.S.locFrom, items), avail = {};
            items.forEach(k => { avail[k] = st[k] ? Number(st[k].avail) || 0 : 0; });
            const shorts = verify.stockCheck(tl, avail);
            if (shorts.length) throw userErr('Can\'t approve: ' + verify.stockText(shorts, skuNames(items)) + '. Send it back to take pallets off, or fix stock in NetSuite and approve again.');
        }
```

`finishDepart`: change `return tx.apply(op);` to `return tx.apply(verify.resolveNew(op, writes));`. Then, before the final `data.updateLoad(… status: T.DEPARTED …)`, add:

```js
        let ids = {};
        if (isScan(x) && writes['to_create:' + x.id] && writes['if_create:new:to:' + x.id]) {   // on mode: the TO and IF exist now
            const toId = String(writes['to_create:' + x.id]), ifId = String(writes['if_create:new:to:' + x.id]);
            let toNum = 'TO ' + toId;
            try { if (tx.tranIds) toNum = tx.tranIds([toId], 'to')[toId] || toNum; } catch (e) { /* shown as the id */ }
            const ifNum = newIfNum(ifId);
            ids = { toId: toId, toNum: toNum, ifId: ifId, ifNum: ifNum,
                alloc: (x.data.alloc || []).map(a => Object.assign({}, a, { ifId: ifId, ifNum: ifNum, toId: toId, toNum: toNum })) };
        }
```

and change that final update to:

```js
        data.updateLoad(data.getLoad(x.id), Object.assign({ status: T.DEPARTED, data: Object.assign({ error: '', writes: writes, workingAt: 0, claim: '', phase: '', shortNote: null }, ids) },
            ids.toId ? { to: ids.toId, if: ids.ifId } : {}));
```

`depart_release`: in `guard`, replace the `stampWritten` line with:

```js
            if (isScan(cur)) {
                const w = cur.data.writes || {}, toId = w['to_create:' + cur.id];
                if (w['if_create:new:to:' + cur.id]) throw userErr('This truck is already in NetSuite. Press Retry to finish the departure.');
                if (toId && !tx.toClosed(toId)) throw userErr('Close TO ' + toId + ' in NetSuite first (it has no IF yet), then Release.');
            } else if (stampWritten(cur)) throw userErr('This truck is already stamped in NetSuite. Press Retry to finish the departure.');
```

`approvalsView`: in the `shipPending` map add:

```js
            const sr = isScan(x) ? scanRows(x, data.palletsByLoad(x.id, [VP.LOADED]), c) : null;
```

and to its returned object `scan: !!sr, lines: sr ? sr.rows.map(r => ({ sku: r.sku, pcs: r.pcs })) : [], lbs: sr ? sr.total : null,`. In `retries`, change `canRelease: !stampWritten(x)` to
`scan: isScan(x), canRelease: isScan(x) ? !(x.data.writes || {})['if_create:new:to:' + x.id] : !stampWritten(x), toId: isScan(x) ? (x.data.writes || {})['to_create:' + x.id] || '' : ''`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 314 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(scan): Approve creates the TO + Shipped IF; stock block; Retry/Release with TO closed check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

