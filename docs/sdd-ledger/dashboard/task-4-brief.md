### Task 4: Report truck history

**Files:**
- Modify: `move_portal/sl_move_portal.js` (the `report` action)
- Test: `move_portal/test/portal.test.js`

**Interfaces:** `report.history: [{ truckId, day, truck, truckNo, trailer, seal, ifs: [ifNum], pallets, pcs, status, stage, startedBy, startedAt, markedBy, markedAt, confirmedBy, confirmedAt, receivedAt, corrections: [text] }]`, newest first (by truck id).

- [ ] **Step 1: Write the failing test**

```js
test('report.history: every truck newest first with who/when per step and correction lines', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const a = departed(ctx, 42, '5260030');
    const s = strayOn(ctx, a.t);
    a.ps.forEach(p => ctx.run('unload_scan', { truckId: a.t.id, raw: p.code }, false));
    ctx.run('pallet_accept', { truckId: a.t.id, palletId: s.id });
    const b = truckWith(ctx, 3, '9002');                                             // still loading
    const h = ctx.run('report').history;
    assert.deepEqual(h.map(r => [r.truckId, r.stage]), [[b.t.id, 'Loading'], [a.t.id, 'Unloading']]);
    const ra = h[1];
    assert.deepEqual([ra.day, ra.truck, ra.truckNo, ra.trailer, ra.seal, ra.ifs, ra.pallets, ra.pcs, ra.startedBy, ra.markedBy, ra.confirmedBy],
        ['2026-10-14', 'Truck 1 · 10/14', 1, ctx.data.getLoad(a.t.id).data.trailer, '5260030', ['IF9001'], 43, 516, 'Miguel', 'Miguel', 'Jack K']);
    assert.deepEqual(ra.corrections, ['+ ' + s.code + ' accepted · IF9001']);
    assert.deepEqual([h[0].seal, h[0].markedAt, h[0].corrections], ['', '', []]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL (`history` undefined).

- [ ] **Step 3: Implement** (in the `report` action, before its `return`)

```js
        // Truck history (spec §4): every v3 truck, newest first.
        const allCounts = data.palletStatusCounts(every.map(x => x.id)), skAll = skuNames([...new Set(every.reduce((s, x) => s.concat((x.data.corrections || []).filter(k => k.op && k.op.op === 'if_qty').map(k => String(k.op.item))), []))]);
        const corrText = k => {
            if (k.kind === 'pallet_accept') return '+ ' + k.code + ' accepted' + (k.ifNum ? ' · ' + k.ifNum : k.toNum ? ' · new IF on ' + k.toNum : '') + (k.pending ? ' (office IF pending)' : '');
            if (k.kind === 'pallet_reject') return '↩ ' + k.code + ' rejected · "' + (k.note || '') + '"';
            const op = k.op || {};
            if (op.op === 'if_qty') return (op.to < op.from ? '⬇ ' : '⬆ ') + op.ifNum + ' ' + (skAll[String(op.item)] || op.item) + ' ' + verify._fmt(op.from) + '→' + verify._fmt(op.to);
            if (op.op === 'if_create') return '➕ add-on IF on ' + (op.toNum || op.toId);
            if (op.op === 'drop_if') return '✕ ' + op.ifNum + ' dropped';
            return String(op.op || k.kind || '');
        };
        const history = every.slice().sort((p, q) => Number(q.id) - Number(p.id)).map(x => {
            const d = x.data, dep = d.depart || null, q = d.shipReq || {}, sts = [VP.LOADED, VP.IN_TRANSIT, VP.RECEIVED, VP.MISSING];
            return { truckId: x.id, day: dep ? dep.day : dayOfStamp(d.startedAt), truck: truckLabel(x), truckNo: dep ? dep.truckNo : null, trailer: dep ? dep.trailer : (d.trailer || ''),
                seal: dep ? dep.seal : (q.seal || ''), ifs: verify.liveIfs(d.ifs).map(f => f.ifNum), pallets: sts.reduce((s, st) => s + cnt(allCounts, x.id, st), 0), pcs: pcsOf(allCounts, x.id, sts),
                status: x.status, stage: stageOf(x), startedBy: whoName(d.startedBy), startedAt: d.startedAt || '', markedBy: whoName(q.by), markedAt: q.at || (dep && dep.markedBy ? dep.at : ''),
                confirmedBy: dep ? whoName(dep.approvedBy) || dep.approvedByRoster || '' : '', confirmedAt: dep ? dep.at : '', receivedAt: d.recvApprovedAt || '',
                corrections: (d.corrections || []).map(corrText) };
        });
```

and add `history: history` to the returned object. `every` is already defined earlier in the action (`const mode = writeMode(c), pend = [], every = allTrucks();`). `markedAt` after confirmation: `ship_confirm`'s `toNeedsFix`/`departData` keep `shipReq` until departure? Check: `finishDepart` does not clear `shipReq`, so `q.at` is still there; the fallback covers older trucks. `confirmedBy`: `departData` stores `approvedBy: c.user` (an object) → `whoName`.

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(report): truck history with per-step who/when and correction lines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

