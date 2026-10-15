### Task 8: Label rows from a sheet: preview with warnings (move_verify + `labels_preview`)

**Files:**
- Modify: `move_portal/move_verify.js` (new `labelRows`)
- Modify: `move_portal/sl_move_portal.js` (new action `labels_preview`)
- Test: `move_portal/test/verify.test.js`, `move_portal/test/portal.test.js`

**Interfaces:**
- Produces:
  - `verify.labelRows(rows, ctx) → { rows: [{ n, sku, item, pcs, pallets, odd, total, labels, status: 'ok'|'warn'|'skip', msg, cfg }], labels, over }`. Input `rows` = `[{ sku, pcs, pallets, odd }]` (raw cell values). `ctx` = `{ skuMap: { SKU_UPPER: item }, items: { item: { sku } }, avail: { item: n }, labeled: { item: pcs }, cfg: { item: code }, maxPrint }`.
  - Action `labels_preview` (manager): `{ rows }` in, `verify.labelRows` result out. It also serves the single-SKU form's warning.

- [ ] **Step 1: Write the failing tests**

Append to `move_portal/test/verify.test.js`:

```js
test('labelRows: ok / warn on a running total / skip, labels with odd pallets, cap', () => {
    const ctx = { skuMap: { YSN201: '11', YSN401: '13', '201': '20' }, items: { '11': { sku: 'YSN201' }, '13': { sku: 'YSN401' }, '20': { sku: '201' } },
        avail: { '11': 720, '13': 2000, '20': 5 }, labeled: { '11': 288 }, cfg: { '11': 'A' }, maxPrint: 250 };
    const r = verify.labelRows([
        { sku: ' ysn401 ', pcs: '36', pallets: '20', odd: '' },
        { sku: 'YSN201', pcs: 72, pallets: 4, odd: 18 },            // 306 of 432 left
        { sku: 'YSN201', pcs: 72, pallets: 2, odd: '' },            // running 450 > 432 → warn
        { sku: 'NOPE', pcs: 10, pallets: 1 },
        { sku: 'YSN401', pcs: 36, pallets: 0 },
        { sku: '', pcs: '', pallets: '' },
        { sku: 201, pcs: 5, pallets: 1 }
    ], ctx);
    assert.deepEqual(r.rows.map(x => [x.n, x.status, x.labels]), [[2, 'ok', 20], [3, 'ok', 5], [4, 'warn', 2], [5, 'skip', 0], [6, 'skip', 0], [8, 'ok', 1]]);
    assert.equal(r.rows[2].msg, 'YSN201: 450 pcs labeled after this, Riverside shows 432 unlabeled');
    assert.equal(r.rows[3].msg, 'Unknown SKU NOPE');
    assert.equal(r.rows[4].msg, 'Pallets must be 1 or more');
    assert.deepEqual([r.rows[1].total, r.rows[1].cfg, r.labels, r.over], [306, 'A', 28, false]);
    assert.equal(verify.labelRows([{ sku: 'YSN401', pcs: 1, pallets: 251 }], ctx).over, true);
});
```

Row numbers `n` are sheet rows: header = row 1, so the first data row is `n: 2`. A fully blank row (row 7 here) is dropped without a message.

Append to `move_portal/test/portal.test.js`:

```js
test('labels_preview checks rows against NetSuite stock and is managers only', () => {
    const ctx = setup();
    printLabels(ctx, 2);                                   // 240 YSN201 labeled already; avail 1000
    const r = ctx.run('labels_preview', { rows: [{ sku: 'YSN201', pcs: 120, pallets: 7, odd: 0 }] });
    assert.deepEqual([r.rows[0].status, r.rows[0].total, r.labels], ['warn', 840, 7]);
    assert.throws(() => ctx.run('labels_preview', { rows: [] }, false), /Managers only/);
    assert.throws(() => ctx.run('labels_preview', { rows: new Array(501).fill({ sku: 'YSN201', pcs: 1, pallets: 1 }) }), /500 rows/);
});
```

