### Task 5: Floor flow for a scan-built truck (start, scan, view, verify)

**Files:**
- Modify: `move_portal/sl_move_portal.js` (`truck_start`, `truck_planned`, `scanCtx`, `checkTruck`, `verifyTruck`, `truckView`, `truck_add_if`, `page`)
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `core.officeIfs`, `core.palletTare`, `verify.truckLines`, `verify.linesPcs`, `verify.truckWeight`, `verify.classifyLoadScan({ scanBuilt })`.
- Produces:
  - `isScan(x) → boolean` (`x.data.kind === 'scan'`), used by Tasks 6–7.
  - `scanRows(x, ps, c) → { rows: [{ item, sku, pallets, pcs, lbs, avail, short }], pallets, pcs, tare, total, noWeight, short }` (loaded pallets only).
  - `truckView(x, c).scan`: the `scanRows` result for a scan truck, else `null`.
  - `truck_planned` returns `officeIfs` (boolean) and `planned: []` when off.
  - Boot data `officeIfs` for the UI.

- [ ] **Step 1: Write the failing tests**

Append to `move_portal/test/portal.test.js`:

```js
function scanSetup() {
    const ctx = setup();
    ctx.data.db.settings.officeIfs = false;
    ctx.data.db.items.find(i => i.item === '11').weight = 10;
    ctx.data.db.items.find(i => i.item === '11').wunit = 'lb';
    return ctx;
}
function scanTruck(ctx, n) {
    const ps = printLabels(ctx, n || 2);
    const v = ctx.run('truck_start', { trailer: tr() }, false).view;
    ps.forEach(p => ctx.run('truck_scan', { truckId: v.truck.id, raw: p.code }, false));
    return { id: v.truck.id, ps };
}

test('scan-built: start with only a trailer, load any labeled pallet, see SKU rows with weight and stock', () => {
    const ctx = scanSetup();
    assert.deepEqual(ctx.run('truck_planned', {}, false).planned, []);
    assert.equal(ctx.run('truck_planned', {}, false).officeIfs, false);
    const t = scanTruck(ctx, 2);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.kind, x.data.ifs], ['loading', 'scan', []]);
    const v = ctx.run('truck_get', { truckId: t.id }, false).view;
    assert.deepEqual(v.scan.rows, [{ item: '11', sku: 'YSN201', pallets: 2, pcs: 240, lbs: 2400, avail: 1000, short: false }]);
    assert.deepEqual([v.scan.pallets, v.scan.pcs, v.scan.tare, v.scan.total, v.scan.noWeight, v.scan.short], [2, 240, 90, 2490, 0, false]);
});

test('scan-built: Verify always matches when something is loaded, and refuses an empty truck', () => {
    const ctx = scanSetup();
    const empty = ctx.run('truck_start', { trailer: tr() }, false).view.truck.id;
    assert.throws(() => ctx.run('truck_verify', { truckId: empty }, false), /Nothing is loaded on this truck/);
    const t = scanTruck(ctx, 1);
    const r = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.equal(r.match, true);
    assert.equal(ctx.data.getLoad(t.id).status, 'ready');
});

test('scan-built: over Riverside available shows as short (a warning, not a block, on the floor)', () => {
    const ctx = scanSetup();
    ctx.data.db.stock['35']['11'].avail = 100;
    const t = scanTruck(ctx, 1);
    const v = ctx.run('truck_get', { truckId: t.id }, false).view;
    assert.deepEqual([v.scan.rows[0].short, v.scan.short], [true, true]);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).match, true);
});

test('office IFs on: a truck still needs an IF; off: office-IF actions refuse a scan truck', () => {
    const on = setup();
    assert.throws(() => on.run('truck_start', { trailer: tr() }, false), /Pick at least one IF/);
    const ctx = scanSetup();
    const t = scanTruck(ctx, 1);
    assert.throws(() => ctx.run('truck_add_if', { truckId: t.id, ifId: '1' }), /no IFs/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL. `truck_start` throws "Pick at least one IF" with office IFs off.

- [ ] **Step 3: Implement**

In `move_portal/sl_move_portal.js`:

Add near `isOpen`:

```js
    // Scan-built truck (spec 2026-10-14): no IFs; Approve creates its TO + IF.
    function isScan(x) { return !!(x && x.data && x.data.kind === 'scan'); }
    // SKU rows for the floor's Load / Verify / Shipments: loaded pallets only, with weight and Riverside available.
    function scanRows(x, ps, c) {
        const loaded = ps.filter(p => p.status === VP.LOADED), tl = verify.truckLines(loaded), items = Object.keys(tl);
        const info = data.itemInfo(items), avail = items.length ? data.locationStock(c.S.locFrom, items) : {};
        const w = verify.truckWeight(tl, info, core.palletTare(c.S), loaded.length);
        const rows = items.map(k => {
            const av = avail[k] ? Number(avail[k].avail) || 0 : 0;
            return { item: k, sku: info[k] ? info[k].sku : k, pallets: tl[k].pallets, pcs: tl[k].pcs, lbs: w.rows[k], avail: av, short: tl[k].pcs > av };
        }).sort((p, q) => p.sku < q.sku ? -1 : p.sku > q.sku ? 1 : 0);
        return { rows: rows, pallets: loaded.length, pcs: rows.reduce((s, r) => s + r.pcs, 0), tare: w.tare, total: w.total, noWeight: w.noWeight, short: rows.some(r => r.short) };
    }
