### Task 5: Manager UI

**Files:** Modify `move_portal/move_ui.js`; test in `move_portal/test/ui.test.js`.

**Behavior** (spec §4):
1. **Manager navigation:** no Outbound/Inbound toggle when `isMgr`. Tabs: `[['labels','Labels'], ['approve','Approvals'], ['dash','Dashboard'], ['report','Report']]`, default `approve`.
2. **Labels** (`SCREENS.labels`): one screen with five stacked cards, reusing the existing screen code for each section:
   - Label requests: the old `SCREENS.queue` content, including its 15 s poll.
   - Print a SKU (old `SCREENS.sku`).
   - Print plan (old `SCREENS.plan`).
   - Reprint (old `SCREENS.reprint`).
   - SKU configs (old `SCREENS.configs`).

   Refactor each old screen into a function that renders into a given container element, so they can share the page. Remove the old separate tabs.
3. **Approvals** (`SCREENS.approve`), in this order:
   1. **Ship confirmations:** one card per `shipPending` entry. It shows trailer, seal, carrier, IFs × qty, pallets/pcs, other items, and "Marked shipped by X at Y". It has **Confirm shipped** (primary, `api('ship_confirm')`, with a confirm) and **Send back** (prompts for a note, `api('ship_sendback')`).
   2. **Correct the IF:** one standalone card per `fixes` entry.
      - It shows "<ifNum or 'New IF from TOxxx'> · <truckLabel>", the instruction text in large type, and "Short note: <text> · <by>" when present.
      - **One large primary button, Correct the IF**, which calls `api('truck_correct', {truckId, keys: [key]})` with a confirm worded by the write mode, as today.
      - A small "Re-check" text link.
      - It shows `correctError` and the corrections log.
   3. **Trucks:** one quiet card per `trucks` entry, titled "Trailer X".
      - Its IFs as a plain list, each `gone`/`empty` one with a small **Drop** button.
      - A **secondary** "+ Add an IF to this truck" button (outline style, never filled), which expands the suggestions and the free-IF picker.
      - "Open truck" (opens it read-only in a modal, or links to the floor view) and "Checked by X at Y".
   4. **Retries/Release** and **Receipts**, as today.
4. **Visual hierarchy:** the Correct the IF button is the largest and most prominent button on the screen. Add-IF controls are secondary (outline, smaller). Add a CSS rule and a UI string test that checks the class names (e.g. `btn-correct` vs `btn-addif`).
5. Keep the cross-check test green. Escape everything. No sideways scroll at 375 px.

- [ ] **Step 1: Write the failing UI test**

```js
test('manager rework: 4 tabs, no toggle, merged Labels, approvals hierarchy', () => {
    const src = ui._clientMain.toString();
    ["['labels', 'Labels']", "['approve', 'Approvals']", "['dash', 'Dashboard']", "['report', 'Report']", 'SCREENS.labels', "api('ship_confirm'", "api('ship_sendback'",
        'btn-correct', 'btn-addif', 'Add an IF to this truck', 'Ship confirmations'].forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    assert.equal(src.indexOf("['queue', 'Print queue']"), -1, 'old label tabs removed');
});
```

- [ ] **Step 2: Run the test and confirm it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suite. Smoke-test on :8799** in the manager view: Labels sections render, Approvals shows a ship confirmation, Correct the IF works, and Send back works.
- [ ] **Step 5: Commit** with the message `feat(rework): manager UI: Labels merged, Approvals with standalone Correct the IF and quiet Truck cards`.

---