(1000 − 240 = 760 unlabeled; 7 × 120 = 840 → warn.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/verify.test.js" "move_portal/test/portal.test.js"`
Expected: FAIL. `verify.labelRows is not a function`, and `Unknown action: labels_preview`.

- [ ] **Step 3: Implement**

`move_portal/move_verify.js`:

```js
    // Excel / single-SKU label preview (spec 2026-10-14 §6). Warnings never block; only an unmatched row is skipped.
    function labelRows(rows, ctx) {
        const out = [], used = {};
        let labels = 0;
        const int = v => { const s = String(v == null ? '' : v).trim(); return s === '' ? 0 : Math.floor(Number(s)); };
        (rows || []).forEach((r, i) => {
            const n = i + 2, raw = String(r.sku == null ? '' : r.sku).trim();
            const pcs = int(r.pcs), pallets = int(r.pallets), odd = int(r.odd);
            if (!raw && !pcs && !pallets && !odd) return;                                    // a blank sheet row
            const item = (ctx.skuMap || {})[raw.toUpperCase()] || '', sku = item && ctx.items[item] ? ctx.items[item].sku : raw;
            const row = { n: n, sku: sku, item: item, pcs: pcs, pallets: pallets, odd: odd > 0 ? odd : 0, total: 0, labels: 0, status: 'ok', msg: '', cfg: (ctx.cfg || {})[item] || '' };
            if (!item) { row.status = 'skip'; row.msg = 'Unknown SKU ' + (raw || '(blank)'); out.push(row); return; }
            if (!(pcs >= 1)) { row.status = 'skip'; row.msg = 'Pcs per pallet must be 1 or more'; out.push(row); return; }
            if (!(pallets >= 1) && !(odd >= 1)) { row.status = 'skip'; row.msg = 'Pallets must be 1 or more'; out.push(row); return; }
            row.labels = Math.max(0, pallets) + (row.odd ? 1 : 0);
            row.total = Math.max(0, pallets) * pcs + row.odd;
            used[item] = (used[item] || 0) + row.total;
            const left = (Number((ctx.avail || {})[item]) || 0) - (Number((ctx.labeled || {})[item]) || 0);
            if (used[item] > left) { row.status = 'warn'; row.msg = sku + ': ' + fmt(used[item]) + ' pcs labeled after this, Riverside shows ' + fmt(Math.max(0, left)) + ' unlabeled'; }
            labels += row.labels;
            out.push(row);
        });
        return { rows: out, labels: labels, over: labels > (Number(ctx.maxPrint) || 250) };
    }
```

Export `labelRows`. Check that the module's `fmt` formats 450 as `'450'` and 1,000 as `'1,000'`; the test messages use values under 1,000.

`move_portal/sl_move_portal.js`, after the `print_chunk` action:

```js
    // Spec 2026-10-14 §6: one preview for the Excel upload and the single-SKU form. Nothing is created here (Print uses print_chunk).
    act('labels_preview', true, (a, c) => {
        const rows = Array.isArray(a.rows) ? a.rows : [];
        if (rows.length > 500) throw userErr('Too many rows (500 rows max per file)');
        const skuMap = data.skuMap(), items = [...new Set(rows.map(r => skuMap[String(r.sku == null ? '' : r.sku).trim().toUpperCase()]).filter(Boolean))];
        const info = data.itemInfo(items), st = items.length ? data.locationStock(c.S.locFrom, items) : {}, avail = {}, cfg = {};
        const cs = data.configsByItem(c.S.activeBatch);
        items.forEach(k => { avail[k] = st[k] ? Number(st[k].avail) || 0 : 0; const d = (cs[k] || []).find(x => x.isDefault) || (cs[k] || [])[0]; if (d) cfg[k] = d.code; });
        return verify.labelRows(rows, { skuMap: skuMap, items: info, avail: avail, labeled: data.labeledPiecesByItem(), cfg: cfg, maxPrint: Number(c.S.maxPrint) || 250 });
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 319 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/sl_move_portal.js move_portal/test/verify.test.js move_portal/test/portal.test.js
git commit -m "feat(labels): labels_preview with running over-stock warnings, skips and the print cap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

