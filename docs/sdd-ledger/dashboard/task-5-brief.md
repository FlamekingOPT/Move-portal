### Task 5: UI: tab order and default, Labels order, Approvals flagged card and receipt rows, floor wording

**Files:**
- Modify: `move_portal/move_ui.js`
- Test: `move_portal/test/ui.test.js`

**Interfaces:** consumes `approvals.flagged`, receipt entries' `flagged / pending / decided / canApprove / blockReason`, actions `pallet_accept` / `pallet_reject`, `unloadView.decided`. Produces `data-act` handlers `apaccept`, `apreject`, section anchors `ap_ship · ap_fix · ap_trucks · ap_flag · ap_retry · ap_rec`, and `ACT.goapprove` (used by Task 6).

- [ ] **Step 1: Update and add UI tests** (`move_portal/test/ui.test.js`)

In the test `manager rework: default Approvals, late badge, ...` change `"mgr: 'approve'"` to `"mgr: 'dash'"`. Append:

```js
test('2026-10-06 pm: Dashboard first and default; Labels start with Print a SKU', () => {
    const src = ui._clientMain.toString();
    assert.ok(src.indexOf("mgr: [['dash', 'Dashboard'], ['approve', 'Approvals'], ['labels', 'Labels'], ['report', 'Report']]") !== -1, 'tab order');
    assert.ok(src.indexOf("mgr: 'dash'") !== -1, 'default tab');
    assert.ok(src.indexOf("main(sec('lb_sku', 'Print a SKU') + sec('lb_queue', 'Label requests') + sec('lb_plan', 'Print plan') + sec('lb_reprint', 'Reprint') + sec('lb_configs', 'SKU configs'))") !== -1, 'labels order');
});

test('2026-10-06 pm: flagged pallets card and receipt rows with Accept / Reject; Approve waits; anchors for the dashboard links', () => {
    const src = ui._clientMain.toString();
    ['Flagged pallets', 'data-act="apaccept"', 'data-act="apreject"', "api('pallet_accept'", "api('pallet_reject'", 'Accept onto this truck', 'x.blockReason', 'x.canApprove', 'r.flagged', 'x.pending', 'x.decided',
        'id="ap_ship"', 'id="ap_fix"', 'id="ap_trucks"', 'id="ap_flag"', 'id="ap_retry"', 'id="ap_rec"', 'ACT.goapprove =', 'decide now, or later on the receipt card', 'waiting for the manager', 'v.decided']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    assert.equal(src.indexOf('The office will sort these out.'), -1);
    ['apaccept', 'apreject'].forEach(n => {
        const i = src.indexOf('ACT.' + n + ' =');
        assert.ok(i !== -1 && src.slice(i, i + 600).indexOf(n === 'apaccept' ? 'confirm(' : 'prompt(') !== -1, 'no dialog in ' + n);
    });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: the two new tests FAIL; the edited one FAILS (`mgr: 'dash'` missing).

- [ ] **Step 3: Implement** (`move_portal/move_ui.js`)

1. `TABS.mgr` → `[['dash', 'Dashboard'], ['approve', 'Approvals'], ['labels', 'Labels'], ['report', 'Report']]`; `DEF_TAB.mgr` → `'dash'`.
2. `SCREENS.labels`: `main(sec('lb_sku', 'Print a SKU') + sec('lb_queue', 'Label requests') + sec('lb_plan', 'Print plan') + sec('lb_reprint', 'Reprint') + sec('lb_configs', 'SKU configs'));` (the `labelX($('..'))` calls below it stay).
3. Floor unload (`paintUnload`): replace the flagged flash with

```js
                (v.flagged.length ? flash('amber', '🟠 ' + v.flagged.length + ' never-loaded pallet(s) · waiting for the manager', esc(v.flagged.map(p => p.code).join(', ')), 'A manager accepts or rejects them in Approvals.') : '') +
                ((v.decided || []).length ? '<div class="diffs">' + v.decided.map(d => '<div>' + esc(d.text) + ' · ' + esc(d.by) + '</div>').join('') + '</div>' : '');
```

and in `unloadResultHtml` the `never_loaded` case: `flash('amber', '🟠 Never loaded on a truck', line, 'Flagged for the manager. Set it aside.')`.

4. Approvals. Add, after `shipConfirmCard`:

```js
        // One row per undecided never-loaded pallet (spec 2026-10-06 pm §2): Accept onto the truck it was scanned on, or Reject with a note.
        function flagRow(f) {
            return '<div class="drow"><span><b>' + esc(f.code) + '</b> · ' + esc(f.sku) + ' · ' + num(f.pcs) + ' pcs <span class="pill p-violet">' + esc(f.truckLabel) + '</span>' +
                '<div class="muted">never loaded on any truck · scanned by ' + esc(f.by || '?') + (f.at ? ' · ' + esc(f.at) : '') + (f.truckStatus === 'receiving' || f.truckStatus === 'departed' ? ' · truck still unloading' : '') + '</div></span>' +
                '<span class="row2" style="margin:0"><button class="dbtn go" data-act="apaccept" data-id="' + esc(f.truckId) + '" data-pid="' + esc(f.palletId) + '" data-label="' + esc(f.code) + '" data-truck="' + esc(f.truckLabel) + '">Accept onto this truck</button>' +
                '<button class="dbtn gh" data-act="apreject" data-id="' + esc(f.truckId) + '" data-pid="' + esc(f.palletId) + '" data-label="' + esc(f.code) + '">Reject</button></span></div>';
        }
        function flaggedCard(list) {
            return '<div class="card amberc"><h4>🟠 ' + list.length + ' pallet' + (list.length === 1 ? '' : 's') + ' scanned at ' + esc(B.toName) + ' that ' + (list.length === 1 ? 'was' : 'were') + ' never loaded</h4>' +
                '<div class="muted">decide now, or later on the receipt card</div><div class="diffs">' + list.map(flagRow).join('') + '</div></div>';
        }
