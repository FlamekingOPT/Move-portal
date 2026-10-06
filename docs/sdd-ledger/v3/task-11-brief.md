### Task 11: UI: Load out screen (trucks, scanning, departure)

**Files:**
- Modify: `move_portal/move_ui.js`
- Modify: `move_portal/test/ui.test.js`

**Interfaces:**
- Consumes the actions from Task 7.
- Produces:
  - Client tabs: `out = [['req','Request label'], ['trucks','Load out'], ['void','Void']]`, plus for managers `[['approve','Approvals'], ['queue','Print queue'], ['plan','Print plan'], ['sku','Print a SKU'], ['configs','SKU configs'], ['reprint','Reprint'], ['report','Report'], ['dash','Dashboard']]`.
  - State `S.truckId` replaces `S.loadId`.
- Reference markup: `docs/mockups/2026-10-01 move portal v3 verification mockup.html` (Load out panel). Keep the existing CSS classes: `card`, `flash f-*`, `pill p-*`, `btn pri|go|ghost|sm`, `inp`, `totals`, `plist`, `it`, `ac`.

- [ ] **Step 1: Write the failing UI test** (append to `ui.test.js`)

```js
test('v3 screens exist and old ones are gone', () => {
    const src = ui._clientMain.toString();
    ['SCREENS.trucks', "api('truck_scan'", "api('depart_confirm'", "api('truck_planned'"].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
    ['SCREENS.ship', 'SCREENS.load ', "api('scan_load'"].forEach(s => assert.equal(src.indexOf(s), -1, 'still has ' + s));
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL with `missing SCREENS.trucks`.

- [ ] **Step 3: Replace the Outbound load section in `move_ui.js`**:
  - Delete the whole `// ── Outbound: load` section: `SCREENS.load`, `loadList`, `ACT.newload`, `ACT.openload`, `ACT.backload`, `loadDetail`, `paintLoad`, `loadResultHtml`, `doLoadScan`, `findPallet`, `ACT.pedit`/`premove`/`movehere`/`loadready`, and any other `ACT` handler in that section.
  - Delete `SCREENS.ship`, `shipCard` and their `ACT` handlers.
  - Replace the `TABS` const with the tabs above.
  - In `ACT.tab`, set `S.truckId = null; S.unloadId = null;` instead of the old ids.
  - Update `PILL`:

```js
        const PILL = { loading: ['Loading', 'p-blue'], departing: ['Departing…', 'p-amber'], departed: ['In transit', 'p-blue'],
            receiving: ['Unloading', 'p-blue'], approving: ['Receiving…', 'p-amber'], received: ['Received', 'p-green'], waiting: ['⏳ Waiting for manager', 'p-amber'] };
```

Then add the Load out section:

