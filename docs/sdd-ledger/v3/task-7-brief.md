### Task 7: Suitelet: load-out and departure actions

**Files:**
- Modify: `move_portal/sl_move_portal.js` (define deps, helpers, new actions)
- Modify: `move_portal/test/portal.test.js` (`setup()` deps, new tests)
- Modify: `move_portal/test/preview_server.js` (add the two new deps so it still loads; fully reworked in Task 13)

**Interfaces:**
- Consumes: `move_verify` (Tasks 1–5), the `move_ns` interface (Task 5), `tx.apply` (Task 6).
- Produces:
  - Actions (all take `{actor}`):

    | Action | Body | Returns |
    |---|---|---|
    | `truck_planned` | — | `{planned: [pubIf], open: [truckSummary], pulledAt}` |
    | `truck_start` | `{ifIds}` | `{view}` |
    | `truck_get` | `{truckId}` | `{view}` |
    | `truck_scan` | `{truckId, raw}` | the scan result + `{raw, tone, pallet, view}` |
    | `truck_move_here` | `{truckId, palletId}` | `{view}` |
    | `truck_remove` | `{truckId, palletId}` | `{view}` |
    | `truck_undo` | `{truckId}` | `{view}` |
    | `depart_preview` | `{truckId, trailer, seal, carrier}` | `{input, truckNo, plan}` |
    | `depart_confirm` | `{truckId, trailer?, seal?, carrier?}` | `{waiting: true, plan, view}` or `{departed: true, view}` |
    | `depart_cancel` | `{truckId}` | `{view}` |
    | `depart_retry` | `{truckId}`, manager only | `{departed: true, view}` |

  - `view` shape: `{truck: {id, label, status, pending, depart, error, bol}, lines: [{ifNum, item, sku, expected, scanned, estPallets}], extras: [{item, sku, scanned}], pallets: [pubPallet], totals: {pallets, pieces}, trailers, carrier, writeMode}`
  - `plan` (public) shape: `{ops: [op + {sku}], unplanned, needsManager, bol, corrections: n}`

- [ ] **Step 1: Wire the dependencies**

In `sl_move_portal.js`, change the `define` list and the factory signature:

```js
define(['N/runtime', 'N/log', 'N/render', 'N/url', 'N/format',
        './move_core', './move_data', './move_tx', './move_label_template', './move_ui', './move_verify', './move_ns'],
function (runtime, log, render, url, format, core, data, tx, tpl, ui, verify, ns) {
```

In `portal.test.js` `setup()`, load and inject them, and return `ns` too:

```js
const verify = loadAmd('move_verify.js');
const { makeSnapshotNs } = require('../local/snapshot_ns');
// inside setup():
    const ns = makeSnapshotNs(verify, JSON.parse(JSON.stringify(require('./fixtures/snapshot_sample.json'))));
    data.db.items.push({ item: '975', sku: 'YSN100', desc: '100# cylinder', upc: '0975' });
    data.db.configs.push({ item: '975', code: 'A', pcs: 12, isDefault: true, batch: 'B1' });
    // add to the loadAmd deps object:
    //   './move_verify': verify, './move_ns': ns
    return { data, tx, run, ns };
```

In `preview_server.js`, add the same two deps to its `loadAmd('sl_move_portal.js', {...})` call. Use `const verify = loadAmd('move_verify.js')` and `require('../local/snapshot_ns').makeSnapshotNs(verify, require('path').join(__dirname, 'fixtures', 'snapshot_sample.json'))`.

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass (no behavior changed yet).

- [ ] **Step 2: Write the failing tests** (append to `portal.test.js`)