```

`truck_start`: replace the two checks `if (!ids.length) throw…` and the `ifs` / `createLoad` block with:

```js
        if (!core.officeIfs(c.S)) {
            const trailer = checkTrailer(a.trailer, null);
            const id = data.createLoad({ number: 'Trailer ' + trailer, status: T.LOADING,
                data: { v3: true, kind: 'scan', ifs: [], trailer: trailer, startedBy: c.actor, startedAt: c.now.stamp, stack: [], lastStep: stepOf('started', c) } });
            return { view: truckView(mustTruck(id), c) };
        }
        if (!ids.length) throw userErr('Pick at least one IF');
```

(keep the existing trailer check and IF code after it, unchanged).

`truck_planned`: replace `planned: ns.plannedIfs().filter(…)…` with
`planned: core.officeIfs(c.S) ? ns.plannedIfs().filter(f => !taken[f.ifId]).map(f => pubIf(f, dp)) : [], officeIfs: core.officeIfs(c.S),`
(and when `officeIfs` is off, `pulledAt` stays as is).

`scanCtx`: first line `if (isScan(x)) return { truckId: x.id, trucks: scanTruckMap(allTrucks()), scanBuilt: true };`

`verifyTruck`: right after `if (!isOpen(x)) throw closedErr(x);` add:

```js
        if (isScan(x) && !data.palletsByLoad(x.id, [VP.LOADED]).length) throw userErr('Nothing is loaded on this truck');
```

`checkTruck`: at the top add:

```js
        if (isScan(x)) {                                // the scans are the order: always a match (spec 2026-10-14 §4)
            const ps = opt && opt.loadedAll ? opt.loadedAll.filter(p => String(p.loadId) === String(x.id)) : data.palletsByLoad(x.id, [VP.LOADED]);
            return { r: { match: true, keep: [], diffs: [], ifs: [] }, ps: ps, trucks: (opt && opt.trucks) || allTrucks(), planned: [] };
        }
```

`truckView`: add `scan: isScan(x) ? scanRows(x, ps, c) : null,` to the returned object.

`truck_add_if`: first line after the truck is read: `if (isScan(x)) throw userErr('This truck has no IFs: it is built from its scans');`. Read `truck_add_if` first to get its variable name for the truck.

`page()`: add `officeIfs: core.officeIfs(S)` to the `ui.buildPage({ … })` boot object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 307 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(scan): floor start/scan/verify for scan-built trucks with weight and stock rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

