# Move Portal v3: Floor and Manager Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the floor/manager rework:
- trucks named by trailer;
- a required short-pick note;
- other (non-inventory) items;
- a Shipments tab where the floor marks a truck shipped and a manager confirms or sends it back;
- manager tabs Labels / Approvals / Dashboard / Report, with standalone Correct-the-IF cards and quieter Truck cards;
- floor opens on Load out with no Void;
- the local beta shows Riverside on hand in the print plan.

**Architecture:** Server changes go in `move_portal/sl_move_portal.js`, reusing its hardened helpers:
- `mustTruck`, `isOpen`, `touched`, `pushStack`;
- `claimLoad(Ld, status, phase, mustBe, extraData)`, `assertClaim`;
- `verifyTruck` / `checkTruck` / `toNeedsFix`;
- `departPlan`, `finishDepart`, `planMismatch`;
- `truckView`, `truckSummary(x, counts)`, `pubDiffs`, `writeMode`;
- `c.user` / `c.mgr`, `act(name, managerOnly, fn)`.

The status `ship_pending` is added to `move_verify.TRUCK`. UI changes go in `move_portal/move_ui.js`, and on-hand for the local beta in `move_portal/test/preview_server.js` and `move_portal/move_verify.js` (`SQL`/`buildReads`). The server and UI tasks specify exact behavior and tests; read each helper before you call it, because the file evolves.

**Tech Stack:** SuiteScript 2.1 AMD, node 18 `node:test`, the fakes in `move_portal/test/`, the local preview server.

**Spec:** `docs/superpowers/specs/2026-10-06-move-portal-floor-manager-rework-design.md` (R1–R10).

## Global Constraints

- **Tests:** run `node --test "move_portal/test/*.test.js"` from the repo root `G:\My Drive\Move-portal`. The quoted glob is required on Windows. The suite starts at 203/203 and must end green with pristine output.
- **Branch:** `feat/v3-verification`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push until the controller says to.
- **Truck statuses:** `loading · needs_fix · ready · ship_pending · departing · departed · receiving · approving · received`.
- **Open (scannable/editable) trucks:** `loading · needs_fix · ready`, with no claim and no depart. `ship_pending` is locked.
- **Pallet changes:** any pallet change on `ready` sets the truck back to `loading` (as today). Other-item edits also set `ready` back to `loading`.
- **Truck label:** `'Trailer ' + trailer` before departure. After departure it is `Truck N · MM/DD`, as today.
- **Trailers:** a trailer is unique among trucks not yet departed (statuses `loading`/`needs_fix`/`ready`/`ship_pending`). Compare after trimming and upper-casing.
- **Short-pick note:** free text, required whenever a manual Verify produces any `if_short` and the truck has no saved note. The 30 s recheck (`trucks_recheck`) never needs one.
- **Other items:** `{id, desc (1–80 chars), qty (whole ≥ 1), by, at}`. Verify ignores them. They're carried into `data.depart.otherItems`.
- **Ship mark and confirm:**
  - `ship_mark` (floor) works only from `ready` and needs a seal. Seal reuse is refused (`sealUsed`, by digits).
  - `ship_confirm` and `ship_sendback` are manager-only.
  - Departure time = `shipReq.at`. Truck # is assigned at confirm.
- **Lesson:** `data.updateLoad(L, patch)` merges `patch.data` over the copy passed in. Always re-read with `data.getLoad(id)` right before an update, and re-check status and claim.
- **Never kill node processes by image name.** Jack's preview runs on :8765, and a demo may run on :8798. Smoke-test on :8799 with `--store` set to a temp file, and stop only your own PID.

---

## File map

| File | Change |
|---|---|
| `move_portal/move_verify.js` | `TRUCK.SHIP_PENDING`; `RESERVING`/placement treat `ship_pending` like `ready`; `SQL().onHand`; `buildReads` exposes `onHand()` |
| `move_portal/sl_move_portal.js` | Trailer on start + label; `truck_verify` short note; other items; `ship_mark` / `ship_confirm` / `ship_sendback`; floor `depart_*` removed; `approvals` reshaped; unload other-item ticks |
| `move_portal/move_ui.js` | Floor: default Load out, no Void, trailer on start, short-note modal, other items, Shipments tab, unload checklist. Manager: 4 tabs, Labels merged, Approvals layout |
| `move_portal/test/preview_server.js` | Seed `db.stock['35']` from the snapshot `onHand` on every start |
| `move_portal/test/*.test.js` | Tests |
| `CLAUDE.md`, `docs/sdd-ledger/progress.md` | Handoff (last task) |