```js
const L975 = { item: '975', sku: 'YSN100', cfg: 'A', pcs: 12 };
function truckWith(ctx, n, ifId) {
    const ps = printLabels(ctx, n, 'Jt' + n + Math.random().toString(36).slice(2, 6), [L975]);
    const t = ctx.run('truck_start', { ifIds: [ifId || '9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    return { t, ps };
}

test('truck_planned lists A/B IFs not on a truck; truck_start takes one', () => {
    const ctx = setup();
    const r = ctx.run('truck_planned');
    assert.deepEqual(r.planned.map(f => [f.ifNum, f.pcs, f.estPallets]), [['IF9001', 504, 42], ['IF9002', 504, 42]]);
    const v1 = ctx.run('truck_start', { ifIds: ['9001'] }).view;
    assert.deepEqual([v1.truck.status, v1.truck.label, v1.lines[0].expected, v1.lines[0].scanned], ['loading', 'IF9001', 504, 0]);
    assert.deepEqual(ctx.run('truck_planned').planned.map(f => f.ifNum), ['IF9002']);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9001'] }), /already on a truck/);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9000'] }), /not Picked\/Packed/);
});

test('truck_scan: ok, dup, no_to blocked, undo and remove', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2, 'Jscan', [L975]);
    const bad = printLabels(ctx, 1, 'Jbad', [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 60 }]);
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    const r = ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code });
    assert.deepEqual([r.result, r.tone, r.view.lines[0].scanned], ['ok', 'ok', 12]);
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code }).result, 'dup');
    const b = ctx.run('truck_scan', { truckId: t.id, raw: bad[0].code });
    assert.deepEqual([b.result, b.sku, b.tone], ['no_to', 'YSN301', 'bad']);
    assert.equal(ctx.data.getPallet(bad[0].id).status, 'labeled');
    ctx.run('truck_scan', { truckId: t.id, raw: ps[1].code });
    assert.equal(ctx.run('truck_undo', { truckId: t.id }).view.lines[0].scanned, 12);
    assert.equal(ctx.run('truck_remove', { truckId: t.id, palletId: ps[0].id }).view.lines[0].scanned, 0);
    assert.equal(ctx.data.db.scans.length, 4);
});

test('truck_scan: pallet on another loading truck → other_truck → move here', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 1, 'Jmv', [L975]);
    const a = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    const b = ctx.run('truck_start', { ifIds: ['9002'] }).view.truck;
    ctx.run('truck_scan', { truckId: a.id, raw: ps[0].code });
    const r = ctx.run('truck_scan', { truckId: b.id, raw: ps[0].code });
    assert.deepEqual([r.result, r.otherLabel], ['other_truck', 'IF9001']);
    assert.equal(ctx.run('truck_move_here', { truckId: b.id, palletId: ps[0].id }).view.lines[0].scanned, 12);
    assert.equal(ctx.data.getPallet(ps[0].id).loadId, b.id);
});

test('depart: exact match → floor departs, stamps planned only in off mode, pallets in transit, truck # 1', () => {
    const ctx = setup();
    const { t, ps } = truckWith(ctx, 42);
    const pv = ctx.run('depart_preview', { truckId: t.id, trailer: '537224', seal: '5249330' }, false);
    assert.deepEqual([pv.truckNo, pv.plan.needsManager, pv.plan.ops.length], [1, false, 1]);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249330' }, false);
    assert.equal(r.departed, true);
    assert.deepEqual([r.view.truck.status, r.view.truck.label, r.view.truck.depart.carrier], ['departed', 'Truck 1 · 10/14', 'Armstrong Group']);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'in_transit');
    const t2 = truckWith(ctx, 1, '9002').t;                                   // IF9001 is taken by the departed truck
    assert.throws(() => ctx.run('depart_confirm', { truckId: t2.id, trailer: '1', seal: '5249330' }), /already used/);
});

test('depart: short needs a manager; floor request waits; manager approval writes only if_qty in qty mode', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    const w = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249331' }, false);
    assert.equal(w.waiting, true);
    assert.equal(w.view.truck.pending.seal, '5249331');
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: 'PLT1' }), /Scanning is closed/);
    const r = ctx.run('depart_confirm', { truckId: t.id }, true);
    assert.equal(r.departed, true);
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.to]), [['if_qty', 480]]);
    assert.deepEqual(ctx.data.getLoad(t.id).data.writes, { 'if_qty:9001:975': '9001' });
    assert.equal(r.view.truck.bol.changed, true);
});

test('depart: a failed write leaves the truck departing with an error; a manager retry finishes without rewriting', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = truckWith(ctx, 42);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249332' }), /NetSuite write failed/);
    assert.equal(ctx.data.getLoad(t.id).status, 'departing');
    assert.throws(() => ctx.run('depart_retry', { truckId: t.id }, false), /Managers only/);
    assert.equal(ctx.run('depart_retry', { truckId: t.id }).departed, true);
    assert.deepEqual(ctx.tx._t.ops.map(o => o.op), ['if_stamp']);
});
```

> The fake `N/format` returns `10/14/2026 2:14:05 pm`, so the day is `2026-10-14` and the label is `Truck 1 · 10/14`.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL with `Unknown action: truck_planned`.

- [ ] **Step 4: Implement**

