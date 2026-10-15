### Task 10: Manager screens: Approve / Reject card, Retry / Release text, Labels (odd pallet, warn, Excel)

**Files:**
- Modify: `move_portal/move_ui.js` (`shipConfirmCard`, `paintApprove` retries, `labelSku`, `ACT.skuprint`, new `labelUpload`, `SCREENS.labels`)
- Test: `move_portal/test/ui.test.js`

**Interfaces:**
- Consumes: approvals `shipPending[i].scan/lines/lbs`, `retries[i].scan/toId` (Task 6); action `labels_preview` (Task 8); `printMany(specs, source, msgEl)` (existing).
- Produces: client `labelUpload(box)`, `readSheet(file) → Promise<rows>`, `ACT.xlsxpick`, `ACT.xlsxprint`, `ACT.xlsxtemplate`.

- [ ] **Step 1: Write the failing test**

Append to `move_portal/test/ui.test.js`:

```js
test('manager screens: plain Approve / Reject card, Excel label upload, odd pallet, over-stock warning', () => {
    const src = ui._clientMain.toString();
    ['✅ Approve', '↩ Reject', 'function labelUpload(', 'function readSheet(', 'xlsx/0.18.5/xlsx.full.min.js', "api('labels_preview'", 'Odd pallet', 'You can still print',
        'Download template', 'Close TO ', 'pcs per pallet', 'odd pallet pcs'].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL `missing ✅ Approve`.

- [ ] **Step 3: Implement**

`shipConfirmCard(x)`: at the top add the scan-truck card:

```js
            if (x.scan) {
                const id = esc(x.truck.id), lab = esc(x.truck.label);
                return '<div class="card bl"><h4>🚚 ' + lab + '</h4><div class="muted">' + esc(['Seal ' + x.seal, 'sent ' + (x.markedAt || '') + ' by ' + (x.markedBy || '?')].join(' · ')) + '</div>' +
                    '<div class="muted">' + esc(x.lines.map(l => l.sku + ' × ' + num(l.pcs)).join(' · ')) + ' · ' + num(x.pallets) + ' pallets' + (x.lbs != null ? ' · ' + num(x.lbs) + ' lb' : '') + '</div>' +
                    '<div class="row2"><button class="dbtn go" data-act="apconfirm" data-id="' + id + '" data-label="' + lab + '">✅ Approve</button>' +
                    '<button class="dbtn gh" data-act="apsendback" data-id="' + id + '" data-label="' + lab + '">↩ Reject</button></div>' +
                    '<div class="muted sm">Approve writes the TO + IF to NetSuite and marks it Shipped.</div></div>';
            }
```

(`ACT.apconfirm` and `ACT.apsendback` already call `ship_confirm` / `ship_sendback`. A blocked stock check comes back as `r.error` and shows in the existing error box. Read `ACT.apsendback` to confirm it prompts for the note, and change its prompt text to `'Reason for the floor (required)'`.)

In `paintApprove`'s retries, change the release button text to
`(t.scan ? (t.toId ? 'Release (after you Close TO ' + esc(t.toId) + ' in NetSuite)' : 'Release to the floor') : 'Release to Needs IF fix')`.

**Labels.** Change `SCREENS.labels` to add an upload section right after Print a SKU:
`sec('lb_sku', 'Print a SKU') + sec('lb_xlsx', 'Upload an Excel') + …` and call `labelUpload($('lb_xlsx'));`.

In `labelSku`, add an odd-pallet input and a warning box:

```js
            box.innerHTML = '<div id="sku_edbox"></div><label class="f" for="sku_odd">Odd pallet (optional) · pcs</label><input class="inp" id="sku_odd" type="number" min="0" placeholder="e.g. 18">' +
                '<div id="skuwarn"></div><div id="skumsg"></div><button class="btn pri" data-act="skuprint">Print labels</button>';
```

`ACT.skuprint`: before printing, call the preview and show a warning without blocking:

```js
            const odd = Math.floor(Number(($('sku_odd') || {}).value) || 0), l = edPayload()[0];
            const pv = await api('labels_preview', { rows: [{ sku: l.sku, pcs: l.pcs, pallets: n, odd: odd }] });
            if (pv.ok && pv.rows[0] && pv.rows[0].status === 'warn') $('skuwarn').innerHTML = flash('amber', '⚠ ' + esc(pv.rows[0].msg) + '. You can still print.');
            const specs = [{ lines: edPayload(), n: n }].concat(odd > 0 ? [{ lines: edPayload().map(x => Object.assign({}, x, { pcs: odd })), n: 1 }] : []);
            await printMany(specs, 'office', $('skumsg'));