---

### Task 1: Trailer-named trucks, short-pick note, other items (server)

**Files:** Modify `move_portal/sl_move_portal.js`; test in `move_portal/test/portal.test.js`.

**Interfaces / behavior:**
- **`truck_start {ifIds, trailer}`:**
  - `trailer` is required: `userErr('Enter the trailer #')`.
  - Trim it, and refuse if any truck with status in `[loading, needs_fix, ready, ship_pending, departing]` has the same trailer (trim + upper-case): `userErr('Trailer X is already on an open truck')`.
  - Save it as `data.trailer`.
- **`truckLabel(x)`:** if `data.depart`, the label is the existing `Truck N · MM/DD`. Otherwise, if `data.trailer`, it is `'Trailer ' + data.trailer`. Otherwise it's the IF-number join (old trucks).
- **`truck_verify {truckId, shortNote?}`:**
  - Run the check. If the result has any `if_short`, and `shortNote` is empty (after trim), and the truck has no `data.shortNote`, return `{needsNote: true, diffs: pubDiffs(...)}` without writing anything.
  - Otherwise, when `shortNote` is given, save `data.shortNote = {text, by: c.actor, at: c.now.stamp}` in the same guarded write as the verify result.
  - `trucks_recheck` is unchanged (no note).
  - `data.shortNote` is cleared when the truck departs (in the departure data write).
- **`truck_other_add {truckId, desc, qty}`:**
  - The truck must be open; `desc` is 1–80 chars after trim; `qty` is a whole number ≥ 1.
  - Append `{id: String(Date.now()) + random4, desc, qty, by, at}` to `data.otherItems`, through a re-read write (`touched`-style, so `ready → loading`).
  - Returns `{view}`.
- **`truck_other_remove {truckId, id}`:** the truck must be open. Remove the item, with `ready → loading`. Returns `{view}`.
- **`truckView`:** adds `otherItems`, `shortNote` and `trailer`.
- **`unload_other_tick {truckId, id, on}` (floor):** the truck must be unloadable. Saves `data.otherItemsIn[id] = on ? {by, at} : null`. Returns `{view}` (the unload view). `unloadView` adds `otherItems` (from `data.depart.otherItems`) with an `in` flag.
- **Existing tests:** every existing `truck_start` call in the tests must pass a trailer. Update the shared helpers (`truckWith`, `readyTruck`, `departed`, …) to pass `trailer: 'T' + n` with a unique `n` per call, and keep each test's intent. The `departed(...)` helper changes again in Task 2; keep it working.

- [ ] **Step 1: Write the failing tests** (append to `portal.test.js`)

