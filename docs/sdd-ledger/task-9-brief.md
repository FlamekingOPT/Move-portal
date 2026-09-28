### Task 9: Loading and Approve & Ship

**Files:**
- Modify: `move_portal/sl_move_portal.js`. Insert the block below right after the line `// ── (Tasks 9–11 add more act(...) blocks here) ──`.
- Test: `move_portal/test/portal.test.js` (append)

**Interfaces:**
- Consumes: the helpers from Task 8; `tx.findByToken`, `tx.createTransferOrder`, `tx.committedShortfalls`, `tx.fulfillTransferOrder`; `core.loadScanRule`, `core.aggregate`, `core.shortages`, `core.txToken`, `core.nextLoadNumber`.
- Produces:
  - Actions: `load_list`, `load_create`, `load_get`, `scan_load`, `load_move_here`, `pallet_edit`, `pallet_remove`, `load_ready`, `load_sendback`, `ship_list`, `load_approve`.
  - Helpers: `loadView(loadId) → {load, pallets (newest first), totals:{pallets, pieces, skus}}` and `shipLoad(load, c) → {number, toNumber, ifNumber}`. Task 10 reuses `shipLoad` for catch-ups.
  - Load `data.phase` is `'ship'` while shipping, `'recv'` while receiving, or `''`. `ship_list` shows only loads whose phase isn't `'recv'`.

- [ ] **Step 1: Append the failing tests**

