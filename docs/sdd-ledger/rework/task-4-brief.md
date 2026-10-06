### Task 4: Floor UI

**Files:** Modify `move_portal/move_ui.js`; test in `move_portal/test/ui.test.js`.

**Behavior** (spec §3):
1. **Navigation:**
   - Floor tabs: Outbound `[['trucks','Load out'], ['ship','Shipments'], ['req','Request label']]`. Inbound `[['unload','Unload']]`.
   - The floor default tab is `trucks`. If a stored tab is no longer valid, fall back to it. No Void tab.
2. **Start truck:** a **Trailer #** field, as a select of the known trailers (`S.trailers` from the view or settings) plus "Other…" with an input. It is required, and the value is sent as `trailer`.
3. **Truck screen:**
   - The title is the label ("Trailer X").
   - **+ Add other item** opens an inline form (description, count, Add). It is listed under the pallets with ✕ while open.
   - When `sentBack` is set, show an amber card: "Sent back by <name>: <note>".
4. **Verify `needsNote`:** show a modal titled "Why is it short?" with the diff texts, a required textarea, Save and Cancel. Save re-calls `truck_verify` with `shortNote`. Show the saved note on the Needs IF fix card.
5. **Ready card:** "✅ Ready to ship: go to Shipments", with a button that switches to the `ship` tab. Remove the departure form from the truck screen.
6. **Shipments tab** (`SCREENS.ship`, `api('truck_planned')` for the list, or a dedicated view; trucks are in `open` with status):
   - **Ready** cards: trailer, IFs, pallets/pcs, other items, **Seal #** input, carrier (default Armstrong Group), **Mark shipped** (`api('ship_mark')`, with a `confirm`). On `needsFix`, show a red flash with the diff texts and refresh.
   - **Waiting for manager:** `ship_pending` trucks, read-only, with who marked them and when.
   - **Shipped today:** departed trucks where `depart.day` is today, showing label, seal and trailer. Use a `truck_planned` extension: add `shippedToday: [summary]` to the server's `truck_planned`. This is a small server addition with a portal test.
7. **Unload screen:** an "Other items" checklist. Each tick calls `api('unload_other_tick')`.
8. **Remove from the floor** any `api('depart_preview' | 'depart_confirm')` calls and the departure form code.
9. Keep the `api`/`act` and `data-act`/`ACT` cross-check test green. Escape every server string with `esc`. The 375 px layout must not scroll sideways.

- [ ] **Step 1: Write the failing UI test**

```js
test('floor rework: Load out default, no Void, Shipments, trailer, short note, other items', () => {
    const src = ui._clientMain.toString();
    ["['ship', 'Shipments']", "api('ship_mark'", "api('truck_other_add'", "api('unload_other_tick'", 'Why is it short?', 'shortNote', 'Trailer #', 'go to Shipments', 'Sent back by']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ["['void', 'Void']", "api('depart_preview'", "api('depart_confirm'"].forEach(t => assert.equal(src.indexOf(t), -1, 'still has ' + t));
});
```

- [ ] **Step 2: Run the test and confirm it fails.**
- [ ] **Step 3: Implement**, including the small server `shippedToday` addition and its test.
- [ ] **Step 4: Run the full suite. Smoke-test on :8799** (temp store) through the floor flow: start with a trailer → scan → short → note → needs fix → load the rest → ready → Shipments → mark shipped.
- [ ] **Step 5: Commit** with the message `feat(rework): floor UI: Load out default, Shipments, trailer, short note, other items`.

---