```

In `paintApprove`, give each section an anchor and add the Flagged section between Trucks and Stalled departures:

```js
            const ship = (r.shipPending || []).length ? '<h3 id="ap_ship">Ship confirmations</h3>' + r.shipPending.map(shipConfirmCard).join('') : '';
            const fix = (r.fixes || []).length ? '<h3 id="ap_fix">Correct the IF</h3>' + r.fixes.map(f => fixCard(f, r.writeMode)).join('') : '';
            const trk = (r.trucks || []).length ? '<h3 id="ap_trucks">Trucks waiting for an IF fix</h3>' + r.trucks.map(n => truckCard(n, r.freeIfs, r.writeMode, (r.fixes || []).some(f => String(f.truckId) === String(n.truck.id)))).join('') : '';
            const flg = (r.flagged || []).length ? '<h3 id="ap_flag">Flagged pallets</h3>' + flaggedCard(r.flagged) : '';
```

`ret` keeps its markup; its heading becomes `'<h3 id="ap_retry">Stalled departures</h3>'` and the receipts heading `'<h3 id="ap_rec">Receipts</h3>'`. The final `main(...)` concatenates `ship + fix + trk + flg + ...`.

In the receipt card builder (the `rec` map), after the `missing` line and before the Approve button, add the flagged block, and gate the button:

```js
                    ((x.flagged || []).length || (x.pending || []).length || (x.decided || []).length
                        ? '<div class="muted" style="margin-top:8px"><b>Flagged pallets' + ((x.flagged || []).length ? ' · ' + x.flagged.length + ' to decide' : '') + '</b></div>' +
                          '<div class="diffs">' + (x.flagged || []).map(flagRow).join('') + (x.pending || []).map(p => '<div><b>' + esc(p.code) + '</b> · ' + esc(p.text) + '</div>').join('') +
                          (x.decided || []).map(d => '<div class="muted">' + esc(d.text) + ' · ' + esc(d.by) + '</div>').join('') + '</div>' : '') +
                    (x.canApprove === false
                        ? '<button class="btn go" disabled>Approve receipt — ' + esc((x.blockReason || '').toLowerCase()) + '</button>'
                        : '<button class="btn go" data-act="aprecv" ...existing attributes...>' + (x.stuck ? 'Re-approve receipt' : missing.length ? 'Approve short receipt' : 'Approve receipt') + '</button>') +
```

(keep the existing button's attributes exactly; only wrap it in the `canApprove` ternary).

Handlers, next to `ACT.aprecv`:

```js
        ACT.apaccept = async el => {
            if (!confirm('Accept ' + (el.dataset.label || 'this pallet') + ' onto ' + (el.dataset.truck || 'this truck') + '? Its IF is raised (or an add-on IF is planned) as the write mode allows, and it joins the receipt.')) return;
            busy(el, true);
            const r = await api('pallet_accept', { truckId: el.dataset.id, palletId: el.dataset.pid });
            tone(r.ok && r.outcome !== 'refused' ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? flash(r.outcome === 'accepted' ? 'green' : r.outcome === 'pending' ? 'amber' : 'red', esc(r.text)) : errBox(r.error));
        };
        ACT.apreject = async el => {
            const note = prompt('Reject ' + (el.dataset.label || 'this pallet') + '. Note for the floor (required):');
            if (note == null) return;
            if (!note.trim()) { tone('bad'); SCREENS.approve(errBox('Enter a note: why is this pallet rejected?')); return; }
            busy(el, true);
            const r = await api('pallet_reject', { truckId: el.dataset.id, palletId: el.dataset.pid, note: note.trim() });
            tone(r.ok ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? flash('amber', esc(r.text)) : errBox(r.error));
        };
        // From the Dashboard's Waiting card: open Approvals scrolled to that section.
        ACT.goapprove = el => {
            S.tab = 'approve';
            S.scrollTo = el.dataset.v || '';
            renderNav();
        };
```

In `paintApprove`, after `main(...)`: `if (S.scrollTo) { const a = $(S.scrollTo); S.scrollTo = ''; if (a) a.scrollIntoView({ block: 'start' }); }`. Add `scrollTo: ''` to the `S` initialiser.

CSS: add `.pill.p-violet{background:#ede9fe;color:#5b21b6}` next to the other pill colours if `p-violet` doesn't exist (grep first).

- [ ] **Step 4: Run the tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass, including `every client api() action exists on the server and every data-act has an ACT handler`.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(ui): Dashboard first tab, Print a SKU first, Flagged pallets card and receipt rows with Accept/Reject, floor flagged wording

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