```js
// ── Task 9 ──
function openLoad(ctx) { return ctx.run('load_create', { door: '4', carrier: 'Estes', trailer: '53', seal: '9' }, false).load; }
function loadAndReady(ctx, n, job) {
    const ps = printLabels(ctx, n, job || 'Jship');
    const L = openLoad(ctx);
    ps.forEach(p => ctx.run('scan_load', { loadId: L.id, raw: p.code }, false));
    ctx.run('load_ready', { loadId: L.id }, false);
    return { ps, L };
}
const txCount = (ctx, type) => ctx.tx._t.calls.filter(c => c.type === type).length;

test('load scanning: ok, dup, unknown, void, other open load, move here', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 3);
    const L1 = openLoad(ctx), L2 = openLoad(ctx);
    assert.deepEqual([L1.number, L2.number, L1.door], ['MV-001', 'MV-002', '4']);
    let r = ctx.run('scan_load', { loadId: L1.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.tone, r.view.totals.pallets, r.view.totals.pieces, r.pallet.status], ['ok', 'ok', 1, 120, 'loaded']);
    assert.equal(ctx.run('scan_load', { loadId: L1.id, raw: ps[0].code }, false).result, 'dup');
    assert.equal(ctx.run('scan_load', { loadId: L1.id, raw: '0714528803' }, false).result, 'unknown');
    ctx.run('pallet_void', { palletId: ps[2].id, reason: 'Damaged' }, false);
    assert.equal(ctx.run('scan_load', { loadId: L1.id, raw: ps[2].code }, false).result, 'void');
    ctx.run('scan_load', { loadId: L2.id, raw: ps[1].code }, false);
    r = ctx.run('scan_load', { loadId: L1.id, raw: ps[1].code }, false);
    assert.deepEqual([r.result, r.otherNumber], ['other_load', 'MV-002']);
    r = ctx.run('load_move_here', { loadId: L1.id, palletId: ps[1].id }, false);
    assert.equal(r.view.totals.pallets, 2);
    assert.equal(ctx.run('load_get', { loadId: L2.id }, false).totals.pallets, 0);
    assert.equal(ctx.data.db.scans.length, 6);
    assert.equal(ctx.run('load_list', {}, false).loads.length, 2);
});

test('edit and remove only while loading; ready closes scanning', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2);
    const L = openLoad(ctx);
    assert.throws(() => ctx.run('load_ready', { loadId: L.id }, false), /at least one/);
    ctx.run('scan_load', { loadId: L.id, raw: ps[0].code }, false);
    const e = ctx.run('pallet_edit', { loadId: L.id, palletId: ps[0].id, lines: [{ item: '11', pcs: 100 }] }, false);
    assert.deepEqual([e.pallet.pieces, e.pallet.edited, e.pallet.summary, e.view.totals.pieces], [100, true, 'YSN201 · A · 100', 100]);
    assert.throws(() => ctx.run('pallet_edit', { loadId: L.id, palletId: ps[0].id, lines: [{ item: '12', pcs: 1 }] }, false), /only change piece counts/);
    ctx.run('pallet_remove', { loadId: L.id, palletId: ps[0].id }, false);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'labeled');
    ctx.run('scan_load', { loadId: L.id, raw: ps[1].code }, false);
    ctx.run('load_ready', { loadId: L.id }, false);
    assert.throws(() => ctx.run('scan_load', { loadId: L.id, raw: ps[0].code }, false), /closed for scanning/);
    assert.throws(() => ctx.run('pallet_remove', { loadId: L.id, palletId: ps[1].id }, false), /open load/);
    assert.throws(() => ctx.run('load_sendback', { loadId: L.id }, false), /Managers only/);
    ctx.run('load_sendback', { loadId: L.id });
    assert.equal(ctx.data.getLoad(L.id).status, 'loading');
});

test('approve & ship creates one TO and one IF and ships the pallets', () => {
    const ctx = setup();
    const { ps, L } = loadAndReady(ctx, 2);
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }, false), /Managers only/);
    const list = ctx.run('ship_list');
    assert.deepEqual(list.loads[0].rows, [{ item: '11', sku: 'YSN201', qty: 240, avail: 1000, ok: true }]);
    const r = ctx.run('load_approve', { loadId: L.id });
    assert.equal(r.number, 'MV-001');
    assert.deepEqual(ctx.tx._t.calls.map(c => c.type), ['TrnfrOrd', 'ItemShip']);
    assert.deepEqual(ctx.tx._t.calls[0].lines, { '11': 240 });
    assert.deepEqual([ctx.tx._t.calls[0].fromLoc, ctx.tx._t.calls[0].toLoc], ['35', '99']);
    assert.match(ctx.tx._t.memos[0].memo, /\[mv:\d+:to\]/);
    const Ld = ctx.data.getLoad(L.id);
    assert.deepEqual([Ld.status, Ld.data.approvedBy, Ld.data.phase], ['shipped', 'Miguel', '']);
    ps.forEach(p => { const x = ctx.data.getPallet(p.id); assert.deepEqual([x.status, x.shippedDay], ['shipped', '2026-10-14']); });
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /not ready to ship/);
    assert.equal(ctx.run('ship_list').loads.length, 0);
    assert.equal(ctx.run('ship_list').recent[0].number, 'MV-001');
});

test('stock shortage blocks approval and leaves the load ready', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 2);
    ctx.data.db.stock['35']['11'].avail = 100;
    assert.equal(ctx.run('ship_list').loads[0].rows[0].ok, false);
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /YSN201 needs 240, available 100/);
    assert.equal(ctx.data.getLoad(L.id).status, 'ready');
    assert.equal(ctx.tx._t.calls.length, 0);
});

test('an IF failure is retried without a second TO; a crash after the IF saved does not duplicate it', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 1);
    ctx.tx._t.failNext = 'if';
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /IF save failed/);
    let Ld = ctx.data.getLoad(L.id);
    assert.deepEqual([Ld.status, Ld.data.error, txCount(ctx, 'TrnfrOrd')], ['error', 'IF save failed', 1]);
    assert.equal(ctx.run('ship_list').loads[0].canSendBack, false);
    ctx.tx._t.failNext = 'if_after';
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /crashed after save/);
    ctx.run('load_approve', { loadId: L.id });
    assert.deepEqual([txCount(ctx, 'TrnfrOrd'), txCount(ctx, 'ItemShip'), ctx.data.getLoad(L.id).status], [1, 1, 'shipped']);
});

test('committed shortfall on the TO stops before the IF', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 1);
    ctx.tx._t.shortfalls = [{ item: '11', need: 120, committed: 60 }];
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /YSN201 reserved 60 of 120/);
    assert.equal(txCount(ctx, 'ItemShip'), 0);
    ctx.tx._t.shortfalls = [];
    ctx.run('load_approve', { loadId: L.id });
    assert.equal(txCount(ctx, 'ItemShip'), 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `Unknown action: load_create`.

- [ ] **Step 3: Insert this block after `// ── (Tasks 9–11 add more act(...) blocks here) ──`:**

