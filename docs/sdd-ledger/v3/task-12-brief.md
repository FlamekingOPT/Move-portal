### Task 12: UI: Unload, Approvals, Report screens; dashboard trucks

**Files:**
- Modify: `move_portal/move_ui.js`
- Modify: `move_portal/test/ui.test.js`

**Interfaces:**
- Consumes the actions from Tasks 8–10.
- Produces: `in = [['unload','Unload']]`, plus for managers `[['approve','Approvals'], ['report','Report'], ['dash','Dashboard']]`, with state `S.unloadId`.

- [ ] **Step 1: Extend the UI test**

```js
test('v3 inbound/approval/report screens exist', () => {
    const src = ui._clientMain.toString();
    ['SCREENS.unload', 'SCREENS.approve', 'SCREENS.report', "api('unload_scan'", "api('receipt_approve'", "api('report'"].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
    ['SCREENS.recv ', 'SCREENS.toreceive', "api('scan_recv'", 'SCREENS.catchup'].forEach(s => assert.equal(src.indexOf(s), -1, 'still has ' + s));
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL with `missing SCREENS.unload`.

- [ ] **Step 3: Replace the inbound section.** Delete `SCREENS.recv`, `recvList`, `recvDetail`, `paintRecv`, `recvResultHtml`, `doRecvScan`, `SCREENS.toreceive` and `SCREENS.catchup`, with their `ACT` handlers. Update the `in` tabs. `refocusScan` already checks `$('rscan')`. Then add:

```js
        // ── Inbound: unload (v3) ─────────────────────────────────────────
        SCREENS.unload = () => (S.unloadId ? unloadDetail() : unloadList());
        async function unloadList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('unload_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main(r.trucks.map(t => '<div class="card bl" data-act="openunload" data-id="' + t.id + '"><h4>' + esc(t.label) + ' ' + statusPill(t.status) + '</h4><div class="muted">' +
                esc(t.depart ? 'Seal ' + t.depart.seal + ' · Trailer ' + t.depart.trailer : '') + ' · ' + t.received + ' of ' + t.pallets + ' in' + (t.missing ? ' · ' + t.missing + ' missing' : '') + '</div></div>').join('') ||
                '<div class="muted">No trucks in transit</div>');
        }
        ACT.openunload = el => { S.unloadId = el.dataset.id; unloadDetail(); };
        ACT.backunload = () => { S.unloadId = null; unloadList(); };
        async function unloadDetail() {
            const r = await api('unload_get', { truckId: S.unloadId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backunload">← All trucks</button><div class="card bl"><h4 id="uhead"></h4><div class="muted" id="usub"></div></div>' +
                scanBox('rscan') + '<div id="scanres"></div><div class="card" id="uifs"></div><div class="card plist" id="uexp"></div><div id="ufoot"></div>');
            wireScan('rscan', doUnloadScan);
            paintUnload(r.view);
        }
        function paintUnload(v) {
            const t = v.truck;
            $('uhead').innerHTML = esc(t.label) + ' ' + statusPill(t.status);
            $('usub').textContent = (t.depart ? 'Seal ' + t.depart.seal + ' · Trailer ' + t.depart.trailer + ' · ' : '') + v.counts.in + ' of ' + v.counts.of + ' pallets in';
            $('uifs').innerHTML = '<table class="tbl"><tr><th>IF</th><th>Received / shipped</th></tr>' + v.perIf.map(f => '<tr class="' + (f.short ? '' : 'okrow') + '"><td>' + esc(f.ifNum) +
                '</td><td><b>' + num(f.received) + '</b> / ' + num(f.shipped) + '</td></tr>').join('') + '</table>' +
                (v.flagged.length ? flash('amber', '🟠 ' + v.flagged.length + ' never-loaded pallet(s) flagged', esc(v.flagged.map(p => p.code).join(', ')), 'The office will sort these out.') : '');
            $('uexp').innerHTML = '<h4>Still expected</h4>' + (v.expected.map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + '</div></div>').join('') || '<div class="muted">All in ✅</div>');
            $('ufoot').innerHTML = '<button class="btn ghost sm" data-act="uundo">↶ Undo last scan</button>' + (S.lastIn ? '<button class="btn ghost sm" data-act="udamaged" data-id="' + S.lastIn + '">Mark last pallet damaged</button>' : '') +
                '<button class="btn go" data-act="udone">Unloading done: send to manager</button>';
        }
        function unloadResultHtml(r) {
            const p = r.pallet, line = p ? esc(p.code + ' · ' + p.summary) : '';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), line, r.view.counts.in + ' of ' + r.view.counts.of + ' in');
                case 'late': return flash('green', '✅ Late arrival', line, 'It goes on a second receipt for this IF (manager OK).');
                case 'dup': return flash('amber', '🟡 Already scanned in', line, 'No change.');
                case 'dup_other': return flash('amber', '🟡 Already received on ' + esc(r.otherLabel), line, '');
                case 'other_truck': return flash('amber', '🟡 Belongs to ' + esc(r.otherLabel), line, '', '<button data-act="uother" data-id="' + p.id + '">Receive it there</button><button data-act="clearres">Set aside</button>');
                case 'never_loaded': return flash('amber', '🟠 Never loaded on a truck', line, 'Flagged for the office. Set it aside.');
                case 'locked': return flash('red', '❌ Its truck is still departing', line, 'Wait a minute and scan again.');
                case 'void': return flash('red', '❌ Label cancelled', line, 'Set aside and call the supervisor.');
                default: return flash('red', '❌ Unknown label', esc('"' + String(r.raw).replace(/\t/g, ' ⇥ ') + '"'), '');
            }
        }
        async function doUnloadScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('unload_scan', { truckId: S.unloadId, raw: v });
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            if (r.result === 'ok' || r.result === 'late') S.lastIn = r.pallet.id;
            $('scanres').innerHTML = unloadResultHtml(r);
            if (r.view) paintUnload(r.view);
        }
        ACT.uother = async el => { const r = await api('unload_other', { palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('green', '✅ Received on its own truck') : errBox(r.error); };
        ACT.udamaged = async el => { const r = await api('unload_damaged', { palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('amber', 'Marked damaged') : errBox(r.error); };
        ACT.uundo = async () => { const r = await api('unload_undo', { truckId: S.unloadId }); if (r.ok) paintUnload(r.view); else $('scanres').innerHTML = errBox(r.error); };
        ACT.udone = async () => { const r = await api('unload_done', { truckId: S.unloadId }); $('scanres').innerHTML = r.ok ? flash('green', 'Sent to the manager for receipt approval') : errBox(r.error); };

        // ── Manager: approvals (v3) ──────────────────────────────────────
        SCREENS.approve = async (msg) => {
            main((msg || '') + '<div class="muted">Loading…</div>');
            const r = await api('approvals');
            if (!r.ok) { main(errBox(r.error)); return; }
            const dep = r.departures.map(d => '<div class="card"><h4>🚚 ' + esc(d.truck.label) + ' · departure</h4><div class="muted">' + esc('Trailer ' + d.pending.trailer + ' · Seal ' + d.pending.seal + ' · by ' + d.pending.by) + '</div>' +
                (d.plan ? planHtml(d.plan) + '<button class="btn go" data-act="apdepart" data-id="' + d.truck.id + '">Approve departure</button>' : errBox(d.error)) + '</div>').join('');
            const ret = r.retries.map(t => '<div class="card"><h4>⚠ ' + esc(t.label) + '</h4>' + errBox(t.error) + '<button class="btn pri" data-act="apretry" data-id="' + t.id + '">Retry</button></div>').join('');
            const rec = r.receipts.map(x => '<div class="card"><h4>📥 ' + esc(x.truck.label) + (x.lateOnly ? ' · late arrivals' : ' · receipt') + '</h4><table class="tbl"><tr><th>IF</th><th>Received / shipped</th></tr>' +
                x.perIf.map(f => '<tr class="' + (f.short ? 'warnrow' : 'okrow') + '"><td>' + esc(f.ifNum) + '</td><td>' + num(f.received) + ' / ' + num(f.shipped) + '</td></tr>').join('') + '</table>' +
                (x.missing.length ? '<div class="muted">Missing: ' + esc(x.missing.join(', ')) + '</div>' : '') +
                '<button class="btn go" data-act="aprecv" data-id="' + x.truck.id + '">' + (x.missing.length ? 'Approve short receipt' : 'Approve receipt') + '</button></div>').join('');
            main((msg || '') + (dep + ret + rec || '<div class="muted">Nothing waiting for approval</div>'));
        };
        ACT.apdepart = async el => { busy(el, true); const r = await api('depart_confirm', { truckId: el.dataset.id }); tone(r.ok ? 'ok' : 'bad'); SCREENS.approve(r.ok ? flash('green', '✅ Departed') : errBox(r.error)); };
        ACT.apretry = async el => { busy(el, true); const r = await api('depart_retry', { truckId: el.dataset.id }); tone(r.ok ? 'ok' : 'bad'); SCREENS.approve(r.ok ? flash('green', '✅ Departed') : errBox(r.error)); };
        ACT.aprecv = async el => {
            busy(el, true);
            const r = await api('receipt_approve', { truckId: el.dataset.id });
            tone(r.ok ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? flash('green', '✅ Receipt approved', r.written.length ? r.written.length + ' written to NetSuite' : 'Plan saved (no NetSuite write in this mode)', r.missing.length ? r.missing.length + ' pallets stay in transit' : '') : errBox(r.error));
        };

        // ── Manager: shadow report (v3) ──────────────────────────────────
        SCREENS.report = async () => {
            main('<div class="muted">Loading…</div>');
            const r = await api('report');
            if (!r.ok) { main(errBox(r.error)); return; }
            const mark = ok => (ok === true ? '✅' : ok === false ? '❌' : '⏳');
            main('<div class="muted">Write mode <b>' + esc(r.writeMode) + '</b>' + (r.pulledAt ? ' · NetSuite data from ' + esc(r.pulledAt) : '') + '</div>' +
                '<div class="card"><table class="tbl"><tr><th>Day</th><th>Trucks</th><th>Pallets</th><th>Pcs</th><th>Diffs</th></tr>' +
                r.days.map(d => '<tr><td>' + esc(d.day) + '</td><td>' + d.trucks + '</td><td>' + d.pallets + '</td><td>' + num(d.pieces) + '</td><td>' + (d.diffs ? '❌ ' + d.diffs : '✅') + '</td></tr>').join('') + '</table></div>' +
                '<div class="card"><table class="tbl"><tr><th></th><th>Truck</th><th>IF</th><th>Check</th><th>Portal</th><th>NetSuite</th></tr>' +
                r.rows.map(x => '<tr class="' + (x.ok === false ? 'warnrow' : '') + '"><td>' + mark(x.ok) + '</td><td>' + esc(x.truck) + '</td><td>' + esc(x.ifNum) + '</td><td>' + esc(x.check) +
                    '</td><td>' + esc(x.portal) + '</td><td>' + esc(x.netsuite) + '</td></tr>').join('') + '</table></div>');
        };
```

In `SCREENS.dash`, replace the loads list (Grep `r.loads` in `SCREENS.dash`) with `r.trucks.map(t => ... esc(t.label) + statusPill(t.status) + t.pallets + ' pallets' ...)`. Replace the exceptions entries `arrivedUnshipped` / `catchups7` with `neverLoaded` ("Never loaded").

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass.

Run: `grep -n "loadId\|recvId\|load_\|recv_\|catchup" move_portal/move_ui.js`
Expected: no hits.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(v3): Unload, Approvals and Report screens; dashboard shows trucks"
```

---

