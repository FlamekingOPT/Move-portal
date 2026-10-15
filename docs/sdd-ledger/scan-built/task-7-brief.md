### Task 7: Late pallet on a shipped scan truck gets its own one-pallet TO + IF; Dashboard row

**Files:**
- Modify: `move_portal/sl_move_portal.js` (`pallet_accept`, new `acceptScanPallet`, `dashboard` rows)
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `verify.scanApprovePlan`, `verify.stockCheck`, `verify.stockText`, `verify.resolveNew`, `completeAccept(id, p, dec, c)` (existing), `newIfNum`, `isScan`.
- Produces: `acceptScanPallet(x0, p0, item, sk, pcs, c) → { outcome: 'accepted'|'refused', text, view }`. Its writes land in the truck's `data.writes` under `to_create:<id>-P<palletId>` and `if_create:new:to:<id>-P<palletId>`.

- [ ] **Step 1: Write the failing tests**

First read the existing never-loaded / pallet_accept tests in `portal.test.js` (search for `pallet_accept`) to see how they flag a pallet at unload: a labeled pallet scanned on `unload_scan` of a departed truck is flagged `never_loaded`. Then append:

```js
test('scan-built: a late pallet accepted after shipping gets a one-pallet TO + Shipped IF and a late receipt', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_confirm', { truckId: t.id });
    const late = printLabels(ctx, 1, 'Jlate')[0];
    ctx.run('unload_scan', { truckId: t.id, raw: late.code }, false);           // never loaded → flagged
    const n0 = ctx.tx._t.ops.length;
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: late.id });
    assert.equal(r.outcome, 'accepted');
    const [to, f] = ctx.tx._t.ops.slice(n0);
    const ref = t.id + '-P' + late.id;
    assert.deepEqual([to.op, to.ref, to.lines, f.op, f.ship, f.seal], ['to_create', ref, { '11': 120 }, 'if_create', true, 'S' + t.id]);
    const x = ctx.data.getLoad(t.id);
    assert.ok(x.data.writes['to_create:' + ref] && x.data.writes['if_create:new:to:' + ref]);
    assert.equal(x.data.alloc.length, 2);
    assert.equal(ctx.data.getPallet(late.id).status, 'received');
});

test('scan-built: a late pallet is refused when Riverside cannot cover it, and nothing is written', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_confirm', { truckId: t.id });
    const late = printLabels(ctx, 1, 'Jlate2')[0];
    ctx.run('unload_scan', { truckId: t.id, raw: late.code }, false);
    ctx.data.db.stock['35']['11'].avail = 10;
    const n0 = ctx.tx._t.ops.length;
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: late.id });
    assert.equal(r.outcome, 'refused');
    assert.match(r.text, /YSN201 on truck 120, available 10/);
    assert.equal(ctx.tx._t.ops.length, n0);
});

test('Dashboard lists a loading scan truck as one row with its SKUs', () => {
    const ctx = scanSetup();
    const t = scanTruck(ctx, 2);
    const row = ctx.run('dashboard').rows.find(r => String(r.truckId) === String(t.id));
    assert.deepEqual([row.ifNum, row.toNum, row.skus, row.pallets, row.pcs], ['—', '—', [{ sku: 'YSN201', qty: 240 }], 2, 240]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL. The accept goes down the office path ("no open TO covers"), and the dashboard has no row for the scan truck.

- [ ] **Step 3: Implement**

Add before `act('pallet_accept', …)`:

```js
    // Spec 2026-10-14 S13: a scan-built truck has no office TO to add to, so the pallet gets its own TO + Shipped IF, stamped like its truck.
    function acceptScanPallet(x0, p0, item, sk, pcs, c) {
        const st = data.locationStock(c.S.locFrom, [item]), shorts = verify.stockCheck({ [item]: pcs }, { [item]: st[item] ? Number(st[item].avail) || 0 : 0 });
        if (shorts.length) return { outcome: 'refused', text: '⛔ Can\'t accept: ' + verify.stockText(shorts, { [item]: sk }), view: unloadView(x0, c) };
        const cl = claimLoad(x0, null, 'accept', decideGuard, {});
        const id = cl.Ld.id, claim = cl.claim, label = truckLabel(cl.Ld);
        try { mustFlaggedOn(cl.Ld, p0.id); } catch (e) { dropClaim(id, claim); throw e; }
        const dep = cl.Ld.data.depart || {}, ref = id + '-P' + p0.id;
        const plan = verify.scanApprovePlan({ ref: ref, lines: { [item]: pcs }, stamp: { trailer: dep.trailer, seal: dep.seal, truckNo: dep.truckNo, dayIso: dep.day }, S: c.S });
        const writes = Object.assign({}, cl.Ld.data.writes);
        try {
            verify.runOps(plan.ops, writeMode(c), o => { assertClaim(id, claim, label, 'accept'); return tx.apply(verify.resolveNew(o, writes)); }, writes,
                (k, newId) => { writes[k] = String(newId); data.updateLoad(data.getLoad(id), { data: { writes: writes } }); });
        } catch (e) {
            if (e.user) throw e;
            log.error({ title: 'move pallet_accept ' + id, details: (e && e.stack) || String(e) });
            dropClaim(id, claim);
            throw userErr('Accept refused: ' + (e.message || e) + ' — fix it in NetSuite and accept again');
        }
        try {
            const toId = writes['to_create:' + ref], ifId = writes['if_create:new:to:' + ref];
            let toNum = toId ? 'TO ' + toId : '(new TO)';
            try { if (toId && tx.tranIds) toNum = tx.tranIds([String(toId)], 'to')[String(toId)] || toNum; } catch (e) { /* shown as the id */ }
            const dec = { kind: 'accepted', ifId: ifId ? String(ifId) : 'new:' + ref, ifNum: ifId ? newIfNum(ifId) : '(plan)', toId: toId ? String(toId) : 'new:to:' + ref, toNum: toNum,
                item: item, sku: sk, pcs: pcs, by: c.user, at: c.now.stamp };
            dec.text = acceptText(dec);
            unloadFromOther(data.getPallet(p0.id), c);
            completeAccept(id, data.getPallet(p0.id), dec, c);
            assertClaim(id, claim, label, 'accept');
            data.updateLoad(data.getLoad(id), { data: { claim: '', workingAt: 0, phase: '' } });
            return { outcome: 'accepted', text: dec.text, view: unloadView(mustTruck(id), c) };
        } catch (e) { dropClaim(id, claim); throw e; }
    }
```

In `pallet_accept`, after the `const sk = …` line, add:

```js
        if (isScan(x0)) return acceptScanPallet(x0, p0, item, sk, pcs, c);
```

In the `dashboard` action, inside `active.forEach` in the `else` branch (no departure), add before `const live = …`:

```js
                if (isScan(x)) {
                    const ps = loadedAll[String(x.id)] || [], tl = verify.truckLines(ps), sk = skuNames(Object.keys(tl));
                    rows.push(Object.assign({}, base, { ifId: '', ifNum: '—', toNum: '—', skus: Object.keys(tl).map(k => ({ sku: sk[k] || k, qty: tl[k].pcs })),
                        pallets: ps.length, pcs: Object.keys(tl).reduce((s, k) => s + tl[k].pcs, 0), received: null }));
                    return;
                }
```

(The sort compares `Number(p.ifId)`, so `''` sorts as 0, which is fine.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 317 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(scan): late pallet after shipping gets its own TO + Shipped IF; dashboard row for scan trucks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