```js
    // ── loading (outbound) ───────────────────────────────────────────────
    const OUT_OPEN = [L.LOADING, L.READY, L.SHIPPING, L.ERROR];

    function loadView(loadId) {
        const Ld = mustLoad(loadId);
        const pallets = data.palletsByLoad(Ld.id, [P.LOADED, P.SHIPPED, P.RECEIVED, P.MISSING]);
        const items = {};
        pallets.forEach(p => p.lines.forEach(l => { items[l.item] = 1; }));
        return { load: pubLoad(Ld, countsFromPallets(pallets)), pallets: pallets.slice().reverse().map(p => pubPallet(p)),
            totals: { pallets: pallets.length, pieces: pallets.reduce((a, p) => a + p.pieces, 0), skus: Object.keys(items).length } };
    }

    act('load_list', false, () => {
        const loads = data.loadsByStatus(OUT_OPEN, 50).filter(l => (l.data || {}).phase !== 'recv');
        const counts = data.palletCountsByLoad(loads.map(l => l.id));
        return { loads: loads.map(l => pubLoad(l, counts[l.id])) };
    });

    act('load_create', false, (a, c) => {
        const clean = v => String(v || '').trim().slice(0, 40);
        const id = data.createLoad({ number: core.nextLoadNumber(data.allLoadNumbers()), status: L.LOADING,
            data: { door: clean(a.door), carrier: clean(a.carrier), trailer: clean(a.trailer), seal: clean(a.seal), createdBy: c.actor, createdAt: c.now.stamp } });
        // Two docks opening a load at the same moment can get the same number; the newer one renumbers.
        const Ld = data.getLoad(id);
        if (data.loadsByNumber(Ld.number).some(x => Number(x.id) < Number(id))) data.updateLoad(Ld, { number: core.nextLoadNumber(data.allLoadNumbers()) });
        return { load: pubLoad(data.getLoad(id)) };
    });

    act('load_get', false, (a) => loadView(a.loadId));

    act('scan_load', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        if (Ld.status !== L.LOADING) throw userErr(Ld.number + ' is closed for scanning (' + Ld.status + ')');
        const sc = core.parseScan(a.raw);
        const p = sc.palletId ? data.getPallet(sc.palletId) : null;
        const loads = {};
        if (p && p.loadId) { const o = p.loadId === Ld.id ? Ld : data.getLoad(p.loadId); if (o) loads[o.id] = o; }
        const rule = core.loadScanRule(p, Ld.id, loads);
        if (rule.set) data.updatePallet(p, { status: rule.set.status, load: rule.set.loadId, data: { loadedAt: c.now.stamp, loadedBy: c.actor } });
        data.logScan({ pallet: p ? p.id : '', load: Ld.id, result: rule.result, data: { raw: sc.raw, mode: 'load', actor: c.actor, at: c.now.stamp } });
        const fresh = p ? data.getPallet(p.id) : null;
        return { result: rule.result, tone: core.toneFor(rule.result), raw: sc.raw, pallet: fresh ? pubPallet(fresh) : null,
            loadNumber: Ld.number, otherNumber: rule.otherNumber || '', view: loadView(Ld.id) };
    });

    act('load_move_here', false, (a, c) => {
        const Ld = mustLoad(a.loadId), p = mustPallet(a.palletId);
        if (Ld.status !== L.LOADING) throw userErr(Ld.number + ' is closed for scanning');
        const other = p.loadId ? data.getLoad(p.loadId) : null;
        if (p.status !== P.LOADED || !other || other.status !== L.LOADING) throw userErr(p.code + ' can no longer be moved');
        data.updatePallet(p, { load: Ld.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor, movedFrom: other.number } });
        return { pallet: pubPallet(data.getPallet(p.id)), view: loadView(Ld.id) };
    });

    function editablePallet(a) {
        const Ld = mustLoad(a.loadId), p = mustPallet(a.palletId);
        if (Ld.status !== L.LOADING || p.status !== P.LOADED || p.loadId !== Ld.id) throw userErr(p.code + ' can only be changed while it is on an open load');
        return { Ld: Ld, p: p };
    }

    act('pallet_edit', false, (a, c) => {
        const o = editablePallet(a);
        const byItem = {};
        o.p.lines.forEach(l => { byItem[String(l.item)] = l; });
        const next = (Array.isArray(a.lines) ? a.lines : []).map(l => byItem[String(l.item)] ? Object.assign({}, byItem[String(l.item)], { pcs: l.pcs }) : null);
        if (next.length !== o.p.lines.length || next.some(l => !l)) throw userErr('Edit can only change piece counts');
        const err = core.validateLines(next);
        if (err) throw userErr(err);
        const lines = next.map(l => Object.assign({}, l, { pcs: Math.floor(Number(l.pcs)) }));
        data.updatePallet(o.p, { lines: lines, summary: core.summarize(lines), pieces: core.totalPieces(lines), edited: true,
            data: { editedAt: c.now.stamp, editedBy: c.actor } });
        return { pallet: pubPallet(data.getPallet(o.p.id)), view: loadView(o.Ld.id) };
    });

    act('pallet_remove', false, (a, c) => {
        const o = editablePallet(a);
        data.updatePallet(o.p, { status: P.LABELED, load: '', data: { removedAt: c.now.stamp, removedBy: c.actor } });
        return { view: loadView(o.Ld.id) };
    });

    act('load_ready', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        if (Ld.status !== L.LOADING) throw userErr(Ld.number + ' is not open');
        if (!data.palletsByLoad(Ld.id, [P.LOADED]).length) throw userErr('Scan at least one pallet first');
        data.updateLoad(Ld, { status: L.READY, data: { readyBy: c.actor, readyAt: c.now.stamp } });
        return {};
    });

    act('load_sendback', true, (a) => {
        const Ld = mustLoad(a.loadId);
        if ([L.READY, L.ERROR].indexOf(Ld.status) === -1 || Ld.to) throw userErr(Ld.number + ' can no longer be sent back');
        data.updateLoad(Ld, { status: L.LOADING, data: { error: '', phase: '' } });
        return {};
    });

    act('ship_list', true, (a, c) => {
        const loads = data.loadsByStatus([L.READY, L.SHIPPING, L.ERROR], 50).filter(l => (l.data || {}).phase !== 'recv');
        const per = loads.map(Ld => ({ Ld: Ld, pallets: data.palletsByLoad(Ld.id, [P.LOADED]) }));
        const skuOf = {};
        per.forEach(o => o.pallets.forEach(p => p.lines.forEach(l => { skuOf[l.item] = l.sku; })));
        const stock = Object.keys(skuOf).length ? data.locationStock(c.S.locFrom, Object.keys(skuOf)) : {};
        const out = per.map(o => {
            const agg = o.Ld.to && o.Ld.data.lines ? o.Ld.data.lines : core.aggregate(o.pallets);
            const rows = Object.keys(agg).map(item => {
                const avail = stock[item] ? stock[item].avail : 0;
                // Once the TO exists its own lines are already committed, so availability no longer applies.
                return { item: item, sku: skuOf[item] || item, qty: agg[item], avail: avail, ok: !!o.Ld.to || avail >= agg[item] };
            });
            return Object.assign(pubLoad(o.Ld, countsFromPallets(o.pallets)), { rows: rows,
                canSendBack: !o.Ld.to && [L.READY, L.ERROR].indexOf(o.Ld.status) !== -1 });
        });
        const recent = data.loadsByStatus([L.SHIPPED, L.RECEIVING, L.RECV_READY, L.RECEIVED, L.RECEIVED_SHORT], 10);
        const t = data.tranids([].concat.apply([], recent.map(l => [l.to, l.if])).filter(Boolean));
        const rc = data.palletCountsByLoad(recent.map(l => l.id));
        return { loads: out, recent: recent.map(l => Object.assign(pubLoad(l, rc[l.id]), { toNumber: t[l.to] || '', ifNumber: t[l.if] || '' })) };
    });

    // Resumable: each finished step (TO, IF) is saved on the load, and memo tokens
    // find a transaction that was saved just before a crash.
    function shipLoad(Ld, c) {
        if ([L.READY, L.ERROR, L.SHIPPING].indexOf(Ld.status) === -1 || Ld.data.phase === 'recv') throw userErr(Ld.number + ' is ' + Ld.status + ', not ready to ship');
        if (Ld.status === L.SHIPPING && !stale(Ld)) throw userErr(Ld.number + ' is already being shipped. Wait a minute and refresh.');
        data.updateLoad(Ld, { status: L.SHIPPING, data: { workingAt: Date.now(), error: '', phase: 'ship' } });
        Ld = data.getLoad(Ld.id);
        try {
            const skuOf = {};
            data.palletsByLoad(Ld.id, [P.LOADED, P.SHIPPED]).forEach(p => p.lines.forEach(l => { skuOf[l.item] = l.sku; }));
            const name = k => skuOf[k] || k;
            let lines = Ld.data.lines;
            if (!Ld.to) {
                const loaded = data.palletsByLoad(Ld.id, [P.LOADED]);
                if (!loaded.length) throw userErr('No pallets on ' + Ld.number);
                lines = core.aggregate(loaded);
                const stock = data.locationStock(c.S.locFrom, Object.keys(lines));
                const avail = {};
                Object.keys(stock).forEach(k => { avail[k] = stock[k].avail; });
                const short = core.shortages(lines, avail);
                if (short.length) {
                    data.updateLoad(Ld, { status: L.READY, data: { workingAt: 0, phase: '' } });
                    throw userErr('Not enough available at ' + c.S.fromName + ': ' +
                        short.map(s => name(s.item) + ' needs ' + s.need + ', available ' + s.avail).join('; ') + '. Remove a pallet or check the count.');
                }
                const tok = core.txToken(Ld.id, 'to');
                const toId = tx.findByToken(tok, 'TrnfrOrd') || tx.createTransferOrder({ fromLoc: c.S.locFrom, toLoc: c.S.locTo,
                    orderStatus: c.S.toStatus, memo: 'Move ' + Ld.number + ' ' + tok, lines: lines });
                data.updateLoad(Ld, { to: toId, data: { lines: lines } });
                Ld = data.getLoad(Ld.id);
            }
            if (!Ld.if) {
                const tok = core.txToken(Ld.id, 'if');
                let ifId = tx.findByToken(tok, 'ItemShip');
                if (!ifId) {
                    const sf = tx.committedShortfalls(Ld.to, lines);
                    if (sf.length) throw userErr('The transfer order was created but NetSuite reserved less than the load: ' +
                        sf.map(s => name(s.item) + ' reserved ' + s.committed + ' of ' + s.need).join('; ') +
                        '. Free that stock (or fix the transfer order in NetSuite) and press Retry.');
                    ifId = tx.fulfillTransferOrder(Ld.to, lines, 'Move ' + Ld.number + ' ' + tok);
                }
                data.updateLoad(Ld, { if: ifId });
                Ld = data.getLoad(Ld.id);
            }
            data.palletsByLoad(Ld.id, [P.LOADED]).forEach(p => data.updatePallet(p, { status: P.SHIPPED, shippedDay: c.now.dayIso, data: { shippedAt: c.now.stamp } }));
            data.updateLoad(Ld, { status: L.SHIPPED, data: { approvedBy: c.actor, approvedAt: c.now.stamp, workingAt: 0, phase: '' } });
            const t = data.tranids([Ld.to, Ld.if]);
            return { number: Ld.number, toNumber: t[Ld.to] || '', ifNumber: t[Ld.if] || '' };
        } catch (e) {
            const cur = data.getLoad(Ld.id);
            if (cur && cur.status === L.SHIPPING) data.updateLoad(cur, { status: L.ERROR, data: { error: e.message, workingAt: 0 } });
            throw e;
        }
    }

    act('load_approve', true, (a, c) => shipLoad(mustLoad(a.loadId), c));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 39 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(move): load scanning and resumable approve & ship"
```

---

