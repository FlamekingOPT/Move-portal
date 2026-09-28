### Task 11: Dashboard / move tracker action

**Files:**
- Modify: `move_portal/sl_move_portal.js`. Insert right after `act('catchup_reject', …);`.
- Test: `move_portal/test/portal.test.js` (append)

**Interfaces:**
- Produces the `dashboard` action (manager), returning:
  - `m`: the `trackerMetrics` output, with `neededPerDay` set to `null` when it's infinite
  - `labeled`, `inTransit`, `received`, `target`
  - `days`: `[{day, n}]` from the start date to today (capped at the target)
  - `loads`: the last 15 loads
  - `exc`: `{missing, arrivedUnshipped, catchups7, damaged, edited, stale, noConfig}`
  - `bySku`: `[{sku, palletsLeft}]`, top 20
  - `noConfigSkus`

- [ ] **Step 1: Append the failing test**

```js
// ── Task 11 ──
test('dashboard counts moved, remaining, days and exceptions', () => {
    const ctx = setup();
    shippedLoad(ctx, 2);
    ctx.data.db.stock['35']['11'].onHand = 960;           // NetSuite drops on-hand when the IF ships
    printLabels(ctx, 1, 'Jlater');
    ctx.data.db.pallets[Object.keys(ctx.data.db.pallets).pop()].printedDay = '2026-10-01';   // stale label
    const r = ctx.run('dashboard');
    assert.deepEqual([r.m.moved, r.m.remaining, r.m.total, r.m.movedToday], [2, 18, 20, 2]);
    assert.deepEqual([r.inTransit, r.labeled, r.received], [2, 1, 0]);
    assert.deepEqual(r.days[r.days.length - 1], { day: '2026-10-14', n: 2 });
    assert.equal(r.days[0].day, '2026-10-01');
    assert.deepEqual([r.exc.missing, r.exc.stale, r.exc.noConfig], [0, 1, 0]);
    assert.equal(r.bySku[0].sku, 'YSN301');
    assert.equal(r.loads.length, 1);
    assert.throws(() => ctx.run('dashboard', {}, false), /Managers only/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `Unknown action: dashboard`.

- [ ] **Step 3: Insert after `act('catchup_reject', …);`:**

```js
    // ── dashboard ────────────────────────────────────────────────────────
    act('dashboard', true, (a, c) => {
        const sm = stockModel(c);
        const m = tracker(c, sm.est);
        const moved = data.movedByDay();
        const end = c.now.dayIso < c.S.target ? c.now.dayIso : c.S.target;
        const days = core.moveDays(c.S.start, end, c.S.skip || []).map(d => ({ day: d, n: moved[d] || 0 }));
        const loads = data.recentLoads(15);
        const lc = data.palletCountsByLoad(loads.map(l => l.id));
        const exc = {
            missing: data.countPallets({ status: [P.MISSING] }),
            arrivedUnshipped: data.countPallets({ status: [P.ARRIVED_UNSHIPPED] }),
            catchups7: data.countPallets({ catchup: true, shippedSince: core.isoAddDays(c.now.dayIso, -6) }),
            damaged: data.countPallets({ damaged: true }),
            edited: data.countPallets({ edited: true, status: [P.SHIPPED, P.RECEIVED, P.MISSING] }),
            stale: data.countPallets({ status: [P.LABELED], printedBefore: core.isoAddDays(c.now.dayIso, -(Number(c.S.staleDays) || 5)) }),
            noConfig: sm.est.unknownItems.length
        };
        const skuOf = k => (sm.stock[k] ? sm.stock[k].sku : k);
        const bySku = Object.keys(sm.est.byItem).map(k => ({ sku: skuOf(k), palletsLeft: sm.est.byItem[k] }))
            .sort((x, y) => y.palletsLeft - x.palletsLeft).slice(0, 20);
        return {
            m: Object.assign({}, m, { neededPerDay: isFinite(m.neededPerDay) ? m.neededPerDay : null }),
            labeled: data.countPallets({ status: [P.LABELED, P.LOADED] }),
            inTransit: data.countPallets({ status: [P.SHIPPED, P.MISSING] }),
            received: data.countPallets({ status: [P.RECEIVED] }),
            target: c.S.target, days: days, loads: loads.map(l => pubLoad(l, lc[l.id])), exc: exc, bySku: bySku,
            noConfigSkus: sm.est.unknownItems.map(skuOf)
        };
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 47 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(move): dashboard move tracker action"
```

---