```js
        // ── Outbound: load out (v3) ──────────────────────────────────────
        SCREENS.trucks = () => (S.truckId ? truckDetail() : truckList());
        function ifRow(f, pick) {
            return '<label class="it"><div>' + (pick ? '<input type="checkbox" data-if="' + esc(f.ifId) + '"> ' : '') + '<b>' + esc(f.ifNum) + '</b> · ' + esc(f.toNum) +
                ' · ' + esc(f.lines.map(l => l.sku + ' ' + num(l.qty)).join(', ')) + '</div><div class="muted">' + (f.estPallets ? '≈ ' + f.estPallets + ' pallets' : '') + '</div></label>';
        }
        async function truckList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('truck_planned');
            if (!r.ok) { main(errBox(r.error)); return; }
            main((r.open.length ? '<h3>Trucks loading</h3>' + r.open.map(t => '<div class="card bl" data-act="opentruck" data-id="' + t.id + '"><h4>' + esc(t.label) + ' ' +
                statusPill(t.pending ? 'waiting' : t.status) + '</h4><div class="muted">' + t.pallets + ' pallets</div></div>').join('') : '') +
                '<h3>Planned trucks · Picked/Packed IFs</h3><div class="card plist">' + (r.planned.map(f => ifRow(f, true)).join('') || '<div class="muted">No planned IFs. The office creates them in NetSuite.</div>') + '</div>' +
                '<div id="tmsg"></div><button class="btn pri" data-act="starttruck">Start truck with selected IFs</button>' +
                (r.pulledAt ? '<div class="muted sm">Data from ' + esc(r.pulledAt) + '</div>' : ''));
        }
        ACT.starttruck = async el => {
            if (needWho()) return;
            const ids = Array.from(document.querySelectorAll('[data-if]:checked')).map(x => x.dataset.if);
            if (!ids.length) { $('tmsg').innerHTML = errBox('Tick at least one IF'); return; }
            busy(el, true);
            const r = await api('truck_start', { ifIds: ids });
            busy(el, false);
            if (!r.ok) { $('tmsg').innerHTML = errBox(r.error); return; }
            S.truckId = r.view.truck.id;
            truckDetail(r);
        };
        ACT.opentruck = el => { S.truckId = el.dataset.id; truckDetail(); };
        ACT.backtruck = () => { S.truckId = null; truckList(); };
        async function truckDetail(pre) {
            const r = pre || await api('truck_get', { truckId: S.truckId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backtruck">← All trucks</button><div class="card bl"><h4 id="thead"></h4><div class="muted" id="tsub"></div></div>' +
                '<div id="tscan"></div><div id="scanres"></div><div class="card" id="tlines"></div><div class="card plist" id="plist"></div><div id="tfoot"></div>');
            paintTruck(r.view, true);
        }
        function paintTruck(v, first) {
            S.tv = v;
            const t = v.truck, open = t.status === 'loading' && !t.pending;
            $('thead').innerHTML = esc(t.label) + ' ' + statusPill(t.pending ? 'waiting' : t.status);
            $('tsub').textContent = t.depart ? [t.depart.carrier, 'Trailer ' + t.depart.trailer, 'Seal ' + t.depart.seal].join(' · ') : v.totals.pallets + ' pallets · ' + num(v.totals.pieces) + ' pcs';
            if (first) {
                $('tscan').innerHTML = open ? scanBox('scan') : '';
                if (open) wireScan('scan', doTruckScan);
            }
            $('tlines').innerHTML = '<table class="tbl"><tr><th>IF</th><th>SKU</th><th>Scanned / expected</th></tr>' +
                v.lines.map(l => '<tr class="' + (l.scanned === l.expected ? 'okrow' : l.scanned > l.expected ? 'warnrow' : '') + '"><td>' + esc(l.ifNum) + '</td><td>' + esc(l.sku) +
                    '</td><td><b>' + num(l.scanned) + '</b> / ' + num(l.expected) + (l.estPallets ? ' <span class="muted">(' + l.estPallets + ' plt)</span>' : '') + '</td></tr>').join('') +
                v.extras.map(x => '<tr class="warnrow"><td>add-on</td><td>' + esc(x.sku) + '</td><td><b>' + num(x.scanned) + '</b> extra</td></tr>').join('') + '</table>';
            $('plist').innerHTML = v.pallets.slice().reverse().map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + '</div>' +
                (open ? '<div class="ac"><button data-act="tremove" data-id="' + p.id + '">✕</button></div>' : '') + '</div>').join('') || '<div class="muted">No pallets yet</div>';
            $('tfoot').innerHTML = t.pending ? flash('amber', '⏳ Waiting for manager approval', esc('Trailer ' + t.pending.trailer + ' · Seal ' + t.pending.seal), 'Requested by ' + esc(t.pending.by), '<button data-act="dcancel">Cancel request, keep loading</button>')
                : open ? '<button class="btn ghost sm" data-act="tundo">↶ Undo last scan</button><div class="card"><h4>Departure</h4>' +
                    '<select class="inp" id="d_trailer"><option value="">Trailer #</option>' + v.trailers.map(x => '<option>' + esc(x) + '</option>').join('') + '<option value="__other">Other…</option></select>' +
                    '<input class="inp" id="d_trailer2" placeholder="Other trailer #" style="display:none"><input class="inp" id="d_seal" placeholder="Seal #">' +
                    '<input class="inp" id="d_carrier" value="' + esc(v.carrier) + '"><div id="dmsg"></div><button class="btn pri" data-act="dpreview">Review departure</button></div>'
                : t.depart ? flash('green', '🚚 ' + esc(t.label) + ' left', esc('Seal ' + t.depart.seal), t.bol && t.bol.changed ? '<b>Reprint BOL REV 2</b> · BOL # ' + esc(t.bol.number) + ' · IFs ' + esc(t.bol.ifNums.join(', ')) : 'BOL unchanged') : '';
            const sel = $('d_trailer');
            if (sel) sel.onchange = () => { $('d_trailer2').style.display = sel.value === '__other' ? '' : 'none'; };
        }
        function departBody() {
            const sel = $('d_trailer').value;
            return { truckId: S.truckId, trailer: sel === '__other' ? $('d_trailer2').value : sel, seal: $('d_seal').value, carrier: $('d_carrier').value };
        }
        function planHtml(p) {
            const line = o => o.op === 'if_qty' ? (o.to < o.from ? '⬇ Lower ' : '⬆ Raise ') + esc(o.ifNum + ' ' + o.sku + ' ' + num(o.from) + ' → ' + num(o.to))
                : o.op === 'if_create' ? '➕ Add-on IF from ' + esc(o.toNum + ': ' + o.skus.join(', ')) : '🔖 Stamp ' + esc(o.ifNum) + ' · Shipped';
            return '<div class="card"><h4>Plan</h4>' + p.ops.map(o => '<div>' + line(o) + '</div>').join('') +
                p.unplanned.map(u => '<div>↩ ' + esc(u.ifNum) + ' has nothing scanned: back to planned</div>').join('') +
                (p.bol.changed ? '<div><b>BOL REV 2</b> · BOL # ' + esc(p.bol.number) + ' · IFs ' + esc(p.bol.ifNums.join(', ')) + '</div>' : '') + '</div>';
        }
        ACT.dpreview = async el => {
            if (needWho()) return;
            busy(el, true);
            const r = await api('depart_preview', departBody());
            busy(el, false);
            if (!r.ok) { $('dmsg').innerHTML = errBox(r.error); return; }
            $('dmsg').innerHTML = flash(r.plan.needsManager ? 'amber' : 'green', 'Truck ' + r.truckNo + ' of the day', r.plan.needsManager ? r.plan.corrections + ' correction(s): a manager must approve' : 'Matches the IFs') +
                planHtml(r.plan) + '<button class="btn go" data-act="dconfirm">' + (r.plan.needsManager && !isMgr ? 'Send to manager' : 'Confirm departure') + '</button>';
        };
        ACT.dconfirm = async el => {
            busy(el, true);
            const r = await api('depart_confirm', departBody());
            busy(el, false);
            if (!r.ok) { tone('bad'); $('dmsg').innerHTML = errBox(r.error); return; }
            tone('ok');
            paintTruck(r.view, true);
        };
        ACT.dcancel = async () => { const r = await api('depart_cancel', { truckId: S.truckId }); if (r.ok) paintTruck(r.view, true); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tundo = async () => { const r = await api('truck_undo', { truckId: S.truckId }); if (r.ok) paintTruck(r.view, false); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tremove = async el => { const r = await api('truck_remove', { truckId: S.truckId, palletId: el.dataset.id }); if (r.ok) paintTruck(r.view, false); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tmovehere = async el => { const r = await api('truck_move_here', { truckId: S.truckId, palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('green', '✅ Moved here') : errBox(r.error); if (r.ok) paintTruck(r.view, false); };
        function truckResultHtml(r) {
            const p = r.pallet, line = p ? esc(p.code + ' · ' + p.summary) : '';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), esc(p.pieces + ' pcs · ' + p.code), r.view.totals.pallets + ' pallets on the truck');
                case 'over': return flash('amber', '🟡 Over the IF qty', line, 'The IF will be raised at departure (manager OK).');
                case 'addon': return flash('amber', '🟡 Add-on IF', line, 'Not on this truck\'s IFs. An add-on IF from ' + esc(r.addonTo ? r.addonTo.toNum : 'an office TO') + ' will be made (manager OK).');
                case 'no_to': return flash('red', '❌ No open TO for ' + esc(r.sku), line, 'Set it aside and call the office.');
                case 'dup': return flash('amber', '🟡 Already on this truck', line, 'No change.');
                case 'other_truck': return flash('amber', '🟡 On ' + esc(r.otherLabel), line, '', '<button data-act="tmovehere" data-id="' + p.id + '">Move here</button><button data-act="clearres">Leave it</button>');
                case 'locked': return flash('red', '❌ On ' + esc(r.otherLabel) + ', departing', line, 'Check with the supervisor.');
                case 'shipped': return flash('red', '❌ Already left', line, 'This pallet is on a truck that departed.');
                case 'void': return flash('red', '❌ Label cancelled', line, 'Request a new label.');
                default: return flash('red', '❌ Unknown label', esc('"' + String(r.raw).replace(/\t/g, ' ⇥ ') + '"'), 'Not a move label. Maybe a product barcode?');
            }
        }
        async function doTruckScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('truck_scan', { truckId: S.truckId, raw: v });
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            $('scanres').innerHTML = truckResultHtml(r);
            if (r.view) paintTruck(r.view, false);
        }
```

Add to the `CSS` string: `.tbl{width:100%;border-collapse:collapse}.tbl td,.tbl th{padding:6px;border-bottom:1px solid #e5e7eb;text-align:left}.okrow{background:#ecfdf5}.warnrow{background:#fffbeb}`.

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass, including the existing `new Function` parse test (it proves the client script still parses).

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(v3): Load out screen: planned IFs, scan vs expected, departure + BOL REV 2"
```

---