```

(This replaces the existing `printMany([{ lines: edPayload(), n: n }], …)` call. For a multi-line pallet, the odd pallet takes `odd` pcs on each line.)

Add the Excel upload:

```js
        // Excel / CSV upload (spec 2026-10-14 §6): SheetJS on demand from cdnjs; headers matched loosely; preview; Print all through print_chunk.
        const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        function loadXlsx() {
            if (window.XLSX) return Promise.resolve(window.XLSX);
            return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = XLSX_URL; s.onload = () => ok(window.XLSX); s.onerror = () => bad(new Error('Could not load the Excel reader (no internet?). Save the sheet as .csv and upload that.')); document.head.appendChild(s); });
        }
        const HEAD = { sku: ['sku'], pcs: ['pcs per pallet', 'pcs/pallet', 'pcs'], pallets: ['pallets'], odd: ['odd pallet pcs', 'odd pallet', 'odd'] };
        function mapRows(objs) {
            if (!objs.length) return [];
            const keys = Object.keys(objs[0]), pick = names => keys.find(k => names.indexOf(String(k).trim().toLowerCase()) !== -1);
            const col = { sku: pick(HEAD.sku), pcs: pick(HEAD.pcs), pallets: pick(HEAD.pallets), odd: pick(HEAD.odd) };
            if (!col.sku || !col.pcs || !col.pallets) throw new Error('The sheet needs the columns SKU, Pcs per pallet and Pallets (Odd pallet pcs is optional)');
            return objs.map(o => ({ sku: o[col.sku], pcs: o[col.pcs], pallets: o[col.pallets], odd: col.odd ? o[col.odd] : '' }));
        }
        function csvObjs(text) {
            const lines = String(text).split(/\r?\n/).filter(l => l.trim() !== '');
            const head = lines.shift().split(',').map(s => s.trim());
            return lines.map(l => { const c = l.split(','); const o = {}; head.forEach((h, i) => { o[h] = (c[i] || '').trim(); }); return o; });
        }
        async function readSheet(file) {
            if (/\.csv$/i.test(file.name)) return mapRows(csvObjs(await file.text()));
            const X = await loadXlsx(), wb = X.read(await file.arrayBuffer(), { type: 'array' });
            return mapRows(X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
        }
        function labelUpload(box) {
            box.innerHTML = '<div class="muted">Columns: SKU · Pcs per pallet · Pallets · Odd pallet pcs (optional). One row per SKU (pcs per pallet, pallets, odd pallet pcs).</div>' +
                '<input type="file" id="xlsx_file" accept=".xlsx,.xls,.csv"> <button class="btn ghost sm" data-act="xlsxtemplate">Download template</button>' +
                '<div id="xlsx_out"></div>';
            $('xlsx_file').onchange = () => ACT.xlsxpick();
        }
        ACT.xlsxpick = async () => {
            const f = $('xlsx_file').files[0], out = $('xlsx_out');
            if (!f) return;
            let rows;
            try { rows = await readSheet(f); } catch (e) { out.innerHTML = errBox(e.message); return; }
            const pv = await api('labels_preview', { rows: rows });
            if (!pv.ok) { out.innerHTML = errBox(pv.error); return; }
            S.xlsx = pv;
            const pill = r => r.status === 'ok' ? '✅' : r.status === 'warn' ? '<span class="pill p-amber">⚠ ' + esc(r.msg) + '</span>' : '<span class="pill p-red">' + esc(r.msg) + ': skipped</span>';
            out.innerHTML = '<div class="muted"><b>' + esc(f.name) + '</b> · ' + pv.rows.length + ' rows read</div><table class="tbl"><tr><th>Row</th><th>SKU</th><th>Pcs/plt</th><th>Pallets</th><th>Odd</th><th>Pcs</th><th></th></tr>' +
                pv.rows.map(r => '<tr><td>' + r.n + '</td><td>' + esc(r.sku) + '</td><td>' + num(r.pcs) + '</td><td>' + num(r.pallets) + '</td><td>' + (r.odd ? num(r.odd) : '—') + '</td><td>' + num(r.total) + '</td><td>' + pill(r) + '</td></tr>').join('') + '</table>' +
                (pv.over ? errBox(pv.labels + ' labels: split the file (max ' + B.maxPrint + ' per print)') :
                    '<div class="muted">Warnings don\'t stop printing.</div><div id="xlsx_msg"></div><button class="btn pri" data-act="xlsxprint">🖨 Print all · ' + pv.labels + ' labels</button>');
        };
        ACT.xlsxprint = async el => {
            const pv = S.xlsx;
            if (!pv) return;
            const specs = [];
            pv.rows.filter(r => r.status !== 'skip').forEach(r => {
                const line = { item: r.item, sku: r.sku, cfg: r.cfg, pcs: r.pcs };
                if (r.pallets > 0) specs.push({ lines: [line], n: r.pallets });
                if (r.odd > 0) specs.push({ lines: [Object.assign({}, line, { pcs: r.odd })], n: 1 });
            });
            busy(el, true);
            await printMany(specs, 'office', $('xlsx_msg'));
            busy(el, false);
        };
        ACT.xlsxtemplate = async () => {
            try {
                const X = await loadXlsx(), ws = X.utils.aoa_to_sheet([['SKU', 'Pcs per pallet', 'Pallets', 'Odd pallet pcs']]), wb = X.utils.book_new();
                X.utils.book_append_sheet(wb, ws, 'Labels'); X.writeFile(wb, 'move-labels-template.xlsx');
            } catch (e) { alert(e.message); }
        };
```

`edPayload()` rows carry `sku` (from `newLine()`). Confirm that by reading `newLine` / `edPayload`; if they don't, read the SKU from `S.ed.lines[0].sku`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 321 tests (or 322).

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(ui): Approve/Reject card, Release after TO close, labels odd pallet + warning + Excel upload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

