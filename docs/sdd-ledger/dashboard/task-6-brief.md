### Task 6: UI: Dashboard screen and Report history with search / filter / sort

**Files:**
- Modify: `move_portal/move_ui.js`
- Test: `move_portal/test/ui.test.js`

**Interfaces:** consumes the Task 3 `dashboard` payload and Task 4 `report.history`. Produces `SCREENS.dash`, `paintLoads()`, `tableTools(...)`, `data-act="dashsort"`, `data-act="dashrow"`.

- [ ] **Step 1: Write the failing test**

```js
test('2026-10-06 pm: Dashboard shows waiting queues, truck tiles, Active loads with search/filter/sort; Report has the history table', () => {
    const src = ui._clientMain.toString();
    ['Waiting for approval', 'Nothing waiting for approval', 'Trucks shipped today', 'Trucks per day · 7-day avg', 'Trucks shipped · total', 'In transit', 'see Move Tracker', 'Active loads',
        'Trucks shipped per day', 'Flagged, waiting on manager', 'Search IF, TO, trailer, seal, Truck # or SKU', 'furthest along', 'oldest step', 'data-act="dashsort"', 'data-act="dashrow"', 'data-act="goapprove"',
        'r.waiting', 'r.tiles', 'r.rows', 'Truck history', 'r.history', 'function tableTools(']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ['Total pallets to move', 'Pallets remaining', 'Projected finish', 'Recent trucks', 'Remaining by SKU', 'r.bySku', 'm.projectedFinish'].forEach(t => assert.equal(src.indexOf(t), -1, 'still has ' + t));
    assert.ok(src.indexOf("barChart(r.days, r.tiles.plan") !== -1, 'chart counts trucks against the plan line');
    assert.equal(src.indexOf('Pallets moved per day'), -1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL.

- [ ] **Step 3: Implement** (`move_portal/move_ui.js`: replace `SCREENS.dash`, extend `SCREENS.report`)

```js
        // ── Dashboard (spec 2026-10-06 pm §3) ───────────────────────────
        const STAGES = ['Receipt pending', 'Waiting for manager', 'Ready to ship', 'Needs IF fix', 'Loading', 'In transit', 'Unloading', 'Received'];
        const SORTS = [['stage', 'Sort: furthest along'], ['newest', 'Sort: newest step'], ['oldest', 'Sort: oldest step (stuck first)'], ['if', 'Sort: IF'], ['trailer', 'Sort: trailer']];
        const COLS = [['ifNum', 'Fulfillment'], ['toNum', 'TO'], ['truck', 'Truck'], ['', 'SKUs on truck'], ['pcs', 'Pallets · pcs'], ['', 'Received'], ['stage', 'Status'], ['newest', 'Last step']];
        // Search box · status select · sort select · "n of m": shared by Active loads and the Report's truck history. Client-side only.
        function tableTools(prefix, st, n, m, sorts) {
            return '<div class="tools"><input class="inp" id="' + prefix + 'q" value="' + esc(st.q) + '" placeholder="Search IF, TO, trailer, seal, Truck # or SKU…">' +
                '<select class="inp" id="' + prefix + 'st"><option value="">All statuses</option>' + STAGES.map(s => '<option' + (st.st === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
                '<select class="inp" id="' + prefix + 'sort">' + sorts.map(s => '<option value="' + s[0] + '"' + (st.sort === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>').join('') + '</select>' +
                '<span class="muted">' + n + ' of ' + m + '</span></div>';
        }
        function wireTools(prefix, st, repaint) {
            const q = $(prefix + 'q'), s = $(prefix + 'st'), o = $(prefix + 'sort');
            if (q) q.oninput = () => { st.q = q.value; repaint(); };
            if (s) s.onchange = () => { st.st = s.value; repaint(); };
            if (o) o.onchange = () => { st.sort = o.value; st.dir = 1; repaint(); };
        }
        function rowText(x) { return [x.ifNum, x.toNum, x.truck, x.trailer, x.seal, x.truckNo ? 'Truck ' + x.truckNo : '', (x.skus || []).map(s => s.sku).join(' '), (x.ifs || []).join(' ')].join(' ').toLowerCase(); }
        function filterRows(rows, st) {
            const q = (st.q || '').trim().toLowerCase();
            return rows.filter(x => (!st.st || x.stage === st.st) && (!q || rowText(x).indexOf(q) !== -1));
        }
        function sortRows(rows, st) {
            const dir = st.dir || 1, k = st.sort || 'stage';
            const key = x => k === 'stage' ? STAGES.indexOf(x.stage) : k === 'newest' ? -(Date.parse(x.lastAt || x.confirmedAt || x.startedAt || 0) || 0) : k === 'oldest' ? (Date.parse(x.lastAt || 0) || 0)
                : k === 'if' || k === 'ifNum' ? Number(String(x.ifNum || (x.ifs || [])[0] || '').replace(/\D/g, '')) : k === 'trailer' ? String(x.trailer || '') : k === 'pcs' ? -Number(x.pcs || 0) : String(x[k] || '');
            return rows.slice().sort((p, q) => { const a = key(p), b = key(q); return (a < b ? -1 : a > b ? 1 : 0) * dir || Number(q.truckId) - Number(p.truckId); });
        }
        S.dashSt = { q: '', st: '', sort: 'stage', dir: 1 };
        S.histSt = { q: '', st: '', sort: 'newest', dir: 1 };
        function ago(min) { return min == null ? '' : min < 60 ? min + ' m ago' : Math.floor(min / 60) + ' h ' + (min % 60) + ' m ago'; }
        function loadsTable(rows) {
            const head = COLS.map(c => '<th' + (c[0] ? ' class="sortable" data-act="dashsort" data-k="' + c[0] + '"' : '') + '>' + esc(c[1]) + (c[0] && S.dashSt.sort === c[0] ? (S.dashSt.dir < 0 ? ' ↑' : ' ↓') : '') + '</th>').join('');
            return '<div style="overflow-x:auto"><table class="tbl"><tr>' + head + '</tr>' + (rows.map(x => '<tr data-act="dashrow" data-id="' + esc(x.truckId) + '" style="cursor:pointer">' +
                '<td><b>' + esc(x.ifNum) + '</b></td><td>' + esc(x.toNum || '') + '</td><td>' + esc(x.truck) + (x.truckNo && x.trailer ? ' · Trailer ' + esc(x.trailer) : '') + (x.seal ? ' · seal ' + esc(x.seal) : '') + '</td>' +
                '<td>' + (x.skus || []).map(s => esc(s.sku) + ' <span class="muted">×' + num(s.qty) + '</span>').join(', ') + '</td><td>' + num(x.pallets) + ' · ' + num(x.pcs) + '</td>' +
                '<td>' + (x.received == null ? '—' : num(x.received)) + (x.flagged ? ' <span class="warn">+' + x.flagged + ' flagged</span>' : '') + '</td><td>' + statusPill(x.status) + '</td>' +
                '<td class="muted' + (x.status === 'ship_pending' && x.lastMin >= LATE_MIN ? ' warn' : '') + '">' + esc((x.lastBy ? x.lastBy + ' ' : '') + String(x.lastKind || '').replace(/_/g, ' ')) + (x.lastMin == null ? '' : ' · ' + ago(x.lastMin)) + '</td></tr>').join('') ||
                '<tr><td colspan="8" class="muted">No active loads</td></tr>') + '</table></div>';
        }
        function paintLoads() {
            const r = S.dash;
            if (!r || !$('dashloads')) return;
            const rows = sortRows(filterRows(r.rows, S.dashSt), S.dashSt);
            $('dashloads').innerHTML = tableTools('dl', S.dashSt, rows.length, r.rows.length, SORTS) + loadsTable(rows) +
                '<div class="muted">Default sort is furthest along first; click a column header or use the Sort menu. Received trucks drop off at the end of their day; the Report keeps the full history.</div>';
            wireTools('dl', S.dashSt, paintLoads);
        }
        ACT.dashsort = el => { const k = el.dataset.k; if (S.dashSt.sort === k) S.dashSt.dir = -S.dashSt.dir; else { S.dashSt.sort = k; S.dashSt.dir = 1; } paintLoads(); };
        ACT.dashrow = el => ACT.opentruck(el);
        SCREENS.dash = async () => {
            main('<div class="muted">Loading…</div>');
            const r = await api('dashboard');
            if (S.tab !== 'dash') return;
            if (!r.ok) { main(errBox(r.error)); return; }
            S.dash = r;
            const k = (label, big, sub, cls) => '<div class="kpi ' + (cls || '') + '"><small>' + esc(label) + '</small><b>' + big + '</b><span>' + sub + '</span></div>';
            const w = r.waiting || [];
            const waiting = '<div class="card ' + (w.length ? 'amberc' : '') + '"><h4>Waiting for approval' + (w.length ? ' <span class="pill p-amber">' + w.reduce((s, x) => s + x.count, 0) + '</span>' : '') + '</h4>' +
                (w.length ? w.map(x => '<div class="warnrow" data-act="goapprove" data-v="ap_' + ({ ship: 'ship', fix: 'fix', trucks: 'trucks', flagged: 'flag', retry: 'retry', receipts: 'rec' })[x.queue] + '" style="cursor:pointer">' +
                    '<span><a href="#" class="linkbtn">' + esc(x.title) + '</a> <span class="muted">' + esc(x.first) + '</span></span><span class="pill ' + (x.late ? 'p-amber' : 'p-gray') + '">' + x.count + (x.late ? ' · over 30 min' : '') + '</span></div>').join('')
                    : '<div class="muted">Nothing waiting for approval</div>') + '</div>';
            const t = r.tiles;
            main(waiting + '<div class="grid4">' +
                k('Trucks shipped today', num(t.today), 'manager-confirmed · plan ' + t.plan + '/day', t.today >= t.plan ? 'good' : '') +
                k('Trucks per day · 7-day avg', t.avg7, 'move days Mon–Sat · all-time ' + t.avgAll) +
                k('Trucks shipped · total', num(t.total), num(t.received) + ' received at ' + esc(B.toName)) +
                k('In transit', num(t.inTransitTrucks) + ' truck' + (t.inTransitTrucks === 1 ? '' : 's'), num(t.inTransitPallets) + ' pallets · ' + t.missing + ' missing') +
                k('Finish date', '<span class="muted" style="font-size:14px">see Move Tracker</span>', 'truckloads to move live there') + '</div>' +
                '<div class="card"><h4>Active loads <span class="pill p-gray">' + new Set(r.rows.map(x => x.truckId)).size + ' trucks</span></h4><div class="muted">one row per IF, like the Move Tracker · not yet received · tap a row to open</div><div id="dashloads"></div></div>' +
                '<div class="grid3"><div class="card"><h4>Trucks shipped per day</h4>' + barChart(r.days, r.tiles.plan) + '</div>' +
                '<div class="card"><h4>Exceptions</h4>' + [['Missing pallets (in transit)', r.exc.missing], ['Flagged, waiting on manager', r.exc.neverLoaded], ['Damaged', r.exc.damaged], ['Edited at dock', r.exc.edited],
                    ['Labeled, never loaded (stale)', r.exc.stale], ['SKUs with stock but no config', r.exc.noConfig]].map(x => '<div class="warnrow"><span>' + esc(x[0]) + '</span><b>' + x[1] + '</b></div>').join('') + '</div></div>');
            paintLoads();
        };
```

Change `barChart`'s label text `' needed'` to `' plan'` and its aria-label to `Trucks shipped per day`. Add CSS: `.tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.tools .inp{flex:1 1 180px;margin:0;padding:9px;font-size:14px}.tools select.inp{flex:0 1 220px}.pill.p-gray{background:#eef2f7;color:#334155}th.sortable{cursor:pointer;color:var(--blue)}` (check `p-gray` isn't already defined).

Report: in `SCREENS.report`, keep the existing markup and append `'<div class="card"><h4>Truck history</h4><div id="hist"></div></div>'`, store `S.report = r`, then:

```js
        function histTable(rows) {
            const cols = ['Day', 'Truck', 'Trailer · seal', 'IFs', 'Pallets · pcs', 'Status', 'Started', 'Shipped', 'Confirmed', 'Received', 'Corrections'];
            return '<div style="overflow-x:auto"><table class="tbl"><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr>' + (rows.map(x => '<tr data-act="dashrow" data-id="' + esc(x.truckId) + '" style="cursor:pointer">' +
                '<td>' + esc(x.day) + '</td><td><b>' + esc(x.truck) + '</b></td><td>' + esc([x.trailer, x.seal].filter(Boolean).join(' · ')) + '</td><td>' + esc((x.ifs || []).join(', ')) + '</td><td>' + num(x.pallets) + ' · ' + num(x.pcs) + '</td>' +
                '<td>' + statusPill(x.status) + '</td><td class="muted">' + esc([x.startedBy, x.startedAt].filter(Boolean).join(' ')) + '</td><td class="muted">' + esc([x.markedBy, x.markedAt].filter(Boolean).join(' ')) + '</td>' +
                '<td class="muted">' + esc([x.confirmedBy, x.confirmedAt].filter(Boolean).join(' ')) + '</td><td class="muted">' + esc(x.receivedAt || '') + '</td><td class="muted">' + (x.corrections || []).map(esc).join('<br>') + '</td></tr>').join('') ||
                '<tr><td colspan="11" class="muted">No trucks yet</td></tr>') + '</table></div>';
        }
        function paintHist() {
            const r = S.report;
            if (!r || !$('hist')) return;
            const rows = sortRows(filterRows(r.history || [], S.histSt), S.histSt);
            $('hist').innerHTML = tableTools('hs', S.histSt, rows.length, (r.history || []).length, SORTS) + histTable(rows);
            wireTools('hs', S.histSt, paintHist);
        }
```

and call `paintHist()` after `main(...)` in `SCREENS.report`. `sortRows` must tolerate history rows: `lastAt` is absent there, hence the `x.confirmedAt || x.startedAt` fallback already in `key`.

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass. The `every data-act has an ACT handler` test covers `dashsort`, `dashrow`, `goapprove`.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(ui): Dashboard with waiting queues, truck tiles, Active loads (search/filter/sort), trucks-per-day chart; Report truck history

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