```js
test('trailer: required, unique among open trucks, names the truck', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9001'] }, false), /Enter the trailer/);
    const v = ctx.run('truck_start', { ifIds: ['9001'], trailer: ' 537224 ' }, false).view;
    assert.deepEqual([v.truck.label, v.trailer], ['Trailer 537224', '537224']);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9002'], trailer: '537224' }, false), /already on an open truck/);
    assert.equal(ctx.run('truck_planned', {}, false).open[0].label, 'Trailer 537224');
});

test('short note: required on a manual verify that finds a short; recheck does not need it', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 40, 'Jsn', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'S1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    const r1 = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.equal(r1.needsNote, true);
    assert.equal(ctx.data.getLoad(t.id).status, 'loading');
    const r2 = ctx.run('truck_verify', { truckId: t.id, shortNote: '  trailer full ' }, false);
    assert.deepEqual([r2.view.truck.status, ctx.data.getLoad(t.id).data.shortNote.text], ['needs_fix', 'trailer full']);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).needsNote, undefined);   // note already saved
    assert.doesNotThrow(() => ctx.run('trucks_recheck', {}, false));
});

test('other items: add/remove while open, ignored by verify, ready → loading', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Joi', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'O1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');
    const v = ctx.run('truck_other_add', { truckId: t.id, desc: 'Office desk', qty: 2 }, false).view;
    assert.deepEqual([v.truck.status, v.otherItems.map(o => [o.desc, o.qty])], ['loading', [['Office desk', 2]]]);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');   // other items ignored
    assert.throws(() => ctx.run('truck_other_add', { truckId: t.id, desc: '', qty: 1 }, false), /description/i);
    assert.throws(() => ctx.run('truck_other_add', { truckId: t.id, desc: 'Chair', qty: 0 }, false), /count/i);
    const id = v.otherItems[0].id;
    assert.equal(ctx.run('truck_other_remove', { truckId: t.id, id }, false).view.otherItems.length, 0);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run `node --test "move_portal/test/portal.test.js"`. Expected: FAIL on the trailer/needsNote/other-item assertions.
- [ ] **Step 3: Implement** the behavior above. Then update the existing test helpers and every `truck_start` call to pass a trailer.
- [ ] **Step 4: Run the full suite.** It must be green.
- [ ] **Step 5: Commit** with the message `feat(rework): trailer-named trucks, short-pick note, other items`.

---

### Task 2: Shipments: mark shipped (floor), confirm / send back (manager)

**Files:** Modify `move_portal/move_verify.js` and `move_portal/sl_move_portal.js`; tests in `portal.test.js` and `verify.test.js`.

**Interfaces / behavior:**
- **`move_verify.js`:**
  - Add `TRUCK.SHIP_PENDING = 'ship_pending'`.
  - In `reservationsFromTrucks`, place `ship_pending` trucks like `ready` (their loaded surplus reserves room).
  - Add a test for it.
- **`isOpen`:** `ship_pending` is not open. Scans, take-off, other items, verify, add/drop IF and correct must all refuse it with "This truck is waiting for a manager to confirm shipping".
- **`ship_mark {truckId, seal, carrier}`** (floor):
  1. The truck must be `ready`: `userErr('Verify the load first')`. The seal is required and must not be reused (`sealUsed` over all trucks, including the `shipReq.seal` of `ship_pending` trucks).
  2. Re-verify, using the same check as departure (`checkTruck`, or `verifyTruck` with `poll`).
     - **Mismatch:** the truck goes to `needs_fix` and the call returns `{needsFix: true, diffs, view}`.
     - **Match:** do a guarded write that sets status `ship_pending`, `data.shipReq = {seal, carrier: carrier || default, trailer: data.trailer, by: c.actor, at: c.now.stamp}` and `data.sentBack = null`. Returns `{view}`.
- **`ship_confirm {truckId}`** (manager): this is today's `depart_confirm` internals, generalized.
  - Claim guard: status `ship_pending`, no claim, no depart.
  - Departure input comes from `shipReq`: trailer = `data.trailer`, seal and carrier from `shipReq`.
  - Re-verify inside the claim.
    - **Mismatch:** release the claim, set `needs_fix` with the new diffs, clear `shipReq`, and return `{needsFix: true, diffs, view}`.
    - **Match:** run `departData` with `depart.at = shipReq.at` (departure time is the floor's mark time), `depart.markedBy = shipReq.by`, `depart.otherItems = data.otherItems || []`, `approvedBy = c.user`, and `shortNote: null`. Then `finishDepart` as today.
  - Truck # of the day is computed at confirm, using the departure day of `shipReq.at`. Use `core.parseNsStamp(shipReq.at).dayIso` for that day.
- **`ship_sendback {truckId, note}`** (manager):
  - The note is required.
  - Guarded write, status `ship_pending` → `loading`, `data.sentBack = {note, by: c.user, at}`, `data.shipReq = null`.
  - Returns `{view}`.
- **`truckView`/`truckSummary`:** add `shipReq` and `sentBack`. `trucks_recheck` ignores `ship_pending` trucks.
- **Floor `depart_preview` / `depart_confirm`:** remove these actions. Keep `depart_retry` and `depart_release`, which act on `departing` trucks, as today. Note: a released truck still goes to `needs_fix`, as today.
- **`approvals`:** adds `shipPending: [{truck: summary, trailer, seal, carrier, ifs: [{ifNum, lines}], pallets, pcs, otherItems, markedBy, markedAt}]`. Keep the existing keys; Task 3 reshapes `needsFix`.
- **Tests:** update `departed(...)` and any test helper that departed via `depart_confirm` to go `truck_verify` → `ship_mark` (floor) → `ship_confirm` (manager). Keep every receipt, unload and report test's intent. Delete or convert tests that only covered the floor `depart_preview`/`depart_confirm` actions, and list them in the report.

- [ ] **Step 1: Write the failing tests**

```js
test('ship_mark: only from ready; locks the truck; seal reuse refused', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jsm', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'SH1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: '5250001' }, false), /Verify the load first/);
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: '' }, false), /seal/i);
    const v = ctx.run('ship_mark', { truckId: t.id, seal: '5250001' }, false).view;
    assert.deepEqual([v.truck.status, v.truck.shipReq.seal, v.truck.shipReq.trailer], ['ship_pending', '5250001', 'SH1']);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false), /waiting for a manager/);
    assert.throws(() => ctx.run('truck_verify', { truckId: t.id }, false), /waiting for a manager/);
    assert.equal(ctx.run('approvals').shipPending[0].seal, '5250001');
});

