### Task 10: Receiving, receipts and catch-ups

**Files:**
- Modify: `move_portal/sl_move_portal.js`. Insert right after the `act('load_approve', …)` line from Task 9.
- Test: `move_portal/test/portal.test.js` (append)

**Interfaces:**
- Consumes: `shipLoad`, `loadView` and the Task 8 helpers; `tx.receiveTransferOrder`; `core.receiveScanRule`; `core.catchupNumber`.
- Produces:
  - Actions: `inbound_list`, `recv_get`, `scan_recv`, `recv_other`, `recv_damaged`, `recv_undo`, `recv_ready`, `toreceive_list`, `recv_approve`, `catchup_list`, `catchup_approve`, `catchup_reject`.
  - Helpers: `recvView(loadId) → {load, total, receivedCount, expected:[pallets shipped|missing], recent:[last 5 received]}` and `receiveLoad(load, c) → {number, receiptNumber, pieces, missing}`.

- [ ] **Step 1: Append the failing tests**

```js
// ── Task 10 ──
function shippedLoad(ctx, n, job) {
    const o = loadAndReady(ctx, n, job);
    ctx.run('load_approve', { loadId: o.L.id });
    return o;
}

test('receiving: missing pallets stay in transit; a late arrival gets a second receipt', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 3);
    let r = ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.view.receivedCount, r.view.total, ctx.data.getLoad(L.id).status], ['ok', 1, 3, 'receiving']);
    assert.equal(ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false).result, 'dup');
    ctx.run('scan_recv', { loadId: L.id, raw: ps[1].code }, false);
    ctx.run('recv_damaged', { palletId: ps[1].id, loadId: L.id }, false);
    ctx.run('recv_ready', { loadId: L.id }, false);
    assert.throws(() => ctx.run('recv_approve', { loadId: L.id }, false), /Managers only/);
    const tr = ctx.run('toreceive_list');
    assert.deepEqual([tr.loads.length, tr.loads[0].scanned, tr.loads[0].expected, tr.loads[0].unpostedPieces, tr.loads[0].damaged.length], [1, 2, 3, 240, 1]);
    r = ctx.run('recv_approve', { loadId: L.id });
    assert.deepEqual([r.missing, r.pieces], [1, 240]);
    const receipts = ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt');
    assert.equal(receipts.length, 1);
    assert.deepEqual(receipts[0].lines, { '11': 240 });
    assert.equal(ctx.data.getPallet(ps[2].id).status, 'missing');
    assert.equal(ctx.data.getPallet(ps[0].id).receipt, receipts[0].id);
    assert.equal(ctx.data.getLoad(L.id).status, 'received_short');
    assert.equal(ctx.run('toreceive_list').loads.length, 0);
    r = ctx.run('scan_recv', { loadId: L.id, raw: ps[2].code }, false);
    assert.equal(r.result, 'late');
    const late = ctx.run('toreceive_list').loads;
    assert.deepEqual([late.length, late[0].late, late[0].unpostedPieces], [1, true, 120]);
    ctx.run('recv_approve', { loadId: L.id });
    assert.equal(ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt').length, 2);
    assert.deepEqual(ctx.data.getLoad(L.id).receipts.length, 2);
    assert.equal(ctx.data.getLoad(L.id).status, 'received');
    assert.equal(ctx.data.getPallet(ps[1].id).damaged, true);
});

test('undo returns a scanned pallet; recv_ready needs a scan', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 1);
    assert.throws(() => ctx.run('recv_ready', { loadId: L.id }, false), /nothing scanned in/);
    ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    const r = ctx.run('recv_undo', { palletId: ps[0].id, loadId: L.id }, false);
    assert.equal(r.view.receivedCount, 0);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'shipped');
});

test('a pallet from another shipped load can be received on that load', () => {
    const ctx = setup();
    const a = shippedLoad(ctx, 1, 'Ja');
    const b = shippedLoad(ctx, 1, 'Jb');
    const r = ctx.run('scan_recv', { loadId: a.L.id, raw: b.ps[0].code }, false);
    assert.deepEqual([r.result, r.otherNumber, r.otherLoadId], ['other_load', b.L.number, b.L.id]);
    const o = ctx.run('recv_other', { palletId: b.ps[0].id, otherLoadId: b.L.id, loadId: a.L.id }, false);
    assert.equal(o.result, 'ok');
    assert.equal(o.view.load.id, a.L.id);
    assert.equal(ctx.data.getPallet(b.ps[0].id).status, 'received');
    assert.equal(ctx.data.getLoad(b.L.id).status, 'receiving');
});

test('a receipt crash right after save is retried without a second receipt', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 1);
    ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    ctx.run('recv_ready', { loadId: L.id }, false);
    ctx.tx._t.failNext = 'r_after';
    assert.throws(() => ctx.run('recv_approve', { loadId: L.id }), /crashed after save/);
    assert.equal(ctx.data.getLoad(L.id).status, 'error');
    assert.equal(ctx.run('ship_list').loads.length, 0);
    assert.equal(ctx.run('toreceive_list').loads.length, 1);
    ctx.run('recv_approve', { loadId: L.id });
    assert.equal(ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt').length, 1);
    assert.equal(ctx.data.getLoad(L.id).status, 'received');
});

test('a pallet loaded without an outbound scan is caught up with its own TO, IF and receipt', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1);
    const stray = printLabels(ctx, 1, 'Jstray')[0];
    const r = ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false);
    assert.equal(r.result, 'arrived_unshipped');
    assert.deepEqual([ctx.data.getPallet(stray.id).status, ctx.data.getPallet(stray.id).arrivedOn], ['arrived_unshipped', L.id]);
    assert.equal(ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false).result, 'dup_catchup');
    const list = ctx.run('catchup_list');
    assert.deepEqual([list.pallets.length, list.pallets[0].ok, list.pallets[0].arrivedOnNumber], [1, true, 'MV-001']);
    assert.throws(() => ctx.run('catchup_approve', { palletId: stray.id }, false), /Managers only/);
    const done = ctx.run('catchup_approve', { palletId: stray.id });
    assert.equal(done.number, 'MV-001-C1');
    const p = ctx.data.getPallet(stray.id);
    assert.deepEqual([p.status, p.catchup, !!p.receipt], ['received', true, true]);
    assert.deepEqual([txCount(ctx, 'TrnfrOrd'), txCount(ctx, 'ItemShip'), txCount(ctx, 'ItemRcpt')], [2, 2, 1]);
    assert.equal(ctx.run('catchup_list').pallets.length, 0);
});

test('catch-up is blocked when NetSuite has the stock reserved; reject returns the label', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1);
    const stray = printLabels(ctx, 1, 'Jstray')[0];
    ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false);
    ctx.data.db.stock['35']['11'].avail = 0;
    assert.equal(ctx.run('catchup_list').pallets[0].ok, false);
    ctx.run('catchup_reject', { palletId: stray.id });
    const p = ctx.data.getPallet(stray.id);
    assert.deepEqual([p.status, p.loadId, p.arrivedOn], ['labeled', '', '']);
});

test('a pallet on a load that was never approved is refused at receiving', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1, 'Ja');
    const pending = loadAndReady(ctx, 1, 'Jb');
    const r = ctx.run('scan_recv', { loadId: L.id, raw: pending.ps[0].code }, false);
    assert.deepEqual([r.result, r.otherNumber], ['other_load_pending', pending.L.number]);
    assert.equal(ctx.data.getPallet(pending.ps[0].id).status, 'loaded');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `Unknown action: scan_recv`.

- [ ] **Step 3: Insert this block after `act('load_approve', …);`:**

```js
    // ── receiving (inbound) ──────────────────────────────────────────────
    const IN_OPEN = [L.SHIPPED, L.RECEIVING, L.RECV_READY, L.RECEIVED_SHORT];

    function recvView(loadId) {
        const Ld = mustLoad(loadId);
        const pallets = data.palletsByLoad(Ld.id, [P.SHIPPED, P.RECEIVED, P.MISSING]);
        const received = pallets.filter(p => p.status === P.RECEIVED);
        return { load: pubLoad(Ld, countsFromPallets(pallets)), total: pallets.length, receivedCount: received.length,
            expected: pallets.filter(p => p.status !== P.RECEIVED).map(p => pubPallet(p)),
            recent: received.slice(-5).reverse().map(p => pubPallet(p)) };
    }

    act('inbound_list', false, () => {
        const loads = data.loadsByStatus(IN_OPEN, 50);
        const counts = data.palletCountsByLoad(loads.map(l => l.id));
        return { loads: loads.map(l => pubLoad(l, counts[l.id])) };
    });

    act('recv_get', false, (a) => recvView(a.loadId));

    function receiveOne(p, Ld, c, raw) {
        if (IN_OPEN.concat([L.RECEIVED]).indexOf(Ld.status) === -1) throw userErr(Ld.number + ' is not open for receiving (' + Ld.status + ')');
        const loads = {};
        if (p && p.loadId) { const o = p.loadId === Ld.id ? Ld : data.getLoad(p.loadId); if (o) loads[o.id] = o; }
        const rule = core.receiveScanRule(p, Ld.id, loads);
        if (rule.set) {
            const patch = { status: rule.set.status, data: {} };
            if ('loadId' in rule.set) patch.load = rule.set.loadId;
            if (rule.set.status === P.RECEIVED) { patch.data.receivedAt = c.now.stamp; patch.data.receivedBy = c.actor; }
            if (rule.set.status === P.ARRIVED_UNSHIPPED) {
                patch.arrivedOn = Ld.id;
                patch.data.arrivedAt = c.now.stamp; patch.data.arrivedBy = c.actor; patch.data.arrivedFromLoad = rule.fromLoadNumber || '';
            }
            data.updatePallet(p, patch);
            if (rule.set.status === P.RECEIVED && Ld.status === L.SHIPPED) data.updateLoad(Ld, { status: L.RECEIVING });
        }
        data.logScan({ pallet: p ? p.id : '', load: Ld.id, result: rule.result, data: { raw: raw, mode: 'receive', actor: c.actor, at: c.now.stamp } });
        const fresh = p ? data.getPallet(p.id) : null;
        return { result: rule.result, tone: core.toneFor(rule.result), raw: raw, pallet: fresh ? pubPallet(fresh) : null,
            loadNumber: Ld.number, otherNumber: rule.otherNumber || '', otherLoadId: rule.otherLoadId || '',
            fromLoadNumber: rule.fromLoadNumber || '', view: recvView(Ld.id) };
    }

    act('scan_recv', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        const sc = core.parseScan(a.raw);
        return receiveOne(sc.palletId ? data.getPallet(sc.palletId) : null, Ld, c, sc.raw);
    });

    act('recv_other', false, (a, c) => {
        const p = mustPallet(a.palletId), other = mustLoad(a.otherLoadId);
        if (p.loadId !== other.id) throw userErr(p.code + ' is not on ' + other.number);
        const r = receiveOne(p, other, c, p.code);
        r.view = recvView(a.loadId || other.id);   // keep the worker on the load they are unloading
        return r;
    });

    act('recv_damaged', false, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.RECEIVED) throw userErr('Scan the pallet in first');
        data.updatePallet(p, { damaged: true, data: { damagedBy: c.actor, damagedAt: c.now.stamp } });
        return { pallet: pubPallet(data.getPallet(p.id)), view: a.loadId ? recvView(a.loadId) : null };
    });

    act('recv_undo', false, (a) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.RECEIVED || p.receipt) throw userErr(p.code + ' can no longer be undone');
        const Ld = mustLoad(p.loadId);
        const back = [L.RECEIVED, L.RECEIVED_SHORT].indexOf(Ld.status) !== -1 ? P.MISSING : P.SHIPPED;
        data.updatePallet(p, { status: back, damaged: false, data: { receivedAt: '', receivedBy: '' } });
        return { view: recvView(a.loadId || Ld.id) };
    });

    act('recv_ready', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        if (Ld.status !== L.RECEIVING) throw userErr(Ld.number + ' has nothing scanned in yet');
        data.updateLoad(Ld, { status: L.RECV_READY, data: { recvReadyBy: c.actor, recvReadyAt: c.now.stamp } });
        return {};
    });

    act('toreceive_list', true, () => {
        const unposted = {};
        data.findPalletsWhere({ status: [P.RECEIVED], receiptEmpty: true }).forEach(p => { unposted[p.loadId] = 1; });
        const seen = {};
        const cand = data.loadsByStatus([L.RECV_READY, L.RECEIVING_TX, L.ERROR], 50)
            .filter(l => l.if && (l.status !== L.ERROR || (l.data || {}).phase === 'recv'))
            .concat(data.getLoads(Object.keys(unposted)).filter(l => [L.RECEIVED_SHORT, L.RECEIVED].indexOf(l.status) !== -1))
            .filter(l => { if (seen[l.id]) return false; seen[l.id] = 1; return true; });
        const loads = cand.map(Ld => {
            const ps = data.palletsByLoad(Ld.id, [P.SHIPPED, P.RECEIVED, P.MISSING]);
            const scanned = ps.filter(p => p.status === P.RECEIVED);
            return Object.assign(pubLoad(Ld, countsFromPallets(ps)), {
                expected: ps.length, scanned: scanned.length,
                missing: ps.filter(p => p.status !== P.RECEIVED).map(p => ({ code: p.code, summary: p.summary })),
                damaged: ps.filter(p => p.damaged).map(p => ({ code: p.code, summary: p.summary })),
                unpostedPieces: scanned.filter(p => !p.receipt).reduce((x, p) => x + p.pieces, 0),
                late: [L.RECEIVED_SHORT, L.RECEIVED].indexOf(Ld.status) !== -1 });
        });
        const transit = data.loadsByStatus([L.SHIPPED, L.RECEIVING], 50);
        const tc = data.palletCountsByLoad(transit.map(l => l.id));
        return { loads: loads, transit: transit.map(l => pubLoad(l, tc[l.id])) };
    });

    // Resumable: `pendingRecv` pins the pallet set, and the memo token finds a
    // receipt that was saved just before a crash.
    function receiveLoad(Ld, c) {
        const ok = [L.RECV_READY, L.RECEIVED_SHORT, L.RECEIVED, L.ERROR, L.RECEIVING_TX];
        if (ok.indexOf(Ld.status) === -1 || !Ld.if || (Ld.status === L.ERROR && Ld.data.phase !== 'recv')) {
            throw userErr(Ld.number + ' is not ready to receive (' + Ld.status + ')');
        }
        if (Ld.status === L.RECEIVING_TX && !stale(Ld)) throw userErr(Ld.number + ' is already being received. Wait a minute and refresh.');
        data.updateLoad(Ld, { status: L.RECEIVING_TX, data: { workingAt: Date.now(), error: '', phase: 'recv' } });
        Ld = data.getLoad(Ld.id);
        try {
            let pend = Ld.data.pendingRecv;
            if (!pend) {
                const ids = data.palletsByLoad(Ld.id, [P.RECEIVED]).filter(p => !p.receipt).map(p => p.id);
                if (!ids.length) throw userErr('Nothing scanned in on ' + Ld.number + ' to receive');
                pend = { seq: (Number(Ld.data.recvSeq) || 0) + 1, ids: ids };
                data.updateLoad(Ld, { data: { pendingRecv: pend, recvSeq: pend.seq } });
                Ld = data.getLoad(Ld.id);
            }
            const pallets = data.palletsByIds(pend.ids);
            const lines = core.aggregate(pallets);
            const tok = core.txToken(Ld.id, 'r' + pend.seq);
            const rid = tx.findByToken(tok, 'ItemRcpt') || tx.receiveTransferOrder(Ld.to, lines, 'Move ' + Ld.number + ' receipt ' + pend.seq + ' ' + tok);
            if (Ld.receipts.indexOf(String(rid)) === -1) data.updateLoad(Ld, { receipts: Ld.receipts.concat([String(rid)]) });
            Ld = data.getLoad(Ld.id);
            pallets.forEach(p => { if (!p.receipt) data.updatePallet(p, { receipt: String(rid) }); });
            data.palletsByLoad(Ld.id, [P.SHIPPED]).forEach(p => data.updatePallet(p, { status: P.MISSING }));
            const missing = data.palletsByLoad(Ld.id, [P.MISSING]).length;
            data.updateLoad(Ld, { status: missing ? L.RECEIVED_SHORT : L.RECEIVED,
                data: { pendingRecv: null, recvApprovedBy: c.actor, recvApprovedAt: c.now.stamp, workingAt: 0, phase: '' } });
            const t = data.tranids([rid]);
            return { number: Ld.number, receiptNumber: t[rid] || '', pieces: pallets.reduce((x, p) => x + p.pieces, 0), missing: missing };
        } catch (e) {
            const cur = data.getLoad(Ld.id);
            if (cur && cur.status === L.RECEIVING_TX) data.updateLoad(cur, { status: L.ERROR, data: { error: e.message, workingAt: 0 } });
            throw e;
        }
    }

    act('recv_approve', true, (a, c) => receiveLoad(mustLoad(a.loadId), c));

    // ── catch-ups (pallet arrived without an outbound scan) ──────────────
    act('catchup_list', true, (a, c) => {
        const ps = data.palletsByStatus([P.ARRIVED_UNSHIPPED]);
        const items = {};
        ps.forEach(p => p.lines.forEach(l => { items[l.item] = 1; }));
        const stock = Object.keys(items).length ? data.locationStock(c.S.locFrom, Object.keys(items)) : {};
        const num = {};
        data.getLoads(ps.map(p => p.arrivedOn).filter(Boolean)).forEach(l => { num[l.id] = l.number; });
        return { pallets: ps.map(p => {
            const short = p.lines.filter(l => (stock[l.item] ? stock[l.item].avail : 0) < l.pcs)
                .map(l => l.sku + ' (' + (stock[l.item] ? stock[l.item].avail : 0) + ' available)');
            return pubPallet(p, { arrivedOnNumber: num[p.arrivedOn] || '', arrivedAt: p.data.arrivedAt || '', ok: !short.length, short: short.join(', ') });
        }) };
    });

    act('catchup_approve', true, (a, c) => {
        let p = mustPallet(a.palletId);
        let cl = p.data.catchupLoad ? data.getLoad(p.data.catchupLoad) : null;
        if (!cl) {
            if (p.status !== P.ARRIVED_UNSHIPPED) throw userErr(p.code + ' is not waiting for a catch-up');
            const parent = p.arrivedOn ? data.getLoad(p.arrivedOn) : null;
            const id = data.createLoad({ number: core.catchupNumber(parent ? parent.number : 'MV-000', data.allLoadNumbers()), status: L.READY,
                data: { catchupFor: parent ? parent.id : '', createdBy: c.actor, createdAt: c.now.stamp, readyBy: c.actor, readyAt: c.now.stamp } });
            data.updatePallet(p, { status: P.LOADED, load: id, catchup: true, data: { catchupLoad: id } });
            cl = data.getLoad(id);
        }
        if ([L.READY, L.ERROR, L.SHIPPING].indexOf(cl.status) !== -1 && cl.data.phase !== 'recv') shipLoad(cl, c);
        cl = data.getLoad(cl.id);
        p = data.getPallet(p.id);
        if (p.status === P.SHIPPED) data.updatePallet(p, { status: P.RECEIVED, data: { receivedAt: c.now.stamp, receivedBy: c.actor } });
        if (cl.status === L.SHIPPED) { data.updateLoad(cl, { status: L.RECV_READY }); cl = data.getLoad(cl.id); }
        const r = receiveLoad(cl, c);
        return { number: cl.number, receiptNumber: r.receiptNumber };
    });

    act('catchup_reject', true, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.ARRIVED_UNSHIPPED) throw userErr(p.code + ' is not waiting for a catch-up');
        data.updatePallet(p, { status: P.LABELED, load: '', arrivedOn: '', data: { catchupRejectedBy: c.actor, catchupRejectedAt: c.now.stamp } });
        return {};
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 46 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(move): scan-based receiving, resumable receipts, catch-ups"
```

---