Put this block in `sl_move_portal.js` after the existing `claimLoad`/claim helpers and before `const A = {};`:

```js
    // ── v3 trucks (spec 2026-10-01) ──────────────────────────────────────
    const T = verify.TRUCK, VP = verify.VP;
    function writeMode(c) { return verify.normMode(c.S.writeMode); }
    function allTrucks() { return data.loadsByStatus(Object.values(T)).filter(x => x.data && x.data.v3); }
    function mustTruck(id) { const x = data.getLoad(id); if (!x || !x.data || !x.data.v3) throw userErr('Truck not found'); return x; }
    function truckLabel(x) {
        const d = x.data || {};
        return d.depart ? verify.memoFor(d.depart.truckNo, d.depart.day) : (d.ifs || []).map(f => f.ifNum).join(' + ');
    }
    function truckMap(list) { const o = {}; list.forEach(x => { o[x.id] = { status: x.status, label: truckLabel(x) }; }); return o; }
    function skuNames(items) { const info = data.itemInfo(items.map(String)); const o = {}; items.forEach(k => { o[k] = info[k] ? info[k].sku : String(k); }); return o; }
    function defPcs(c) { return core.defaultPcs(data.configsByItem(c.S.activeBatch)); }
    function pubIf(f, dp) {
        const pcs = f.lines.reduce((a, l) => a + l.qty, 0);
        const est = f.lines.reduce((a, l) => a + (dp[l.item] ? Math.ceil(l.qty / dp[l.item]) : 0), 0);
        return { ifId: f.ifId, ifNum: f.ifNum, status: f.status, toNum: f.toNum, trandate: f.trandate, lines: f.lines, pcs: pcs, estPallets: est };
    }
    function truckSummary(x) {
        const ps = data.palletsByLoad(x.id, [VP.LOADED, VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
        return { id: x.id, label: truckLabel(x), status: x.status, pending: x.data.pending || null, depart: x.data.depart || null,
            error: x.data.error || '', pallets: ps.length, received: ps.filter(p => p.status === VP.RECEIVED).length,
            missing: ps.filter(p => p.status === VP.MISSING || (x.status === T.RECEIVED && p.status === VP.IN_TRANSIT)).length };
    }
    function truckView(x, c) {
        const d = x.data || {}, dp = defPcs(c);
        const ps = data.palletsByLoad(x.id, [VP.LOADED, VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
        const fill = verify.fillExpected(d.ifs || [], verify.sumLines(ps));
        const lines = [];
        (d.ifs || []).forEach(f => f.lines.forEach(l => lines.push({ ifNum: f.ifNum, item: l.item, sku: l.sku, expected: l.qty,
            scanned: fill.alloc[f.ifId] ? fill.alloc[f.ifId][l.item] || 0 : 0, estPallets: dp[l.item] ? Math.ceil(l.qty / dp[l.item]) : null })));
        const extraIds = Object.keys(fill.left).filter(k => fill.left[k] > 0), sk = skuNames(extraIds);
        return { truck: Object.assign(truckSummary(x), { bol: d.bol || null }), lines: lines,
            extras: extraIds.map(k => ({ item: k, sku: sk[k], scanned: fill.left[k] })),
            pallets: ps.map(p => pubPallet(p)), totals: { pallets: ps.length, pieces: ps.reduce((a, p) => a + p.pieces, 0) },
            trailers: c.S.trailers || ['537224', '416460', '105488', '522051', '211659'], carrier: c.S.defaultCarrier || 'Armstrong Group', writeMode: writeMode(c) };
    }
    function pushStack(x, entry, key) {
        const k = key || 'stack';
        data.updateLoad(x, { data: { [k]: ((x.data && x.data[k]) || []).concat([entry]).slice(-60) } });
    }
    function scanCtx(x) {
        return { truckId: x.id, trucks: truckMap(allTrucks()), ifs: x.data.ifs, toLines: ns.openToLines(),
            loadedByItem: verify.sumLines(data.palletsByLoad(x.id, [VP.LOADED])) };
    }
    function mustOpenTruck(id) {
        const x = mustTruck(id);
        if (x.status !== T.LOADING || x.data.pending) throw userErr('Scanning is closed on this truck');
        return x;
    }
    function pubPlan(p) {
        const ids = {};
        p.ops.forEach(o => { if (o.item) ids[o.item] = 1; if (o.lines) Object.keys(o.lines).forEach(k => { ids[k] = 1; }); });
        const sk = skuNames(Object.keys(ids));
        return { ops: p.ops.map(o => Object.assign({}, o, { sku: o.item ? sk[o.item] : '', skus: o.lines ? Object.keys(o.lines).map(k => sk[k] + ' ×' + o.lines[k]) : [] })),
            unplanned: p.unplanned, needsManager: p.needsManager, bol: p.bol, corrections: p.corrections.length };
    }
    function departInput(a, x, c) {
        const p = x.data.pending || {};
        const pick = (k, d) => String(a[k] != null && a[k] !== '' ? a[k] : p[k] || d || '').trim();
        const inp = { trailer: pick('trailer'), seal: pick('seal'), carrier: pick('carrier', c.S.defaultCarrier || 'Armstrong Group') };
        if (!inp.trailer) throw userErr('Enter the trailer #');
        if (!inp.seal) throw userErr('Enter the seal #');
        if (verify.sealUsed(allTrucks(), inp.seal, x.id)) throw userErr('Seal ' + inp.seal + ' was already used on another truck');
        return inp;
    }
    function departPlan(x, inp, c) {
        const truckNo = verify.truckNoForDay(allTrucks(), c.now.dayIso, x.id);
        try {
            return { truckNo: truckNo, plan: verify.planDeparture({ ifs: x.data.ifs, pallets: data.palletsByLoad(x.id, [VP.LOADED]), toLines: ns.openToLines(),
                stamp: { trailer: inp.trailer, seal: inp.seal, truckNo: truckNo, dayIso: c.now.dayIso } }) };
        } catch (e) { throw userErr(e.message); }
    }
    function finishDepart(x, c) {
        const writes = Object.assign({}, x.data.writes);
        try {
            verify.runOps(x.data.plan, writeMode(c), op => tx.apply(verify.resolveNew(op, writes)), writes,
                (k, id) => { writes[k] = id; data.updateLoad(x, { data: { writes: writes } }); });
        } catch (e) {
            data.updateLoad(x, { data: { error: e.message || String(e), writes: writes } });
            throw userErr('Departure saved but a NetSuite write failed: ' + (e.message || e) + '. A manager can press Retry.');
        }
        data.palletsByLoad(x.id, [VP.LOADED]).forEach(p => data.updatePallet(p, { status: VP.IN_TRANSIT, shippedDay: x.data.depart.day }));
        data.updateLoad(x, { status: T.DEPARTED, data: { error: '', writes: writes } });
        return { departed: true, view: truckView(mustTruck(x.id), c) };
    }
```

