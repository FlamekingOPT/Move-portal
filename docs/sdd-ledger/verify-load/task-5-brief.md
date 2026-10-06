### Task 5: UI

**Files:**
- Modify: `move_portal/move_ui.js`
- Test: `move_portal/test/ui.test.js`

**Behavior** (spec §5–§6):

1. **Truck screen**
   - A mode toggle `➕ Load / ➖ Take off` next to the scan box. Take off gets the class `takeoff` (amber outline). The mode resets to Load after 2 minutes without a scan.
   - `doTruckScan` sends `mode`. New result renderers:
     - `taken_off`: amber, "Taken off: PLTx → back to Riverside".
     - `not_on_truck`: red, "Not on this truck".
   - A **Verify load** button (`data-act="tverify"`) under the table.
2. **Stage cards** (replace the old departure footer):
   - **`loading`:** Verify button, Undo.
   - **`needs_fix`:** an amber card "⚠ Needs IF fix" with each diff's `text`. Under it, suggestions with **Add to this truck** (`data-act="taddif"`). Buttons **Verify again** and **← Other trucks**. The scan box stays.
   - **`ready`:** a green card "✅ Ready to ship" with the departure form (trailer list + Other, seal, carrier, Review departure → Confirm departure). Confirm needs no manager.
     - `depart_preview` / `depart_confirm` may return `needsFix`. In that case, repaint the needs_fix card with a red flash "IF changed in NetSuite: needs a fix again".
   - **`departing` / `departed`:** as today.
3. **Remove from the UI:** pending "waiting for manager", `dcancel`, `apdepart`, `apskip`, and the departure cards in Approvals.
4. **Trucks list badges:** Loading / ⚠ Needs IF fix / ✅ Ready to ship / Departing.
5. **Recheck and alert:**
   - On any floor screen (not manager), every 30 s call `trucks_recheck`.
   - For each `nowReady` truck not yet alerted on this device (a localStorage set `mv_alerted`), show a fixed green banner at the top with a double ok tone: "✅ <label> now matches its IF: ready to ship [Open]" (`data-act="opentruck"`).
   - The banner is dismissible.
   - Stop polling when the page is hidden (`document.hidden`).
6. **Manager Approvals:** a top section "Needs IF fix", one card per `needsFix` entry:
   - the diff texts;
   - suggestions with Add;
   - per-IF Drop buttons for `if_empty`/`if_gone` (`truck_drop_if`);
   - **Correct the IF** (`data-act="apcorrect"`, with `confirm()`). The confirm text depends on the write mode:
     - `off`: "Plan only: fix in NetSuite";
     - `qty`: "Changes IF quantities in NetSuite";
     - `on`: "Changes IF quantities and creates add-on IFs in NetSuite".
   - **Re-check** (`truck_verify`).
   - It shows `correctError` if present.
7. **Keep the cross-check test green:** every `api()` call has a matching `act`, and every `data-act` has a handler.

- [ ] **Step 1: Write the failing UI tests**

```js
test('verify-load UI: verify, take-off, stages, recheck alert, manager correct', () => {
    const src = ui._clientMain.toString();
    ["api('truck_verify'", "api('trucks_recheck'", "api('truck_add_if'", "api('truck_drop_if'", "api('truck_correct'", 'Needs IF fix', 'Ready to ship',
        'Take off', 'back to Riverside', 'now matches its IF', 'mv_alerted', 'document.hidden']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ["api('depart_cancel'", "api('depart_skip_write'", 'Waiting for manager'].forEach(t => assert.equal(src.indexOf(t), -1, 'still has ' + t));
});
```

- [ ] **Step 2: Run the test and confirm it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suite. It must pass.**
- [ ] **Step 5: Commit** with the message `feat(verify-load): UI for verify, take-off, stage cards, alerts, manager corrections`.

---

