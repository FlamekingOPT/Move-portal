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