test('ship_confirm: manager only; departs with Truck # and the floor mark time; send back returns to loading', () => {
    const ctx = setup();
    const mk = (n, trailer, seal, ifId) => { const ps = printLabels(ctx, n, 'J' + trailer, [L975]); const t = ctx.run('truck_start', { ifIds: [ifId], trailer }, false).view.truck;
        ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false)); ctx.run('truck_verify', { truckId: t.id }, false); ctx.run('ship_mark', { truckId: t.id, seal }, false); return t; };
    const a = mk(42, 'C1', '5250002', '9001');
    assert.throws(() => ctx.run('ship_confirm', { truckId: a.id }, false), /Managers only/);
    const r = ctx.run('ship_confirm', { truckId: a.id });
    const d = ctx.data.getLoad(a.id).data.depart;
    assert.deepEqual([r.view.truck.status, d.seal, d.trailer, d.truckNo, d.at === ctx.data.getLoad(a.id).data.shipReq.at], ['departed', '5250002', 'C1', 1, true]);
    const b = mk(42, 'C2', '5250003', '9002');
    assert.throws(() => ctx.run('ship_sendback', { truckId: b.id, note: '' }), /note/i);
    const sb = ctx.run('ship_sendback', { truckId: b.id, note: 'wrong seal photo' });
    assert.deepEqual([sb.view.truck.status, sb.view.truck.sentBack.note], ['loading', 'wrong seal photo']);
});

test('ship_confirm re-verifies: an IF change after mark sends the truck to needs_fix', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jrv', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'RV1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id, seal: '5250004' }, false);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 456 })] }) : f);
    const r = ctx.run('ship_confirm', { truckId: t.id });
    assert.deepEqual([r.needsFix, ctx.data.getLoad(t.id).status, ctx.data.getLoad(t.id).data.claim], [true, 'needs_fix', '']);
});

