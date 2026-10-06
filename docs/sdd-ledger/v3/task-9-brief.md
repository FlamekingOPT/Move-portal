### Task 9: Suitelet: approvals list and shadow report

**Files:**
- Modify: `move_portal/sl_move_portal.js`
- Modify: `move_portal/test/portal.test.js`

**Interfaces:**
- Produces:

  | Action | Who | Returns |
  |---|---|---|
  | `approvals` | manager | `{departures: [{truck, pending, plan|null, error|null}], retries: [truckSummary], receipts: [{truck, perIf, missing, lateOnly}]}` |
  | `report` | manager | `{rows: shadowRows, days: [{day, trucks, pallets, pieces, diffs}], pulledAt, writeMode}` |

- [ ] **Step 1: Write the failing tests** (append)

```js
test('approvals lists pending departures, failed departures and receipts waiting', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'P1' }, false);
    const d = departed(ctx, 1, 'P2', '9002');
    ctx.run('unload_scan', { truckId: d.t.id, raw: d.ps[0].code }, false);
    ctx.run('unload_done', { truckId: d.t.id }, false);
    const r = ctx.run('approvals');
    assert.deepEqual(r.departures.map(x => [x.truck.id, x.pending.seal, x.plan.corrections]), [[t.id, 'P1', 1]]);
    assert.deepEqual(r.receipts.map(x => [x.truck.id, x.perIf[0].received]), [[d.t.id, 12]]);
    assert.throws(() => ctx.run('approvals', {}, false), /Managers only/);
});

test('report compares plan with the snapshot', () => {
    const ctx = setup();
    departed(ctx, 42, '5249300');
    const r = ctx.run('report');
    assert.ok(r.rows.some(x => x.ifNum === 'IF9001' && x.check === 'IF qty YSN100' && x.ok === null));   // IF9001 is still B in the snapshot
    assert.deepEqual([r.days[0].trucks, r.days[0].pallets, r.writeMode], [1, 42, 'off']);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL with `Unknown action: approvals`.

- [ ] **Step 3: Implement**

```js
    act('approvals', true, (a, c) => {
        const trucks = allTrucks();
        return {
            departures: trucks.filter(x => x.status === T.LOADING && x.data.pending).map(x => {
                let plan = null, error = null;
                try { plan = pubPlan(departPlan(x, x.data.pending, c).plan); } catch (e) { error = e.message; }
                return { truck: truckSummary(x), pending: x.data.pending, plan: plan, error: error };
            }),
            retries: trucks.filter(x => x.status === T.DEPARTING && x.data.error).map(truckSummary),
            receipts: trucks.filter(x => UNLOADABLE.indexOf(x.status) !== -1).map(x => {
                const unposted = data.palletsByLoad(x.id, [VP.RECEIVED]).filter(p => !p.data.postedSeq).length;
                if (!unposted || (x.status !== T.RECEIVED && !x.data.recvRequested)) return null;
                const rp = receiptPlan(x);
                return { truck: truckSummary(x), perIf: rp.perIf, missing: rp.missing, lateOnly: x.status === T.RECEIVED };
            }).filter(Boolean)
        };
    });

    act('report', true, (a, c) => {
        const trucks = allTrucks().filter(x => x.data.depart);
        const ids = {};
        trucks.forEach(x => (x.data.alloc || []).forEach(al => Object.keys(al.lines).forEach(k => { ids[k] = 1; })));
        const rows = verify.shadowRows({ trucks: trucks, ifInfo: ns.ifInfo(), ifsByTo: ns.ifsByTo(), receipts: ns.receiptsByIf(), sku: skuNames(Object.keys(ids)) });
        const days = {};
        trucks.forEach(x => {
            const dd = days[x.data.depart.day] = days[x.data.depart.day] || { day: x.data.depart.day, trucks: 0, pallets: 0, pieces: 0, diffs: 0 };
            const ps = data.palletsByLoad(x.id, [VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING]);
            dd.trucks++; dd.pallets += ps.length; dd.pieces += ps.reduce((s, p) => s + p.pieces, 0);
            const label = truckLabel(x);
            dd.diffs += rows.filter(r => r.truck === label && r.ok === false).length;
        });
        return { rows: rows, days: Object.values(days).sort((p, q) => (p.day < q.day ? 1 : -1)), pulledAt: ns.pulledAt(), writeMode: writeMode(c) };
    });
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(v3): manager approvals list + shadow report action"
```

---