Then add the actions (with the other `act(...)` calls, before `// ── entry points`):

```js
    act('truck_planned', false, (a, c) => {
        const trucks = allTrucks(), taken = {}, dp = defPcs(c);
        trucks.forEach(x => (x.data.ifs || []).forEach(f => { taken[f.ifId] = true; }));
        return { planned: ns.plannedIfs().filter(f => !taken[f.ifId]).map(f => pubIf(f, dp)),
            open: trucks.filter(x => x.status === T.LOADING || x.status === T.DEPARTING).map(truckSummary), pulledAt: ns.pulledAt() };
    });

    act('truck_start', false, (a, c) => {
        const ids = (a.ifIds || []).map(String);
        if (!ids.length) throw userErr('Pick at least one IF');
        const planned = ns.plannedIfs(), taken = {};
        allTrucks().forEach(x => (x.data.ifs || []).forEach(f => { taken[f.ifId] = true; }));
        const ifs = ids.map(id => {
            const f = planned.find(y => y.ifId === id);
            if (taken[id]) throw userErr((f ? f.ifNum : 'IF ' + id) + ' is already on a truck');
            if (!f) throw userErr('IF ' + id + ' is not Picked/Packed any more. Refresh the list.');
            return f;
        });
        const id = data.createLoad({ number: ifs.map(f => f.ifNum).join('+').slice(0, 290), status: T.LOADING,
            data: { v3: true, ifs: ifs, startedBy: c.actor, startedAt: c.now.stamp, stack: [] } });
        return { view: truckView(mustTruck(id), c) };
    });

    act('truck_get', false, (a, c) => ({ view: truckView(mustTruck(a.truckId), c) }));

    act('truck_scan', false, (a, c) => {
        const x = mustOpenTruck(a.truckId);
        const s = core.parseScan(a.raw);
        const p = s.palletId ? data.getPallet(s.palletId) : null;
        const r = verify.classifyLoadScan(Object.assign({ pallet: p }, scanCtx(x)));
        if (r.set) {
            data.updatePallet(p, { status: r.set.status, load: x.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor } });
            pushStack(x, String(p.id));
        }
        data.logScan({ pallet: p ? p.id : '', load: x.id, result: r.result, data: { raw: s.raw, mode: 'load', actor: c.actor, at: c.now.stamp } });
        return Object.assign({}, r, { raw: s.raw, tone: verify.toneFor(r.result), pallet: p ? pubPallet(data.getPallet(p.id)) : null, view: truckView(mustTruck(x.id), c) });
    });

    act('truck_move_here', false, (a, c) => {
        const x = mustOpenTruck(a.truckId), p = mustPallet(a.palletId);
        const from = p.loadId ? data.getLoad(p.loadId) : null;
        if (p.status !== VP.LOADED || !from || from.status !== T.LOADING || from.data.pending) throw userErr('That pallet can no longer be moved');
        const r = verify.fitOnTruck(p, scanCtx(x));
        if (r.result === 'no_to') throw userErr('No open transfer order for ' + r.sku + ' on this truck. Set it aside and call the office.');
        data.updatePallet(p, { load: x.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor } });
        pushStack(x, String(p.id));
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('truck_remove', false, (a, c) => {
        const x = mustOpenTruck(a.truckId), p = mustPallet(a.palletId);
        if (p.status !== VP.LOADED || p.loadId !== x.id) throw userErr('That pallet is not on this truck');
        data.updatePallet(p, { status: VP.LABELED, load: '' });
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('truck_undo', false, (a, c) => {
        const x = mustOpenTruck(a.truckId), st = (x.data.stack || []).slice();
        while (st.length) {
            const p = data.getPallet(st.pop());
            if (p && p.status === VP.LOADED && p.loadId === x.id) { data.updatePallet(p, { status: VP.LABELED, load: '' }); break; }
        }
        data.updateLoad(x, { data: { stack: st } });
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('depart_preview', false, (a, c) => {
        const x = mustTruck(a.truckId), inp = departInput(a, x, c), d = departPlan(x, inp, c);
        return { input: inp, truckNo: d.truckNo, plan: pubPlan(d.plan) };
    });

    act('depart_confirm', false, (a, c) => {
        const x0 = mustTruck(a.truckId);
        if (x0.status !== T.LOADING) throw userErr('This truck is already ' + x0.status);
        const inp = departInput(a, x0, c), d = departPlan(x0, inp, c);
        if (d.plan.needsManager && !c.mgr) {
            data.updateLoad(x0, { data: { pending: Object.assign({ by: c.actor, at: c.now.stamp }, inp) } });
            return { waiting: true, plan: pubPlan(d.plan), view: truckView(mustTruck(x0.id), c) };
        }
        const x = claimLoad(x0, T.DEPARTING, 'depart').Ld;
        const gone = {};
        d.plan.unplanned.forEach(u => { gone[u.ifId] = true; });
        data.updateLoad(x, { data: { depart: Object.assign({ truckNo: d.truckNo, day: c.now.dayIso, at: c.now.stamp, by: c.actor,
            approvedBy: d.plan.needsManager ? c.actor : '' }, inp), plan: d.plan.ops, alloc: d.plan.alloc, unplanned: d.plan.unplanned,
            bol: d.plan.bol, ifs: x.data.ifs.filter(f => !gone[f.ifId]), writes: {}, pending: null } });
        return finishDepart(mustTruck(x.id), c);
    });

    act('depart_cancel', false, (a, c) => {
        const x = mustTruck(a.truckId);
        if (x.status !== T.LOADING) throw userErr('This truck already left');
        data.updateLoad(x, { data: { pending: null } });
        return { view: truckView(mustTruck(x.id), c) };
    });

    act('depart_retry', true, (a, c) => {
        const x = mustTruck(a.truckId);
        if (x.status !== T.DEPARTING || !x.data.depart) throw userErr('Nothing to retry on this truck');
        return finishDepart(x, c);
    });
```

> `claimLoad`'s error text says "shipped/received". Change its message line to `throw userErr((Ld.number || 'This truck') + ' is already being processed by someone else. Refresh in a minute.');` (the old tests match on `/already being/`, so they still pass).

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass. If an old test asserted the exact `claimLoad` message, update its regex to `/already being/`.

- [ ] **Step 6: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js move_portal/test/preview_server.js
git commit -m "feat(v3): truck load-out + departure actions with manager gate and write modes"
```

---

