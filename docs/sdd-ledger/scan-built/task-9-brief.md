### Task 9: Floor screens for scan-built trucks (move_ui)

**Files:**
- Modify: `move_portal/move_ui.js` (`truckList`, `ACT.starttruck`, `paintTruck`, `stageHtml`, `shipCard`, new `scanTable`)
- Test: `move_portal/test/ui.test.js`

**Interfaces:**
- Consumes: boot `B.officeIfs`; `truck_planned.officeIfs`; `truckView.scan` (Task 5).
- Produces: client functions `scanTable(sc, opt)`, and actions `ACT.finishload` (→ Verify) and `ACT.goship` (existing).

- [ ] **Step 1: Write the failing test**

Append to `move_portal/test/ui.test.js`:

```js
test('scan-built floor screens: no IF list when office IFs are off, Finish loading, weight on Verify, Finish → Shipments', () => {
    const src = ui._clientMain.toString();
    ['function scanTable(', 'ACT.finishload', 'Finish loading', 'Finish → Shipments', 'r.officeIfs', 'Start Trailer', 'pallets × ', 'without weight', 'Approve will be blocked']
        .forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL `missing function scanTable(`.

- [ ] **Step 3: Implement**

In `move_portal/move_ui.js`, add next to `ifRow`:

```js
        // Scan-built truck (spec 2026-10-14): SKU rows with pallets, pcs, weight and Riverside available.
        function scanTable(sc, opt) {
            opt = opt || {};
            const lb = n => n == null ? '<span class="muted">no weight</span>' : num(n) + ' lb';
            return '<table class="tbl"><tr><th>SKU</th><th>Pallets</th><th>Pcs</th>' + (opt.weight ? '<th>Weight</th>' : '') + (opt.avail ? '<th>Riverside avail.</th>' : '') + '</tr>' +
                sc.rows.map(r => '<tr class="' + (r.short && opt.avail ? 'warnrow' : '') + '"><td>' + esc(r.sku) + '</td><td>' + num(r.pallets) + '</td><td>' + num(r.pcs) + '</td>' +
                    (opt.weight ? '<td>' + lb(r.lbs) + '</td>' : '') + (opt.avail ? '<td>' + num(r.avail) + (r.short ? ' ⚠' : '') + '</td>' : '') + '</tr>').join('') +
                (opt.weight ? '<tr><td class="muted">Pallets (tare)</td><td class="muted">' + num(sc.pallets) + ' pallets × ' + num(sc.pallets ? sc.tare / sc.pallets : 0) + '</td><td></td><td class="muted">' + num(sc.tare) + ' lb</td>' + (opt.avail ? '<td></td>' : '') + '</tr>' +
                    '<tr><td><b>Total</b></td><td><b>' + num(sc.pallets) + '</b></td><td><b>' + num(sc.pcs) + '</b></td><td><b>' + num(sc.total) + ' lb</b>' +
                    (sc.noWeight ? ' <span class="muted">+ ' + sc.noWeight + ' SKU' + (sc.noWeight > 1 ? 's' : '') + ' without weight</span>' : '') + '</td>' + (opt.avail ? '<td></td>' : '') + '</tr>' : '') +
                '</table>' + (opt.avail && sc.short ? flash('amber', '⚠ More than Riverside has available', 'Approve will be blocked: take pallets off or call the office') : '');
        }
```

In `truckList`, replace the planned-IF section and button so that when `r.officeIfs` is false only the trailer picker shows:

```js
                (r.officeIfs ? '<h3>Planned trucks · Picked/Packed IFs</h3><div class="card plist">' + (r.planned.map(f => ifRow(f, true)).join('') || '<div class="muted">No planned IFs. The office creates them in NetSuite.</div>') + '</div>' : '<h3>Start a truck</h3>') +
                trailerHtml(r.trailers) + '<div id="tmsg"></div><button class="btn pri" data-act="starttruck">' + (r.officeIfs ? 'Start truck with selected IFs' : 'Start Trailer') + '</button>' +
```

In `ACT.starttruck`, change the IF check to `if (B.officeIfs && !ids.length) { … }`, and send `ifIds: ids` as before (the server ignores it when office IFs are off).

In `paintTruck`, replace the `$('tlines').innerHTML = …` assignment with:

```js
            $('tlines').innerHTML = v.scan ? (v.scan.rows.length ? scanTable(v.scan) : '<div class="muted">Scan pallets to load them</div>') :
                '<table class="tbl"><tr><th>IF</th><th>SKU</th><th>Scanned / expected</th></tr>' +
```

and keep the existing office-IF table expression after it.

In `stageHtml`, add at the top (after `const err = …`):

```js
            if (v.scan && st === 'loading') return err + '<button class="btn pri" data-act="finishload">Finish loading</button>' + undo;
            if (v.scan && st === 'ready') return err + '<div class="card greenc"><h4>Verify load</h4>' + when + scanTable(v.scan, { weight: true, avail: true }) +
                '<div class="muted">Check this against the trailer. Scanning or taking a pallet off sends it back to loading.</div>' +
                '<button class="btn go" data-act="goship">Finish → Shipments</button></div>' + undo;
```

Add the action (next to `ACT.goship`):

```js
        ACT.finishload = async el => { if (needWho()) return; busy(el, true); const r = await api('truck_verify', { truckId: S.truckId }); busy(el, false);
            if (!r.ok) { $('scanres').innerHTML = errBox(r.error); return; } paintTruck(r.view, false); };
```

A scan or take-off on a ready truck must send it back to `loading`. Check in `truck_scan` / `takeOff` / `truck_remove` (`touched`) that a pallet change already resets READY to LOADING. If not, add `status: T.LOADING` to the `touched` update for open trucks. Read `touched` first (sl ~229). If you change it, add a portal test: "scan-built: a scan after Verify sends the truck back to loading".

In `shipCard`, when `v.scan`, replace the IFs line with the weight:

```js
                '<div class="muted">' + esc('Trailer ' + (v.trailer || '')) + (v.scan ? ' · ' + num(v.scan.total) + ' lb' : ' · IFs ' + esc(ifs.join(', '))) + '</div>' +
```

and change the button text to `'🚚 Mark shipped · send for approval'` when `v.scan`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 320 tests (321 with the optional `touched` test).

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/sl_move_portal.js move_portal/test/ui.test.js move_portal/test/portal.test.js
git commit -m "feat(ui): floor screens for scan-built trucks: trailer-only start, Finish loading, Verify with weight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