test('removed: floor depart_preview / depart_confirm', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('depart_preview', { truckId: '1' }, false), /Unknown action/);
    assert.throws(() => ctx.run('depart_confirm', { truckId: '1' }, false), /Unknown action/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement**, including the `reservationsFromTrucks` change and its `verify.test.js` test.
- [ ] **Step 4: Run the full suite.** It must be green.
- [ ] **Step 5: Commit** with the message `feat(rework): Shipments: floor marks shipped, manager confirms or sends back`.

---

### Task 3: Approvals reshaped + local on-hand

**Files:** Modify `move_portal/sl_move_portal.js`, `move_portal/move_verify.js` and `move_portal/test/preview_server.js`; tests in `portal.test.js` and `verify.test.js`.

**Behavior:**
- **`approvals`** returns `{shipPending, fixes, trucks, retries, receipts, freeIfs, writeMode}`:
  - `fixes`: one entry per `if_short`/`if_over`/`no_if` diff across every `needs_fix` truck:
    `{truckId, truckLabel, key, kind, ifId?, ifNum?, toNum?, text, shortNote: data.shortNote || null, corrections (for that key), correctError}`.
    Built from the stored `data.verify.diffs` through `pubDiffs`, with batched SKU names, as today.
  - `trucks`: one entry per `needs_fix` truck:
    `{truck: summary, trailer, ifs: [{ifId, ifNum, toNum, lines, gone, empty}], suggestions, orphans, verifiedBy, verifiedAt}`.
    `empty`/`gone` come from that truck's `if_empty`/`if_gone` diffs.
  - The old `needsFix` key is removed.
- **`truck_correct {truckId, keys}`:** unchanged. The UI now sends one key per Correct card.
- **On hand, local only.** In NetSuite the print plan already uses live on-hand via `data.locationStock`.
  - `move_verify.SQL(...)` gains `onHand`:
    `"SELECT ail.item AS item, SUM(ail.quantityonhand) AS onhand FROM aggregateItemLocation ail WHERE ail.location = " + F + " AND ail.quantityonhand > 0 GROUP BY ail.item"`.
  - `buildReads(raw)` exposes `onHand() → {item: qty}` from `raw.onHand` rows `{item, onhand}`, or `{}` if the rows are absent.
  - `preview_server.js`: on every start, set `data.db.stock[locFrom] = {item: {onHand, avail: onHand}}` from `ns.onHand()`, and merge in the item SKU/desc from the snapshot items. Don't wipe the stock when the snapshot has no `onHand`.
  - Tests: `buildReads` `onHand`, plus a `SQL.onHand` string test.

- [ ] **Step 1: Write the failing tests**

```js
test('approvals: fixes per diff (with short note) and trucks per needs_fix truck', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 40, 'Jap', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'AP1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'trailer full' }, false);
    const a = ctx.run('approvals');
    assert.equal(a.needsFix, undefined);
    assert.deepEqual([a.fixes.length, a.fixes[0].truckLabel, a.fixes[0].ifNum, a.fixes[0].shortNote.text], [1, 'Trailer AP1', 'IF9001', 'trailer full']);
    assert.match(a.fixes[0].text, /IF needs −24/);
    assert.deepEqual([a.trucks.length, a.trucks[0].trailer, a.trucks[0].ifs.map(f => f.ifNum)], [1, 'AP1', ['IF9001']]);
});
```

```js
// verify.test.js
test('buildReads.onHand and SQL.onHand', () => {
    const r = v.buildReads(Object.assign({}, raw, { onHand: [{ item: 975, onhand: 12000 }, { item: 11, onhand: 300 }] }));
    assert.deepEqual(r.onHand(), { 975: 12000, 11: 300 });
    assert.deepEqual(v.buildReads(raw).onHand(), {});
    assert.match(v.SQL('35', '46').onHand, /aggregateItemLocation ail WHERE ail.location = 35/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.** The preview-server seeding has no unit test. Check it with a smoke run on :8799 with a temp store and a temp snapshot that has `onHand` rows: the `plan` action should return rows for SKUs with configs, and a `noConfig` list for SKUs without them.
- [ ] **Step 4: Run the full suite.** It must be green.
- [ ] **Step 5: Commit** with the message `feat(rework): approvals split into fixes/trucks/shipPending; local on-hand for the print plan`.

---

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

### Task 6: Smoke test, snapshot on-hand, handoff (controller)

- [ ] If the NetSuite connector can read `aggregateItemLocation`, refresh the snapshot (Task 13 Step 5 of the v3 plan), including the new `onHand` query. If it can't, ask Jack to reconnect the NetSuite connector, and note this in the handoff.
- [ ] Restart Jack's preview. In the browser, walk the floor and manager flows end to end at 375 px. Take screenshots for Jack.
- [ ] Update the CLAUDE.md READ FIRST block, the test count and the SDD ledger. Commit and push.
