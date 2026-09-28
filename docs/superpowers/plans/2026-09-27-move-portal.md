# Move Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate NetSuite Suitelet ("Move Portal") that prints 4×6 pallet labels, scans pallets onto trucks at Riverside and off trucks at Tippecanoe, and (on manager approval) creates the Transfer Order → Item Fulfillment (Shipped) → Item Receipt that moves the inventory, with a move tracker for the Nov 15 target.

**Architecture:**
- One Suitelet (`sl_move_portal.js`) serves a single-page app (`move_ui.js`) plus JSON actions.
- Pure logic (`move_core.js`) and label XML (`move_label_template.js`) have no `N/` dependencies and are unit-tested in node.
- NetSuite access is isolated in `move_data.js` (custom records and item searches) and `move_tx.js` (transactions). The Suitelet's action handlers are tested in node against in-memory fakes of those two modules.

**Tech Stack:** SuiteScript 2.1 (AMD `define`), BFO XML → PDF via `N/render`, plain browser JS (no libraries), node 24 built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-09-27-move-portal-design.md`. Mockup: `docs/mockups/2026-09-27 move portal mockup.html`.

## Global Constraints

- **Separate app.** Never edit `picker_portal_v19.js` or any picker-portal script, and never reuse its deployment (prod 913, sandbox 747).
- **Sandbox first.** Everything is deployed and tested in sandbox (`8211645-sb1`) before production, which is Task 15 and needs Jack's explicit go.
- **Direction is fixed:** settings `locFrom` (Riverside) → `locTo` (Tippecanoe). No code path may swap them.
- **FLOOR users** only write the six `customrecord_mv_*` records. **Only MANAGER users** create transactions, print labels or change configs, and that is enforced server-side in `runAction`.
- **Manager** = Administrator role, a role in `MANAGER_ROLE_SCRIPT_IDS = ['customrole_warehouse_manager','customrole1009','customrole2522','customrole_warehouse_portal_manager']`, or an employee with `custentity_portal_manager` checked.
- **Move days are Mon–Sat.** The target is `2026-11-15`, which is a **Sunday**, so the last move day is Sat 2026-11-14.
- **All timestamps are text.** Display stamps come from `N/format` DATETIMETZ America/Los_Angeles, and day fields are `YYYY-MM-DD`.
- **Label code** = `PLT` + pallet internal id, printed as Code128 and/or QR per settings `labelCode` (`both` | `c128` | `qr`).
- **Every transaction the portal creates** carries a memo token `[mv:<loadId>:<kind>]` (kind `to`, `if`, `r<n>`). A retry must find the existing transaction by that token instead of creating a second one.
- **Syntax check before every upload:** `node --check <file>`. Test command: `node --test "move_portal/test/*.test.js"` (run from the repo root).
- **All new files** live in `move_portal/`. There are no existing live files for this app, so the dated-test-copy rule applies only if a file already uploaded to NetSuite is later changed. In that case, copy it to `<name>_test_YYYY-MM-DD.js` first.

## File Structure

| File | Responsibility |
|---|---|
| `move_portal/move_core.js` | Pure logic: statuses, scan rules, line helpers, CSV import, calendar/tracker math, plan suggestion, tokens |
| `move_portal/move_label_template.js` | BFO XML for labels, batch header cards, load sheet |
| `move_portal/move_data.js` | Custom-record CRUD, item/stock searches, counts (NetSuite only) |
| `move_portal/move_tx.js` | Transfer Order create, commit check, IF (Shipped), Item Receipt, token lookup |
| `move_portal/move_ui.js` | Page HTML, CSS and the whole browser app (`clientMain`) |
| `move_portal/sl_move_portal.js` | Suitelet entry: routing, roles, every action handler, PDF output |
| `move_portal/test/amd.js` | Loads AMD modules in node with injected dependencies |
| `move_portal/test/fake_data.js` | In-memory `move_data` with the identical API |
| `move_portal/test/fake_tx.js` | In-memory `move_tx` that records calls and can simulate failures |
| `move_portal/test/*.test.js` | Unit tests |

---

### Task 0: NetSuite sandbox setup and prerequisite checks (manual, in the NetSuite UI)

No code in this task. It creates the records the code expects and answers the spec §13 questions. Record every id and answer in the CLAUDE.md Move Portal handoff block. Jack may do these steps himself or approve doing them through Chrome.

- [ ] **Step 1: Tippecanoe location in sandbox.**
  1. Go to Setup → Company → Locations → New and copy the prod "Tippecanoe" location's settings: subsidiary, "Make Inventory Available" ON, address.
  2. Note the new internal id, and the sandbox internal id of "CA - Riverside Warehouse".

- [ ] **Step 2: Manual Transfer Order test** (this confirms how inventory moves).
  1. Pick an item with Riverside stock, e.g. YSN201. Write down Riverside on-hand/available and Tippecanoe on-hand.
  2. Create a Transfer Order: From = Riverside, To = Tippecanoe, qty 1, memo `MOVE TEST`. Save it and note its status. Is it Pending Approval, or Pending Fulfillment right away? That tells whether TO approval routing is on.
  3. If it's Pending Approval, approve it and write "toStatus must be approved by a manager" in the handoff. If it saved as Pending Fulfillment, the settings value `toStatus: "B"` is right.
  4. Fulfill it and set the IF status to **Shipped**. Re-check on-hand: Riverside −1 expected. Check whether in-transit shows on the TO/item, or whether the account uses a separate "In-Transit" location.
  5. Receive it. Re-check that Tippecanoe on-hand is +1.
  6. Open the Script Execution Logs for `ue_if_filled_status` (script 791), `ue_if_packages`, `ue_portal_link` and the RSM/SPS IF scripts from the moment of the IF save. Record any error, and whether `ue_if_filled_status` wrote a "Filled" pick status onto the TO line (open the TO and look at the line's Pick Status).
  7. Record everything in the handoff block.

- [ ] **Step 3: Manager role permissions (sandbox).**
  - Setup → Users/Roles → Manage Roles → **Warehouse Portal Manager** (`customrole_warehouse_portal_manager`) → Permissions → Transactions: make sure **Transfer Order = Edit**, **Item Receipt = Create** (or Edit), **Item Fulfillment = Full** and **Fulfill Orders = Full**.
  - If TO approval routing is on, also grant **Approve Transfer Order** or the equivalent.
  - Save, and note which permissions were added.

- [ ] **Step 4: Create the six custom record types.**
  - Customization → Lists, Records & Fields → Record Types → New. For **each** record: **Include Name Field = OFF**, **Access Type = No Permission Required**, Show ID = ON.
  - Type the ID **with a leading underscore** (e.g. `_mv_settings`) so NetSuite produces `customrecord_mv_settings`. Create them in this order, because later records reference earlier ones:

  | # | Name | ID typed | Resulting id |
  |---|---|---|---|
  | 1 | Move Settings | `_mv_settings` | `customrecord_mv_settings` |
  | 2 | Move Pallet Config | `_mv_config` | `customrecord_mv_config` |
  | 3 | Move Load | `_mv_load` | `customrecord_mv_load` |
  | 4 | Move Pallet | `_mv_pallet` | `customrecord_mv_pallet` |
  | 5 | Move Scan | `_mv_scan` | `customrecord_mv_scan` |
  | 6 | Move Label Request | `_mv_label_req` | `customrecord_mv_label_req` |

- [ ] **Step 5: Create the fields.**
  - On each record's Fields subtab → New Field: **Store Value ON**. Type the ID with a leading underscore (e.g. `_mvs_data` → `custrecord_mvs_data`).
  - After saving, confirm each resulting id is exactly as listed. The known Change-ID gotcha produces `custrecordcustrecord_…` or `custrecordmvs_…`; if that happens, fix the id before continuing.

  | Record | Label | ID typed | Type | List/Record target |
  |---|---|---|---|---|
  | Move Settings | Data | `_mvs_data` | Long Text | |
  | Move Pallet Config | Item | `_mvc_item` | List/Record | Item |
  | | Config | `_mvc_code` | Free-Form Text | |
  | | Pieces | `_mvc_pcs` | Integer Number | |
  | | Default | `_mvc_default` | Check Box | |
  | | Batch | `_mvc_batch` | Free-Form Text | |
  | Move Load | Number | `_mvl_number` | Free-Form Text | |
  | | Status | `_mvl_status` | Free-Form Text | |
  | | Transfer Order | `_mvl_to` | List/Record | Transaction |
  | | Fulfillment | `_mvl_if` | List/Record | Transaction |
  | | Receipts | `_mvl_receipts` | Free-Form Text | |
  | | Data | `_mvl_data` | Long Text | |
  | Move Pallet | Status | `_mvp_status` | Free-Form Text | |
  | | Load | `_mvp_load` | List/Record | Move Load |
  | | Job | `_mvp_job` | Free-Form Text | |
  | | Receipt | `_mvp_receipt` | Free-Form Text | |
  | | Shipped Day | `_mvp_shipped_day` | Free-Form Text | |
  | | Printed Day | `_mvp_printed_day` | Free-Form Text | |
  | | Arrived On | `_mvp_arrived_on` | List/Record | Move Load |
  | | Damaged | `_mvp_damaged` | Check Box | |
  | | Catch-up | `_mvp_catchup` | Check Box | |
  | | Edited | `_mvp_edited` | Check Box | |
  | | Summary | `_mvp_summary` | Free-Form Text | |
  | | Pieces | `_mvp_pieces` | Integer Number | |
  | | Data | `_mvp_data` | Long Text | |
  | Move Scan | Pallet | `_mvsc_pallet` | List/Record | Move Pallet |
  | | Load | `_mvsc_load` | List/Record | Move Load |
  | | Result | `_mvsc_result` | Free-Form Text | |
  | | Data | `_mvsc_data` | Long Text | |
  | Move Label Request | Status | `_mvr_status` | Free-Form Text | |
  | | Requester | `_mvr_requester` | Free-Form Text | |
  | | Data | `_mvr_data` | Long Text | |

- [ ] **Step 6: Create the one Move Settings row.** Lists → Custom → Move Settings → New. In **Data**, paste the JSON below with the ids from Step 1, a real roster, and a `toStatus` that matches Step 2, then save:

```json
{"locFrom":"RIVERSIDE_SANDBOX_ID","locTo":"TIPPECANOE_SANDBOX_ID","fromName":"Riverside","toName":"Tippecanoe","target":"2026-11-15","start":"2026-10-01","skip":[],"labelCode":"both","roster":["Miguel Trejo","Santiago Chumil","David Fanco","Kevin Perez"],"maxPrint":250,"staleDays":5,"toStatus":"B","activeBatch":""}
```
Replace `RIVERSIDE_SANDBOX_ID` / `TIPPECANOE_SANDBOX_ID` with the two numbers from Step 1. `start` is the first real move day, so change it if the move starts on a different date.

- [ ] **Step 7: Record everything** (ids, the Step 2 answers, permissions added) in the CLAUDE.md Move Portal block, then commit:

```bash
git add CLAUDE.md
git commit -m "docs: Move Portal sandbox setup ids and TO test results"
```

---

### Task 1: Test harness and core line helpers

**Files:**
- Create: `move_portal/test/amd.js`
- Create: `move_portal/move_core.js`
- Test: `move_portal/test/core.test.js`

**Interfaces:**
- Produces: `loadAmd(file, deps) → module` (test only).
- Produces (`move_core`): `PALLET`, `LOAD` status constants; `palletCode(id) → 'PLT'+id`; `parseScan(raw) → {raw, palletId|null}`; `totalPieces(lines)`; `summarize(lines)`; `headline(lines)`; `isEdited(lines, pcsMap)`; `validateLines(lines) → ''|message`; `pcsMap(cfgByItem)`; `defaultPcs(cfgByItem)`.
- **A line** is `{item:'11', sku:'YSN201', cfg:'A', pcs:120, desc?}`. **`cfgByItem`** is `{itemId:[{code, pcs, isDefault}]}`.

- [ ] **Step 1: Write the AMD loader**

```js
// move_portal/test/amd.js
// Loads a SuiteScript AMD module (define([...], factory)) in node with injected deps.
const fs = require('fs');
const path = require('path');

function loadAmd(file, deps) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    let exported;
    function define(names, factory) {
        if (typeof names === 'function') { factory = names; names = []; }
        exported = factory.apply(null, names.map(n => {
            if (!deps || !(n in deps)) throw new Error(file + ': missing test dependency ' + n);
            return deps[n];
        }));
    }
    new Function('define', src)(define);
    return exported;
}

module.exports = { loadAmd };
```

- [ ] **Step 2: Write the failing tests**

```js
// move_portal/test/core.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const P = core.PALLET, L = core.LOAD;

test('parseScan accepts PLT codes in any case and rejects everything else', () => {
    assert.deepEqual(core.parseScan(' plt48213 '), { raw: 'PLT48213', palletId: 48213 });
    assert.deepEqual(core.parseScan('0714528803'), { raw: '0714528803', palletId: null });
    assert.deepEqual(core.parseScan('PLT0'), { raw: 'PLT0', palletId: null });
    assert.deepEqual(core.parseScan(null), { raw: '', palletId: null });
    assert.equal(core.palletCode(7), 'PLT7');
});

test('summarize, headline and totalPieces', () => {
    const one = [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }];
    const custom = [{ item: '11', sku: 'YSN201', cfg: '', pcs: 7 }];
    const mixed = [{ item: '1', sku: 'YSN330', cfg: 'A', pcs: 24 }, { item: '2', sku: 'YSN10LB', cfg: '', pcs: 40 }];
    assert.equal(core.summarize(one), 'YSN201 · A · 120');
    assert.equal(core.summarize(custom), 'YSN201 · custom · 7');
    assert.equal(core.summarize(mixed), 'MIXED · YSN330 ×24, YSN10LB ×40');
    assert.equal(core.headline(one), 'YSN201 · Config A');
    assert.equal(core.headline(custom), 'YSN201 · Custom');
    assert.equal(core.headline(mixed), 'MIXED · 2 SKUs');
    assert.equal(core.totalPieces(mixed), 64);
    assert.equal(core.summarize([]), '');
});

test('isEdited is true only for a single-SKU pallet whose pieces differ from its config', () => {
    const pcs = { '11': { A: 120, B: 60 } };
    assert.equal(core.isEdited([{ item: '11', cfg: 'A', pcs: 120 }], pcs), false);
    assert.equal(core.isEdited([{ item: '11', cfg: 'A', pcs: 80 }], pcs), true);
    assert.equal(core.isEdited([{ item: '11', cfg: '', pcs: 80 }], pcs), false);
    assert.equal(core.isEdited([{ item: '11', cfg: 'A', pcs: 1 }, { item: '12', cfg: 'A', pcs: 1 }], pcs), false);
    assert.equal(core.isEdited([{ item: '99', cfg: 'A', pcs: 1 }], pcs), false);
});

test('validateLines', () => {
    assert.equal(core.validateLines([{ item: '11', sku: 'YSN201', pcs: 5 }]), '');
    assert.match(core.validateLines([]), /At least one SKU/);
    assert.match(core.validateLines([{ item: '', pcs: 5 }]), /Unknown SKU/);
    assert.match(core.validateLines([{ item: '11', sku: 'YSN201', pcs: 0 }]), /whole number above 0 for YSN201/);
    assert.match(core.validateLines([{ item: '11', sku: 'YSN201', pcs: 2.5 }]), /whole number/);
    assert.match(core.validateLines([{ item: '11', sku: 'YSN201', pcs: 1 }, { item: '11', sku: 'YSN201', pcs: 2 }]), /appears twice/);
    const six = [1, 2, 3, 4, 5, 6].map(i => ({ item: String(i), sku: 'S' + i, pcs: 1 }));
    assert.match(core.validateLines(six), /at most 5/);
});

test('pcsMap and defaultPcs', () => {
    const cfg = { '11': [{ code: 'A', pcs: 120, isDefault: false }, { code: 'B', pcs: 60, isDefault: true }], '12': [{ code: 'A', pcs: 60, isDefault: false }] };
    assert.deepEqual(core.pcsMap(cfg), { '11': { A: 120, B: 60 }, '12': { A: 60 } });
    assert.deepEqual(core.defaultPcs(cfg), { '11': 60, '12': 60 });
    assert.equal(P.LABELED, 'labeled');
    assert.equal(L.RECEIVED_SHORT, 'received_short');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `ENOENT ... move_core.js`.

- [ ] **Step 4: Write `move_core.js`.** This first part ends with a `return` that later tasks extend.

```js
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: pure logic (no N/ modules), unit-tested in node.
 * Spec: docs/superpowers/specs/2026-09-27-move-portal-design.md
 */
define([], function () {
    'use strict';

    const PALLET = {
        LABELED: 'labeled', LOADED: 'loaded', SHIPPED: 'shipped', RECEIVED: 'received',
        MISSING: 'missing', ARRIVED_UNSHIPPED: 'arrived_unshipped', VOID: 'void'
    };
    const LOAD = {
        LOADING: 'loading', READY: 'ready', SHIPPING: 'shipping', SHIPPED: 'shipped',
        RECEIVING: 'receiving', RECV_READY: 'recv_ready', RECEIVING_TX: 'receiving_tx',
        RECEIVED: 'received', RECEIVED_SHORT: 'received_short', ERROR: 'error'
    };

    // ── labels and pallet lines ──────────────────────────────────────────
    function palletCode(id) { return 'PLT' + String(id); }

    function parseScan(raw) {
        const s = String(raw == null ? '' : raw).trim().toUpperCase();
        const m = /^PLT(\d+)$/.exec(s);
        const id = m ? Number(m[1]) : 0;
        return { raw: s, palletId: id > 0 ? id : null };
    }

    function totalPieces(lines) {
        return (lines || []).reduce((a, l) => a + (Number(l.pcs) || 0), 0);
    }

    function summarize(lines) {
        if (!lines || !lines.length) return '';
        if (lines.length === 1) {
            const l = lines[0];
            return l.sku + ' · ' + (l.cfg || 'custom') + ' · ' + l.pcs;
        }
        return 'MIXED · ' + lines.map(l => l.sku + ' ×' + l.pcs).join(', ');
    }

    function headline(lines) {
        if (!lines || !lines.length) return '';
        if (lines.length === 1) return lines[0].sku + ' · ' + (lines[0].cfg ? 'Config ' + lines[0].cfg : 'Custom');
        return 'MIXED · ' + lines.length + ' SKUs';
    }

    // pcs: { itemId: { A: 120, B: 60 } }
    function isEdited(lines, pcs) {
        if (!lines || lines.length !== 1) return false;
        const l = lines[0];
        const m = pcs && pcs[String(l.item)];
        if (!l.cfg || !m || m[l.cfg] == null) return false;
        return Number(l.pcs) !== Number(m[l.cfg]);
    }

    function validateLines(lines) {
        if (!Array.isArray(lines) || !lines.length) return 'At least one SKU is required';
        if (lines.length > 5) return 'A mixed pallet can have at most 5 SKUs';
        const seen = {};
        for (const l of lines) {
            if (!l || !l.item) return 'Unknown SKU';
            const n = Number(l.pcs);
            if (!(n > 0) || Math.floor(n) !== n) return 'Pieces must be a whole number above 0 for ' + (l.sku || 'SKU');
            if (seen[String(l.item)]) return (l.sku || 'SKU') + ' appears twice on one pallet';
            seen[String(l.item)] = true;
        }
        return '';
    }

    // cfgByItem: { itemId: [{ code, pcs, isDefault }] }
    function pcsMap(cfgByItem) {
        const out = {};
        Object.keys(cfgByItem || {}).forEach(k => {
            out[k] = {};
            cfgByItem[k].forEach(c => { out[k][c.code] = c.pcs; });
        });
        return out;
    }

    function defaultPcs(cfgByItem) {
        const out = {};
        Object.keys(cfgByItem || {}).forEach(k => {
            const d = cfgByItem[k].find(c => c.isDefault) || cfgByItem[k][0];
            if (d) out[k] = d.pcs;
        });
        return out;
    }

    // ── (Task 2) scan rules, aggregation, numbering ──────────────────────

    // ── (Task 3) CSV config import ────────────────────────────────────────

    // ── (Task 4) calendar, tracker, plan ─────────────────────────────────

    return {
        PALLET, LOAD, palletCode, parseScan, totalPieces, summarize, headline,
        isEdited, validateLines, pcsMap, defaultPcs
    };
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add move_portal/test/amd.js move_portal/test/core.test.js move_portal/move_core.js
git commit -m "feat(move): test harness and core pallet line helpers"
```

---

### Task 2: Core scan rules, aggregation, numbering, tokens

**Files:**
- Modify: `move_portal/move_core.js` (fill the `(Task 2)` section and extend the `return`)
- Test: `move_portal/test/core.test.js` (append)

**Interfaces:**
- Consumes: `PALLET`, `LOAD` from Task 1.
- Produces:
  - `loadScanRule(pallet|null, loadId, loads) → {result, set?, otherLoadId?, otherNumber?}`
  - `receiveScanRule(pallet|null, loadId, loads) → {result, set?, otherLoadId?, otherNumber?, fromLoadNumber?}`
  - `pallet` is `{status, loadId}`; `loads` is `{[loadId]: {status, number}}`.
  - `toneFor(result) → 'ok'|'warn'|'bad'`
  - `aggregate(pallets) → {itemId: qty}`
  - `shortages(agg, avail) → [{item, need, avail}]`
  - `nextLoadNumber(numbers) → 'MV-001'`
  - `catchupNumber(parent, numbers) → 'MV-011-C1'`
  - `txToken(loadId, kind) → '[mv:17:to]'`

**Result values used by the UI:**
- load mode: `ok, dup, other_load, locked_load, void, shipped, unknown`
- receive mode: `ok, late, dup, dup_other, other_load, other_load_pending, arrived_unshipped, dup_catchup, void, unknown`

- [ ] **Step 1: Append the failing tests**

```js
// ── Task 2 ──
const LOADS = {
    '1': { status: L.LOADING, number: 'MV-001' }, '2': { status: L.LOADING, number: 'MV-002' },
    '3': { status: L.READY, number: 'MV-003' }, '4': { status: L.SHIPPED, number: 'MV-004' }
};

test('loadScanRule covers every pallet state', () => {
    assert.deepEqual(core.loadScanRule(null, '1', LOADS), { result: 'unknown' });
    assert.deepEqual(core.loadScanRule({ status: P.LABELED, loadId: '' }, '1', LOADS), { result: 'ok', set: { status: P.LOADED, loadId: '1' } });
    assert.deepEqual(core.loadScanRule({ status: P.LOADED, loadId: '1' }, 1, LOADS), { result: 'dup' });
    assert.deepEqual(core.loadScanRule({ status: P.LOADED, loadId: '2' }, '1', LOADS), { result: 'other_load', otherLoadId: '2', otherNumber: 'MV-002' });
    assert.deepEqual(core.loadScanRule({ status: P.LOADED, loadId: '3' }, '1', LOADS), { result: 'locked_load', otherLoadId: '3', otherNumber: 'MV-003' });
    assert.deepEqual(core.loadScanRule({ status: P.VOID, loadId: '' }, '1', LOADS), { result: 'void' });
    assert.deepEqual(core.loadScanRule({ status: P.SHIPPED, loadId: '4' }, '1', LOADS), { result: 'shipped', otherLoadId: '4', otherNumber: 'MV-004' });
    assert.equal(core.loadScanRule({ status: P.RECEIVED, loadId: '4' }, '1', LOADS).result, 'shipped');
    assert.equal(core.loadScanRule({ status: P.ARRIVED_UNSHIPPED, loadId: '' }, '1', LOADS).result, 'shipped');
});

test('receiveScanRule covers every pallet state', () => {
    assert.deepEqual(core.receiveScanRule(null, '4', LOADS), { result: 'unknown' });
    assert.deepEqual(core.receiveScanRule({ status: P.SHIPPED, loadId: '4' }, '4', LOADS), { result: 'ok', set: { status: P.RECEIVED } });
    assert.deepEqual(core.receiveScanRule({ status: P.MISSING, loadId: '4' }, '4', LOADS), { result: 'late', set: { status: P.RECEIVED } });
    assert.deepEqual(core.receiveScanRule({ status: P.SHIPPED, loadId: '4' }, '9', LOADS), { result: 'other_load', otherLoadId: '4', otherNumber: 'MV-004' });
    assert.deepEqual(core.receiveScanRule({ status: P.MISSING, loadId: '4' }, '9', LOADS), { result: 'other_load', otherLoadId: '4', otherNumber: 'MV-004' });
    assert.deepEqual(core.receiveScanRule({ status: P.RECEIVED, loadId: '4' }, '4', LOADS), { result: 'dup' });
    assert.deepEqual(core.receiveScanRule({ status: P.RECEIVED, loadId: '4' }, '9', LOADS), { result: 'dup_other', otherLoadId: '4', otherNumber: 'MV-004' });
    assert.deepEqual(core.receiveScanRule({ status: P.LABELED, loadId: '' }, '4', LOADS),
        { result: 'arrived_unshipped', set: { status: P.ARRIVED_UNSHIPPED, loadId: '' }, fromLoadNumber: '' });
    assert.deepEqual(core.receiveScanRule({ status: P.LOADED, loadId: '1' }, '4', LOADS),
        { result: 'arrived_unshipped', set: { status: P.ARRIVED_UNSHIPPED, loadId: '' }, fromLoadNumber: 'MV-001' });
    assert.deepEqual(core.receiveScanRule({ status: P.LOADED, loadId: '3' }, '4', LOADS), { result: 'other_load_pending', otherLoadId: '3', otherNumber: 'MV-003' });
    assert.deepEqual(core.receiveScanRule({ status: P.ARRIVED_UNSHIPPED, loadId: '' }, '4', LOADS), { result: 'dup_catchup' });
    assert.deepEqual(core.receiveScanRule({ status: P.VOID, loadId: '' }, '4', LOADS), { result: 'void' });
});

test('toneFor', () => {
    assert.equal(core.toneFor('ok'), 'ok');
    assert.equal(core.toneFor('late'), 'ok');
    assert.equal(core.toneFor('dup'), 'warn');
    assert.equal(core.toneFor('arrived_unshipped'), 'warn');
    assert.equal(core.toneFor('void'), 'bad');
    assert.equal(core.toneFor('whatever'), 'bad');
});

test('aggregate and shortages', () => {
    const pallets = [
        { lines: [{ item: '11', pcs: 120 }] },
        { lines: [{ item: 11, pcs: 120 }, { item: '12', pcs: 30 }] }
    ];
    const agg = core.aggregate(pallets);
    assert.deepEqual(agg, { '11': 240, '12': 30 });
    assert.deepEqual(core.shortages(agg, { '11': 200, '12': 30 }), [{ item: '11', need: 240, avail: 200 }]);
    assert.deepEqual(core.shortages(agg, { '11': 240 }), [{ item: '12', need: 30, avail: 0 }]);
});

test('load numbers, catch-up numbers and transaction tokens', () => {
    assert.equal(core.nextLoadNumber([]), 'MV-001');
    assert.equal(core.nextLoadNumber(['MV-009', 'MV-010', 'junk', 'MV-003-C1']), 'MV-011');
    assert.equal(core.catchupNumber('MV-011', ['MV-011']), 'MV-011-C1');
    assert.equal(core.catchupNumber('MV-011', ['MV-011', 'MV-011-C1', 'MV-012-C4']), 'MV-011-C2');
    assert.equal(core.txToken('17', 'to'), '[mv:17:to]');
    assert.equal(core.txToken(17, 'r2'), '[mv:17:r2]');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `core.loadScanRule is not a function`.

- [ ] **Step 3: Replace the `// ── (Task 2) …` line in `move_core.js` with:**

```js
    // ── scan rules ────────────────────────────────────────────────────────
    // pallet: { status, loadId } | null   loads: { [loadId]: { status, number } }
    function loadScanRule(pallet, loadId, loads) {
        if (!pallet) return { result: 'unknown' };
        const me = String(loadId);
        const pl = pallet.loadId ? String(pallet.loadId) : '';
        const other = (loads && loads[pl]) || {};
        switch (pallet.status) {
            case PALLET.LABELED:
                return { result: 'ok', set: { status: PALLET.LOADED, loadId: me } };
            case PALLET.LOADED:
                if (pl === me) return { result: 'dup' };
                if (other.status === LOAD.LOADING) return { result: 'other_load', otherLoadId: pl, otherNumber: other.number || '' };
                return { result: 'locked_load', otherLoadId: pl, otherNumber: other.number || '' };
            case PALLET.VOID:
                return { result: 'void' };
            default:
                return { result: 'shipped', otherLoadId: pl, otherNumber: other.number || '' };
        }
    }

    function receiveScanRule(pallet, loadId, loads) {
        if (!pallet) return { result: 'unknown' };
        const me = String(loadId);
        const pl = pallet.loadId ? String(pallet.loadId) : '';
        const other = (loads && loads[pl]) || {};
        const elsewhere = { otherLoadId: pl, otherNumber: other.number || '' };
        switch (pallet.status) {
            case PALLET.SHIPPED:
                return pl === me ? { result: 'ok', set: { status: PALLET.RECEIVED } } : Object.assign({ result: 'other_load' }, elsewhere);
            case PALLET.MISSING:
                return pl === me ? { result: 'late', set: { status: PALLET.RECEIVED } } : Object.assign({ result: 'other_load' }, elsewhere);
            case PALLET.RECEIVED:
                return pl === me ? { result: 'dup' } : Object.assign({ result: 'dup_other' }, elsewhere);
            case PALLET.LABELED:
                return { result: 'arrived_unshipped', set: { status: PALLET.ARRIVED_UNSHIPPED, loadId: '' }, fromLoadNumber: '' };
            case PALLET.LOADED:
                if (other.status === LOAD.LOADING) {
                    return { result: 'arrived_unshipped', set: { status: PALLET.ARRIVED_UNSHIPPED, loadId: '' }, fromLoadNumber: other.number || '' };
                }
                return Object.assign({ result: 'other_load_pending' }, elsewhere);
            case PALLET.ARRIVED_UNSHIPPED:
                return { result: 'dup_catchup' };
            case PALLET.VOID:
                return { result: 'void' };
            default:
                return { result: 'unknown' };
        }
    }

    const TONE = { ok: 'ok', late: 'ok', dup: 'warn', other_load: 'warn', dup_other: 'warn', dup_catchup: 'warn', arrived_unshipped: 'warn' };
    function toneFor(result) { return TONE[result] || 'bad'; }

    // ── aggregation and numbering ────────────────────────────────────────
    function aggregate(pallets) {
        const out = {};
        (pallets || []).forEach(p => (p.lines || []).forEach(l => {
            const k = String(l.item);
            out[k] = (out[k] || 0) + (Number(l.pcs) || 0);
        }));
        return out;
    }

    function shortages(agg, avail) {
        return Object.keys(agg)
            .filter(k => (Number(avail && avail[k]) || 0) < agg[k])
            .map(k => ({ item: k, need: agg[k], avail: Number(avail && avail[k]) || 0 }));
    }

    function nextLoadNumber(numbers) {
        let max = 0;
        (numbers || []).forEach(n => { const m = /^MV-(\d+)$/.exec(String(n)); if (m) max = Math.max(max, Number(m[1])); });
        return 'MV-' + String(max + 1).padStart(3, '0');
    }

    function catchupNumber(parent, numbers) {
        const re = new RegExp('^' + String(parent).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '-C(\\d+)$');
        let max = 0;
        (numbers || []).forEach(n => { const m = re.exec(String(n)); if (m) max = Math.max(max, Number(m[1])); });
        return parent + '-C' + (max + 1);
    }

    function txToken(loadId, kind) { return '[mv:' + loadId + ':' + kind + ']'; }
```

In the `return` object, add: `loadScanRule, receiveScanRule, toneFor, aggregate, shortages, nextLoadNumber, catchupNumber, txToken`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_core.js move_portal/test/core.test.js
git commit -m "feat(move): scan rules, aggregation, load numbers, tx tokens"
```

---

### Task 3: Core CSV config import

**Files:**
- Modify: `move_portal/move_core.js` (fill the `(Task 3)` section and extend the `return`)
- Test: `move_portal/test/core.test.js` (append)

**Interfaces:**
- Produces:
  - `parseCsv(text) → string[][]` (trimmed cells, blank rows dropped, quotes and CRLF handled)
  - `buildConfigImport(rows, skuToItem) → {configs:[{item, sku, code, pcs, isDefault}], errors:[{row, msg}], unknownSkus:[sku]}`
  - `skuToItem` keys are UPPERCASE SKUs. Row numbers are 1-based and count the header. A `row` of 0 means an error for the whole SKU.

- [ ] **Step 1: Append the failing tests**

```js
// ── Task 3 ──
test('parseCsv handles quotes, CRLF and blank lines', () => {
    const rows = core.parseCsv('SKU,Config,Pcs,Default\r\n"YSN,201",A,120,Y\r\n\r\nYSN301, B ,"60",\n"say ""hi""",C,1,N');
    assert.deepEqual(rows, [
        ['SKU', 'Config', 'Pcs', 'Default'],
        ['YSN,201', 'A', '120', 'Y'],
        ['YSN301', 'B', '60', ''],
        ['say "hi"', 'C', '1', 'N']
    ]);
    assert.deepEqual(core.parseCsv(''), []);
});

test('buildConfigImport validates rows and resolves one default per SKU', () => {
    const skus = { YSN201: '11', YSN301: '12', YSN401: '13' };
    const rows = [
        ['SKU', 'Config', 'Pcs per pallet', 'Default'],
        ['ysn201', 'a', '120', 'Y'],
        ['YSN201', 'B', '60', 'N'],
        ['YSN301', 'A', '60', ''],
        ['NOPE', 'A', '5', 'Y'],
        ['YSN301', 'B', '0', 'N'],
        ['YSN201', 'A', '100', 'N'],
        ['YSN401', 'A', '10', 'Y'],
        ['YSN401', 'B', '20', 'yes'],
        ['', 'A', '1', 'Y']
    ];
    const r = core.buildConfigImport(rows, skus);
    assert.deepEqual(r.unknownSkus, ['NOPE']);
    assert.deepEqual(r.configs, [
        { item: '11', sku: 'YSN201', code: 'A', pcs: 120, isDefault: true },
        { item: '11', sku: 'YSN201', code: 'B', pcs: 60, isDefault: false },
        { item: '12', sku: 'YSN301', code: 'A', pcs: 60, isDefault: true },
        { item: '13', sku: 'YSN401', code: 'A', pcs: 10, isDefault: true },
        { item: '13', sku: 'YSN401', code: 'B', pcs: 20, isDefault: false }
    ]);
    assert.deepEqual(r.errors.map(e => e.row), [6, 7, 10, 0]);
    assert.match(r.errors[0].msg, /YSN301 B: pieces must be a whole number/);
    assert.match(r.errors[1].msg, /YSN201 A: duplicate config/);
    assert.match(r.errors[2].msg, /Missing SKU/);
    assert.match(r.errors[3].msg, /YSN401: more than one default, using A/);
});

test('buildConfigImport works without a header row', () => {
    const r = core.buildConfigImport([['YSN201', 'A', '120', 'Y']], { YSN201: '11' });
    assert.equal(r.configs.length, 1);
    assert.equal(r.errors.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `core.parseCsv is not a function`.

- [ ] **Step 3: Replace the `// ── (Task 3) …` line with:**

```js
    // ── CSV config import ─────────────────────────────────────────────────
    function parseCsv(text) {
        const s = String(text || '').replace(/\r\n?/g, '\n');
        const rows = [];
        let row = [], f = '', q = false;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (q) {
                if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
                else f += c;
            } else if (c === '"') q = true;
            else if (c === ',') { row.push(f); f = ''; }
            else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
            else f += c;
        }
        if (f !== '' || row.length) { row.push(f); rows.push(row); }
        return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
    }

    function buildConfigImport(rows, skuToItem) {
        const out = { configs: [], errors: [], unknownSkus: [] };
        const start = rows.length && /sku/i.test(rows[0][0] || '') ? 1 : 0;
        const bySku = {}, order = [];
        for (let i = start; i < rows.length; i++) {
            const r = rows[i], rn = i + 1;
            const sku = String(r[0] || '').toUpperCase();
            if (!sku) { out.errors.push({ row: rn, msg: 'Missing SKU' }); continue; }
            const item = skuToItem[sku];
            if (!item) { if (out.unknownSkus.indexOf(sku) === -1) out.unknownSkus.push(sku); continue; }
            const code = String(r[1] || '').toUpperCase();
            if (!code) { out.errors.push({ row: rn, msg: sku + ': missing config code' }); continue; }
            const pcs = Number(r[2]);
            if (!(pcs > 0) || Math.floor(pcs) !== pcs) { out.errors.push({ row: rn, msg: sku + ' ' + code + ': pieces must be a whole number above 0' }); continue; }
            if (!bySku[sku]) { bySku[sku] = []; order.push(sku); }
            if (bySku[sku].some(x => x.code === code)) { out.errors.push({ row: rn, msg: sku + ' ' + code + ': duplicate config' }); continue; }
            bySku[sku].push({ item: String(item), sku, code, pcs, isDefault: /^(y|yes|true|1)$/i.test(String(r[3] || '')) });
        }
        order.forEach(sku => {
            const list = bySku[sku];
            const defs = list.filter(x => x.isDefault);
            if (defs.length > 1) {
                out.errors.push({ row: 0, msg: sku + ': more than one default, using ' + defs[0].code });
                list.forEach(x => { x.isDefault = x === defs[0]; });
            }
            if (!defs.length) list[0].isDefault = true;
            list.forEach(x => out.configs.push(x));
        });
        return out;
    }
```

In the `return` object, add: `parseCsv, buildConfigImport`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_core.js move_portal/test/core.test.js
git commit -m "feat(move): CSV pallet-config import parsing and validation"
```

---

### Task 4: Core calendar, tracker, plan suggestion, stamp parsing

**Files:**
- Modify: `move_portal/move_core.js` (fill the `(Task 4)` section and extend the `return`)
- Test: `move_portal/test/core.test.js` (append)

**Interfaces:**
- Produces:
  - `isoAddDays(iso, n)`
  - `moveDays(fromIso, toIso, skip) → iso[]` (Mon–Sat, inclusive)
  - `nthMoveDayFrom(fromIso, n, skip)` (inclusive of `fromIso`)
  - `parseNsStamp(s) → {dayIso, hour}|null` (NetSuite `M/D/YYYY h:mm:ss am` format)
  - `estimateRemaining(onHand, defPcs) → {pallets, byItem, unknownItems}`
  - `trackerMetrics({todayIso, targetIso, startIso, skipDates, remaining, movedByDay, todayDone}) → {moved, remaining, total, movedToday, daysLeft, neededPerDay, avg7, avgAll, projectedFinish, onTrack}`. `neededPerDay` is `Infinity` when there's work left and no days remain.
  - `suggestPlan(rows:[{item, palletsLeft}], total) → {item: count}`

- [ ] **Step 1: Append the failing tests**

```js
// ── Task 4 ──
test('calendar helpers skip Sundays and skip dates', () => {
    assert.equal(core.isoAddDays('2026-10-01', -1), '2026-09-30');
    assert.equal(core.isoAddDays('2026-12-31', 1), '2027-01-01');
    assert.deepEqual(core.moveDays('2026-10-01', '2026-10-07', []), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07']);
    assert.deepEqual(core.moveDays('2026-10-01', '2026-10-07', ['2026-10-05']), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-06', '2026-10-07']);
    assert.deepEqual(core.moveDays('2026-10-08', '2026-10-07', []), []);
    assert.equal(core.moveDays('2026-10-01', '2026-11-15', []).length, 39);
    assert.equal(core.nthMoveDayFrom('2026-10-03', 1, []), '2026-10-03');
    assert.equal(core.nthMoveDayFrom('2026-10-04', 1, []), '2026-10-05');
    assert.equal(core.nthMoveDayFrom('2026-10-03', 2, []), '2026-10-05');
});

test('parseNsStamp reads NetSuite date-time text', () => {
    assert.deepEqual(core.parseNsStamp('10/14/2026 2:14:05 pm'), { dayIso: '2026-10-14', hour: 14 });
    assert.deepEqual(core.parseNsStamp('1/2/2026 12:05 am'), { dayIso: '2026-01-02', hour: 0 });
    assert.deepEqual(core.parseNsStamp('1/2/2026 12:05 pm'), { dayIso: '2026-01-02', hour: 12 });
    assert.equal(core.parseNsStamp('nope'), null);
});

test('estimateRemaining rounds pallets up and lists items with no config', () => {
    assert.deepEqual(core.estimateRemaining({ '11': 1200, '12': 610, '13': 5, '14': 0 }, { '11': 120, '12': 60 }),
        { pallets: 21, byItem: { '11': 10, '12': 11 }, unknownItems: ['13'] });
});

test('trackerMetrics mid-move, today not finished', () => {
    const moved = {};
    ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-12', '2026-10-13']
        .forEach(d => { moved[d] = 200; });
    const m = core.trackerMetrics({ todayIso: '2026-10-14', targetIso: '2026-11-15', startIso: '2026-10-01', skipDates: [], remaining: 5250, movedByDay: moved, todayDone: false });
    assert.deepEqual(m, { moved: 2200, remaining: 5250, total: 7450, movedToday: 0, daysLeft: 28, neededPerDay: 188,
        avg7: 200, avgAll: 200, projectedFinish: '2026-11-13', onTrack: true });
});

test('trackerMetrics after today is done, and edge cases', () => {
    const moved = { '2026-10-07': 200, '2026-10-08': 200, '2026-10-09': 200, '2026-10-10': 200, '2026-10-12': 200, '2026-10-13': 200, '2026-10-14': 150 };
    const m = core.trackerMetrics({ todayIso: '2026-10-14', targetIso: '2026-11-15', startIso: '2026-10-07', skipDates: [], remaining: 100, movedByDay: moved, todayDone: true });
    assert.equal(m.daysLeft, 27);
    assert.equal(m.avg7, 192.9);
    assert.equal(m.movedToday, 150);
    assert.equal(m.projectedFinish, '2026-10-15');
    const done = core.trackerMetrics({ todayIso: '2026-11-20', targetIso: '2026-11-15', startIso: '2026-10-01', skipDates: [], remaining: 5, movedByDay: {}, todayDone: false });
    assert.equal(done.daysLeft, 0);
    assert.equal(done.neededPerDay, Infinity);
    assert.equal(done.projectedFinish, null);
    assert.equal(done.onTrack, false);
    const none = core.trackerMetrics({ todayIso: '2026-10-14', targetIso: '2026-11-15', startIso: '2026-10-01', skipDates: [], remaining: 0, movedByDay: {}, todayDone: false });
    assert.equal(none.projectedFinish, '2026-10-14');
    assert.equal(none.neededPerDay, 0);
});

test('suggestPlan splits by pallets left and never exceeds them', () => {
    const rows = [{ item: '11', palletsLeft: 10 }, { item: '12', palletsLeft: 30 }];
    assert.deepEqual(core.suggestPlan(rows, 8), { '11': 2, '12': 6 });
    assert.deepEqual(core.suggestPlan(rows, 5), { '11': 1, '12': 4 });
    assert.deepEqual(core.suggestPlan(rows, 100), { '11': 10, '12': 30 });
    assert.deepEqual(core.suggestPlan(rows, 0), { '11': 0, '12': 0 });
    assert.deepEqual(core.suggestPlan([], 5), {});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `core.isoAddDays is not a function`.

- [ ] **Step 3: Replace the `// ── (Task 4) …` line with:**

```js
    // ── calendar (ISO YYYY-MM-DD strings, computed in UTC to avoid DST) ──
    const DAY_MS = 86400000;
    function pad2(n) { return String(n).padStart(2, '0'); }
    function isoToUtc(iso) { const p = String(iso).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
    function utcToIso(t) { return new Date(t).toISOString().slice(0, 10); }
    function isoAddDays(iso, n) { return utcToIso(isoToUtc(iso) + n * DAY_MS); }
    function isMoveDay(iso, skipSet) { return new Date(isoToUtc(iso)).getUTCDay() !== 0 && !skipSet[iso]; }
    function skipSetOf(skip) { const s = {}; (skip || []).forEach(d => { s[d] = true; }); return s; }

    function moveDays(fromIso, toIso, skip) {
        const out = [], sk = skipSetOf(skip);
        for (let t = isoToUtc(fromIso), end = isoToUtc(toIso); t <= end; t += DAY_MS) {
            const iso = utcToIso(t);
            if (isMoveDay(iso, sk)) out.push(iso);
        }
        return out;
    }

    function nthMoveDayFrom(fromIso, n, skip) {
        const sk = skipSetOf(skip);
        let iso = fromIso, count = 0;
        for (let guard = 0; guard < 5000; guard++) {
            if (isMoveDay(iso, sk)) { count++; if (count >= n) return iso; }
            iso = isoAddDays(iso, 1);
        }
        return null;
    }

    // NetSuite DATETIMETZ text in M/D/YYYY format, e.g. "10/14/2026 2:14:05 pm"
    function parseNsStamp(s) {
        const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?/i.exec(String(s || ''));
        if (!m) return null;
        let h = Number(m[4]);
        if (m[6]) { const pm = /pm/i.test(m[6]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
        return { dayIso: m[3] + '-' + pad2(m[1]) + '-' + pad2(m[2]), hour: h };
    }

    // ── tracker ───────────────────────────────────────────────────────────
    function estimateRemaining(onHand, defPcs) {
        const byItem = {}, unknownItems = [];
        let pallets = 0;
        Object.keys(onHand || {}).forEach(k => {
            const q = Number(onHand[k]) || 0;
            if (q <= 0) return;
            const pcs = Number(defPcs && defPcs[k]) || 0;
            if (!pcs) { unknownItems.push(k); return; }
            byItem[k] = Math.ceil(q / pcs);
            pallets += byItem[k];
        });
        return { pallets, byItem, unknownItems };
    }

    function trackerMetrics(o) {
        const skip = o.skipDates || [];
        const moved = o.movedByDay || {};
        const movedTotal = Object.keys(moved).reduce((a, k) => a + (Number(moved[k]) || 0), 0);
        const fromIso = o.todayDone ? nthMoveDayFrom(isoAddDays(o.todayIso, 1), 1, skip) : o.todayIso;
        const daysLeft = fromIso > o.targetIso ? 0 : moveDays(fromIso, o.targetIso, skip).length;
        const done = moveDays(o.startIso, o.todayIso, skip).filter(d => d < o.todayIso || o.todayDone);
        const sumOf = ds => ds.reduce((a, d) => a + (Number(moved[d]) || 0), 0);
        const last7 = done.slice(-7);
        const avg7 = last7.length ? sumOf(last7) / last7.length : 0;
        const avgAll = done.length ? sumOf(done) / done.length : 0;
        const remaining = Math.max(0, Number(o.remaining) || 0);
        const needed = daysLeft ? Math.ceil(remaining / daysLeft) : (remaining > 0 ? Infinity : 0);
        let projected = null;
        if (remaining === 0) projected = o.todayIso;
        else if (avg7 > 0) projected = nthMoveDayFrom(fromIso, Math.ceil(remaining / avg7), skip);
        return {
            moved: movedTotal, remaining, total: movedTotal + remaining, movedToday: Number(moved[o.todayIso]) || 0,
            daysLeft, neededPerDay: needed, avg7: Math.round(avg7 * 10) / 10, avgAll: Math.round(avgAll * 10) / 10,
            projectedFinish: projected, onTrack: !!projected && projected <= o.targetIso
        };
    }

    // Split `total` labels across SKUs in proportion to pallets left (largest remainder).
    function suggestPlan(rows, total) {
        const out = {};
        const sum = rows.reduce((a, r) => a + r.palletsLeft, 0);
        const want = Math.min(Math.max(0, Math.floor(Number(total) || 0)), sum);
        if (!want) { rows.forEach(r => { out[r.item] = 0; }); return out; }
        const parts = rows.map(r => {
            const raw = want * r.palletsLeft / sum;
            return { item: r.item, base: Math.floor(raw), frac: raw - Math.floor(raw), cap: r.palletsLeft };
        });
        let left = want - parts.reduce((a, p) => a + p.base, 0);
        parts.slice().sort((a, b) => b.frac - a.frac).forEach(p => { if (left > 0 && p.base < p.cap) { p.base++; left--; } });
        parts.forEach(p => { out[p.item] = Math.min(p.base, p.cap); });
        return out;
    }
```

In the `return` object, add: `isoAddDays, moveDays, nthMoveDayFrom, parseNsStamp, estimateRemaining, trackerMetrics, suggestPlan`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_core.js move_portal/test/core.test.js
git commit -m "feat(move): move-day calendar, tracker metrics, plan suggestion"
```

---

### Task 5: Label, header-card and load-sheet XML

**Files:**
- Create: `move_portal/move_label_template.js`
- Test: `move_portal/test/template.test.js`

**Interfaces:**
- Produces:
  - `labelsXml(labels, opts) → BFO XML string`
    - `labels` is `[{code, lines:[{sku, cfg, pcs, desc}], pieces, edited, printedDay, by, summary}]`.
    - `opts` is `{codeMode:'both'|'c128'|'qr', header:boolean, fromName, toName}`.
    - Pages are joined with `<pbr/>`. With `header`, a batch header card goes before each run of consecutive labels with the same `summary`.
  - `loadSheetXml(model)`
    - `model` is `{number, fromName, toName, toNumber, ifNumber, door, carrier, trailer, seal, approvedAt, approvedBy, pallets:[{code, summary, pieces}], totals:[{sku, qty}]}`.
  - `esc(s)`, `skuSize(sku)`.

- [ ] **Step 1: Write the failing tests**

```js
// move_portal/test/template.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const tpl = loadAmd('move_label_template.js');

const lab = (code, lines, extra) => Object.assign({
    code, lines, pieces: lines.reduce((a, l) => a + l.pcs, 0), edited: false, printedDay: '2026-10-14', by: 'Miguel',
    summary: lines.map(l => l.sku + l.pcs).join('+')
}, extra || {});
const A = [{ sku: 'YSN201', cfg: 'A', pcs: 120, desc: '20# LP Cylinder' }];
const B = [{ sku: 'YSN301', cfg: '', pcs: 60, desc: '30#' }];
const O = { codeMode: 'both', header: false, fromName: 'Riverside', toName: 'Tippecanoe' };
const count = (s, sub) => s.split(sub).length - 1;

test('one page per label, header card per run of identical labels', () => {
    const labels = [lab('PLT1', A), lab('PLT2', A), lab('PLT3', B)];
    const plain = tpl.labelsXml(labels, O);
    assert.equal(count(plain, '<pbr/>'), 2);
    assert.equal(count(plain, 'BATCH HEADER'), 0);
    const withHdr = tpl.labelsXml(labels, Object.assign({}, O, { header: true }));
    assert.equal(count(withHdr, '<pbr/>'), 4);
    assert.equal(count(withHdr, 'BATCH HEADER'), 2);
    assert.match(withHdr, /2 labels/);
    assert.match(withHdr, /PLT1 - PLT2/);
    assert.ok(withHdr.startsWith('<?xml'));
    assert.match(withHdr, /<body width="4in" height="6in"/);
});

test('code mode controls which barcodes print', () => {
    const one = [lab('PLT9', A)];
    const both = tpl.labelsXml(one, O);
    assert.equal(count(both, 'codetype="code128"'), 1);
    assert.equal(count(both, 'codetype="qrcode"'), 1);
    const c128 = tpl.labelsXml(one, Object.assign({}, O, { codeMode: 'c128' }));
    assert.equal(count(c128, 'codetype="qrcode"'), 0);
    const qr = tpl.labelsXml(one, Object.assign({}, O, { codeMode: 'qr' }));
    assert.equal(count(qr, 'codetype="code128"'), 0);
    assert.match(qr, /width="1.5in"/);
    assert.match(both, /value="PLT9"/);
});

test('single, custom, mixed and edited labels', () => {
    const x = tpl.labelsXml([lab('PLT1', A), lab('PLT2', B, { edited: true }), lab('PLT3', A.concat(B))], O);
    assert.match(x, /Config A/);
    assert.match(x, /Custom/);
    assert.match(x, /MIXED/);
    assert.match(x, /180 pcs/);
    assert.equal(count(x, 'EDITED'), 1);
    assert.match(x, /RIVERSIDE &gt; TIPPECANOE/);
});

test('text is XML-escaped', () => {
    const x = tpl.labelsXml([lab('PLT1', [{ sku: 'A&B<1>', cfg: 'A', pcs: 1, desc: '"q"' }])], O);
    assert.match(x, /A&amp;B&lt;1&gt;/);
    assert.match(x, /&quot;q&quot;/);
    assert.equal(x.indexOf('A&B<1>'), -1);
    assert.equal(tpl.skuSize('YSN201'), 48);
    assert.equal(tpl.skuSize('YSNEZFSTND2.0'), 30);
});

test('load sheet lists totals, pallets and signature lines', () => {
    const x = tpl.loadSheetXml({ number: 'MV-014', fromName: 'Riverside', toName: 'Tippecanoe', toNumber: 'TO9412', ifNumber: 'IF72031',
        door: '4', carrier: 'Estes', trailer: '53-1', seal: '9', approvedAt: '10/14/2026 2:14 pm', approvedBy: 'Jack',
        pallets: [{ code: 'PLT1', summary: 'YSN201 · A · 120', pieces: 120 }], totals: [{ sku: 'YSN201', qty: 120 }] });
    assert.match(x, /Move load sheet · MV-014/);
    assert.match(x, /TO9412/);
    assert.match(x, /Pallets \(1\)/);
    assert.match(x, /Driver signature/);
    assert.match(x, /size="Letter"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `ENOENT ... move_label_template.js`.

- [ ] **Step 3: Write `move_label_template.js`**

```js
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: BFO XML for 4x6 pallet labels, batch header cards and the load sheet.
 * Pure string building (no N/ modules) so it is unit-tested in node.
 */
define([], function () {
    'use strict';
    const HEAD = '<?xml version="1.0"?>\n<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">\n';

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function skuSize(sku) { const n = String(sku || '').length; return n <= 7 ? 48 : n <= 10 ? 38 : n <= 13 ? 30 : 24; }
    function cfgText(l) { return l.cfg ? 'Config ' + l.cfg : 'Custom'; }

    function codeBlock(code, mode) {
        const text = '<p align="center" style="font-family:Courier;font-size:14pt;font-weight:bold">' + esc(code) + '</p>';
        const c128 = '<barcode codetype="code128" showtext="false" value="' + esc(code) + '" width="3.5in" height="0.9in"/>';
        const qrSize = mode === 'qr' ? '1.5in' : '1.1in';
        const qr = '<barcode codetype="qrcode" value="' + esc(code) + '" width="' + qrSize + '" height="' + qrSize + '"/>';
        let rows = '';
        if (mode !== 'qr') rows += '<tr><td align="center">' + c128 + '</td></tr><tr><td align="center">' + text + '</td></tr>';
        if (mode !== 'c128') rows += '<tr><td align="center" style="padding-top:4pt">' + qr + '</td></tr>';
        if (mode === 'qr') rows += '<tr><td align="center">' + text + '</td></tr>';
        return '<table width="100%" style="margin-top:8pt">' + rows + '</table>';
    }

    function labelPage(l, o) {
        const top = '<table width="100%" style="border-bottom:2pt solid #000"><tr>' +
            '<td style="font-size:12pt;font-weight:bold">MOVE</td>' +
            '<td align="right" style="font-size:12pt;font-weight:bold">' + esc(String(o.fromName).toUpperCase()) +
            ' &gt; ' + esc(String(o.toName).toUpperCase()) + '</td></tr></table>';
        let mid;
        if (l.lines.length === 1) {
            const s = l.lines[0];
            mid = '<p style="font-size:' + skuSize(s.sku) + 'pt;font-weight:bold;margin-top:8pt">' + esc(s.sku) + '</p>' +
                '<p style="font-size:18pt;font-weight:bold">' + esc(cfgText(s)) + '</p>' +
                '<p style="font-size:36pt;font-weight:bold;margin-top:4pt">' + esc(s.pcs) + ' pcs</p>' +
                '<p style="font-size:11pt;margin-top:4pt">' + esc(s.desc || '') + '</p>';
        } else {
            mid = '<p style="font-size:40pt;font-weight:bold;margin-top:8pt">MIXED</p><table width="100%" style="margin-top:4pt">' +
                l.lines.map(x => '<tr><td style="font-size:16pt;font-weight:bold;border-bottom:0.5pt solid #999">' + esc(x.sku) +
                    '</td><td align="right" style="font-size:16pt;font-weight:bold;border-bottom:0.5pt solid #999">' + esc(x.pcs) + ' pcs</td></tr>').join('') +
                '<tr><td style="font-size:16pt">Total</td><td align="right" style="font-size:16pt">' + esc(l.pieces) + ' pcs</td></tr></table>';
        }
        const foot = '<table width="100%" style="border-top:0.5pt solid #000;margin-top:6pt"><tr>' +
            '<td style="font-size:9pt">printed ' + esc(l.printedDay) + (l.by ? ' · ' + esc(l.by) : '') + '</td>' +
            '<td align="right" style="font-size:12pt;font-weight:bold">' + (l.edited ? 'EDITED' : '') + '</td></tr></table>';
        return top + mid + codeBlock(l.code, o.codeMode || 'both') + foot;
    }

    function headerPage(first, last, n) {
        const s = first.lines[0] || {};
        const single = first.lines.length === 1;
        const title = single ? s.sku : 'MIXED';
        const sub = single ? cfgText(s) + ' · ' + s.pcs + ' pcs' : first.summary;
        return '<p align="center" style="font-size:14pt;margin-top:0.8in">BATCH HEADER</p>' +
            '<p align="center" style="font-size:' + skuSize(title) + 'pt;font-weight:bold;margin-top:8pt">' + esc(title) + '</p>' +
            '<p align="center" style="font-size:18pt;font-weight:bold">' + esc(sub) + '</p>' +
            '<p align="center" style="font-size:32pt;font-weight:bold;margin-top:14pt">' + n + ' labels</p>' +
            '<p align="center" style="font-size:11pt;margin-top:8pt">' + esc(first.code) + ' - ' + esc(last.code) + '</p>';
    }

    function labelsXml(labels, o) {
        const pages = [];
        let i = 0;
        while (i < labels.length) {
            let j = i;
            while (j + 1 < labels.length && labels[j + 1].summary === labels[i].summary) j++;
            if (o.header) pages.push(headerPage(labels[i], labels[j], j - i + 1));
            for (let k = i; k <= j; k++) pages.push(labelPage(labels[k], o));
            i = j + 1;
        }
        return HEAD + '<pdf><head><style>p { margin: 0; }</style></head>' +
            '<body width="4in" height="6in" padding="0.15in" font-family="Helvetica">' + pages.join('<pbr/>') + '</body></pdf>';
    }

    function loadSheetXml(m) {
        const row = (a, b) => '<tr><td width="50%">' + a + '</td><td>' + b + '</td></tr>';
        return HEAD + '<pdf><head><style>td, th { padding: 3pt; } th { border-bottom: 1pt solid #000; }</style></head>' +
            '<body size="Letter" padding="0.5in" font-family="Helvetica" font-size="10pt">' +
            '<p style="font-size:18pt;font-weight:bold">Move load sheet · ' + esc(m.number) + '</p>' +
            '<table width="100%" style="margin-top:8pt">' +
            row('From: <b>' + esc(m.fromName) + '</b>', 'To: <b>' + esc(m.toName) + '</b>') +
            row('Transfer order: <b>' + esc(m.toNumber) + '</b>', 'Fulfillment: <b>' + esc(m.ifNumber) + '</b>') +
            row('Door: ' + esc(m.door), 'Carrier: ' + esc(m.carrier)) +
            row('Trailer: ' + esc(m.trailer), 'Seal: ' + esc(m.seal)) +
            row('Approved: ' + esc(m.approvedAt), 'By: ' + esc(m.approvedBy)) + '</table>' +
            '<p style="font-size:13pt;font-weight:bold;margin-top:12pt">SKU totals</p>' +
            '<table width="60%"><tr><th align="left">SKU</th><th align="right">Pieces</th></tr>' +
            m.totals.map(t => '<tr><td>' + esc(t.sku) + '</td><td align="right">' + esc(t.qty) + '</td></tr>').join('') + '</table>' +
            '<p style="font-size:13pt;font-weight:bold;margin-top:12pt">Pallets (' + m.pallets.length + ')</p>' +
            '<table width="100%"><tr><th align="left">#</th><th align="left">Label</th><th align="left">Contents</th><th align="right">Pcs</th></tr>' +
            m.pallets.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(p.code) + '</td><td>' + esc(p.summary) +
                '</td><td align="right">' + esc(p.pieces) + '</td></tr>').join('') + '</table>' +
            '<p style="margin-top:30pt">Driver signature: ________________________  Date: ____________</p>' +
            '<p style="margin-top:16pt">Received by: ________________________  Date: ____________</p>' +
            '</body></pdf>';
    }

    return { esc: esc, skuSize: skuSize, labelsXml: labelsXml, loadSheetXml: loadSheetXml };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_label_template.js move_portal/test/template.test.js
git commit -m "feat(move): 4x6 label, batch header and load sheet XML"
```

---

### Task 6: Data layer (`move_data.js`) and its in-memory fake

**Files:**
- Create: `move_portal/move_data.js`
- Create: `move_portal/test/fake_data.js`
- Test: `move_portal/test/fake_data.test.js`

The real module can only run in NetSuite. Its twin, `fake_data.js`, has the **identical API** and is what the Suitelet tests in Tasks 8–11 run against. Any change to one must be made to the other.

**Interfaces:**
- **Object shapes**
  - **pallet:** `{id:Number, code, status, loadId:String, job, receipt, shippedDay, printedDay, arrivedOn:String, damaged, catchup, edited, summary, pieces, lines, data}`
  - **load:** `{id:String, number, status, to:String, if:String, receipts:String[], data}`
  - **req:** `{id:String, status, requester, data}`
- **Settings / users**
  - `resetCache()`
  - `getSettings() → settings (+ _id)`
  - `saveSettings(patch)`
  - `employeeIsPortalManager(uid)`
- **Items / stock**
  - `itemLookup(q) → [{item, sku, desc, upc}]`
  - `itemInfo(ids) → {item: {item, sku, desc, upc}}`
  - `skuMap() → {SKU_UPPER: itemId}`
  - `locationStock(locId, itemIds|null) → {item: {item, sku, desc, upc, onHand, avail}}`. `null` means every item with on-hand > 0.
- **Configs**
  - `configsByItem(batch) → {item: [{code, pcs, isDefault}]}`
  - `countConfigsInBatch(batch)`
  - `createConfig(cfg, batch)`
  - `deleteConfigsNotInBatch(batch, max) → remaining`
- **Pallets**
  - `getPallet(id)`, `palletsByIds(ids)`, `palletsByJob(job)`, `palletsByStatus(statuses)`, `palletsByLoad(loadId, statuses|null)`. All lists are sorted by id ascending.
  - `countByJob(job)`
  - `createPallet(patch) → id`
  - `updatePallet(pallet, patch)`. `patch` keys are pallet field names plus `lines` and a `data` object that is merged into the existing data.
  - `labeledPiecesByItem() → {item: pcs}`
  - `movedByDay() → {iso: count}`
  - `palletCountsByLoad(loadIds) → {loadId: {status: {n, pcs}}}`
  - `findPalletsWhere(q)`, `countPallets(q)`. `q` is `{status?:[], receiptEmpty?, damaged?, catchup?, edited?, shippedSince?:iso, printedBefore?:iso}`.
- **Loads**
  - `getLoad(id)`, `getLoads(ids)`
  - `loadsByStatus(statuses, limit?)`, sorted id descending
  - `recentLoads(limit)`, `loadsByNumber(number)`, `allLoadNumbers()`
  - `createLoad(patch) → id`
  - `updateLoad(load, patch)`. `patch` keys are `number, status, to, if, receipts:[]` plus a merged `data` object.
- **Scans / requests / transactions**
  - `logScan({pallet, load, result, data})`
  - `createReq(patch) → id`, `getReq(id)`
  - `findReqs({requester?, status?, limit})`, sorted id descending
  - `updateReq(req, patch)`
  - `tranids(ids) → {id: tranid}`

- [ ] **Step 1: Write the failing fake test** (it checks the merge semantics the Suitelet relies on)

```js
// move_portal/test/fake_data.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const { makeFakeData } = require('./fake_data');

test('fake data: pallet create/update merges data and exposes lines', () => {
    const d = makeFakeData(core);
    const id = d.createPallet({ status: 'labeled', job: 'J1', summary: 's', pieces: 5, lines: [{ item: '11', sku: 'X', cfg: 'A', pcs: 5 }], data: { source: 'plan' } });
    let p = d.getPallet(id);
    assert.equal(p.code, 'PLT' + id);
    assert.equal(p.loadId, '');
    assert.deepEqual(p.lines, [{ item: '11', sku: 'X', cfg: 'A', pcs: 5 }]);
    d.updatePallet(p, { status: 'loaded', load: '7', data: { loadedBy: 'M' } });
    p = d.getPallet(id);
    assert.equal(p.status, 'loaded');
    assert.equal(p.loadId, '7');
    assert.equal(p.data.source, 'plan');
    assert.equal(p.data.loadedBy, 'M');
    assert.equal(d.palletsByLoad('7', ['loaded']).length, 1);
    assert.equal(d.countPallets({ status: ['loaded'] }), 1);
    assert.equal(d.countByJob('J1'), 1);
});

test('fake data: loads keep string ids and merge data', () => {
    const d = makeFakeData(core);
    const id = d.createLoad({ number: 'MV-001', status: 'loading', data: { door: '4' } });
    assert.equal(typeof id, 'string');
    let L = d.getLoad(id);
    d.updateLoad(L, { status: 'ready', receipts: ['9'], data: { readyBy: 'M' } });
    L = d.getLoad(id);
    assert.deepEqual([L.status, L.receipts, L.data.door, L.data.readyBy], ['ready', ['9'], '4', 'M']);
    assert.deepEqual(d.allLoadNumbers(), ['MV-001']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `Cannot find module './fake_data'`.

- [ ] **Step 3: Write `test/fake_data.js`**

```js
// move_portal/test/fake_data.js
// In-memory stand-in for move_data.js. Keep the API identical to the real module.
function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

function makeFakeData(core) {
    const db = {
        settings: { locFrom: '35', locTo: '99', fromName: 'Riverside', toName: 'Tippecanoe', target: '2026-11-15', start: '2026-10-01',
            skip: [], labelCode: 'both', roster: ['Miguel'], maxPrint: 250, staleDays: 5, toStatus: 'B', activeBatch: 'B1' },
        items: [], stock: {}, configs: [], pallets: {}, loads: {}, scans: [], reqs: {}, tranids: {}, seq: 100
    };
    const nextId = () => ++db.seq;
    const PKEYS = ['status', 'load', 'job', 'receipt', 'shippedDay', 'printedDay', 'arrivedOn', 'damaged', 'catchup', 'edited', 'summary', 'pieces'];

    function toPallet(r) {
        const p = clone(r);
        p.code = core.palletCode(p.id);
        p.loadId = String(p.load || '');
        p.arrivedOn = String(p.arrivedOn || '');
        p.lines = p.data.lines || [];
        delete p.load;
        return p;
    }
    function applyPallet(r, patch, base) {
        PKEYS.forEach(k => { if (k in patch) r[k] = patch[k] == null ? '' : clone(patch[k]); });
        if (patch.data || patch.lines) {
            r.data = Object.assign({}, base ? clone(base.data) : {}, clone(patch.data || {}));
            if (patch.lines) r.data.lines = clone(patch.lines);
        }
    }
    function toLoad(r) { return clone(r); }
    function applyLoad(r, patch, base) {
        ['number', 'status', 'to', 'if'].forEach(k => { if (k in patch) r[k] = patch[k] == null ? '' : String(patch[k]); });
        if (patch.receipts) r.receipts = patch.receipts.map(String);
        if (patch.data) r.data = Object.assign({}, base ? clone(base.data) : {}, clone(patch.data));
    }
    function matchQ(p, q) {
        if (q.status && q.status.indexOf(p.status) === -1) return false;
        if (q.receiptEmpty && p.receipt) return false;
        if (q.damaged && !p.damaged) return false;
        if (q.catchup && !p.catchup) return false;
        if (q.edited && !p.edited) return false;
        if (q.shippedSince && !(p.shippedDay && p.shippedDay >= q.shippedSince)) return false;
        if (q.printedBefore && !(p.printedDay && p.printedDay < q.printedBefore)) return false;
        return true;
    }
    const pallets = () => Object.values(db.pallets).sort((a, b) => a.id - b.id);
    const loadsDesc = () => Object.values(db.loads).sort((a, b) => Number(b.id) - Number(a.id));

    return {
        db,
        resetCache() {},
        getSettings: () => Object.assign(clone(db.settings), { _id: '1' }),
        saveSettings: patch => { Object.assign(db.settings, clone(patch)); },
        employeeIsPortalManager: () => false,

        itemLookup: q => db.items.filter(i => i.sku.toUpperCase().indexOf(q.toUpperCase()) !== -1 || i.upc === q).map(clone),
        itemInfo: ids => { const o = {}; ids.map(String).forEach(id => { const i = db.items.find(x => x.item === id); if (i) o[id] = clone(i); }); return o; },
        skuMap: () => { const o = {}; db.items.forEach(i => { o[i.sku.toUpperCase()] = i.item; }); return o; },
        locationStock: (loc, ids) => {
            const s = db.stock[loc] || {}, o = {};
            Object.keys(s).forEach(k => {
                if (ids ? ids.map(String).indexOf(k) === -1 : !(s[k].onHand > 0)) return;
                const i = db.items.find(x => x.item === k) || { item: k, sku: k, desc: '', upc: '' };
                o[k] = Object.assign(clone(i), { onHand: s[k].onHand, avail: s[k].avail });
            });
            return o;
        },

        configsByItem: batch => {
            const o = {};
            db.configs.filter(c => c.batch === batch).forEach(c => { (o[c.item] = o[c.item] || []).push({ code: c.code, pcs: c.pcs, isDefault: c.isDefault }); });
            return o;
        },
        countConfigsInBatch: b => db.configs.filter(c => c.batch === b).length,
        createConfig: (c, b) => { db.configs.push(Object.assign({ id: nextId(), batch: b }, clone(c))); },
        deleteConfigsNotInBatch: (b, max) => {
            let n = 0;
            db.configs = db.configs.filter(c => { if (c.batch !== b && n < max) { n++; return false; } return true; });
            return db.configs.filter(c => c.batch !== b).length;
        },

        getPallet: id => (db.pallets[Number(id)] ? toPallet(db.pallets[Number(id)]) : null),
        palletsByIds: ids => pallets().filter(p => ids.map(Number).indexOf(p.id) !== -1).map(toPallet),
        palletsByJob: job => pallets().filter(p => p.job === job).map(toPallet),
        palletsByStatus: st => pallets().filter(p => st.indexOf(p.status) !== -1).map(toPallet),
        palletsByLoad: (loadId, st) => pallets().filter(p => String(p.load) === String(loadId) && (!st || st.indexOf(p.status) !== -1)).map(toPallet),
        countByJob: job => pallets().filter(p => p.job === job).length,
        createPallet: patch => {
            const id = nextId();
            const r = { id, data: {}, load: '', arrivedOn: '', receipt: '', job: '', shippedDay: '', printedDay: '', damaged: false, catchup: false, edited: false, summary: '', pieces: 0, status: '' };
            applyPallet(r, patch, null);
            db.pallets[id] = r;
            return id;
        },
        updatePallet: (p, patch) => { applyPallet(db.pallets[p.id], patch, p); },
        labeledPiecesByItem: () => {
            const o = {};
            pallets().filter(p => p.status === 'labeled').forEach(p => (p.data.lines || []).forEach(l => { o[l.item] = (o[l.item] || 0) + l.pcs; }));
            return o;
        },
        movedByDay: () => { const o = {}; pallets().filter(p => p.shippedDay).forEach(p => { o[p.shippedDay] = (o[p.shippedDay] || 0) + 1; }); return o; },
        palletCountsByLoad: ids => {
            const o = {}, want = ids.map(String);
            pallets().filter(p => want.indexOf(String(p.load)) !== -1).forEach(p => {
                const l = o[p.load] = o[p.load] || {};
                const s = l[p.status] = l[p.status] || { n: 0, pcs: 0 };
                s.n++; s.pcs += p.pieces;
            });
            return o;
        },
        findPalletsWhere: q => pallets().filter(p => matchQ(p, q)).map(toPallet),
        countPallets: q => pallets().filter(p => matchQ(p, q)).length,

        getLoad: id => (db.loads[String(id)] ? toLoad(db.loads[String(id)]) : null),
        getLoads: ids => ids.map(String).filter(id => db.loads[id]).map(id => toLoad(db.loads[id])),
        loadsByStatus: (st, limit) => loadsDesc().filter(l => st.indexOf(l.status) !== -1).slice(0, limit || 1e9).map(toLoad),
        recentLoads: limit => loadsDesc().slice(0, limit).map(toLoad),
        loadsByNumber: n => loadsDesc().filter(l => l.number === n).map(toLoad),
        allLoadNumbers: () => Object.values(db.loads).map(l => l.number),
        createLoad: patch => {
            const id = String(nextId());
            const r = { id, number: '', status: '', to: '', if: '', receipts: [], data: {} };
            applyLoad(r, patch, null);
            db.loads[id] = r;
            return id;
        },
        updateLoad: (L, patch) => { applyLoad(db.loads[L.id], patch, L); },

        logScan: s => { db.scans.push(clone(s)); },
        createReq: patch => { const id = String(nextId()); db.reqs[id] = Object.assign({ id, data: {} }, clone(patch)); return id; },
        getReq: id => (db.reqs[String(id)] ? clone(db.reqs[String(id)]) : null),
        findReqs: q => Object.values(db.reqs)
            .filter(r => (!q.requester || r.requester === q.requester) && (!q.status || r.status === q.status))
            .sort((a, b) => Number(b.id) - Number(a.id)).slice(0, q.limit || 100).map(clone),
        updateReq: (r, patch) => {
            const s = db.reqs[r.id];
            if ('status' in patch) s.status = patch.status;
            if (patch.data) s.data = Object.assign({}, clone(r.data), clone(patch.data));
        },
        tranids: ids => { const o = {}; ids.filter(Boolean).forEach(id => { o[id] = db.tranids[id] || ('#' + id); }); return o; }
    };
}

module.exports = { makeFakeData };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 26 tests.

- [ ] **Step 5: Write the real `move_data.js`**

```js
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: custom-record and item reads/writes. The in-memory test double is
 * test/fake_data.js. Keep the two APIs identical.
 */
define(['N/search', 'N/record', './move_core'], function (search, record, core) {
    'use strict';

    const REC = { SETTINGS: 'customrecord_mv_settings', CONFIG: 'customrecord_mv_config', PALLET: 'customrecord_mv_pallet',
        LOAD: 'customrecord_mv_load', SCAN: 'customrecord_mv_scan', REQ: 'customrecord_mv_label_req' };
    const SETTINGS_FIELD = 'custrecord_mvs_data';
    const CF = { item: 'custrecord_mvc_item', code: 'custrecord_mvc_code', pcs: 'custrecord_mvc_pcs', isDefault: 'custrecord_mvc_default', batch: 'custrecord_mvc_batch' };
    const PF = { status: 'custrecord_mvp_status', load: 'custrecord_mvp_load', job: 'custrecord_mvp_job', receipt: 'custrecord_mvp_receipt',
        shippedDay: 'custrecord_mvp_shipped_day', printedDay: 'custrecord_mvp_printed_day', arrivedOn: 'custrecord_mvp_arrived_on',
        damaged: 'custrecord_mvp_damaged', catchup: 'custrecord_mvp_catchup', edited: 'custrecord_mvp_edited',
        summary: 'custrecord_mvp_summary', pieces: 'custrecord_mvp_pieces', data: 'custrecord_mvp_data' };
    const LF = { number: 'custrecord_mvl_number', status: 'custrecord_mvl_status', to: 'custrecord_mvl_to', if: 'custrecord_mvl_if',
        receipts: 'custrecord_mvl_receipts', data: 'custrecord_mvl_data' };
    const SF = { pallet: 'custrecord_mvsc_pallet', load: 'custrecord_mvsc_load', result: 'custrecord_mvsc_result', data: 'custrecord_mvsc_data' };
    const RF = { status: 'custrecord_mvr_status', requester: 'custrecord_mvr_requester', data: 'custrecord_mvr_data' };
    const DEFAULTS = { locFrom: '', locTo: '', fromName: 'Riverside', toName: 'Tippecanoe', target: '2026-11-15', start: '2026-10-01',
        skip: [], labelCode: 'both', roster: [], maxPrint: 250, staleDays: 5, toStatus: 'B', activeBatch: '' };
    const ITEM_TYPES = ['InvtPart', 'Assembly'];
    let cfgCache = {};

    // ── helpers ──────────────────────────────────────────────────────────
    function all(s) {
        const out = [];
        const pd = s.runPaged({ pageSize: 1000 });
        pd.pageRanges.forEach(r => { pd.fetch({ index: r.index }).data.forEach(x => out.push(x)); });
        return out;
    }
    function firstRow(s) { const r = s.run().getRange({ start: 0, end: 1 }); return r && r[0] ? r[0] : null; }
    function bool(v) { return v === true || v === 'T'; }
    function json(v, d) { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } }
    function cols(map) { return Object.keys(map).map(k => search.createColumn({ name: map[k] })); }
    function anyText(field, values) { const ex = []; values.forEach((v, i) => { if (i) ex.push('OR'); ex.push([field, 'is', v]); }); return ex; }
    function uniq(ids) { return [...new Set((ids || []).map(String).filter(x => Number(x) > 0))]; }
    function isoOk(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error('Bad date ' + s); return s; }
    function countOf(type, filters) {
        const r = firstRow(search.create({ type, filters, columns: [search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })] }));
        return r ? Number(r.getValue({ name: 'internalid', summary: search.Summary.COUNT })) || 0 : 0;
    }
    function createWith(type, values) {
        const r = record.create({ type });
        Object.keys(values).forEach(f => { if (values[f] !== '' && values[f] != null) r.setValue({ fieldId: f, value: values[f] }); });
        return r.save();
    }
    function resetCache() { cfgCache = {}; }

    // ── settings / users ─────────────────────────────────────────────────
    function getSettings() {
        const r = firstRow(search.create({ type: REC.SETTINGS, columns: [SETTINGS_FIELD] }));
        if (!r) throw new Error('Move settings record is missing (customrecord_mv_settings)');
        const s = Object.assign({}, DEFAULTS, json(r.getValue(SETTINGS_FIELD), {}));
        s._id = String(r.id);
        return s;
    }
    function saveSettings(patch) {
        const s = getSettings();
        const id = s._id;
        delete s._id;
        record.submitFields({ type: REC.SETTINGS, id, values: { [SETTINGS_FIELD]: JSON.stringify(Object.assign(s, patch)) } });
    }
    function employeeIsPortalManager(uid) {
        try {
            if (!(Number(uid) > 0)) return false;
            const f = search.lookupFields({ type: search.Type.EMPLOYEE, id: uid, columns: ['custentity_portal_manager'] });
            return f.custentity_portal_manager === true;
        } catch (e) { return false; }
    }

    // ── items / stock ────────────────────────────────────────────────────
    function skuOfName(n) { const s = String(n || ''); const i = s.lastIndexOf(' : '); return i >= 0 ? s.slice(i + 3) : s; }
    function itemCols() { return ['itemid', 'salesdescription', 'displayname', 'upccode'].map(n => search.createColumn({ name: n })); }
    function itemRow(r) {
        return { item: String(r.id), sku: skuOfName(r.getValue('itemid')),
            desc: r.getValue('salesdescription') || r.getValue('displayname') || '', upc: r.getValue('upccode') || '' };
    }
    function itemLookup(q) {
        if (!q) return [];
        return search.create({ type: search.Type.ITEM,
            filters: [['isinactive', 'is', 'F'], 'AND', ['type', 'anyof', ITEM_TYPES], 'AND', [['itemid', 'contains', q], 'OR', ['upccode', 'is', q]]],
            columns: itemCols() }).run().getRange({ start: 0, end: 15 }).map(itemRow);
    }
    function itemInfo(ids) {
        const out = {}, u = uniq(ids);
        if (!u.length) return out;
        all(search.create({ type: search.Type.ITEM, filters: [['internalid', 'anyof', u]], columns: itemCols() }))
            .forEach(r => { const i = itemRow(r); out[i.item] = i; });
        return out;
    }
    function skuMap() {
        const out = {};
        all(search.create({ type: search.Type.ITEM, filters: [['isinactive', 'is', 'F'], 'AND', ['type', 'anyof', ITEM_TYPES]],
            columns: [search.createColumn({ name: 'itemid' })] }))
            .forEach(r => { out[skuOfName(r.getValue('itemid')).toUpperCase()] = String(r.id); });
        return out;
    }
    function locationStock(locId, itemIds) {
        const f = [['inventorylocation', 'anyof', String(locId)], 'AND', ['type', 'anyof', ITEM_TYPES]];
        if (itemIds) {
            const u = uniq(itemIds);
            if (!u.length) return {};
            f.push('AND', ['internalid', 'anyof', u]);
        } else {
            f.push('AND', ['locationquantityonhand', 'greaterthan', 0]);
        }
        const out = {};
        all(search.create({ type: search.Type.ITEM, filters: f,
            columns: itemCols().concat([search.createColumn({ name: 'locationquantityonhand' }), search.createColumn({ name: 'locationquantityavailable' })]) }))
            .forEach(r => {
                const i = itemRow(r);
                i.onHand = Number(r.getValue('locationquantityonhand')) || 0;
                i.avail = Number(r.getValue('locationquantityavailable')) || 0;
                out[i.item] = i;
            });
        return out;
    }

    // ── configs ──────────────────────────────────────────────────────────
    function configsByItem(batch) {
        const key = String(batch || '');
        if (cfgCache[key]) return cfgCache[key];
        const out = {};
        if (key) {
            all(search.create({ type: REC.CONFIG, filters: [[CF.batch, 'is', key]], columns: cols(CF) })).forEach(r => {
                const it = String(r.getValue(CF.item));
                (out[it] = out[it] || []).push({ code: r.getValue(CF.code), pcs: Number(r.getValue(CF.pcs)), isDefault: bool(r.getValue(CF.isDefault)) });
            });
            Object.keys(out).forEach(k => out[k].sort((a, b) => (a.code < b.code ? -1 : 1)));
        }
        cfgCache[key] = out;
        return out;
    }
    function countConfigsInBatch(batch) { return countOf(REC.CONFIG, [[CF.batch, 'is', String(batch)]]); }
    function createConfig(c, batch) {
        return createWith(REC.CONFIG, { [CF.item]: c.item, [CF.code]: c.code, [CF.pcs]: c.pcs, [CF.isDefault]: !!c.isDefault, [CF.batch]: batch });
    }
    function deleteConfigsNotInBatch(batch, max) {
        search.create({ type: REC.CONFIG, filters: [[CF.batch, 'isnot', String(batch)]], columns: ['internalid'] })
            .run().getRange({ start: 0, end: max }).forEach(r => record.delete({ type: REC.CONFIG, id: r.id }));
        return countOf(REC.CONFIG, [[CF.batch, 'isnot', String(batch)]]);
    }

    // ── pallets ──────────────────────────────────────────────────────────
    function rowToPallet(r) {
        const g = f => r.getValue(f);
        const d = json(g(PF.data), {});
        return { id: Number(r.id), code: core.palletCode(r.id), status: g(PF.status) || '', loadId: String(g(PF.load) || ''),
            job: g(PF.job) || '', receipt: g(PF.receipt) || '', shippedDay: g(PF.shippedDay) || '', printedDay: g(PF.printedDay) || '',
            arrivedOn: String(g(PF.arrivedOn) || ''), damaged: bool(g(PF.damaged)), catchup: bool(g(PF.catchup)), edited: bool(g(PF.edited)),
            summary: g(PF.summary) || '', pieces: Number(g(PF.pieces)) || 0, lines: d.lines || [], data: d };
    }
    function findPallets(filters) {
        return all(search.create({ type: REC.PALLET, filters,
            columns: cols(PF).concat([search.createColumn({ name: 'internalid', sort: search.Sort.ASC })]) })).map(rowToPallet);
    }
    function getPallet(id) { return Number(id) > 0 ? findPallets([['internalid', 'anyof', String(id)]])[0] || null : null; }
    function palletsByIds(ids) { const u = uniq(ids); return u.length ? findPallets([['internalid', 'anyof', u]]) : []; }
    function palletsByJob(job) { return findPallets([[PF.job, 'is', String(job)]]); }
    function palletsByStatus(statuses) { return findPallets(anyText(PF.status, statuses)); }
    function palletsByLoad(loadId, statuses) {
        const f = [[PF.load, 'anyof', String(loadId)]];
        if (statuses && statuses.length) f.push('AND', anyText(PF.status, statuses));
        return findPallets(f);
    }
    function countByJob(job) { return countOf(REC.PALLET, [[PF.job, 'is', String(job)]]); }
    function palletValues(patch, base) {
        const v = {};
        Object.keys(patch).forEach(k => {
            if (k === 'data' || k === 'lines') return;
            if (!PF[k]) throw new Error('Unknown pallet field ' + k);
            const x = patch[k];
            v[PF[k]] = typeof x === 'boolean' ? x : (x == null ? '' : x);
        });
        if (patch.data || patch.lines) {
            const d = Object.assign({}, base ? base.data : {}, patch.data || {});
            if (patch.lines) d.lines = patch.lines;
            v[PF.data] = JSON.stringify(d);
        }
        return v;
    }
    function createPallet(patch) { return Number(createWith(REC.PALLET, palletValues(patch, null))); }
    function updatePallet(p, patch) { record.submitFields({ type: REC.PALLET, id: p.id, values: palletValues(patch, p) }); }
    function labeledPiecesByItem() {
        const out = {};
        palletsByStatus([core.PALLET.LABELED]).forEach(p => p.lines.forEach(l => { out[l.item] = (out[l.item] || 0) + (Number(l.pcs) || 0); }));
        return out;
    }
    function movedByDay() {
        const out = {};
        search.create({ type: REC.PALLET, filters: [[PF.shippedDay, 'isnotempty', '']],
            columns: [search.createColumn({ name: PF.shippedDay, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })] })
            .run().each(r => {
                out[r.getValue({ name: PF.shippedDay, summary: search.Summary.GROUP })] = Number(r.getValue({ name: 'internalid', summary: search.Summary.COUNT }));
                return true;
            });
        return out;
    }
    function palletCountsByLoad(loadIds) {
        const out = {}, u = uniq(loadIds);
        if (!u.length) return out;
        search.create({ type: REC.PALLET, filters: [[PF.load, 'anyof', u]],
            columns: [search.createColumn({ name: PF.load, summary: search.Summary.GROUP }),
                search.createColumn({ name: PF.status, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT }),
                search.createColumn({ name: PF.pieces, summary: search.Summary.SUM })] })
            .run().each(r => {
                const l = String(r.getValue({ name: PF.load, summary: search.Summary.GROUP }));
                const st = r.getValue({ name: PF.status, summary: search.Summary.GROUP });
                (out[l] = out[l] || {})[st] = { n: Number(r.getValue({ name: 'internalid', summary: search.Summary.COUNT })) || 0,
                    pcs: Number(r.getValue({ name: PF.pieces, summary: search.Summary.SUM })) || 0 };
                return true;
            });
        return out;
    }
    function whereFilters(q) {
        const f = [];
        const add = x => { if (f.length) f.push('AND'); f.push(x); };
        if (q.status && q.status.length) add(anyText(PF.status, q.status));
        if (q.receiptEmpty) add([PF.receipt, 'isempty', '']);
        if (q.damaged) add([PF.damaged, 'is', 'T']);
        if (q.catchup) add([PF.catchup, 'is', 'T']);
        if (q.edited) add([PF.edited, 'is', 'T']);
        if (q.shippedSince) add(["formulanumeric: CASE WHEN {" + PF.shippedDay + "} >= '" + isoOk(q.shippedSince) + "' THEN 1 ELSE 0 END", 'equalto', '1']);
        if (q.printedBefore) add(["formulanumeric: CASE WHEN {" + PF.printedDay + "} < '" + isoOk(q.printedBefore) + "' THEN 1 ELSE 0 END", 'equalto', '1']);
        return f;
    }
    function findPalletsWhere(q) { return findPallets(whereFilters(q)); }
    function countPallets(q) { return countOf(REC.PALLET, whereFilters(q)); }

    // ── loads ────────────────────────────────────────────────────────────
    function rowToLoad(r) {
        const g = f => r.getValue(f);
        return { id: String(r.id), number: g(LF.number) || '', status: g(LF.status) || '', to: String(g(LF.to) || ''), if: String(g(LF.if) || ''),
            receipts: String(g(LF.receipts) || '').split(',').filter(Boolean), data: json(g(LF.data), {}) };
    }
    function findLoads(filters, limit) {
        const s = search.create({ type: REC.LOAD, filters: filters || [],
            columns: cols(LF).concat([search.createColumn({ name: 'internalid', sort: search.Sort.DESC })]) });
        return (limit ? s.run().getRange({ start: 0, end: limit }) : all(s)).map(rowToLoad);
    }
    function getLoad(id) { return Number(id) > 0 ? findLoads([['internalid', 'anyof', String(id)]])[0] || null : null; }
    function getLoads(ids) { const u = uniq(ids); return u.length ? findLoads([['internalid', 'anyof', u]]) : []; }
    function loadsByStatus(statuses, limit) { return findLoads(anyText(LF.status, statuses), limit); }
    function recentLoads(limit) { return findLoads([], limit); }
    function loadsByNumber(n) { return findLoads([[LF.number, 'is', String(n)]]); }
    function allLoadNumbers() { return all(search.create({ type: REC.LOAD, columns: [search.createColumn({ name: LF.number })] })).map(r => r.getValue(LF.number)); }
    function loadValues(patch, base) {
        const v = {};
        Object.keys(patch).forEach(k => {
            if (k === 'data') return;
            if (k === 'receipts') { v[LF.receipts] = patch.receipts.join(','); return; }
            if (!LF[k]) throw new Error('Unknown load field ' + k);
            v[LF[k]] = patch[k] == null ? '' : patch[k];
        });
        if (patch.data) v[LF.data] = JSON.stringify(Object.assign({}, base ? base.data : {}, patch.data));
        return v;
    }
    function createLoad(patch) { return String(createWith(REC.LOAD, loadValues(patch, null))); }
    function updateLoad(L, patch) { record.submitFields({ type: REC.LOAD, id: L.id, values: loadValues(patch, L) }); }

    // ── scans / requests / transactions ──────────────────────────────────
    function logScan(s) {
        createWith(REC.SCAN, { [SF.pallet]: s.pallet || '', [SF.load]: s.load || '', [SF.result]: s.result, [SF.data]: JSON.stringify(s.data || {}) });
    }
    function rowToReq(r) { return { id: String(r.id), status: r.getValue(RF.status) || '', requester: r.getValue(RF.requester) || '', data: json(r.getValue(RF.data), {}) }; }
    function createReq(p) { return String(createWith(REC.REQ, { [RF.status]: p.status, [RF.requester]: p.requester, [RF.data]: JSON.stringify(p.data || {}) })); }
    function getReq(id) {
        if (!(Number(id) > 0)) return null;
        const r = firstRow(search.create({ type: REC.REQ, filters: [['internalid', 'anyof', String(id)]], columns: cols(RF) }));
        return r ? rowToReq(r) : null;
    }
    function findReqs(q) {
        const f = [];
        if (q.requester) f.push([RF.requester, 'is', q.requester]);
        if (q.status) { if (f.length) f.push('AND'); f.push([RF.status, 'is', q.status]); }
        return search.create({ type: REC.REQ, filters: f, columns: cols(RF).concat([search.createColumn({ name: 'internalid', sort: search.Sort.DESC })]) })
            .run().getRange({ start: 0, end: q.limit || 100 }).map(rowToReq);
    }
    function updateReq(r, patch) {
        const v = {};
        if ('status' in patch) v[RF.status] = patch.status;
        if (patch.data) v[RF.data] = JSON.stringify(Object.assign({}, r.data, patch.data));
        record.submitFields({ type: REC.REQ, id: r.id, values: v });
    }
    function tranids(ids) {
        const out = {}, u = uniq(ids);
        if (!u.length) return out;
        all(search.create({ type: search.Type.TRANSACTION, filters: [['internalid', 'anyof', u], 'AND', ['mainline', 'is', 'T']], columns: ['tranid'] }))
            .forEach(r => { out[String(r.id)] = r.getValue('tranid'); });
        return out;
    }

    return {
        resetCache, getSettings, saveSettings, employeeIsPortalManager,
        itemLookup, itemInfo, skuMap, locationStock,
        configsByItem, countConfigsInBatch, createConfig, deleteConfigsNotInBatch,
        getPallet, palletsByIds, palletsByJob, palletsByStatus, palletsByLoad, countByJob, createPallet, updatePallet,
        labeledPiecesByItem, movedByDay, palletCountsByLoad, findPalletsWhere, countPallets,
        getLoad, getLoads, loadsByStatus, recentLoads, loadsByNumber, allLoadNumbers, createLoad, updateLoad,
        logScan, createReq, getReq, findReqs, updateReq, tranids
    };
});
```

- [ ] **Step 6: Syntax check the real module and confirm both files export the same names**

Run: `node --check move_portal/move_data.js`
Expected: no output (OK).

Run:
```bash
node -e "const {loadAmd}=require('./move_portal/test/amd');const core=loadAmd('move_core.js');const stub=new Proxy({},{get:()=>()=>({})});const real=Object.keys(loadAmd('move_data.js',{'N/search':stub,'N/record':stub,'./move_core':core})).sort();const fake=Object.keys(require('./move_portal/test/fake_data').makeFakeData(core)).filter(k=>k!=='db').sort();console.log(JSON.stringify(real)===JSON.stringify(fake)?'API MATCH':'MISMATCH '+real.filter(k=>fake.indexOf(k)<0)+' | '+fake.filter(k=>real.indexOf(k)<0));"
```
Expected: `API MATCH`.

- [ ] **Step 7: Commit**

```bash
git add move_portal/move_data.js move_portal/test/fake_data.js move_portal/test/fake_data.test.js
git commit -m "feat(move): data layer for move custom records plus in-memory fake"
```

---

### Task 7: Transactions (`move_tx.js`) and its fake

**Files:**
- Create: `move_portal/move_tx.js`
- Create: `move_portal/test/fake_tx.js`

**Interfaces:**
- Produces:
  - `findByToken(token, typeCode) → id|null`. `typeCode` is `'TrnfrOrd' | 'ItemShip' | 'ItemRcpt'`.
  - `createTransferOrder({fromLoc, toLoc, orderStatus, memo, lines:{item: qty}}) → id`
  - `committedShortfalls(toId, lines) → [{item, need, committed}]`
  - `fulfillTransferOrder(toId, lines, memo) → ifId` (IF saved with `shipstatus = 'C'`)
  - `receiveTransferOrder(toId, lines, memo) → receiptId`
- The fake also exposes `_t = {calls, memos, shortfalls, failNext}`.
  - `failNext` is `'to' | 'if' | 'r'` (throw before saving) or `'if_after' | 'r_after'` (save, then throw, to simulate a crash after the save).

- [ ] **Step 1: Write the fake**

```js
// move_portal/test/fake_tx.js
// In-memory stand-in for move_tx.js. Records calls; can simulate failures.
function makeFakeTx() {
    const t = { calls: [], memos: [], shortfalls: [], failNext: null, seq: 900 };
    function save(type, memo, extra) {
        const id = String(++t.seq);
        t.memos.push({ id, type, memo });
        t.calls.push(Object.assign({ type, id }, extra));
        return id;
    }
    function maybeFail(kind, fn) {
        if (t.failNext === kind) { t.failNext = null; throw new Error(kind.toUpperCase() + ' save failed'); }
        const id = fn();
        if (t.failNext === kind + '_after') { t.failNext = null; throw new Error(kind.toUpperCase() + ' crashed after save'); }
        return id;
    }
    return {
        _t: t,
        findByToken: (tok, type) => { const m = t.memos.find(x => x.type === type && x.memo.indexOf(tok) !== -1); return m ? m.id : null; },
        createTransferOrder: o => maybeFail('to', () => save('TrnfrOrd', o.memo, { lines: JSON.parse(JSON.stringify(o.lines)), fromLoc: o.fromLoc, toLoc: o.toLoc })),
        committedShortfalls: () => t.shortfalls,
        fulfillTransferOrder: (toId, lines, memo) => maybeFail('if', () => save('ItemShip', memo, { toId, lines: JSON.parse(JSON.stringify(lines)) })),
        receiveTransferOrder: (toId, lines, memo) => maybeFail('r', () => save('ItemRcpt', memo, { toId, lines: JSON.parse(JSON.stringify(lines)) }))
    };
}

module.exports = { makeFakeTx };
```

- [ ] **Step 2: Write `move_tx.js`**

```js
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: NetSuite transactions (Transfer Order -> Item Fulfillment -> Item Receipt).
 * Called only from manager actions in sl_move_portal.js. The test double is test/fake_tx.js.
 */
define(['N/record', 'N/search'], function (record, search) {
    'use strict';

    // Find a transaction created earlier by the portal, by the token in its memo.
    function findByToken(tok, typeCode) {
        const r = search.create({ type: search.Type.TRANSACTION,
            filters: [['memo', 'contains', tok], 'AND', ['mainline', 'is', 'T'], 'AND', ['type', 'anyof', typeCode]],
            columns: ['internalid'] }).run().getRange({ start: 0, end: 1 });
        return r && r[0] ? String(r[0].id) : null;
    }

    function locationSubsidiary(locId) {
        const f = search.lookupFields({ type: search.Type.LOCATION, id: locId, columns: ['subsidiary'] });
        const s = f && f.subsidiary;
        return Array.isArray(s) && s.length ? s[0].value : null;
    }

    function createTransferOrder(o) {
        const to = record.create({ type: record.Type.TRANSFER_ORDER, isDynamic: true });
        const sub = locationSubsidiary(o.fromLoc);
        if (sub) to.setValue({ fieldId: 'subsidiary', value: sub });
        to.setValue({ fieldId: 'location', value: o.fromLoc });
        to.setValue({ fieldId: 'transferlocation', value: o.toLoc });
        to.setValue({ fieldId: 'memo', value: o.memo });
        if (o.orderStatus) to.setValue({ fieldId: 'orderstatus', value: o.orderStatus });
        Object.keys(o.lines).forEach(item => {
            to.selectNewLine({ sublistId: 'item' });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: item });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: o.lines[item] });
            to.commitLine({ sublistId: 'item' });
        });
        return String(to.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }

    function committedShortfalls(toId, lines) {
        const to = record.load({ type: record.Type.TRANSFER_ORDER, id: toId });
        const got = {};
        const n = to.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < n; i++) {
            const it = String(to.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            got[it] = (got[it] || 0) + (Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantitycommitted', line: i })) || 0);
        }
        return Object.keys(lines).filter(k => (got[k] || 0) < lines[k]).map(k => ({ item: k, need: lines[k], committed: got[k] || 0 }));
    }

    // Tick exactly the load's items at the load's quantities; untick everything else.
    function setLines(rec, lines) {
        const left = Object.assign({}, lines);
        const n = rec.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < n; i++) {
            rec.selectLine({ sublistId: 'item', line: i });
            const it = String(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' }));
            const q = left[it] || 0;
            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: q > 0 });
            if (q > 0) { rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: q }); left[it] = 0; }
            rec.commitLine({ sublistId: 'item' });
        }
        const miss = Object.keys(left).filter(k => left[k] > 0);
        if (miss.length) throw new Error('Items not found on the transfer order: ' + miss.join(', '));
    }

    function fulfillTransferOrder(toId, lines, memo) {
        const f = record.transform({ fromType: record.Type.TRANSFER_ORDER, fromId: toId, toType: record.Type.ITEM_FULFILLMENT, isDynamic: true });
        f.setValue({ fieldId: 'shipstatus', value: 'C' });
        f.setValue({ fieldId: 'memo', value: memo });
        setLines(f, lines);
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }

    function receiveTransferOrder(toId, lines, memo) {
        const r = record.transform({ fromType: record.Type.TRANSFER_ORDER, fromId: toId, toType: record.Type.ITEM_RECEIPT, isDynamic: true });
        r.setValue({ fieldId: 'memo', value: memo });
        setLines(r, lines);
        return String(r.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }

    return { findByToken, createTransferOrder, committedShortfalls, fulfillTransferOrder, receiveTransferOrder };
});
```

- [ ] **Step 3: Syntax check**

Run: `node --check move_portal/move_tx.js && node --check move_portal/test/fake_tx.js`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add move_portal/move_tx.js move_portal/test/fake_tx.js
git commit -m "feat(move): transfer order, fulfillment and receipt helpers plus fake"
```

---

### Task 8: Suitelet shell and label actions (configs, printing, requests, pallet tools, plan)

**Files:**
- Create: `move_portal/sl_move_portal.js`
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes:
  - `move_core` (Tasks 1–4)
  - `move_data` and `move_tx` APIs (Tasks 6–7)
  - `tpl.labelsXml` / `tpl.loadSheetXml` (Task 5)
  - `ui.buildPage(boot)` (Task 12)
- Produces:
  - `onRequest(ctx)`
  - `_runAction(action, body, isManager) → result object`. Test hook; the JSON response is `{ok:true, ...result}`.
  - Actions in this task:
    - config: `item_lookup`, `cfg_list`, `cfg_preview`, `cfg_commit_chunk`, `cfg_activate`, `cfg_cleanup`
    - printing and requests: `print_chunk`, `req_create`, `req_list`, `req_print`, `req_cancel`
    - pallet tools and plan: `pallet_get`, `pallet_void`, `pallet_reprint`, `pallet_relabel`, `plan`
  - PDF: GET `action=pdf&job=<job>[&header=1]` or `action=pdf&ids=<id,id>` (manager only).
- Internal helpers later tasks reuse:
  - `userErr(msg)`, `pubPallet(p, extra)`, `pubLoad(L, counts)`, `countsFromPallets(pallets)`
  - `mustLoad(id)`, `mustPallet(id)`, `stale(L)`
  - `normalizeLines(lines, S)`, `lineFields(lines, S)`, `createPalletsForJob(job, lines, upTo, source, c)`
  - `stockModel(c)`, `tracker(c, est)`, and `act(name, managerOnly, fn(a, c))`
  - `c` is `{mgr, S:settings, actor, now:{stamp, dayIso, hour}}`.

- [ ] **Step 1: Write the failing tests**

```js
// move_portal/test/portal.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const { makeFakeData } = require('./fake_data');
const { makeFakeTx } = require('./fake_tx');

function setup() {
    const data = makeFakeData(core);
    const tx = makeFakeTx();
    data.db.items.push({ item: '11', sku: 'YSN201', desc: '20# cylinder', upc: '111' }, { item: '12', sku: 'YSN301', desc: '30# cylinder', upc: '112' });
    data.db.stock['35'] = { '11': { onHand: 1200, avail: 1000 }, '12': { onHand: 600, avail: 600 } };
    data.db.configs.push({ item: '11', code: 'A', pcs: 120, isDefault: true, batch: 'B1' }, { item: '12', code: 'A', pcs: 60, isDefault: true, batch: 'B1' });
    const sl = loadAmd('sl_move_portal.js', {
        'N/runtime': { getCurrentUser: () => ({ id: 5, name: 'Jack K', roleId: 'administrator', role: 3 }), getCurrentScript: () => ({ id: 's', deploymentId: 'd' }) },
        'N/log': { error() {}, debug() {}, audit() {} },
        'N/render': {}, 'N/url': {},
        'N/format': { format: () => '10/14/2026 2:14:05 pm', Type: { DATETIMETZ: 'dtz' }, Timezone: { AMERICA_LOS_ANGELES: 'la' } },
        './move_core': core, './move_data': data, './move_tx': tx, './move_label_template': {}, './move_ui': {}
    });
    const run = (action, a, mgr = true) => sl._runAction(action, Object.assign({ actor: 'Miguel' }, a || {}), mgr);
    return { data, tx, run };
}
const LINE201 = { item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 };
function printLabels(ctx, n, job, lines) {
    ctx.run('print_chunk', { job: job || 'Jtest1', lines: lines || [LINE201], upTo: n, source: 'plan' });
    return ctx.data.palletsByJob(job || 'Jtest1');
}

test('print_chunk creates labels once per job even when retried', () => {
    const ctx = setup();
    printLabels(ctx, 3);
    const again = printLabels(ctx, 3);
    assert.equal(again.length, 3);
    assert.deepEqual([again[0].status, again[0].summary, again[0].edited, again[0].printedDay, again[0].data.printedBy],
        ['labeled', 'YSN201 · A · 120', false, '2026-10-14', 'Miguel']);
    assert.equal(again[0].lines[0].desc, '20# cylinder');
    assert.equal(printLabels(ctx, 5).length, 5);
});

test('floor users cannot print, and a short pallet is flagged EDITED', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('print_chunk', { job: 'J1', lines: [LINE201], upTo: 1 }, false), /Managers only/);
    const ps = printLabels(ctx, 1, 'Jshort', [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 80 }]);
    assert.equal(ps[0].edited, true);
    assert.throws(() => ctx.run('print_chunk', { job: 'Jx', lines: [{ item: '999', pcs: 1 }], upTo: 1 }), /Unknown item/);
    assert.throws(() => ctx.run('print_chunk', { job: 'bad job', lines: [LINE201], upTo: 1 }), /print job id/);
});

test('item_lookup returns stock and configs, exact SKU first', () => {
    const ctx = setup();
    ctx.data.db.items.push({ item: '13', sku: 'YSN2010', desc: 'x', upc: '' });
    const r = ctx.run('item_lookup', { q: 'ysn201' }, false);
    assert.equal(r.items[0].sku, 'YSN201');
    assert.equal(r.items[0].onHand, 1200);
    assert.deepEqual(r.items[0].cfgs, [{ code: 'A', pcs: 120, isDefault: true }]);
});

test('label requests: floor asks, manager prints once, radio requests keep the caller name', () => {
    const ctx = setup();
    const { id } = ctx.run('req_create', { lines: [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 52 }], count: 2, note: 'aisle 3' }, false);
    assert.equal(ctx.run('req_list', { mine: true }, false).reqs[0].summary, 'YSN301 · A · 52');
    assert.throws(() => ctx.run('req_list', { status: 'queued' }, false), /Managers only/);
    assert.equal(ctx.run('req_list', { status: 'queued' }).reqs.length, 1);
    const p1 = ctx.run('req_print', { reqId: id });
    const p2 = ctx.run('req_print', { reqId: id });
    assert.equal(p1.job, p2.job);
    const ps = ctx.data.palletsByJob(p1.job);
    assert.equal(ps.length, 2);
    assert.equal(ps[0].edited, true);
    assert.equal(ps[0].data.source, 'request:' + id);
    assert.equal(ctx.run('req_list', { mine: true }, false).reqs[0].status, 'printed');
    const radio = ctx.run('req_create', { lines: [LINE201], count: 1, via: 'radio', requester: 'Santiago' });
    assert.equal(ctx.data.getReq(radio.id).requester, 'Santiago');
    const floorRadio = ctx.run('req_create', { lines: [LINE201], count: 1, via: 'radio', requester: 'Santiago' }, false);
    assert.equal(ctx.data.getReq(floorRadio.id).requester, 'Miguel');
    ctx.run('req_cancel', { reqId: floorRadio.id }, false);
    assert.equal(ctx.data.getReq(floorRadio.id).status, 'cancelled');
    assert.throws(() => ctx.run('req_create', { lines: [LINE201], count: 51 }, false), /1 to 50/);
});

test('void only unloaded labels; relabel prints a new one and voids the old', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2);
    ctx.run('pallet_void', { palletId: ps[0].id, reason: 'Sent to customer' }, false);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'void');
    assert.throws(() => ctx.run('pallet_void', { palletId: ps[0].id }, false), /Only labels not on a load/);
    assert.throws(() => ctx.run('pallet_relabel', { palletId: ps[1].id, lines: [LINE201] }, false), /Managers only/);
    const r = ctx.run('pallet_relabel', { palletId: ps[1].id, lines: [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 90 }] });
    const fresh = ctx.data.palletsByJob(r.job)[0];
    const old = ctx.data.getPallet(ps[1].id);
    assert.deepEqual([old.status, old.data.replacedBy, fresh.pieces, fresh.edited, r.code], ['void', fresh.id, 90, true, fresh.code]);
    const got = ctx.run('pallet_get', { code: r.code.toLowerCase() }, false).pallet;
    assert.equal(got.edLines[0].cfgs.length, 1);
    assert.throws(() => ctx.run('pallet_get', { code: '12345' }, false), /Not a move label/);
    assert.deepEqual(ctx.run('pallet_reprint', { palletId: fresh.id }).ids, [fresh.id]);
    assert.equal(ctx.data.getPallet(fresh.id).data.printCount, 2);
});

test('config import: preview flags problems; chunked commit is retry-safe; activate; cleanup', () => {
    const ctx = setup();
    const pv = ctx.run('cfg_preview', { csv: 'SKU,Config,Pcs per pallet,Default\nYSN201,A,120,Y\nYSN201,B,60,N\nYSN301,A,60,\nNOPE,A,5,Y\nYSN301,B,0,N' });
    assert.deepEqual([pv.configs.length, pv.unknownSkus, pv.errors.length, pv.skuCount, pv.noConfigWithStock], [3, ['NOPE'], 1, 2, []]);
    ctx.run('cfg_commit_chunk', { batch: 'B2', configs: pv.configs.slice(0, 2), upTo: 2 });
    ctx.run('cfg_commit_chunk', { batch: 'B2', configs: pv.configs.slice(0, 2), upTo: 2 });
    ctx.run('cfg_commit_chunk', { batch: 'B2', configs: pv.configs.slice(2), upTo: 3 });
    assert.equal(ctx.data.countConfigsInBatch('B2'), 3);
    assert.throws(() => ctx.run('cfg_cleanup', { batch: 'B2' }), /Activate/);
    ctx.run('cfg_activate', { batch: 'B2' });
    assert.equal(ctx.run('cfg_cleanup', { batch: 'B2' }).remaining, 0);
    assert.equal(ctx.data.db.configs.length, 3);
    const list = ctx.run('cfg_list');
    assert.equal(list.rows.find(r => r.sku === 'YSN201').cfgs.length, 2);
    assert.throws(() => ctx.run('cfg_commit_chunk', { batch: 'x', configs: [], upTo: 0 }), /Bad batch/);
});

test('plan subtracts already-labeled stock and lists SKUs with no config', () => {
    const ctx = setup();
    ctx.data.db.items.push({ item: '14', sku: 'NOCFG', desc: '', upc: '' });
    ctx.data.db.stock['35']['14'] = { onHand: 5, avail: 5 };
    printLabels(ctx, 3);
    const r = ctx.run('plan');
    const y201 = r.rows.find(x => x.sku === 'YSN201');
    assert.deepEqual([y201.palletsLeft, y201.labeled, y201.cfg, y201.pcs], [7, 3, 'A', 120]);
    assert.equal(r.rows.find(x => x.sku === 'YSN301').palletsLeft, 10);
    assert.deepEqual(r.noConfig.map(x => x.sku), ['NOCFG']);
    assert.equal(r.labeledPallets, 3);
    assert.equal(r.dayLabel, '2026-10-14');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `ENOENT ... sl_move_portal.js`.

- [ ] **Step 3: Write `sl_move_portal.js`.** Tasks 9–11 add more `act(...)` blocks at the marked spot.

```js
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Move Portal (Riverside -> Tippecanoe warehouse move). A separate app from the
 * picker portal; shares no code with it.
 * Spec: docs/superpowers/specs/2026-09-27-move-portal-design.md
 */
define(['N/runtime', 'N/log', 'N/render', 'N/url', 'N/format',
        './move_core', './move_data', './move_tx', './move_label_template', './move_ui'],
function (runtime, log, render, url, format, core, data, tx, tpl, ui) {
    'use strict';

    const P = core.PALLET, L = core.LOAD;
    const MANAGER_ROLE_SCRIPT_IDS = ['customrole_warehouse_manager', 'customrole1009', 'customrole2522', 'customrole_warehouse_portal_manager'];
    const PRINT_CHUNK_MAX = 80;
    const CFG_CHUNK_MAX = 100;
    const STALE_MS = 2 * 60 * 1000;

    // ── shared helpers ───────────────────────────────────────────────────
    function userErr(msg) { const e = new Error(msg); e.user = true; return e; }

    function isManager() {
        const u = runtime.getCurrentUser();
        const role = String(u.roleId || '').toLowerCase();
        if (role === 'administrator' || Number(u.role) === 3 || MANAGER_ROLE_SCRIPT_IDS.indexOf(role) !== -1) return true;
        return data.employeeIsPortalManager(u.id);
    }

    function nowInfo() {
        const stamp = format.format({ value: new Date(), type: format.Type.DATETIMETZ, timezone: format.Timezone.AMERICA_LOS_ANGELES });
        const p = core.parseNsStamp(stamp);
        return { stamp: stamp, dayIso: p ? p.dayIso : new Date().toISOString().slice(0, 10), hour: p ? p.hour : 12 };
    }

    function settings() {
        const S = data.getSettings();
        if (!S.locFrom || !S.locTo) throw userErr('Move settings are missing locFrom/locTo. Ask an admin to fill in the Move Settings record.');
        return S;
    }

    function pubPallet(p, extra) {
        return Object.assign({ id: p.id, code: p.code, status: p.status, summary: p.summary, headline: core.headline(p.lines),
            pieces: p.pieces, edited: p.edited, damaged: p.damaged, catchup: p.catchup, lines: p.lines, loadId: p.loadId,
            printedAt: p.data.printedAt || '', receipt: p.receipt }, extra || {});
    }

    function countsFromPallets(ps) {
        const out = {};
        ps.forEach(p => { const o = out[p.status] = out[p.status] || { n: 0, pcs: 0 }; o.n++; o.pcs += p.pieces; });
        return out;
    }

    function pubLoad(Ld, counts) {
        const d = Ld.data || {}, cs = counts || {};
        const n = st => (cs[st] ? cs[st].n : 0);
        const pcs = st => (cs[st] ? cs[st].pcs : 0);
        const onTruck = [P.LOADED, P.SHIPPED, P.RECEIVED, P.MISSING];
        return { id: Ld.id, number: Ld.number, status: Ld.status, door: d.door || '', carrier: d.carrier || '', trailer: d.trailer || '',
            seal: d.seal || '', to: Ld.to, if: Ld.if, error: d.error || '', readyBy: d.readyBy || '', readyAt: d.readyAt || '',
            approvedAt: d.approvedAt || '', approvedBy: d.approvedBy || '', catchupFor: d.catchupFor || '',
            pallets: onTruck.reduce((a, s) => a + n(s), 0), pieces: onTruck.reduce((a, s) => a + pcs(s), 0), received: n(P.RECEIVED) };
    }

    function mustLoad(id) { const Ld = data.getLoad(id); if (!Ld) throw userErr('Load not found'); return Ld; }
    function mustPallet(id) { const p = data.getPallet(id); if (!p) throw userErr('Label not found'); return p; }
    function stale(Ld) { return Date.now() - (Number(Ld.data.workingAt) || 0) > STALE_MS; }

    // Client lines are only trusted for item, cfg and pcs; SKU and description come from NetSuite.
    function normalizeLines(lines, S) {
        const err = core.validateLines(lines);
        if (err) throw userErr(err);
        const info = data.itemInfo(lines.map(l => l.item));
        const cfg = data.configsByItem(S.activeBatch);
        return lines.map(l => {
            const i = info[String(l.item)];
            if (!i) throw userErr('Unknown item ' + (l.sku || l.item));
            const cs = cfg[String(l.item)] || [];
            return { item: String(l.item), sku: i.sku, desc: i.desc, cfg: cs.some(x => x.code === l.cfg) ? l.cfg : '', pcs: Math.floor(Number(l.pcs)) };
        });
    }

    function lineFields(lines, S) {
        return { summary: core.summarize(lines), pieces: core.totalPieces(lines),
            edited: core.isEdited(lines, core.pcsMap(data.configsByItem(S.activeBatch))) };
    }

    // Idempotent: creates only the labels still missing to reach `upTo` for this job.
    function createPalletsForJob(job, lines, upTo, source, c) {
        const target = Math.floor(Number(upTo)) || 0;
        const existing = data.countByJob(job);
        const n = target - existing;
        if (n > PRINT_CHUNK_MAX) throw userErr('Too many labels in one request (max ' + PRINT_CHUNK_MAX + ')');
        const f = lineFields(lines, c.S);
        for (let i = 0; i < n; i++) {
            data.createPallet(Object.assign({ status: P.LABELED, job: job, printedDay: c.now.dayIso }, f,
                { lines: lines, data: { source: source, printedAt: c.now.stamp, printedBy: c.actor, printCount: 1 } }));
        }
        return Math.max(existing, target);
    }

    function stockModel(c) {
        const stock = data.locationStock(c.S.locFrom, null);
        const cfg = data.configsByItem(c.S.activeBatch);
        const onHand = {};
        Object.keys(stock).forEach(k => { onHand[k] = stock[k].onHand; });
        return { stock: stock, cfg: cfg, est: core.estimateRemaining(onHand, core.defaultPcs(cfg)) };
    }

    function tracker(c, est) {
        const moved = data.movedByDay();
        const todayDone = (moved[c.now.dayIso] || 0) > 0 && c.now.hour >= 15;
        return core.trackerMetrics({ todayIso: c.now.dayIso, targetIso: c.S.target, startIso: c.S.start, skipDates: c.S.skip || [],
            remaining: est.pallets, movedByDay: moved, todayDone: todayDone });
    }

    // ── actions ──────────────────────────────────────────────────────────
    const A = {};
    function act(name, managerOnly, fn) { A[name] = { m: managerOnly, fn: fn }; }

    // items and configs
    act('item_lookup', false, (a, c) => {
        const q = String(a.q || '').trim();
        if (!q) return { items: [] };
        const items = data.itemLookup(q);
        const stock = data.locationStock(c.S.locFrom, items.map(i => i.item));
        const cfg = data.configsByItem(c.S.activeBatch);
        const exact = i => (i.sku.toUpperCase() === q.toUpperCase() || i.upc === q ? 0 : 1);
        items.sort((x, y) => exact(x) - exact(y));
        return { items: items.map(i => Object.assign({}, i, { onHand: stock[i.item] ? stock[i.item].onHand : 0, cfgs: cfg[i.item] || [] })) };
    });

    act('cfg_list', true, (a, c) => {
        const cfg = data.configsByItem(c.S.activeBatch);
        const stock = data.locationStock(c.S.locFrom, null);
        const info = data.itemInfo(Object.keys(cfg));
        const rows = Object.keys(cfg).map(item => {
            const def = cfg[item].find(x => x.isDefault) || cfg[item][0];
            const onHand = stock[item] ? stock[item].onHand : 0;
            return { item: item, sku: info[item] ? info[item].sku : item, desc: info[item] ? info[item].desc : '', cfgs: cfg[item],
                onHand: onHand, estPallets: def && onHand > 0 ? Math.ceil(onHand / def.pcs) : 0 };
        }).sort((x, y) => y.onHand - x.onHand);
        const noConfig = Object.keys(stock).filter(k => !cfg[k] && stock[k].onHand > 0).map(k => ({ item: k, sku: stock[k].sku }));
        return { rows: rows, noConfig: noConfig, activeBatch: c.S.activeBatch };
    });

    act('cfg_preview', true, (a, c) => {
        const rows = core.parseCsv(a.csv);
        if (!rows.length) throw userErr('The CSV is empty');
        const imp = core.buildConfigImport(rows, data.skuMap());
        const stock = data.locationStock(c.S.locFrom, null);
        const has = {}, skus = {};
        imp.configs.forEach(x => { has[x.item] = 1; skus[x.sku] = 1; });
        return { configs: imp.configs, errors: imp.errors, unknownSkus: imp.unknownSkus, skuCount: Object.keys(skus).length,
            noConfigWithStock: Object.keys(stock).filter(k => !has[k] && stock[k].onHand > 0).map(k => stock[k].sku) };
    });

    act('cfg_commit_chunk', true, (a, c) => {
        const batch = String(a.batch || '');
        const list = Array.isArray(a.configs) ? a.configs : [];
        if (!/^B\d+$/.test(batch)) throw userErr('Bad batch id');
        if (list.length > CFG_CHUNK_MAX) throw userErr('Too many configs in one request');
        const start = Math.floor(Number(a.upTo)) - list.length;
        const skip = Math.max(0, data.countConfigsInBatch(batch) - start);
        list.slice(skip).forEach(x => {
            const pcs = Math.floor(Number(x.pcs));
            if (!x.item || !x.code || !(pcs > 0)) throw userErr('Bad config row for ' + (x.sku || x.item));
            data.createConfig({ item: String(x.item), code: String(x.code).toUpperCase(), pcs: pcs, isDefault: !!x.isDefault }, batch);
        });
        return { written: data.countConfigsInBatch(batch) };
    });

    act('cfg_activate', true, (a) => {
        const batch = String(a.batch || '');
        if (!data.countConfigsInBatch(batch)) throw userErr('That import batch has no configs');
        data.saveSettings({ activeBatch: batch });
        return {};
    });

    act('cfg_cleanup', true, (a, c) => {
        if (!c.S.activeBatch || String(a.batch) !== c.S.activeBatch) throw userErr('Activate the batch before cleanup');
        return { remaining: data.deleteConfigsNotInBatch(c.S.activeBatch, 150) };
    });

    // printing and label requests
    act('print_chunk', true, (a, c) => {
        const job = String(a.job || '');
        if (!/^J[a-z0-9]+$/i.test(job)) throw userErr('Bad print job id');
        const lines = normalizeLines(a.lines, c.S);
        const src = a.source === 'plan' ? 'plan' : 'office';
        return { created: createPalletsForJob(job, lines, a.upTo, src, c) };
    });

    function pubReq(q) {
        const d = q.data || {};
        return { id: q.id, status: q.status, requester: q.requester, summary: core.summarize(d.lines || []), count: d.count || 1,
            note: d.note || '', via: d.via || 'phone', at: d.at || '', job: d.job || '' };
    }

    act('req_create', false, (a, c) => {
        const lines = normalizeLines(a.lines, c.S);
        const count = Math.floor(Number(a.count) || 1);
        if (count < 1 || count > 50) throw userErr('Request 1 to 50 labels');
        const radio = c.mgr && a.via === 'radio';
        const requester = radio ? String(a.requester || '').trim().slice(0, 60) : c.actor;
        if (!requester) throw userErr('Enter who called it in');
        const id = data.createReq({ status: 'queued', requester: requester,
            data: { lines: lines, count: count, note: String(a.note || '').slice(0, 200), via: radio ? 'radio' : 'phone', at: c.now.stamp } });
        return { id: id };
    });

    act('req_list', false, (a, c) => {
        if (!a.mine && !c.mgr) throw userErr('Managers only');
        const q = a.mine ? { requester: c.actor, limit: 20 } : { status: a.status === 'queued' ? 'queued' : null, limit: 100 };
        return { reqs: data.findReqs(q).map(pubReq) };
    });

    act('req_print', true, (a, c) => {
        const q = data.getReq(a.reqId);
        if (!q) throw userErr('Request not found');
        if (q.status === 'cancelled') throw userErr('That request was cancelled');
        const job = 'R' + q.id;
        createPalletsForJob(job, q.data.lines, q.data.count || 1, 'request:' + q.id, c);
        if (q.status !== 'printed') data.updateReq(q, { status: 'printed', data: { job: job, printedAt: c.now.stamp, printedBy: c.actor } });
        return { job: job };
    });

    act('req_cancel', false, (a, c) => {
        const q = data.getReq(a.reqId);
        if (!q) throw userErr('Request not found');
        if (!c.mgr && q.requester !== c.actor) throw userErr('Only the requester or a manager can cancel');
        if (q.status !== 'queued') throw userErr('Only queued requests can be cancelled');
        data.updateReq(q, { status: 'cancelled' });
        return {};
    });

    // pallet tools
    act('pallet_get', false, (a, c) => {
        const sc = core.parseScan(a.code);
        if (!sc.palletId) throw userErr('Not a move label: ' + sc.raw);
        const p = mustPallet(sc.palletId);
        const Ld = p.loadId ? data.getLoad(p.loadId) : null;
        const cfg = data.configsByItem(c.S.activeBatch);
        const edLines = p.lines.map(l => ({ item: l.item, sku: l.sku, desc: l.desc || '', onHand: null, cfgs: cfg[l.item] || [], cfg: l.cfg, pcs: l.pcs }));
        return { pallet: pubPallet(p, { loadNumber: Ld ? Ld.number : '', edLines: edLines }) };
    });

    act('pallet_void', false, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.LABELED) throw userErr(p.code + ' is ' + p.status + '. Only labels not on a load can be voided.');
        data.updatePallet(p, { status: P.VOID, data: { voidReason: String(a.reason || '').slice(0, 60), voidedBy: c.actor, voidedAt: c.now.stamp } });
        return {};
    });

    act('pallet_reprint', true, (a) => {
        const p = mustPallet(a.palletId);
        if (p.status === P.VOID) throw userErr(p.code + ' is voided');
        data.updatePallet(p, { data: { printCount: (Number(p.data.printCount) || 1) + 1 } });
        return { ids: [p.id] };
    });

    act('pallet_relabel', true, (a, c) => {
        const p = mustPallet(a.palletId);
        const job = 'RL' + p.id;
        let np = data.palletsByJob(job)[0];
        if (!np) {
            if (p.status !== P.LABELED) throw userErr(p.code + ' is ' + p.status + '. Fix loaded pallets with Edit on the Load screen.');
            createPalletsForJob(job, normalizeLines(a.lines, c.S), 1, 'relabel:' + p.id, c);
            np = data.palletsByJob(job)[0];
        }
        if (p.status !== P.VOID) {
            data.updatePallet(p, { status: P.VOID, data: { voidReason: 'relabeled', replacedBy: np.id, voidedBy: c.actor, voidedAt: c.now.stamp } });
        }
        return { job: job, code: np.code };
    });

    act('plan', true, (a, c) => {
        const sm = stockModel(c);
        const m = tracker(c, sm.est);
        const labeled = data.labeledPiecesByItem();
        const rows = [], noConfig = [];
        Object.keys(sm.stock).forEach(item => {
            const st = sm.stock[item];
            if (st.onHand <= 0) return;
            const cs = sm.cfg[item];
            const def = cs && (cs.find(x => x.isDefault) || cs[0]);
            if (!def) { noConfig.push({ item: item, sku: st.sku }); return; }
            const lab = labeled[item] || 0;
            rows.push({ item: item, sku: st.sku, desc: st.desc, cfg: def.code, pcs: def.pcs,
                palletsLeft: Math.ceil(Math.max(0, st.onHand - lab) / def.pcs), labeled: Math.ceil(lab / def.pcs) });
        });
        const labeledPallets = rows.reduce((x, r) => x + r.labeled, 0);
        const need = isFinite(m.neededPerDay) ? m.neededPerDay : m.remaining;
        const sugg = core.suggestPlan(rows.filter(r => r.palletsLeft > 0), Math.max(0, need - labeledPallets));
        rows.forEach(r => { r.suggest = sugg[r.item] || 0; });
        rows.sort((x, y) => y.palletsLeft - x.palletsLeft);
        return { dayLabel: c.now.dayIso, neededPerDay: isFinite(m.neededPerDay) ? m.neededPerDay : null, labeledPallets: labeledPallets,
            rows: rows.filter(r => r.palletsLeft > 0 || r.labeled > 0), noConfig: noConfig };
    });

    // ── (Tasks 9–11 add more act(...) blocks here) ──

    // ── entry points ─────────────────────────────────────────────────────
    function runAction(action, a, mgr) {
        const def = A[action];
        if (!def) throw userErr('Unknown action: ' + action);
        if (def.m && !mgr) throw userErr('Managers only');
        data.resetCache();
        const body = a || {};
        const c = { mgr: !!mgr, S: settings(), now: nowInfo(),
            actor: String(body.actor || '').trim().slice(0, 60) || runtime.getCurrentUser().name };
        return def.fn(body, c) || {};
    }

    function onRequest(ctx) {
        const q = ctx.request.parameters;
        if (!q.action) return page(ctx);
        if (q.action === 'pdf') return pdf(ctx);
        let out;
        try {
            let a = {};
            try { a = JSON.parse(ctx.request.body || '{}') || {}; } catch (e) { a = {}; }
            out = Object.assign({ ok: true }, runAction(q.action, a, isManager()));
        } catch (e) {
            if (!e.user) log.error({ title: 'move ' + q.action, details: (e && e.stack) || String(e) });
            out = { ok: false, error: e.user ? e.message : 'Error: ' + (e.message || e.name || String(e)) };
        }
        ctx.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        ctx.response.write(JSON.stringify(out));
    }

    function page(ctx) {
        const S = data.getSettings();
        const script = runtime.getCurrentScript();
        ctx.response.write(ui.buildPage({
            url: url.resolveScript({ scriptId: script.id, deploymentId: script.deploymentId }),
            mode: isManager() ? 'manager' : 'floor', me: runtime.getCurrentUser().name, roster: S.roster || [],
            fromName: S.fromName, toName: S.toName, maxPrint: Number(S.maxPrint) || 250
        }));
    }

    function loadSheetModel(Ld, S) {
        const ps = data.palletsByLoad(Ld.id, [P.LOADED, P.SHIPPED, P.RECEIVED, P.MISSING]);
        const t = data.tranids([Ld.to, Ld.if].filter(Boolean));
        const tot = {}, sku = {};
        ps.forEach(p => p.lines.forEach(l => { tot[l.item] = (tot[l.item] || 0) + l.pcs; sku[l.item] = l.sku; }));
        const d = Ld.data || {};
        return { number: Ld.number, fromName: S.fromName, toName: S.toName, toNumber: t[Ld.to] || '', ifNumber: t[Ld.if] || '',
            door: d.door || '', carrier: d.carrier || '', trailer: d.trailer || '', seal: d.seal || '',
            approvedAt: d.approvedAt || '', approvedBy: d.approvedBy || '',
            pallets: ps.map(p => ({ code: p.code, summary: p.summary, pieces: p.pieces })),
            totals: Object.keys(tot).map(k => ({ sku: sku[k], qty: tot[k] })).sort((x, y) => (x.sku < y.sku ? -1 : 1)) };
    }

    function pdf(ctx) {
        const q = ctx.request.parameters;
        if (!isManager()) { ctx.response.write('Managers only'); return; }
        const S = data.getSettings();
        let xml;
        if (q.type === 'loadsheet') {
            const Ld = data.getLoad(q.loadId);
            if (!Ld) { ctx.response.write('Load not found'); return; }
            xml = tpl.loadSheetXml(loadSheetModel(Ld, S));
        } else {
            const ps = q.job ? data.palletsByJob(String(q.job)).filter(p => p.status !== P.VOID) : data.palletsByIds(String(q.ids || '').split(','));
            if (!ps.length) { ctx.response.write('No labels to print'); return; }
            xml = tpl.labelsXml(ps.map(p => ({ code: p.code, lines: p.lines, pieces: p.pieces, edited: p.edited, printedDay: p.printedDay,
                by: p.data.printedBy || '', summary: p.summary })), { codeMode: S.labelCode, header: q.header === '1', fromName: S.fromName, toName: S.toName });
        }
        ctx.response.writeFile({ file: render.xmlToPdf({ xmlString: xml }), isInline: true });
    }

    return { onRequest: onRequest, _runAction: runAction };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 33 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(move): suitelet shell with configs, printing, requests, pallet tools, plan"
```

---

### Task 9: Loading and Approve & Ship

**Files:**
- Modify: `move_portal/sl_move_portal.js`. Insert the block below right after the line `// ── (Tasks 9–11 add more act(...) blocks here) ──`.
- Test: `move_portal/test/portal.test.js` (append)

**Interfaces:**
- Consumes: the helpers from Task 8; `tx.findByToken`, `tx.createTransferOrder`, `tx.committedShortfalls`, `tx.fulfillTransferOrder`; `core.loadScanRule`, `core.aggregate`, `core.shortages`, `core.txToken`, `core.nextLoadNumber`.
- Produces:
  - Actions: `load_list`, `load_create`, `load_get`, `scan_load`, `load_move_here`, `pallet_edit`, `pallet_remove`, `load_ready`, `load_sendback`, `ship_list`, `load_approve`.
  - Helpers: `loadView(loadId) → {load, pallets (newest first), totals:{pallets, pieces, skus}}` and `shipLoad(load, c) → {number, toNumber, ifNumber}`. Task 10 reuses `shipLoad` for catch-ups.
  - Load `data.phase` is `'ship'` while shipping, `'recv'` while receiving, or `''`. `ship_list` shows only loads whose phase isn't `'recv'`.

- [ ] **Step 1: Append the failing tests**

```js
// ── Task 9 ──
function openLoad(ctx) { return ctx.run('load_create', { door: '4', carrier: 'Estes', trailer: '53', seal: '9' }, false).load; }
function loadAndReady(ctx, n, job) {
    const ps = printLabels(ctx, n, job || 'Jship');
    const L = openLoad(ctx);
    ps.forEach(p => ctx.run('scan_load', { loadId: L.id, raw: p.code }, false));
    ctx.run('load_ready', { loadId: L.id }, false);
    return { ps, L };
}
const txCount = (ctx, type) => ctx.tx._t.calls.filter(c => c.type === type).length;

test('load scanning: ok, dup, unknown, void, other open load, move here', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 3);
    const L1 = openLoad(ctx), L2 = openLoad(ctx);
    assert.deepEqual([L1.number, L2.number, L1.door], ['MV-001', 'MV-002', '4']);
    let r = ctx.run('scan_load', { loadId: L1.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.tone, r.view.totals.pallets, r.view.totals.pieces, r.pallet.status], ['ok', 'ok', 1, 120, 'loaded']);
    assert.equal(ctx.run('scan_load', { loadId: L1.id, raw: ps[0].code }, false).result, 'dup');
    assert.equal(ctx.run('scan_load', { loadId: L1.id, raw: '0714528803' }, false).result, 'unknown');
    ctx.run('pallet_void', { palletId: ps[2].id, reason: 'Damaged' }, false);
    assert.equal(ctx.run('scan_load', { loadId: L1.id, raw: ps[2].code }, false).result, 'void');
    ctx.run('scan_load', { loadId: L2.id, raw: ps[1].code }, false);
    r = ctx.run('scan_load', { loadId: L1.id, raw: ps[1].code }, false);
    assert.deepEqual([r.result, r.otherNumber], ['other_load', 'MV-002']);
    r = ctx.run('load_move_here', { loadId: L1.id, palletId: ps[1].id }, false);
    assert.equal(r.view.totals.pallets, 2);
    assert.equal(ctx.run('load_get', { loadId: L2.id }, false).totals.pallets, 0);
    assert.equal(ctx.data.db.scans.length, 6);
    assert.equal(ctx.run('load_list', {}, false).loads.length, 2);
});

test('edit and remove only while loading; ready closes scanning', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2);
    const L = openLoad(ctx);
    assert.throws(() => ctx.run('load_ready', { loadId: L.id }, false), /at least one/);
    ctx.run('scan_load', { loadId: L.id, raw: ps[0].code }, false);
    const e = ctx.run('pallet_edit', { loadId: L.id, palletId: ps[0].id, lines: [{ item: '11', pcs: 100 }] }, false);
    assert.deepEqual([e.pallet.pieces, e.pallet.edited, e.pallet.summary, e.view.totals.pieces], [100, true, 'YSN201 · A · 100', 100]);
    assert.throws(() => ctx.run('pallet_edit', { loadId: L.id, palletId: ps[0].id, lines: [{ item: '12', pcs: 1 }] }, false), /only change piece counts/);
    ctx.run('pallet_remove', { loadId: L.id, palletId: ps[0].id }, false);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'labeled');
    ctx.run('scan_load', { loadId: L.id, raw: ps[1].code }, false);
    ctx.run('load_ready', { loadId: L.id }, false);
    assert.throws(() => ctx.run('scan_load', { loadId: L.id, raw: ps[0].code }, false), /closed for scanning/);
    assert.throws(() => ctx.run('pallet_remove', { loadId: L.id, palletId: ps[1].id }, false), /open load/);
    assert.throws(() => ctx.run('load_sendback', { loadId: L.id }, false), /Managers only/);
    ctx.run('load_sendback', { loadId: L.id });
    assert.equal(ctx.data.getLoad(L.id).status, 'loading');
});

test('approve & ship creates one TO and one IF and ships the pallets', () => {
    const ctx = setup();
    const { ps, L } = loadAndReady(ctx, 2);
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }, false), /Managers only/);
    const list = ctx.run('ship_list');
    assert.deepEqual(list.loads[0].rows, [{ item: '11', sku: 'YSN201', qty: 240, avail: 1000, ok: true }]);
    const r = ctx.run('load_approve', { loadId: L.id });
    assert.equal(r.number, 'MV-001');
    assert.deepEqual(ctx.tx._t.calls.map(c => c.type), ['TrnfrOrd', 'ItemShip']);
    assert.deepEqual(ctx.tx._t.calls[0].lines, { '11': 240 });
    assert.deepEqual([ctx.tx._t.calls[0].fromLoc, ctx.tx._t.calls[0].toLoc], ['35', '99']);
    assert.match(ctx.tx._t.memos[0].memo, /\[mv:\d+:to\]/);
    const Ld = ctx.data.getLoad(L.id);
    assert.deepEqual([Ld.status, Ld.data.approvedBy, Ld.data.phase], ['shipped', 'Miguel', '']);
    ps.forEach(p => { const x = ctx.data.getPallet(p.id); assert.deepEqual([x.status, x.shippedDay], ['shipped', '2026-10-14']); });
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /not ready to ship/);
    assert.equal(ctx.run('ship_list').loads.length, 0);
    assert.equal(ctx.run('ship_list').recent[0].number, 'MV-001');
});

test('stock shortage blocks approval and leaves the load ready', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 2);
    ctx.data.db.stock['35']['11'].avail = 100;
    assert.equal(ctx.run('ship_list').loads[0].rows[0].ok, false);
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /YSN201 needs 240, available 100/);
    assert.equal(ctx.data.getLoad(L.id).status, 'ready');
    assert.equal(ctx.tx._t.calls.length, 0);
});

test('an IF failure is retried without a second TO; a crash after the IF saved does not duplicate it', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 1);
    ctx.tx._t.failNext = 'if';
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /IF save failed/);
    let Ld = ctx.data.getLoad(L.id);
    assert.deepEqual([Ld.status, Ld.data.error, txCount(ctx, 'TrnfrOrd')], ['error', 'IF save failed', 1]);
    assert.equal(ctx.run('ship_list').loads[0].canSendBack, false);
    ctx.tx._t.failNext = 'if_after';
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /crashed after save/);
    ctx.run('load_approve', { loadId: L.id });
    assert.deepEqual([txCount(ctx, 'TrnfrOrd'), txCount(ctx, 'ItemShip'), ctx.data.getLoad(L.id).status], [1, 1, 'shipped']);
});

test('committed shortfall on the TO stops before the IF', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 1);
    ctx.tx._t.shortfalls = [{ item: '11', need: 120, committed: 60 }];
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /YSN201 reserved 60 of 120/);
    assert.equal(txCount(ctx, 'ItemShip'), 0);
    ctx.tx._t.shortfalls = [];
    ctx.run('load_approve', { loadId: L.id });
    assert.equal(txCount(ctx, 'ItemShip'), 1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `Unknown action: load_create`.

- [ ] **Step 3: Insert this block after `// ── (Tasks 9–11 add more act(...) blocks here) ──`:**

```js
    // ── loading (outbound) ───────────────────────────────────────────────
    const OUT_OPEN = [L.LOADING, L.READY, L.SHIPPING, L.ERROR];

    function loadView(loadId) {
        const Ld = mustLoad(loadId);
        const pallets = data.palletsByLoad(Ld.id, [P.LOADED, P.SHIPPED, P.RECEIVED, P.MISSING]);
        const items = {};
        pallets.forEach(p => p.lines.forEach(l => { items[l.item] = 1; }));
        return { load: pubLoad(Ld, countsFromPallets(pallets)), pallets: pallets.slice().reverse().map(p => pubPallet(p)),
            totals: { pallets: pallets.length, pieces: pallets.reduce((a, p) => a + p.pieces, 0), skus: Object.keys(items).length } };
    }

    act('load_list', false, () => {
        const loads = data.loadsByStatus(OUT_OPEN, 50).filter(l => (l.data || {}).phase !== 'recv');
        const counts = data.palletCountsByLoad(loads.map(l => l.id));
        return { loads: loads.map(l => pubLoad(l, counts[l.id])) };
    });

    act('load_create', false, (a, c) => {
        const clean = v => String(v || '').trim().slice(0, 40);
        const id = data.createLoad({ number: core.nextLoadNumber(data.allLoadNumbers()), status: L.LOADING,
            data: { door: clean(a.door), carrier: clean(a.carrier), trailer: clean(a.trailer), seal: clean(a.seal), createdBy: c.actor, createdAt: c.now.stamp } });
        // Two docks opening a load at the same moment can get the same number; the newer one renumbers.
        const Ld = data.getLoad(id);
        if (data.loadsByNumber(Ld.number).some(x => Number(x.id) < Number(id))) data.updateLoad(Ld, { number: core.nextLoadNumber(data.allLoadNumbers()) });
        return { load: pubLoad(data.getLoad(id)) };
    });

    act('load_get', false, (a) => loadView(a.loadId));

    act('scan_load', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        if (Ld.status !== L.LOADING) throw userErr(Ld.number + ' is closed for scanning (' + Ld.status + ')');
        const sc = core.parseScan(a.raw);
        const p = sc.palletId ? data.getPallet(sc.palletId) : null;
        const loads = {};
        if (p && p.loadId) { const o = p.loadId === Ld.id ? Ld : data.getLoad(p.loadId); if (o) loads[o.id] = o; }
        const rule = core.loadScanRule(p, Ld.id, loads);
        if (rule.set) data.updatePallet(p, { status: rule.set.status, load: rule.set.loadId, data: { loadedAt: c.now.stamp, loadedBy: c.actor } });
        data.logScan({ pallet: p ? p.id : '', load: Ld.id, result: rule.result, data: { raw: sc.raw, mode: 'load', actor: c.actor, at: c.now.stamp } });
        const fresh = p ? data.getPallet(p.id) : null;
        return { result: rule.result, tone: core.toneFor(rule.result), raw: sc.raw, pallet: fresh ? pubPallet(fresh) : null,
            loadNumber: Ld.number, otherNumber: rule.otherNumber || '', view: loadView(Ld.id) };
    });

    act('load_move_here', false, (a, c) => {
        const Ld = mustLoad(a.loadId), p = mustPallet(a.palletId);
        if (Ld.status !== L.LOADING) throw userErr(Ld.number + ' is closed for scanning');
        const other = p.loadId ? data.getLoad(p.loadId) : null;
        if (p.status !== P.LOADED || !other || other.status !== L.LOADING) throw userErr(p.code + ' can no longer be moved');
        data.updatePallet(p, { load: Ld.id, data: { loadedAt: c.now.stamp, loadedBy: c.actor, movedFrom: other.number } });
        return { pallet: pubPallet(data.getPallet(p.id)), view: loadView(Ld.id) };
    });

    function editablePallet(a) {
        const Ld = mustLoad(a.loadId), p = mustPallet(a.palletId);
        if (Ld.status !== L.LOADING || p.status !== P.LOADED || p.loadId !== Ld.id) throw userErr(p.code + ' can only be changed while it is on an open load');
        return { Ld: Ld, p: p };
    }

    act('pallet_edit', false, (a, c) => {
        const o = editablePallet(a);
        const byItem = {};
        o.p.lines.forEach(l => { byItem[String(l.item)] = l; });
        const next = (Array.isArray(a.lines) ? a.lines : []).map(l => byItem[String(l.item)] ? Object.assign({}, byItem[String(l.item)], { pcs: l.pcs }) : null);
        if (next.length !== o.p.lines.length || next.some(l => !l)) throw userErr('Edit can only change piece counts');
        const err = core.validateLines(next);
        if (err) throw userErr(err);
        const lines = next.map(l => Object.assign({}, l, { pcs: Math.floor(Number(l.pcs)) }));
        data.updatePallet(o.p, { lines: lines, summary: core.summarize(lines), pieces: core.totalPieces(lines), edited: true,
            data: { editedAt: c.now.stamp, editedBy: c.actor } });
        return { pallet: pubPallet(data.getPallet(o.p.id)), view: loadView(o.Ld.id) };
    });

    act('pallet_remove', false, (a, c) => {
        const o = editablePallet(a);
        data.updatePallet(o.p, { status: P.LABELED, load: '', data: { removedAt: c.now.stamp, removedBy: c.actor } });
        return { view: loadView(o.Ld.id) };
    });

    act('load_ready', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        if (Ld.status !== L.LOADING) throw userErr(Ld.number + ' is not open');
        if (!data.palletsByLoad(Ld.id, [P.LOADED]).length) throw userErr('Scan at least one pallet first');
        data.updateLoad(Ld, { status: L.READY, data: { readyBy: c.actor, readyAt: c.now.stamp } });
        return {};
    });

    act('load_sendback', true, (a) => {
        const Ld = mustLoad(a.loadId);
        if ([L.READY, L.ERROR].indexOf(Ld.status) === -1 || Ld.to) throw userErr(Ld.number + ' can no longer be sent back');
        data.updateLoad(Ld, { status: L.LOADING, data: { error: '', phase: '' } });
        return {};
    });

    act('ship_list', true, (a, c) => {
        const loads = data.loadsByStatus([L.READY, L.SHIPPING, L.ERROR], 50).filter(l => (l.data || {}).phase !== 'recv');
        const per = loads.map(Ld => ({ Ld: Ld, pallets: data.palletsByLoad(Ld.id, [P.LOADED]) }));
        const skuOf = {};
        per.forEach(o => o.pallets.forEach(p => p.lines.forEach(l => { skuOf[l.item] = l.sku; })));
        const stock = Object.keys(skuOf).length ? data.locationStock(c.S.locFrom, Object.keys(skuOf)) : {};
        const out = per.map(o => {
            const agg = o.Ld.to && o.Ld.data.lines ? o.Ld.data.lines : core.aggregate(o.pallets);
            const rows = Object.keys(agg).map(item => {
                const avail = stock[item] ? stock[item].avail : 0;
                // Once the TO exists its own lines are already committed, so availability no longer applies.
                return { item: item, sku: skuOf[item] || item, qty: agg[item], avail: avail, ok: !!o.Ld.to || avail >= agg[item] };
            });
            return Object.assign(pubLoad(o.Ld, countsFromPallets(o.pallets)), { rows: rows,
                canSendBack: !o.Ld.to && [L.READY, L.ERROR].indexOf(o.Ld.status) !== -1 });
        });
        const recent = data.loadsByStatus([L.SHIPPED, L.RECEIVING, L.RECV_READY, L.RECEIVED, L.RECEIVED_SHORT], 10);
        const t = data.tranids([].concat.apply([], recent.map(l => [l.to, l.if])).filter(Boolean));
        const rc = data.palletCountsByLoad(recent.map(l => l.id));
        return { loads: out, recent: recent.map(l => Object.assign(pubLoad(l, rc[l.id]), { toNumber: t[l.to] || '', ifNumber: t[l.if] || '' })) };
    });

    // Resumable: each finished step (TO, IF) is saved on the load, and memo tokens
    // find a transaction that was saved just before a crash.
    function shipLoad(Ld, c) {
        if ([L.READY, L.ERROR, L.SHIPPING].indexOf(Ld.status) === -1 || Ld.data.phase === 'recv') throw userErr(Ld.number + ' is ' + Ld.status + ', not ready to ship');
        if (Ld.status === L.SHIPPING && !stale(Ld)) throw userErr(Ld.number + ' is already being shipped. Wait a minute and refresh.');
        data.updateLoad(Ld, { status: L.SHIPPING, data: { workingAt: Date.now(), error: '', phase: 'ship' } });
        Ld = data.getLoad(Ld.id);
        try {
            const skuOf = {};
            data.palletsByLoad(Ld.id, [P.LOADED, P.SHIPPED]).forEach(p => p.lines.forEach(l => { skuOf[l.item] = l.sku; }));
            const name = k => skuOf[k] || k;
            let lines = Ld.data.lines;
            if (!Ld.to) {
                const loaded = data.palletsByLoad(Ld.id, [P.LOADED]);
                if (!loaded.length) throw userErr('No pallets on ' + Ld.number);
                lines = core.aggregate(loaded);
                const stock = data.locationStock(c.S.locFrom, Object.keys(lines));
                const avail = {};
                Object.keys(stock).forEach(k => { avail[k] = stock[k].avail; });
                const short = core.shortages(lines, avail);
                if (short.length) {
                    data.updateLoad(Ld, { status: L.READY, data: { workingAt: 0, phase: '' } });
                    throw userErr('Not enough available at ' + c.S.fromName + ': ' +
                        short.map(s => name(s.item) + ' needs ' + s.need + ', available ' + s.avail).join('; ') + '. Remove a pallet or check the count.');
                }
                const tok = core.txToken(Ld.id, 'to');
                const toId = tx.findByToken(tok, 'TrnfrOrd') || tx.createTransferOrder({ fromLoc: c.S.locFrom, toLoc: c.S.locTo,
                    orderStatus: c.S.toStatus, memo: 'Move ' + Ld.number + ' ' + tok, lines: lines });
                data.updateLoad(Ld, { to: toId, data: { lines: lines } });
                Ld = data.getLoad(Ld.id);
            }
            if (!Ld.if) {
                const tok = core.txToken(Ld.id, 'if');
                let ifId = tx.findByToken(tok, 'ItemShip');
                if (!ifId) {
                    const sf = tx.committedShortfalls(Ld.to, lines);
                    if (sf.length) throw userErr('The transfer order was created but NetSuite reserved less than the load: ' +
                        sf.map(s => name(s.item) + ' reserved ' + s.committed + ' of ' + s.need).join('; ') +
                        '. Free that stock (or fix the transfer order in NetSuite) and press Retry.');
                    ifId = tx.fulfillTransferOrder(Ld.to, lines, 'Move ' + Ld.number + ' ' + tok);
                }
                data.updateLoad(Ld, { if: ifId });
                Ld = data.getLoad(Ld.id);
            }
            data.palletsByLoad(Ld.id, [P.LOADED]).forEach(p => data.updatePallet(p, { status: P.SHIPPED, shippedDay: c.now.dayIso, data: { shippedAt: c.now.stamp } }));
            data.updateLoad(Ld, { status: L.SHIPPED, data: { approvedBy: c.actor, approvedAt: c.now.stamp, workingAt: 0, phase: '' } });
            const t = data.tranids([Ld.to, Ld.if]);
            return { number: Ld.number, toNumber: t[Ld.to] || '', ifNumber: t[Ld.if] || '' };
        } catch (e) {
            const cur = data.getLoad(Ld.id);
            if (cur && cur.status === L.SHIPPING) data.updateLoad(cur, { status: L.ERROR, data: { error: e.message, workingAt: 0 } });
            throw e;
        }
    }

    act('load_approve', true, (a, c) => shipLoad(mustLoad(a.loadId), c));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 39 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(move): load scanning and resumable approve & ship"
```

---

### Task 10: Receiving, receipts and catch-ups

**Files:**
- Modify: `move_portal/sl_move_portal.js`. Insert right after the `act('load_approve', …)` line from Task 9.
- Test: `move_portal/test/portal.test.js` (append)

**Interfaces:**
- Consumes: `shipLoad`, `loadView` and the Task 8 helpers; `tx.receiveTransferOrder`; `core.receiveScanRule`; `core.catchupNumber`.
- Produces:
  - Actions: `inbound_list`, `recv_get`, `scan_recv`, `recv_other`, `recv_damaged`, `recv_undo`, `recv_ready`, `toreceive_list`, `recv_approve`, `catchup_list`, `catchup_approve`, `catchup_reject`.
  - Helpers: `recvView(loadId) → {load, total, receivedCount, expected:[pallets shipped|missing], recent:[last 5 received]}` and `receiveLoad(load, c) → {number, receiptNumber, pieces, missing}`.

- [ ] **Step 1: Append the failing tests**

```js
// ── Task 10 ──
function shippedLoad(ctx, n, job) {
    const o = loadAndReady(ctx, n, job);
    ctx.run('load_approve', { loadId: o.L.id });
    return o;
}

test('receiving: missing pallets stay in transit; a late arrival gets a second receipt', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 3);
    let r = ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.view.receivedCount, r.view.total, ctx.data.getLoad(L.id).status], ['ok', 1, 3, 'receiving']);
    assert.equal(ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false).result, 'dup');
    ctx.run('scan_recv', { loadId: L.id, raw: ps[1].code }, false);
    ctx.run('recv_damaged', { palletId: ps[1].id, loadId: L.id }, false);
    ctx.run('recv_ready', { loadId: L.id }, false);
    assert.throws(() => ctx.run('recv_approve', { loadId: L.id }, false), /Managers only/);
    const tr = ctx.run('toreceive_list');
    assert.deepEqual([tr.loads.length, tr.loads[0].scanned, tr.loads[0].expected, tr.loads[0].unpostedPieces, tr.loads[0].damaged.length], [1, 2, 3, 240, 1]);
    r = ctx.run('recv_approve', { loadId: L.id });
    assert.deepEqual([r.missing, r.pieces], [1, 240]);
    const receipts = ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt');
    assert.equal(receipts.length, 1);
    assert.deepEqual(receipts[0].lines, { '11': 240 });
    assert.equal(ctx.data.getPallet(ps[2].id).status, 'missing');
    assert.equal(ctx.data.getPallet(ps[0].id).receipt, receipts[0].id);
    assert.equal(ctx.data.getLoad(L.id).status, 'received_short');
    assert.equal(ctx.run('toreceive_list').loads.length, 0);
    r = ctx.run('scan_recv', { loadId: L.id, raw: ps[2].code }, false);
    assert.equal(r.result, 'late');
    const late = ctx.run('toreceive_list').loads;
    assert.deepEqual([late.length, late[0].late, late[0].unpostedPieces], [1, true, 120]);
    ctx.run('recv_approve', { loadId: L.id });
    assert.equal(ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt').length, 2);
    assert.deepEqual(ctx.data.getLoad(L.id).receipts.length, 2);
    assert.equal(ctx.data.getLoad(L.id).status, 'received');
    assert.equal(ctx.data.getPallet(ps[1].id).damaged, true);
});

test('undo returns a scanned pallet; recv_ready needs a scan', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 1);
    assert.throws(() => ctx.run('recv_ready', { loadId: L.id }, false), /nothing scanned in/);
    ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    const r = ctx.run('recv_undo', { palletId: ps[0].id, loadId: L.id }, false);
    assert.equal(r.view.receivedCount, 0);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'shipped');
});

test('a pallet from another shipped load can be received on that load', () => {
    const ctx = setup();
    const a = shippedLoad(ctx, 1, 'Ja');
    const b = shippedLoad(ctx, 1, 'Jb');
    const r = ctx.run('scan_recv', { loadId: a.L.id, raw: b.ps[0].code }, false);
    assert.deepEqual([r.result, r.otherNumber, r.otherLoadId], ['other_load', b.L.number, b.L.id]);
    const o = ctx.run('recv_other', { palletId: b.ps[0].id, otherLoadId: b.L.id, loadId: a.L.id }, false);
    assert.equal(o.result, 'ok');
    assert.equal(o.view.load.id, a.L.id);
    assert.equal(ctx.data.getPallet(b.ps[0].id).status, 'received');
    assert.equal(ctx.data.getLoad(b.L.id).status, 'receiving');
});

test('a receipt crash right after save is retried without a second receipt', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 1);
    ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    ctx.run('recv_ready', { loadId: L.id }, false);
    ctx.tx._t.failNext = 'r_after';
    assert.throws(() => ctx.run('recv_approve', { loadId: L.id }), /crashed after save/);
    assert.equal(ctx.data.getLoad(L.id).status, 'error');
    assert.equal(ctx.run('ship_list').loads.length, 0);
    assert.equal(ctx.run('toreceive_list').loads.length, 1);
    ctx.run('recv_approve', { loadId: L.id });
    assert.equal(ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt').length, 1);
    assert.equal(ctx.data.getLoad(L.id).status, 'received');
});

test('a pallet loaded without an outbound scan is caught up with its own TO, IF and receipt', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1);
    const stray = printLabels(ctx, 1, 'Jstray')[0];
    const r = ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false);
    assert.equal(r.result, 'arrived_unshipped');
    assert.deepEqual([ctx.data.getPallet(stray.id).status, ctx.data.getPallet(stray.id).arrivedOn], ['arrived_unshipped', L.id]);
    assert.equal(ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false).result, 'dup_catchup');
    const list = ctx.run('catchup_list');
    assert.deepEqual([list.pallets.length, list.pallets[0].ok, list.pallets[0].arrivedOnNumber], [1, true, 'MV-001']);
    assert.throws(() => ctx.run('catchup_approve', { palletId: stray.id }, false), /Managers only/);
    const done = ctx.run('catchup_approve', { palletId: stray.id });
    assert.equal(done.number, 'MV-001-C1');
    const p = ctx.data.getPallet(stray.id);
    assert.deepEqual([p.status, p.catchup, !!p.receipt], ['received', true, true]);
    assert.deepEqual([txCount(ctx, 'TrnfrOrd'), txCount(ctx, 'ItemShip'), txCount(ctx, 'ItemRcpt')], [2, 2, 1]);
    assert.equal(ctx.run('catchup_list').pallets.length, 0);
});

test('catch-up is blocked when NetSuite has the stock reserved; reject returns the label', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1);
    const stray = printLabels(ctx, 1, 'Jstray')[0];
    ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false);
    ctx.data.db.stock['35']['11'].avail = 0;
    assert.equal(ctx.run('catchup_list').pallets[0].ok, false);
    ctx.run('catchup_reject', { palletId: stray.id });
    const p = ctx.data.getPallet(stray.id);
    assert.deepEqual([p.status, p.loadId, p.arrivedOn], ['labeled', '', '']);
});

test('a pallet on a load that was never approved is refused at receiving', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1, 'Ja');
    const pending = loadAndReady(ctx, 1, 'Jb');
    const r = ctx.run('scan_recv', { loadId: L.id, raw: pending.ps[0].code }, false);
    assert.deepEqual([r.result, r.otherNumber], ['other_load_pending', pending.L.number]);
    assert.equal(ctx.data.getPallet(pending.ps[0].id).status, 'loaded');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `Unknown action: scan_recv`.

- [ ] **Step 3: Insert this block after `act('load_approve', …);`:**

```js
    // ── receiving (inbound) ──────────────────────────────────────────────
    const IN_OPEN = [L.SHIPPED, L.RECEIVING, L.RECV_READY, L.RECEIVED_SHORT];

    function recvView(loadId) {
        const Ld = mustLoad(loadId);
        const pallets = data.palletsByLoad(Ld.id, [P.SHIPPED, P.RECEIVED, P.MISSING]);
        const received = pallets.filter(p => p.status === P.RECEIVED);
        return { load: pubLoad(Ld, countsFromPallets(pallets)), total: pallets.length, receivedCount: received.length,
            expected: pallets.filter(p => p.status !== P.RECEIVED).map(p => pubPallet(p)),
            recent: received.slice(-5).reverse().map(p => pubPallet(p)) };
    }

    act('inbound_list', false, () => {
        const loads = data.loadsByStatus(IN_OPEN, 50);
        const counts = data.palletCountsByLoad(loads.map(l => l.id));
        return { loads: loads.map(l => pubLoad(l, counts[l.id])) };
    });

    act('recv_get', false, (a) => recvView(a.loadId));

    function receiveOne(p, Ld, c, raw) {
        if (IN_OPEN.concat([L.RECEIVED]).indexOf(Ld.status) === -1) throw userErr(Ld.number + ' is not open for receiving (' + Ld.status + ')');
        const loads = {};
        if (p && p.loadId) { const o = p.loadId === Ld.id ? Ld : data.getLoad(p.loadId); if (o) loads[o.id] = o; }
        const rule = core.receiveScanRule(p, Ld.id, loads);
        if (rule.set) {
            const patch = { status: rule.set.status, data: {} };
            if ('loadId' in rule.set) patch.load = rule.set.loadId;
            if (rule.set.status === P.RECEIVED) { patch.data.receivedAt = c.now.stamp; patch.data.receivedBy = c.actor; }
            if (rule.set.status === P.ARRIVED_UNSHIPPED) {
                patch.arrivedOn = Ld.id;
                patch.data.arrivedAt = c.now.stamp; patch.data.arrivedBy = c.actor; patch.data.arrivedFromLoad = rule.fromLoadNumber || '';
            }
            data.updatePallet(p, patch);
            if (rule.set.status === P.RECEIVED && Ld.status === L.SHIPPED) data.updateLoad(Ld, { status: L.RECEIVING });
        }
        data.logScan({ pallet: p ? p.id : '', load: Ld.id, result: rule.result, data: { raw: raw, mode: 'receive', actor: c.actor, at: c.now.stamp } });
        const fresh = p ? data.getPallet(p.id) : null;
        return { result: rule.result, tone: core.toneFor(rule.result), raw: raw, pallet: fresh ? pubPallet(fresh) : null,
            loadNumber: Ld.number, otherNumber: rule.otherNumber || '', otherLoadId: rule.otherLoadId || '',
            fromLoadNumber: rule.fromLoadNumber || '', view: recvView(Ld.id) };
    }

    act('scan_recv', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        const sc = core.parseScan(a.raw);
        return receiveOne(sc.palletId ? data.getPallet(sc.palletId) : null, Ld, c, sc.raw);
    });

    act('recv_other', false, (a, c) => {
        const p = mustPallet(a.palletId), other = mustLoad(a.otherLoadId);
        if (p.loadId !== other.id) throw userErr(p.code + ' is not on ' + other.number);
        const r = receiveOne(p, other, c, p.code);
        r.view = recvView(a.loadId || other.id);   // keep the worker on the load they are unloading
        return r;
    });

    act('recv_damaged', false, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.RECEIVED) throw userErr('Scan the pallet in first');
        data.updatePallet(p, { damaged: true, data: { damagedBy: c.actor, damagedAt: c.now.stamp } });
        return { pallet: pubPallet(data.getPallet(p.id)), view: a.loadId ? recvView(a.loadId) : null };
    });

    act('recv_undo', false, (a) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.RECEIVED || p.receipt) throw userErr(p.code + ' can no longer be undone');
        const Ld = mustLoad(p.loadId);
        const back = [L.RECEIVED, L.RECEIVED_SHORT].indexOf(Ld.status) !== -1 ? P.MISSING : P.SHIPPED;
        data.updatePallet(p, { status: back, damaged: false, data: { receivedAt: '', receivedBy: '' } });
        return { view: recvView(a.loadId || Ld.id) };
    });

    act('recv_ready', false, (a, c) => {
        const Ld = mustLoad(a.loadId);
        if (Ld.status !== L.RECEIVING) throw userErr(Ld.number + ' has nothing scanned in yet');
        data.updateLoad(Ld, { status: L.RECV_READY, data: { recvReadyBy: c.actor, recvReadyAt: c.now.stamp } });
        return {};
    });

    act('toreceive_list', true, () => {
        const unposted = {};
        data.findPalletsWhere({ status: [P.RECEIVED], receiptEmpty: true }).forEach(p => { unposted[p.loadId] = 1; });
        const seen = {};
        const cand = data.loadsByStatus([L.RECV_READY, L.RECEIVING_TX, L.ERROR], 50)
            .filter(l => l.if && (l.status !== L.ERROR || (l.data || {}).phase === 'recv'))
            .concat(data.getLoads(Object.keys(unposted)).filter(l => [L.RECEIVED_SHORT, L.RECEIVED].indexOf(l.status) !== -1))
            .filter(l => { if (seen[l.id]) return false; seen[l.id] = 1; return true; });
        const loads = cand.map(Ld => {
            const ps = data.palletsByLoad(Ld.id, [P.SHIPPED, P.RECEIVED, P.MISSING]);
            const scanned = ps.filter(p => p.status === P.RECEIVED);
            return Object.assign(pubLoad(Ld, countsFromPallets(ps)), {
                expected: ps.length, scanned: scanned.length,
                missing: ps.filter(p => p.status !== P.RECEIVED).map(p => ({ code: p.code, summary: p.summary })),
                damaged: ps.filter(p => p.damaged).map(p => ({ code: p.code, summary: p.summary })),
                unpostedPieces: scanned.filter(p => !p.receipt).reduce((x, p) => x + p.pieces, 0),
                late: [L.RECEIVED_SHORT, L.RECEIVED].indexOf(Ld.status) !== -1 });
        });
        const transit = data.loadsByStatus([L.SHIPPED, L.RECEIVING], 50);
        const tc = data.palletCountsByLoad(transit.map(l => l.id));
        return { loads: loads, transit: transit.map(l => pubLoad(l, tc[l.id])) };
    });

    // Resumable: `pendingRecv` pins the pallet set, and the memo token finds a
    // receipt that was saved just before a crash.
    function receiveLoad(Ld, c) {
        const ok = [L.RECV_READY, L.RECEIVED_SHORT, L.RECEIVED, L.ERROR, L.RECEIVING_TX];
        if (ok.indexOf(Ld.status) === -1 || !Ld.if || (Ld.status === L.ERROR && Ld.data.phase !== 'recv')) {
            throw userErr(Ld.number + ' is not ready to receive (' + Ld.status + ')');
        }
        if (Ld.status === L.RECEIVING_TX && !stale(Ld)) throw userErr(Ld.number + ' is already being received. Wait a minute and refresh.');
        data.updateLoad(Ld, { status: L.RECEIVING_TX, data: { workingAt: Date.now(), error: '', phase: 'recv' } });
        Ld = data.getLoad(Ld.id);
        try {
            let pend = Ld.data.pendingRecv;
            if (!pend) {
                const ids = data.palletsByLoad(Ld.id, [P.RECEIVED]).filter(p => !p.receipt).map(p => p.id);
                if (!ids.length) throw userErr('Nothing scanned in on ' + Ld.number + ' to receive');
                pend = { seq: (Number(Ld.data.recvSeq) || 0) + 1, ids: ids };
                data.updateLoad(Ld, { data: { pendingRecv: pend, recvSeq: pend.seq } });
                Ld = data.getLoad(Ld.id);
            }
            const pallets = data.palletsByIds(pend.ids);
            const lines = core.aggregate(pallets);
            const tok = core.txToken(Ld.id, 'r' + pend.seq);
            const rid = tx.findByToken(tok, 'ItemRcpt') || tx.receiveTransferOrder(Ld.to, lines, 'Move ' + Ld.number + ' receipt ' + pend.seq + ' ' + tok);
            if (Ld.receipts.indexOf(String(rid)) === -1) data.updateLoad(Ld, { receipts: Ld.receipts.concat([String(rid)]) });
            Ld = data.getLoad(Ld.id);
            pallets.forEach(p => { if (!p.receipt) data.updatePallet(p, { receipt: String(rid) }); });
            data.palletsByLoad(Ld.id, [P.SHIPPED]).forEach(p => data.updatePallet(p, { status: P.MISSING }));
            const missing = data.palletsByLoad(Ld.id, [P.MISSING]).length;
            data.updateLoad(Ld, { status: missing ? L.RECEIVED_SHORT : L.RECEIVED,
                data: { pendingRecv: null, recvApprovedBy: c.actor, recvApprovedAt: c.now.stamp, workingAt: 0, phase: '' } });
            const t = data.tranids([rid]);
            return { number: Ld.number, receiptNumber: t[rid] || '', pieces: pallets.reduce((x, p) => x + p.pieces, 0), missing: missing };
        } catch (e) {
            const cur = data.getLoad(Ld.id);
            if (cur && cur.status === L.RECEIVING_TX) data.updateLoad(cur, { status: L.ERROR, data: { error: e.message, workingAt: 0 } });
            throw e;
        }
    }

    act('recv_approve', true, (a, c) => receiveLoad(mustLoad(a.loadId), c));

    // ── catch-ups (pallet arrived without an outbound scan) ──────────────
    act('catchup_list', true, (a, c) => {
        const ps = data.palletsByStatus([P.ARRIVED_UNSHIPPED]);
        const items = {};
        ps.forEach(p => p.lines.forEach(l => { items[l.item] = 1; }));
        const stock = Object.keys(items).length ? data.locationStock(c.S.locFrom, Object.keys(items)) : {};
        const num = {};
        data.getLoads(ps.map(p => p.arrivedOn).filter(Boolean)).forEach(l => { num[l.id] = l.number; });
        return { pallets: ps.map(p => {
            const short = p.lines.filter(l => (stock[l.item] ? stock[l.item].avail : 0) < l.pcs)
                .map(l => l.sku + ' (' + (stock[l.item] ? stock[l.item].avail : 0) + ' available)');
            return pubPallet(p, { arrivedOnNumber: num[p.arrivedOn] || '', arrivedAt: p.data.arrivedAt || '', ok: !short.length, short: short.join(', ') });
        }) };
    });

    act('catchup_approve', true, (a, c) => {
        let p = mustPallet(a.palletId);
        let cl = p.data.catchupLoad ? data.getLoad(p.data.catchupLoad) : null;
        if (!cl) {
            if (p.status !== P.ARRIVED_UNSHIPPED) throw userErr(p.code + ' is not waiting for a catch-up');
            const parent = p.arrivedOn ? data.getLoad(p.arrivedOn) : null;
            const id = data.createLoad({ number: core.catchupNumber(parent ? parent.number : 'MV-000', data.allLoadNumbers()), status: L.READY,
                data: { catchupFor: parent ? parent.id : '', createdBy: c.actor, createdAt: c.now.stamp, readyBy: c.actor, readyAt: c.now.stamp } });
            data.updatePallet(p, { status: P.LOADED, load: id, catchup: true, data: { catchupLoad: id } });
            cl = data.getLoad(id);
        }
        if ([L.READY, L.ERROR, L.SHIPPING].indexOf(cl.status) !== -1 && cl.data.phase !== 'recv') shipLoad(cl, c);
        cl = data.getLoad(cl.id);
        p = data.getPallet(p.id);
        if (p.status === P.SHIPPED) data.updatePallet(p, { status: P.RECEIVED, data: { receivedAt: c.now.stamp, receivedBy: c.actor } });
        if (cl.status === L.SHIPPED) { data.updateLoad(cl, { status: L.RECV_READY }); cl = data.getLoad(cl.id); }
        const r = receiveLoad(cl, c);
        return { number: cl.number, receiptNumber: r.receiptNumber };
    });

    act('catchup_reject', true, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.ARRIVED_UNSHIPPED) throw userErr(p.code + ' is not waiting for a catch-up');
        data.updatePallet(p, { status: P.LABELED, load: '', arrivedOn: '', data: { catchupRejectedBy: c.actor, catchupRejectedAt: c.now.stamp } });
        return {};
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 46 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(move): scan-based receiving, resumable receipts, catch-ups"
```

---

### Task 11: Dashboard / move tracker action

**Files:**
- Modify: `move_portal/sl_move_portal.js`. Insert right after `act('catchup_reject', …);`.
- Test: `move_portal/test/portal.test.js` (append)

**Interfaces:**
- Produces the `dashboard` action (manager), returning:
  - `m`: the `trackerMetrics` output, with `neededPerDay` set to `null` when it's infinite
  - `labeled`, `inTransit`, `received`, `target`
  - `days`: `[{day, n}]` from the start date to today (capped at the target)
  - `loads`: the last 15 loads
  - `exc`: `{missing, arrivedUnshipped, catchups7, damaged, edited, stale, noConfig}`
  - `bySku`: `[{sku, palletsLeft}]`, top 20
  - `noConfigSkus`

- [ ] **Step 1: Append the failing test**

```js
// ── Task 11 ──
test('dashboard counts moved, remaining, days and exceptions', () => {
    const ctx = setup();
    shippedLoad(ctx, 2);
    ctx.data.db.stock['35']['11'].onHand = 960;           // NetSuite drops on-hand when the IF ships
    printLabels(ctx, 1, 'Jlater');
    ctx.data.db.pallets[Object.keys(ctx.data.db.pallets).pop()].printedDay = '2026-10-01';   // stale label
    const r = ctx.run('dashboard');
    assert.deepEqual([r.m.moved, r.m.remaining, r.m.total, r.m.movedToday], [2, 18, 20, 2]);
    assert.deepEqual([r.inTransit, r.labeled, r.received], [2, 1, 0]);
    assert.deepEqual(r.days[r.days.length - 1], { day: '2026-10-14', n: 2 });
    assert.equal(r.days[0].day, '2026-10-01');
    assert.deepEqual([r.exc.missing, r.exc.stale, r.exc.noConfig], [0, 1, 0]);
    assert.equal(r.bySku[0].sku, 'YSN301');
    assert.equal(r.loads.length, 1);
    assert.throws(() => ctx.run('dashboard', {}, false), /Managers only/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `Unknown action: dashboard`.

- [ ] **Step 3: Insert after `act('catchup_reject', …);`:**

```js
    // ── dashboard ────────────────────────────────────────────────────────
    act('dashboard', true, (a, c) => {
        const sm = stockModel(c);
        const m = tracker(c, sm.est);
        const moved = data.movedByDay();
        const end = c.now.dayIso < c.S.target ? c.now.dayIso : c.S.target;
        const days = core.moveDays(c.S.start, end, c.S.skip || []).map(d => ({ day: d, n: moved[d] || 0 }));
        const loads = data.recentLoads(15);
        const lc = data.palletCountsByLoad(loads.map(l => l.id));
        const exc = {
            missing: data.countPallets({ status: [P.MISSING] }),
            arrivedUnshipped: data.countPallets({ status: [P.ARRIVED_UNSHIPPED] }),
            catchups7: data.countPallets({ catchup: true, shippedSince: core.isoAddDays(c.now.dayIso, -6) }),
            damaged: data.countPallets({ damaged: true }),
            edited: data.countPallets({ edited: true, status: [P.SHIPPED, P.RECEIVED, P.MISSING] }),
            stale: data.countPallets({ status: [P.LABELED], printedBefore: core.isoAddDays(c.now.dayIso, -(Number(c.S.staleDays) || 5)) }),
            noConfig: sm.est.unknownItems.length
        };
        const skuOf = k => (sm.stock[k] ? sm.stock[k].sku : k);
        const bySku = Object.keys(sm.est.byItem).map(k => ({ sku: skuOf(k), palletsLeft: sm.est.byItem[k] }))
            .sort((x, y) => y.palletsLeft - x.palletsLeft).slice(0, 20);
        return {
            m: Object.assign({}, m, { neededPerDay: isFinite(m.neededPerDay) ? m.neededPerDay : null }),
            labeled: data.countPallets({ status: [P.LABELED, P.LOADED] }),
            inTransit: data.countPallets({ status: [P.SHIPPED, P.MISSING] }),
            received: data.countPallets({ status: [P.RECEIVED] }),
            target: c.S.target, days: days, loads: loads.map(l => pubLoad(l, lc[l.id])), exc: exc, bySku: bySku,
            noConfigSkus: sm.est.unknownItems.map(skuOf)
        };
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 47 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(move): dashboard move tracker action"
```

---

### Task 12: Browser app (`move_ui.js`)

**Files:**
- Create: `move_portal/move_ui.js`
- Test: `move_portal/test/ui.test.js`

**Interfaces:**
- Consumes (over HTTP, as `POST <url>&action=<name>` with a JSON body): every action from Tasks 8–11, plus GET `action=pdf`.
- The boot object from `page()` is `{url, mode:'manager'|'floor', me, roster:[names], fromName, toName, maxPrint}`.
- Produces: `buildPage(boot) → full HTML string`; `_clientMain` (the browser function, exposed for tests).
- The browser code is one real function, `clientMain`, serialized with `Function.prototype.toString()`. It must never contain a closing script tag, and the test enforces that.

**UI rules (from the spec and mockup):**
- Header: "I am ___" and the **📤 Outbound / 📥 Inbound** toggle, both remembered per device in `localStorage`.
- Floor tabs:
  - Outbound: Request label · Load · Void.
  - Inbound: Receive.
- Manager extra tabs:
  - Outbound: To ship · Print queue · Print plan · Print a SKU · SKU configs · Reprint · Dashboard.
  - Inbound: To receive · Catch-ups · Dashboard.
- Scan fields:
  - They use `inputmode="none"` so the phone keyboard doesn't pop up; a hardware or wedge scanner still types into them. A **⌨ Type** button switches to the keyboard.
  - The scan field is re-focused after every tap.
  - Scans are queued, so none are lost while a request is in flight.
- Each scan result gets its own color card plus a tone: ok = rising, warn = double, bad = low buzz.

- [ ] **Step 1: Write the failing test**

```js
// move_portal/test/ui.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const ui = loadAmd('move_ui.js');

test('buildPage embeds boot data safely and the client script parses', () => {
    const html = ui.buildPage({ url: '/app/site/hosting/scriptlet.nl?script=1&deploy=1', mode: 'floor', me: 'X</script><b>',
        roster: ['Miguel'], fromName: 'Riverside', toName: 'Tippecanoe', maxPrint: 250 });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.match(html, /<meta name="viewport"/);
    const m = /<script>([\s\S]*)<\/script>/.exec(html);
    assert.ok(m, 'has a script');
    assert.doesNotThrow(() => new Function(m[1]));
    assert.equal(html.indexOf('</script><b>'), -1, 'boot data cannot close the script tag');
});

test('client code never contains a closing script tag', () => {
    assert.equal(ui._clientMain.toString().toLowerCase().indexOf('</script'), -1);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `ENOENT ... move_ui.js`.

- [ ] **Step 3: Write `move_ui.js`**

```js
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: page HTML + the whole browser app. clientMain runs in the browser;
 * it is serialized with toString(), so it must be self-contained.
 */
define([], function () {
    'use strict';

    const CSS = `
:root{--bg:#f1f5f9;--ink:#1f2937;--muted:#6b7280;--line:#e5e7eb;--blue:#2563eb;--blue-soft:#dbeafe;--green:#16a34a;--green-soft:#dcfce7;--amber:#d97706;--amber-soft:#fef3c7;--orange:#ea580c;--red:#dc2626;--red-soft:#fee2e2;--navy:#1e293b;--teal:#0d9488}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
.top{background:var(--navy);color:#fff;padding:10px 12px;position:sticky;top:0;z-index:5}
.ttl{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#cbd5e1}.ttl b{color:#fff;font-size:16px}
.who{margin-top:6px;font-size:13px;color:#cbd5e1}.who select,.who input{margin-left:6px;padding:7px;border-radius:8px;border:0;font-size:15px}
.toggle{display:flex;margin-top:8px;background:#334155;border-radius:10px;padding:3px}
.toggle button{flex:1;border:0;background:transparent;color:#cbd5e1;padding:12px 4px;border-radius:8px;font-weight:700;font-size:14px}
.toggle button.on.out{background:var(--blue);color:#fff}.toggle button.on.in{background:var(--teal);color:#fff}
.subnav{display:flex;flex-wrap:wrap;background:#fff;border-bottom:1px solid var(--line)}
.subnav div{flex:1 0 auto;text-align:center;padding:13px 10px;font-size:13px;font-weight:700;color:var(--muted);border-bottom:3px solid transparent;cursor:pointer}
.subnav div.on{color:var(--ink);border-color:var(--blue)}
main{padding:12px;max-width:1180px;margin:0 auto}
.btn{display:block;width:100%;border:0;border-radius:12px;padding:15px;font-size:16px;font-weight:700;cursor:pointer;margin:10px 0}
.btn.pri{background:var(--blue);color:#fff}.btn.go{background:var(--green);color:#fff}.btn.teal{background:var(--teal);color:#fff}
.btn.ghost{background:#fff;border:1px solid var(--line);color:var(--ink);font-weight:600}.btn.sm{padding:10px;font-size:14px;border-radius:9px}
.btn:disabled,.dbtn:disabled{opacity:.45}
.dbtn{border:0;border-radius:8px;padding:10px 14px;font-weight:700;font-size:13px;cursor:pointer}
.dbtn.pri{background:var(--blue);color:#fff}.dbtn.go{background:var(--green);color:#fff}.dbtn.gh{background:#fff;border:1px solid var(--line)}
.row2{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
label.f{display:block;font-size:12px;font-weight:700;color:var(--muted);margin:12px 0 5px}
.inp{width:100%;padding:13px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;background:#fff;margin-bottom:6px}
.num{width:76px;padding:9px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:2px solid var(--line);background:#fff;border-radius:10px;padding:10px 12px;cursor:pointer;flex:1;min-width:30%;text-align:center;font-weight:600}
.chip small{display:block;color:var(--muted);font-size:11px;font-weight:400}.chip.on{border-color:var(--blue);background:var(--blue-soft)}
.stepper{display:flex;align-items:center;gap:8px}.stepper button{width:54px;height:54px;flex:0 0 54px;border-radius:12px;border:1px solid #cbd5e1;background:#fff;font-size:24px}
.stepper .inp{text-align:center;font-size:22px;font-weight:700;margin:0}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px}
.card h4{margin:0 0 4px;font-size:15px}.card.bl{border-color:var(--blue)}.card.bt{border-color:var(--teal)}.card.bo{border-color:var(--orange)}.card.warnc{border-color:var(--red)}
[data-act="openload"],[data-act="openrecv"]{cursor:pointer}
.muted{color:var(--muted);font-size:13px}.warn{color:var(--red)!important}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;vertical-align:middle}
.p-blue{background:var(--blue-soft);color:var(--blue)}.p-green{background:var(--green-soft);color:var(--green)}.p-amber{background:var(--amber-soft);color:var(--amber)}.p-red{background:var(--red-soft);color:var(--red)}.p-gray{background:#f1f5f9;color:#475569}
.scanbox{display:flex;gap:8px;align-items:center;background:#fff;border:2px dashed #94a3b8;border-radius:12px;padding:10px 12px;margin:10px 0}
.scanbox span{font-size:22px}.scanbox input{border:0;flex:1;font-size:18px;outline:none;min-width:0}.scanbox button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 10px}
.flash{border-radius:14px;padding:16px;margin:10px 0;color:#fff}
.flash .big{font-size:24px;font-weight:800;line-height:1.15}.flash .mid{font-size:18px;font-weight:700;margin-top:4px}.flash .sm{font-size:14px;margin-top:6px}
.f-green{background:var(--green)}.f-amber{background:var(--amber)}.f-orange{background:var(--orange)}.f-red{background:var(--red)}
.flash .acts{display:flex;gap:8px;margin-top:10px}.flash .acts button{flex:1;border:0;border-radius:9px;padding:12px;font-weight:700;background:rgba(255,255,255,.25);color:#fff;font-size:15px}
.totals{display:flex;gap:8px;margin-bottom:10px}.totals div{flex:1;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center}
.totals b{display:block;font-size:20px}.totals small{color:var(--muted);font-size:11px}
.plist .it{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)}
.plist .it:last-child{border:0}.plist .ac{flex:0 0 auto}.plist .ac button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:9px 11px;font-size:13px;margin-left:4px}
.results div{padding:11px;border-bottom:1px solid var(--line);cursor:pointer;background:#fff}
.prog{margin:8px 0 4px;font-weight:700}.progress{height:12px;background:#e2e8f0;border-radius:999px;overflow:hidden}.progress div{height:100%;background:var(--teal);width:0}
.warnrow{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px}.warnrow:last-child{border:0}
.tbl{width:100%;border-collapse:collapse;font-size:13px;background:#fff}.tbl th{text-align:left;color:var(--muted);font-weight:600;padding:7px 6px;border-bottom:1px solid var(--line)}.tbl td{padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:top}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px}.kpi small{color:var(--muted);font-size:12px}.kpi b{display:block;font-size:26px;margin-top:2px}.kpi span{font-size:12px;color:var(--muted)}
.kpi.good{border-color:#86efac;background:#f0fdf4}.kpi.bad{border-color:#fca5a5;background:#fef2f2}
textarea.inp{font-family:monospace;font-size:13px}
h3{font-size:15px;margin:16px 0 8px}
@media (max-width:900px){.grid4{grid-template-columns:repeat(2,1fr)}.grid3{grid-template-columns:1fr}}
`;

    function clientMain(B) {
        'use strict';
        const isMgr = B.mode === 'manager';
        const S = { side: get('mv_side') === 'in' ? 'in' : 'out', tab: null, who: get('mv_who') || '', poll: null,
            ed: null, edRender: null, loadId: null, lv: null, recvId: null, rv: null, plan: null, pt: null, cfgRows: [], cfgImport: null, items: [] };

        function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
        function put(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
        function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
        function $(id) { return document.getElementById(id); }
        function main(html) { $('main').innerHTML = html; }
        function busy(el, on) { if (el) el.disabled = on; }
        function pdfUrl(q) { return B.url + '&action=pdf&' + q; }
        function num(n) { return Number(n || 0).toLocaleString(); }

        async function api(action, body) {
            try {
                const r = await fetch(B.url + '&action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.assign({ actor: S.who || B.me }, body || {})) });
                const t = await r.text();
                try { return JSON.parse(t); } catch (e) { return { ok: false, error: 'Unexpected response (' + r.status + ')' }; }
            } catch (e) { return { ok: false, error: 'No connection. Scan again or retry.' }; }
        }

        let actx = null;
        function tone(kind) {
            try {
                actx = actx || new (window.AudioContext || window.webkitAudioContext)();
                const seq = kind === 'ok' ? [[880, 0.08], [1320, 0.1]] : kind === 'warn' ? [[660, 0.09], [0, 0.05], [660, 0.09]] : [[180, 0.35]];
                let t = actx.currentTime;
                seq.forEach(([f, d]) => {
                    if (f) {
                        const o = actx.createOscillator(), g = actx.createGain();
                        o.frequency.value = f; o.type = kind === 'bad' ? 'square' : 'sine'; g.gain.value = 0.15;
                        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d);
                    }
                    t += d;
                });
            } catch (e) { /* no audio */ }
        }

        function flash(kind, big, mid, sm, acts) {
            return '<div class="flash f-' + kind + '"><div class="big">' + big + '</div>' + (mid ? '<div class="mid">' + mid + '</div>' : '') +
                (sm ? '<div class="sm">' + sm + '</div>' : '') + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>';
        }
        function errBox(msg) { return flash('red', '❌ ' + esc(msg)); }

        const PILL = { loading: ['Loading', 'p-blue'], ready: ['⏳ Waiting for approval', 'p-amber'], shipping: ['Shipping…', 'p-amber'],
            shipped: ['In transit', 'p-blue'], receiving: ['Unloading', 'p-blue'], recv_ready: ['⏳ Receipt approval', 'p-amber'],
            receiving_tx: ['Receiving…', 'p-amber'], received: ['Received', 'p-green'], received_short: ['Received · short', 'p-red'], error: ['Needs attention', 'p-red'] };
        function statusPill(s) { const p = PILL[s] || [s, 'p-gray']; return '<span class="pill ' + p[1] + '">' + esc(p[0]) + '</span>'; }
        function loadSub(L) { return [L.carrier, L.trailer && 'Trailer ' + L.trailer, L.seal && 'Seal ' + L.seal].filter(Boolean).join(' · '); }

        function needWho() {
            if (S.who) return false;
            alert('Pick your name in "I am" first.');
            return true;
        }

        // ── shell ────────────────────────────────────────────────────────
        const TABS = {
            out: [['req', 'Request label'], ['load', 'Load'], ['void', 'Void']].concat(isMgr ? [['ship', 'To ship'], ['queue', 'Print queue'],
                ['plan', 'Print plan'], ['sku', 'Print a SKU'], ['configs', 'SKU configs'], ['reprint', 'Reprint'], ['dash', 'Dashboard']] : []),
            in: [['recv', 'Receive']].concat(isMgr ? [['toreceive', 'To receive'], ['catchup', 'Catch-ups'], ['dash', 'Dashboard']] : [])
        };

        function shell() {
            const whoCtl = B.roster.length
                ? '<select id="who"><option value="">— pick —</option>' + B.roster.map(n => '<option' + (n === S.who ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>'
                : '<input id="who" value="' + esc(S.who) + '" placeholder="your name">';
            document.body.innerHTML = '<div class="top"><div class="ttl"><b>Move Portal</b><span>' + esc(B.me) + (isMgr ? ' · manager' : '') + '</span></div>' +
                '<div class="who">I am ' + whoCtl + '</div>' +
                '<div class="toggle"><button data-act="side" data-v="out" class="' + (S.side === 'out' ? 'on out' : '') + '">📤 Outbound · ' + esc(B.fromName) + '</button>' +
                '<button data-act="side" data-v="in" class="' + (S.side === 'in' ? 'on in' : '') + '">📥 Inbound · ' + esc(B.toName) + '</button></div></div>' +
                '<div class="subnav" id="subnav"></div><main id="main"></main>';
            const w = $('who');
            w.onchange = w.oninput = () => { S.who = w.value.trim(); put('mv_who', S.who); };
            renderNav();
        }

        function renderNav() {
            const tabs = TABS[S.side];
            if (!tabs.some(t => t[0] === S.tab)) S.tab = tabs[0][0];
            $('subnav').innerHTML = tabs.map(t => '<div data-act="tab" data-v="' + t[0] + '" class="' + (t[0] === S.tab ? 'on' : '') + '">' + esc(t[1]) + '</div>').join('');
            clearInterval(S.poll);
            S.poll = null;
            SCREENS[S.tab]();
        }

        const ACT = {};
        const SCREENS = {};
        document.addEventListener('click', e => {
            const el = e.target.closest('[data-act]');
            if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el); }
            setTimeout(refocusScan, 60);
        });
        function refocusScan() {
            const i = $('scan') || $('rscan');
            const a = document.activeElement;
            if (i && !(a && a.matches && a.matches('input,select,textarea'))) i.focus();
        }
        ACT.side = el => { S.side = el.dataset.v; put('mv_side', S.side); shell(); };
        ACT.tab = el => { S.tab = el.dataset.v; S.loadId = null; S.recvId = null; renderNav(); };
        ACT.clearres = () => { const r = $('scanres'); if (r) r.innerHTML = ''; };
        ACT.typecode = el => { const i = $(el.dataset.v); if (i) { i.setAttribute('inputmode', 'text'); i.focus(); } };

        // Scan input: queue every Enter so nothing is lost while a request runs.
        function wireScan(id, fn) {
            const i = $(id);
            if (!i) return;
            i.focus();
            const q = [];
            let running = false;
            async function pump() {
                if (running) return;
                running = true;
                while (q.length) { await fn(q.shift()); }
                running = false;
                refocusScan();
            }
            i.onkeydown = e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const v = i.value.trim();
                i.value = '';
                if (v) { q.push(v); pump(); }
            };
        }
        function scanBox(id) {
            return '<div class="scanbox"><span>📷</span><input id="' + id + '" inputmode="none" placeholder="Scan pallet label…" autocomplete="off" autocapitalize="characters">' +
                '<button data-act="typecode" data-v="' + id + '">⌨ Type</button></div>';
        }

        // ── shared line editor (request, print a SKU, relabel) ───────────
        function newLine() { return { item: '', sku: '', desc: '', onHand: null, cfgs: [], cfg: '', pcs: '' }; }
        function newEd() { return { lines: [newLine()], count: 1, note: '' }; }
        function editedNote(l) {
            const c = l.cfgs.find(x => x.code === l.cfg);
            return c && Number(l.pcs) !== c.pcs ? '<div class="muted warn">⚠ Differs from Config ' + esc(c.code) + ' (' + c.pcs + '). The label will show EDITED.</div>' : '';
        }
        function edHtml(o) {
            const ed = S.ed;
            return ed.lines.map((l, i) => '<div class="card">' +
                '<label class="f">SKU' + (ed.lines.length > 1 ? ' ' + (i + 1) : '') + ' (type or scan the product barcode)</label>' +
                '<input class="inp" data-sku="' + i + '" value="' + esc(l.sku) + '" placeholder="e.g. YSN201" autocomplete="off">' +
                '<div id="skures' + i + '"></div>' +
                (l.item ? '<div class="muted">' + esc(l.desc) + (l.onHand != null ? ' · ' + num(l.onHand) + ' on hand at ' + esc(B.fromName) : '') + '</div>' +
                    '<label class="f">Pallet config</label><div class="chips">' +
                    l.cfgs.map(c => '<div class="chip' + (l.cfg === c.code ? ' on' : '') + '" data-act="cfg" data-i="' + i + '" data-v="' + esc(c.code) + '">Config ' + esc(c.code) +
                        '<small>' + c.pcs + ' / pallet' + (c.isDefault ? ' · default' : '') + '</small></div>').join('') +
                    '<div class="chip' + (!l.cfg ? ' on' : '') + '" data-act="cfg" data-i="' + i + '" data-v="">Custom<small>type pcs</small></div></div>' +
                    '<label class="f">Pieces on this pallet</label><div class="stepper"><button data-act="pcs" data-i="' + i + '" data-v="-1">−</button>' +
                    '<input class="inp" data-pcs="' + i + '" inputmode="numeric" value="' + esc(l.pcs) + '"><button data-act="pcs" data-i="' + i + '" data-v="1">+</button></div>' +
                    editedNote(l) : '') +
                (ed.lines.length > 1 ? '<button class="btn ghost sm" data-act="rmline" data-i="' + i + '">Remove this SKU</button>' : '') + '</div>').join('') +
                '<button class="btn ghost sm" data-act="addline">+ Mixed pallet (add another SKU)</button>' +
                (o.count ? '<label class="f">How many labels</label><div class="stepper"><button data-act="cnt" data-v="-1">−</button>' +
                    '<input class="inp" id="edcount" inputmode="numeric" value="' + esc(ed.count) + '"><button data-act="cnt" data-v="1">+</button></div>' : '') +
                (o.note ? '<label class="f">Note for the runner (optional)</label><input class="inp" id="ednote" value="' + esc(ed.note) + '" placeholder="e.g. aisle 12, top rack">' : '');
        }
        function mountEd(o, extraHtml) {
            S.edRender = () => {
                $('edbox').innerHTML = edHtml(o) + (extraHtml || '');
                document.querySelectorAll('[data-sku]').forEach(inp => {
                    let t;
                    inp.oninput = () => { clearTimeout(t); t = setTimeout(() => skuSearch(+inp.dataset.sku, inp.value, false), 300); };
                    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); skuSearch(+inp.dataset.sku, inp.value, true); } };
                });
                document.querySelectorAll('[data-pcs]').forEach(inp => {
                    inp.oninput = () => { S.ed.lines[+inp.dataset.pcs].pcs = inp.value; };
                    inp.onchange = () => S.edRender();
                });
                const c = $('edcount'); if (c) c.oninput = () => { S.ed.count = c.value; };
                const n = $('ednote'); if (n) n.oninput = () => { S.ed.note = n.value; };
            };
            S.edRender();
        }
        async function skuSearch(i, q, exact) {
            q = String(q || '').trim();
            const box = $('skures' + i);
            if (!box) return;
            if (!q) { box.innerHTML = ''; return; }
            const r = await api('item_lookup', { q: q });
            if (!r.ok) { box.innerHTML = errBox(r.error); return; }
            const hit = r.items.find(x => x.sku.toUpperCase() === q.toUpperCase() || x.upc === q);
            if (exact && (hit || r.items.length === 1)) return pickItem(i, hit || r.items[0]);
            S.items = r.items;
            box.innerHTML = r.items.length ? '<div class="results">' + r.items.map((x, k) => '<div data-act="pick" data-i="' + i + '" data-k="' + k + '"><b>' + esc(x.sku) +
                '</b> <span class="muted">' + esc(x.desc) + '</span></div>').join('') + '</div>' : '<div class="muted">No match</div>';
        }
        function pickItem(i, x) {
            const l = S.ed.lines[i];
            Object.assign(l, { item: x.item, sku: x.sku, desc: x.desc, onHand: x.onHand, cfgs: x.cfgs || [] });
            const d = l.cfgs.find(c => c.isDefault) || l.cfgs[0];
            l.cfg = d ? d.code : '';
            l.pcs = d ? d.pcs : '';
            S.edRender();
        }
        ACT.pick = el => pickItem(+el.dataset.i, S.items[+el.dataset.k]);
        ACT.cfg = el => { const l = S.ed.lines[+el.dataset.i]; l.cfg = el.dataset.v; const c = l.cfgs.find(x => x.code === l.cfg); if (c) l.pcs = c.pcs; S.edRender(); };
        ACT.pcs = el => { const l = S.ed.lines[+el.dataset.i]; l.pcs = Math.max(1, (Number(l.pcs) || 0) + Number(el.dataset.v)); S.edRender(); };
        ACT.cnt = el => { S.ed.count = Math.max(1, (Number(S.ed.count) || 0) + Number(el.dataset.v)); S.edRender(); };
        ACT.addline = () => { if (S.ed.lines.length >= 5) return alert('A mixed pallet can have at most 5 SKUs'); S.ed.lines.push(newLine()); S.edRender(); };
        ACT.rmline = el => { S.ed.lines.splice(+el.dataset.i, 1); S.edRender(); };
        function edPayload() { return S.ed.lines.map(l => ({ item: l.item, sku: l.sku, cfg: l.cfg, pcs: Number(l.pcs) })); }
        function edInvalid() {
            for (const l of S.ed.lines) {
                if (!l.item) return 'Pick a SKU for every line';
                if (!(Number(l.pcs) > 0)) return 'Pieces must be above 0 for ' + l.sku;
            }
            return '';
        }

        // Print: one job id per click; chunks are retry-safe because the server counts per job.
        async function printMany(specs, source, msgEl) {
            const total = specs.reduce((a, s) => a + s.n, 0);
            if (!total) return false;
            if (total > B.maxPrint) { alert('That is ' + total + ' labels. Max ' + B.maxPrint + ' per print job; print in parts.'); return false; }
            const w = window.open('about:blank');
            const job = 'J' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            let upTo = 0;
            for (const s of specs) {
                const end = upTo + s.n;
                while (upTo < end) {
                    const next = Math.min(end, upTo + 80);
                    if (msgEl) msgEl.innerHTML = flash('amber', 'Creating labels… ' + upTo + ' / ' + total);
                    let r;
                    for (let t = 0; t < 3; t++) { r = await api('print_chunk', { job: job, lines: s.lines, upTo: next, source: source }); if (r.ok) break; }
                    if (!r.ok) { if (w) w.close(); if (msgEl) msgEl.innerHTML = errBox(r.error + ' (labels already created are kept; press Print again)'); return false; }
                    upTo = next;
                }
            }
            if (w) w.location = pdfUrl('job=' + encodeURIComponent(job) + '&header=1');
            if (msgEl) msgEl.innerHTML = flash('green', '✅ ' + total + ' labels sent to print');
            return true;
        }

        // ── Outbound: request label ──────────────────────────────────────
        SCREENS.req = () => {
            S.ed = newEd();
            main('<div id="edbox"></div><div id="edmsg"></div><button class="btn pri" data-act="reqsend">Send to office printer</button>' +
                '<label class="f">My recent requests</label><div id="myreqs"><div class="muted">Loading…</div></div>');
            mountEd({ count: true, note: true });
            loadMyReqs();
        };
        function reqCard(q, acts) {
            const pill = { queued: 'p-amber', printed: 'p-green', cancelled: 'p-gray' }[q.status] || 'p-gray';
            return '<div class="card"><h4>' + esc(q.summary) + ' ×' + q.count + ' <span class="pill ' + pill + '">' +
                esc(q.status === 'printed' ? 'Printed · on its way' : q.status) + '</span></h4><div class="muted">' + esc(q.at) + ' · ' + esc(q.requester) +
                (q.via === 'radio' ? ' (radio)' : '') + (q.note ? ' · ' + esc(q.note) : '') + '</div>' +
                (acts && q.status === 'queued' ? '<div class="row2"><button class="dbtn pri" data-act="reqprint" data-id="' + q.id + '">Print</button>' +
                    '<button class="dbtn gh" data-act="reqcancel" data-id="' + q.id + '">Cancel</button></div>' : '') + '</div>';
        }
        async function loadMyReqs() {
            const r = await api('req_list', { mine: true });
            const box = $('myreqs');
            if (box) box.innerHTML = !r.ok ? errBox(r.error) : (r.reqs.map(q => reqCard(q, false)).join('') || '<div class="muted">None yet</div>');
        }
        ACT.reqsend = async el => {
            if (needWho()) return;
            const bad = edInvalid();
            if (bad) { $('edmsg').innerHTML = errBox(bad); return; }
            busy(el, true);
            const r = await api('req_create', { lines: edPayload(), count: Number(S.ed.count) || 1, note: S.ed.note, via: 'phone' });
            busy(el, false);
            if (!r.ok) { $('edmsg').innerHTML = errBox(r.error); return; }
            tone('ok');
            $('edmsg').innerHTML = flash('green', '✅ Sent to the office');
            S.ed = newEd();
            S.edRender();
            loadMyReqs();
        };

        // ── Outbound: void (floor) and reprint (manager) ─────────────────
        SCREENS.void = () => palletTool(false);
        SCREENS.reprint = () => palletTool(true);
        function palletTool(mgr) {
            main('<label class="f">Scan or type a label</label><input class="inp" id="ptcode" placeholder="PLT…" autocomplete="off"><div id="ptres"></div><div id="ptmsg"></div><div id="edbox"></div>');
            const i = $('ptcode');
            i.focus();
            i.onkeydown = async e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const r = await api('pallet_get', { code: i.value });
                i.select();
                $('ptmsg').innerHTML = '';
                $('edbox').innerHTML = '';
                if (!r.ok) { $('ptres').innerHTML = errBox(r.error); return; }
                S.pt = r.pallet;
                renderPt(mgr);
            };
        }
        function renderPt(mgr) {
            const p = S.pt, canVoid = p.status === 'labeled';
            $('ptres').innerHTML = '<div class="card"><h4>' + esc(p.code) + ' · ' + esc(p.summary) + ' <span class="pill p-gray">' + esc(p.status) + '</span></h4>' +
                '<div class="muted">' + (p.loadNumber ? 'Load ' + esc(p.loadNumber) + ' · ' : '') + 'printed ' + esc(p.printedAt) + (p.edited ? ' · EDITED' : '') + '</div>' +
                (mgr ? '<div class="row2"><button class="dbtn pri" data-act="ptreprint">Reprint (same code)</button>' +
                    '<button class="dbtn gh" data-act="ptrelabel"' + (canVoid ? '' : ' disabled') + '>Edit + reprint</button></div>' : '') +
                (canVoid ? '<label class="f">Void reason</label><select class="inp" id="ptreason"><option>Broken up for stock</option><option>Sent to customer</option>' +
                    '<option>Damaged</option><option>Other</option></select><button class="btn ghost sm warn" data-act="ptvoid">Void this label</button>'
                    : '<div class="muted">Only labels not yet on a load can be voided' + (p.status === 'loaded' ? ' (remove it from its load first)' : '') + '.</div>') + '</div>';
        }
        ACT.ptvoid = async () => {
            if (!confirm('Void ' + S.pt.code + '?')) return;
            const r = await api('pallet_void', { palletId: S.pt.id, reason: $('ptreason').value });
            $('ptmsg').innerHTML = r.ok ? flash('green', '✅ ' + esc(S.pt.code) + ' voided') : errBox(r.error);
            if (r.ok) tone('ok');
        };
        ACT.ptreprint = async () => {
            const w = window.open('about:blank');
            const r = await api('pallet_reprint', { palletId: S.pt.id });
            if (!r.ok) { if (w) w.close(); $('ptmsg').innerHTML = errBox(r.error); return; }
            if (w) w.location = pdfUrl('ids=' + S.pt.id);
        };
        ACT.ptrelabel = () => {
            S.ed = { lines: S.pt.edLines.map(l => Object.assign({}, l)), count: 1, note: '' };
            mountEd({}, '<button class="btn pri" data-act="ptrelabelgo">Print new label (voids ' + esc(S.pt.code) + ')</button>');
        };
        ACT.ptrelabelgo = async el => {
            const bad = edInvalid();
            if (bad) { $('ptmsg').innerHTML = errBox(bad); return; }
            const w = window.open('about:blank');
            busy(el, true);
            const r = await api('pallet_relabel', { palletId: S.pt.id, lines: edPayload() });
            busy(el, false);
            if (!r.ok) { if (w) w.close(); $('ptmsg').innerHTML = errBox(r.error); return; }
            if (w) w.location = pdfUrl('job=' + encodeURIComponent(r.job));
            $('edbox').innerHTML = '';
            $('ptmsg').innerHTML = flash('green', '✅ New label ' + esc(r.code) + ' printing; ' + esc(S.pt.code) + ' voided');
        };

        // ── Outbound: load ───────────────────────────────────────────────
        SCREENS.load = () => (S.loadId ? loadDetail() : loadList());
        async function loadList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('load_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main(r.loads.map(L => '<div class="card' + (L.status === 'loading' ? ' bl' : '') + '" data-act="openload" data-id="' + L.id + '"><h4>' + esc(L.number) +
                (L.door ? ' · Door ' + esc(L.door) : '') + ' ' + statusPill(L.status) + '</h4><div class="muted">' + esc(loadSub(L)) + ' · ' + L.pallets + ' pallets</div></div>').join('') ||
                '<div class="muted">No open loads</div>') ;
            $('main').insertAdjacentHTML('beforeend', '<div class="card"><h4>New load</h4><input class="inp" id="nl_door" placeholder="Door"><input class="inp" id="nl_carrier" placeholder="Carrier">' +
                '<input class="inp" id="nl_trailer" placeholder="Trailer #"><input class="inp" id="nl_seal" placeholder="Seal #"><div id="nlmsg"></div>' +
                '<button class="btn pri" data-act="newload">Open load</button></div>');
        }
        ACT.newload = async el => {
            if (needWho()) return;
            busy(el, true);
            const r = await api('load_create', { door: $('nl_door').value, carrier: $('nl_carrier').value, trailer: $('nl_trailer').value, seal: $('nl_seal').value });
            busy(el, false);
            if (!r.ok) { $('nlmsg').innerHTML = errBox(r.error); return; }
            S.loadId = r.load.id;
            loadDetail();
        };
        ACT.openload = el => { S.loadId = el.dataset.id; loadDetail(); };
        ACT.backload = () => { S.loadId = null; loadList(); };
        async function loadDetail() {
            main('<div class="muted">Loading…</div>');
            const r = await api('load_get', { loadId: S.loadId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backload">← All loads</button><div class="card bl"><h4 id="lhead"></h4><div class="muted" id="lsub"></div></div>' +
                '<div id="lscan"></div><div id="scanres"></div><div class="totals" id="ltot"></div><div class="card plist" id="plist"></div><div id="lfoot"></div>');
            paintLoad(r, true);
        }
        function paintLoad(r, first) {
            S.lv = r;
            const L = r.load, open = L.status === 'loading';
            $('lhead').innerHTML = esc(L.number) + (L.door ? ' · Door ' + esc(L.door) : '') + ' ' + statusPill(L.status);
            $('lsub').textContent = loadSub(L);
            if (first) {
                $('lscan').innerHTML = open ? scanBox('scan') : '<div class="muted">' + (L.status === 'ready' ? '⏳ Waiting for manager approval. Scanning is closed.' : 'Scanning is closed (' + esc(L.status) + ').') + '</div>';
                if (open) wireScan('scan', doLoadScan);
            }
            $('ltot').innerHTML = '<div><b>' + r.totals.pallets + '</b><small>pallets</small></div><div><b>' + num(r.totals.pieces) + '</b><small>pieces</small></div><div><b>' + r.totals.skus + '</b><small>SKUs</small></div>';
            $('plist').innerHTML = r.pallets.map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + (p.edited ? ' <span class="pill p-amber">EDITED</span>' : '') + '</div>' +
                (open ? '<div class="ac"><button data-act="pedit" data-id="' + p.id + '">Edit</button><button data-act="premove" data-id="' + p.id + '">✕</button></div>' : '') + '</div>').join('') ||
                '<div class="muted">No pallets yet</div>';
            $('lfoot').innerHTML = open ? '<button class="btn go" data-act="loadready">Load done: send for approval</button>' : '';
        }
        function loadResultHtml(r) {
            const p = r.pallet, line = p ? esc(p.code + ' · ' + p.summary) : '';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), esc(p.pieces + ' pcs · ' + p.code), 'Added to ' + esc(r.loadNumber) + ' · ' + r.view.totals.pallets + ' pallets',
                    '<button data-act="pedit" data-id="' + p.id + '">Edit count</button><button data-act="premove" data-id="' + p.id + '">Remove</button>');
                case 'dup': return flash('amber', '🟡 Already on this load', line, 'No change.');
                case 'other_load': return flash('amber', '🟡 On load ' + esc(r.otherNumber), line, '',
                    '<button data-act="movehere" data-id="' + p.id + '">Move it to ' + esc(r.loadNumber) + '</button><button data-act="clearres">Leave it</button>');
                case 'locked_load': return flash('red', '❌ On ' + esc(r.otherNumber) + ', awaiting approval', line, 'That load is closed for scanning. Check with the supervisor.');
                case 'void': return flash('red', '❌ Label cancelled', line, "Don't load it. Request a new label for this pallet.");
                case 'shipped': return flash('red', '❌ Already shipped', esc(p.code + (r.otherNumber ? ' · on ' + r.otherNumber : '')), 'This pallet already left. Check with the supervisor.');
                default: return flash('red', '❌ Unknown label', esc('"' + r.raw + '"'), 'Not a move label. Maybe a product barcode?');
            }
        }
        async function doLoadScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('scan_load', { loadId: S.loadId, raw: v });
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            $('scanres').innerHTML = loadResultHtml(r);
            if (r.view) paintLoad(r.view, false);
        }
        function findPallet(id) {
            const all = (S.lv ? S.lv.pallets : []);
            return all.find(x => String(x.id) === String(id));
        }
        ACT.pedit = async el => {
            const p = findPallet(el.dataset.id);
            if (!p) return;
            const lines = [];
            for (const l of p.lines) {
                const v = prompt(l.sku + ': pieces on this pallet', l.pcs);
                if (v === null) return;
                const n = Math.floor(Number(v));
                if (!(n > 0)) { alert('Pieces must be above 0'); return; }
                lines.push({ item: l.item, pcs: n });
            }
            const r = await api('pallet_edit', { palletId: p.id, loadId: S.loadId, lines: lines });
            if (!r.ok) { alert(r.error); return; }
            paintLoad(r.view, false);
            $('scanres').innerHTML = flash('amber', '✏️ ' + esc(p.code) + ' updated', esc(r.pallet.summary), 'Flagged EDITED');
        };
        ACT.premove = async el => {
            const p = findPallet(el.dataset.id);
            if (!p || !confirm('Take ' + p.code + ' off this load?')) return;
            const r = await api('pallet_remove', { palletId: p.id, loadId: S.loadId });
            if (!r.ok) { alert(r.error); return; }
            paintLoad(r.view, false);
            $('scanres').innerHTML = flash('amber', '↩ ' + esc(p.code) + ' removed');
        };
        ACT.movehere = async el => {
            const r = await api('load_move_here', { palletId: el.dataset.id, loadId: S.loadId });
            if (!r.ok) { alert(r.error); return; }
            tone('ok');
            paintLoad(r.view, false);
            $('scanres').innerHTML = flash('green', '✅ Moved to this load', esc(r.pallet.code + ' · ' + r.pallet.summary));
        };
        ACT.loadready = async el => {
            if (!confirm('Done loading? A manager will approve and ship it.')) return;
            busy(el, true);
            const r = await api('load_ready', { loadId: S.loadId });
            busy(el, false);
            if (!r.ok) { alert(r.error); return; }
            loadDetail();
        };

        // ── Outbound: manager "To ship" ──────────────────────────────────
        SCREENS.ship = async (msg) => {
            main('<div class="muted">Loading…</div>');
            const r = await api('ship_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<div id="shipmsg">' + (msg || '') + '</div>' + (r.loads.map(shipCard).join('') || '<div class="muted">Nothing waiting for approval</div>') +
                '<h3>Recently shipped</h3>' + (r.recent.map(L => '<div class="card"><h4>' + esc(L.number) + ' ' + statusPill(L.status) + '</h4><div class="muted">' + L.pallets + ' pallets · ' +
                    esc(L.toNumber) + ' · ' + esc(L.ifNumber) + ' · ' + esc(L.approvedAt) + '</div><button class="dbtn gh" data-act="sheet" data-id="' + L.id + '">Reprint load sheet</button></div>').join('') ||
                    '<div class="muted">None yet</div>'));
        };
        function shipCard(L) {
            const bad = L.rows.filter(x => !x.ok);
            const retry = L.status === 'error' || L.status === 'shipping';
            return '<div class="card' + (L.status === 'error' ? ' warnc' : '') + '"><h4>' + esc(L.number) + (L.door ? ' · Door ' + esc(L.door) : '') + ' ' + statusPill(L.status) + '</h4>' +
                '<div class="muted">' + L.pallets + ' pallets · ' + num(L.pieces) + ' pcs · loaded by ' + esc(L.readyBy) + ' ' + esc(L.readyAt) + '</div>' +
                '<table class="tbl"><tr><th>SKU</th><th>On truck</th><th>Available</th><th></th></tr>' + L.rows.map(x => '<tr><td>' + esc(x.sku) + '</td><td>' + num(x.qty) + '</td><td>' +
                    num(x.avail) + '</td><td>' + (x.ok ? '✅' : '❌') + '</td></tr>').join('') + '</table>' +
                (bad.length ? '<div class="muted warn">⚠ ' + bad.map(x => esc(x.sku) + ': truck has ' + x.qty + ', only ' + x.avail + ' available').join('; ') +
                    '. Remove a pallet or check the count.</div>' : '') +
                (L.error ? '<div class="muted warn">Last error: ' + esc(L.error) + '</div>' : '') +
                '<div class="row2">' + (L.canSendBack ? '<button class="dbtn gh" data-act="sendback" data-id="' + L.id + '">Send back</button>' : '') +
                '<button class="dbtn go" data-act="approveship" data-id="' + L.id + '"' + (bad.length && !L.to ? ' disabled' : '') + '>' + (retry ? 'Retry' : 'Approve & Ship') + '</button></div></div>';
        }
        ACT.approveship = async el => {
            if (!confirm('Create the transfer order and ship this load? ' + B.fromName + ' inventory goes down now.')) return;
            const w = window.open('about:blank');
            busy(el, true);
            const r = await api('load_approve', { loadId: el.dataset.id });
            busy(el, false);
            if (!r.ok) { if (w) w.close(); tone('bad'); SCREENS.ship(errBox(r.error)); return; }
            if (w) w.location = pdfUrl('type=loadsheet&loadId=' + el.dataset.id);
            tone('ok');
            SCREENS.ship(flash('green', '✅ ' + esc(r.number) + ' shipped', esc(r.toNumber + ' · ' + r.ifNumber), 'Load sheet opened in a new tab.'));
        };
        ACT.sendback = async el => {
            if (!confirm('Send this load back to the dock for changes?')) return;
            const r = await api('load_sendback', { loadId: el.dataset.id });
            SCREENS.ship(r.ok ? flash('amber', 'Sent back to the dock') : errBox(r.error));
        };
        ACT.sheet = el => { window.open(pdfUrl('type=loadsheet&loadId=' + el.dataset.id)); };

        // ── Outbound: manager print queue / plan / print a SKU ────────────
        SCREENS.queue = () => {
            S.ed = newEd();
            main('<div class="card"><h4>Add a request (radio)</h4><input class="inp" id="radiowho" placeholder="Who called it in"><div id="edbox"></div><div id="edmsg"></div>' +
                '<button class="btn pri sm" data-act="radiosend">Add to queue</button></div><h3>Queued</h3><div id="qlist"><div class="muted">Loading…</div></div><div id="qmsg"></div>');
            mountEd({ count: true, note: true });
            loadQueue();
            S.poll = setInterval(loadQueue, 15000);
        };
        async function loadQueue() {
            const r = await api('req_list', { status: 'queued' });
            const box = $('qlist');
            if (box) box.innerHTML = !r.ok ? errBox(r.error) : (r.reqs.map(q => reqCard(q, true)).join('') || '<div class="muted">The queue is empty</div>');
        }
        ACT.radiosend = async el => {
            const who = $('radiowho').value.trim();
            if (!who) { $('edmsg').innerHTML = errBox('Enter who called it in'); return; }
            const bad = edInvalid();
            if (bad) { $('edmsg').innerHTML = errBox(bad); return; }
            busy(el, true);
            const r = await api('req_create', { lines: edPayload(), count: Number(S.ed.count) || 1, note: S.ed.note, via: 'radio', requester: who });
            busy(el, false);
            if (!r.ok) { $('edmsg').innerHTML = errBox(r.error); return; }
            S.ed = newEd();
            S.edRender();
            $('edmsg').innerHTML = '';
            $('radiowho').value = '';
            loadQueue();
        };
        ACT.reqprint = async el => {
            const w = window.open('about:blank');
            busy(el, true);
            const r = await api('req_print', { reqId: el.dataset.id });
            if (!r.ok) { if (w) w.close(); busy(el, false); $('qmsg').innerHTML = errBox(r.error); return; }
            if (w) w.location = pdfUrl('job=' + encodeURIComponent(r.job));
            loadQueue();
        };
        ACT.reqcancel = async el => {
            if (!confirm('Cancel this request?')) return;
            const r = await api('req_cancel', { reqId: el.dataset.id });
            if (!r.ok) $('qmsg').innerHTML = errBox(r.error);
            loadQueue();
        };

        SCREENS.plan = async () => {
            main('<div class="muted">Loading plan…</div>');
            const r = await api('plan');
            if (!r.ok) { main(errBox(r.error)); return; }
            S.plan = r;
            main('<div class="card"><h4>Print plan · ' + esc(r.dayLabel) + ' <span class="muted">needed ' + (r.neededPerDay == null ? '—' : r.neededPerDay) + ' pallets/day · ' +
                r.labeledPallets + ' already labeled</span></h4><div class="muted">Suggested counts split today\'s need across SKUs by pallets left. Change any count.</div></div>' +
                '<div id="planmsg"></div><table class="tbl"><tr><th>SKU</th><th>Config</th><th>Pallets left</th><th>Labeled</th><th>Print</th><th></th></tr>' +
                r.rows.map((x, k) => '<tr><td><b>' + esc(x.sku) + '</b><div class="muted">' + esc(x.desc) + '</div></td><td>' + esc(x.cfg) + ' · ' + x.pcs + '</td><td>' + x.palletsLeft +
                    '</td><td>' + x.labeled + '</td><td><input class="num" data-plan="' + k + '" inputmode="numeric" value="' + x.suggest + '"></td><td><button class="dbtn pri" data-act="planrow" data-k="' + k +
                    '">Print</button></td></tr>').join('') + '</table><button class="btn go" data-act="planall">Print all</button>' +
                (r.noConfig.length ? '<div class="card warnc"><h4>' + r.noConfig.length + ' SKUs with stock but no config</h4><div class="muted">' + r.noConfig.map(x => esc(x.sku)).join(', ') +
                    '</div></div>' : ''));
        };
        function planCount(k) { const i = document.querySelector('[data-plan="' + k + '"]'); return Math.max(0, Math.floor(Number(i && i.value) || 0)); }
        function planLines(x) { return [{ item: x.item, sku: x.sku, cfg: x.cfg, pcs: x.pcs }]; }
        ACT.planrow = async el => {
            const k = +el.dataset.k, n = planCount(k);
            if (!n) return;
            busy(el, true);
            await printMany([{ lines: planLines(S.plan.rows[k]), n: n }], 'plan', $('planmsg'));
            busy(el, false);
        };
        ACT.planall = async el => {
            const specs = S.plan.rows.map((x, k) => ({ lines: planLines(x), n: planCount(k) })).filter(s => s.n > 0);
            const total = specs.reduce((a, s) => a + s.n, 0);
            if (!total || !confirm('Print ' + total + ' labels?')) return;
            busy(el, true);
            await printMany(specs, 'plan', $('planmsg'));
            busy(el, false);
        };

        SCREENS.sku = () => {
            S.ed = newEd();
            main('<div id="edbox"></div><div id="edmsg"></div><button class="btn pri" data-act="skuprint">Print labels</button>');
            mountEd({ count: true });
        };
        ACT.skuprint = async el => {
            const bad = edInvalid();
            if (bad) { $('edmsg').innerHTML = errBox(bad); return; }
            const n = Math.floor(Number(S.ed.count) || 0);
            if (n < 1) return;
            busy(el, true);
            await printMany([{ lines: edPayload(), n: n }], 'office', $('edmsg'));
            busy(el, false);
        };

        // ── Outbound: manager SKU configs ────────────────────────────────
        SCREENS.configs = async () => {
            main('<div class="card"><h4>Import configs from the sheet (CSV)</h4><div class="muted">Columns: SKU, Config, Pcs per pallet, Default (Y/N). The import replaces all configs.</div>' +
                '<input type="file" id="cfgfile" accept=".csv,text/csv"><textarea id="cfgcsv" class="inp" rows="5" placeholder="…or paste CSV here"></textarea>' +
                '<button class="dbtn pri" data-act="cfgpreview">Preview import</button><div id="cfgmsg"></div></div><div id="cfglist"><div class="muted">Loading…</div></div>');
            $('cfgfile').onchange = e => {
                const f = e.target.files[0];
                if (!f) return;
                const rd = new FileReader();
                rd.onload = () => { $('cfgcsv').value = rd.result; };
                rd.readAsText(f);
            };
            const r = await api('cfg_list');
            if (!r.ok) { $('cfglist').innerHTML = errBox(r.error); return; }
            S.cfgRows = r.rows;
            $('cfglist').innerHTML = '<div class="card"><h4>' + r.rows.length + ' SKUs with configs <button class="dbtn gh" data-act="cfgdownload">Download CSV</button></h4>' +
                (r.noConfig.length ? '<div class="muted warn">' + r.noConfig.length + ' SKUs have ' + esc(B.fromName) + ' stock but no config: ' + r.noConfig.map(x => esc(x.sku)).join(', ') + '</div>' : '') +
                '<table class="tbl"><tr><th>SKU</th><th>Configs</th><th>' + esc(B.fromName) + ' on hand</th><th>Est. pallets</th></tr>' +
                r.rows.map(x => '<tr><td><b>' + esc(x.sku) + '</b><div class="muted">' + esc(x.desc) + '</div></td><td>' + x.cfgs.map(c => esc(c.code) + ' · ' + c.pcs + (c.isDefault ? ' ✓' : '')).join('<br>') +
                    '</td><td>' + num(x.onHand) + '</td><td>' + (x.estPallets || '—') + '</td></tr>').join('') + '</table></div>';
        };
        ACT.cfgdownload = () => {
            const q = v => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
            const lines = ['SKU,Config,Pcs per pallet,Default'];
            S.cfgRows.forEach(x => x.cfgs.forEach(c => lines.push([x.sku, c.code, c.pcs, c.isDefault ? 'Y' : 'N'].map(q).join(','))));
            const a = document.createElement('a');
            a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
            a.download = 'move_pallet_configs.csv';
            a.click();
        };
        ACT.cfgpreview = async el => {
            busy(el, true);
            const r = await api('cfg_preview', { csv: $('cfgcsv').value });
            busy(el, false);
            if (!r.ok) { $('cfgmsg').innerHTML = errBox(r.error); return; }
            S.cfgImport = r;
            $('cfgmsg').innerHTML = '<div class="card"><h4>' + r.configs.length + ' configs for ' + r.skuCount + ' SKUs</h4>' +
                (r.unknownSkus.length ? '<div class="muted warn">Not found in NetSuite (skipped): ' + r.unknownSkus.map(esc).join(', ') + '</div>' : '') +
                (r.errors.length ? '<div class="muted warn">' + r.errors.map(e => (e.row ? 'Row ' + e.row + ': ' : '') + esc(e.msg)).join('<br>') + '</div>' : '') +
                (r.noConfigWithStock.length ? '<div class="muted warn">Still no config (have stock): ' + r.noConfigWithStock.map(esc).join(', ') + '</div>' : '') +
                '<button class="dbtn go" data-act="cfgcommit"' + (r.configs.length ? '' : ' disabled') + '>Replace configs with these ' + r.configs.length + '</button></div>';
        };
        ACT.cfgcommit = async el => {
            if (!confirm('Replace all pallet configs?')) return;
            busy(el, true);
            const all = S.cfgImport.configs, batch = 'B' + Date.now();
            const fail = msg => { busy(el, false); $('cfgmsg').innerHTML = errBox(msg); };
            for (let i = 0; i < all.length; i += 100) {
                let r;
                for (let t = 0; t < 3; t++) { r = await api('cfg_commit_chunk', { batch: batch, configs: all.slice(i, i + 100), upTo: Math.min(all.length, i + 100) }); if (r.ok) break; }
                if (!r.ok) return fail(r.error + '. The old configs are still active; try again.');
            }
            const act = await api('cfg_activate', { batch: batch });
            if (!act.ok) return fail(act.error);
            let rem = 1;
            while (rem > 0) {
                const r = await api('cfg_cleanup', { batch: batch });
                if (!r.ok) return fail(r.error + ' (new configs are active; old rows can be cleaned up later)');
                rem = r.remaining;
            }
            await SCREENS.configs();
            $('cfgmsg').innerHTML = flash('green', '✅ Imported ' + all.length + ' configs');
        };

        // ── Inbound: receive ─────────────────────────────────────────────
        SCREENS.recv = () => (S.recvId ? recvDetail() : recvList());
        async function recvList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('inbound_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main(r.loads.map(L => '<div class="card bt" data-act="openrecv" data-id="' + L.id + '"><h4>' + esc(L.number) + ' from ' + esc(B.fromName) + ' ' + statusPill(L.status) + '</h4>' +
                '<div class="muted">' + (L.approvedAt ? 'Shipped ' + esc(L.approvedAt) + ' · ' : '') + L.received + ' of ' + L.pallets + ' in</div></div>').join('') ||
                '<div class="muted">No trucks in transit</div>');
        }
        ACT.openrecv = el => { S.recvId = el.dataset.id; recvDetail(); };
        ACT.backrecv = () => { S.recvId = null; recvList(); };
        async function recvDetail() {
            main('<div class="muted">Loading…</div>');
            const r = await api('recv_get', { loadId: S.recvId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backrecv">← Inbound loads</button><div class="card bt"><h4>' + esc(r.load.number) + ' from ' + esc(B.fromName) +
                ' <span id="rstat"></span></h4><div class="muted">' + esc(loadSub(r.load)) + '</div><div class="prog" id="rcount"></div><div class="progress"><div id="rbar"></div></div></div>' +
                scanBox('rscan') + '<div id="scanres"></div><div class="card plist"><div class="muted"><b>Still expected</b></div><div id="rexp"></div></div><div id="rdone"></div>');
            paintRecv(r);
            wireScan('rscan', doRecvScan);
        }
        function paintRecv(r) {
            S.rv = r;
            $('rstat').innerHTML = statusPill(r.load.status);
            $('rcount').textContent = r.receivedCount + ' of ' + r.total + ' in';
            $('rbar').style.width = (r.total ? Math.round(r.receivedCount / r.total * 100) : 0) + '%';
            $('rexp').innerHTML = r.expected.map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + '</div>' +
                (p.status === 'missing' ? '<span class="pill p-red">missing</span>' : '') + '</div>').join('') || '<div class="muted">All pallets scanned in ✅</div>';
            $('rdone').innerHTML = r.load.status === 'receiving' ? '<button class="btn teal" data-act="recvready">Unloading done: send for approval</button>'
                : (r.load.status === 'recv_ready' ? '<div class="muted">⏳ Waiting for a manager to approve the receipt.</div>' : '');
        }
        function recvResultHtml(r) {
            const p = r.pallet, id = p ? p.id : '', line = p ? esc(p.code + ' · ' + p.summary) : '';
            const acts = '<button data-act="rdamaged" data-id="' + id + '">Mark damaged</button><button data-act="rundo" data-id="' + id + '">Undo</button>';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), esc(p.pieces + ' pcs · ' + p.code), esc(r.view.receivedCount + ' of ' + r.view.total + ' in'), acts);
                case 'late': return flash('green', '✅ Late arrival for ' + esc(r.loadNumber), line, 'A manager approves a second receipt for it.', acts);
                case 'dup': return flash('amber', '🟡 Already scanned in', line, 'No change.');
                case 'dup_other': return flash('amber', '🟡 Already received on ' + esc(r.otherNumber), line, 'No change.');
                case 'other_load': return flash('amber', '🟡 Belongs to ' + esc(r.otherNumber), line, '',
                    '<button data-act="recvother" data-id="' + id + '" data-load="' + esc(r.otherLoadId) + '">Receive on ' + esc(r.otherNumber) + '</button><button data-act="clearres">Set aside</button>');
                case 'other_load_pending': return flash('red', '❌ ' + esc(r.otherNumber) + ' not approved yet', line, 'A manager must Approve & Ship ' + esc(r.otherNumber) + ' first. Set the pallet aside.');
                case 'arrived_unshipped': return flash('orange', '🟠 Loaded without scan', line, 'It was never on a shipped load, so NetSuite still counts it at ' + esc(B.fromName) + '. Flagged for a manager catch-up.');
                case 'dup_catchup': return flash('amber', '🟡 Already flagged for catch-up', line);
                case 'void': return flash('red', '❌ Label cancelled', line, 'Set it aside and call the supervisor.');
                default: return flash('red', '❌ Unknown label', esc('"' + r.raw + '"'), 'Not a move label.');
            }
        }
        async function doRecvScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('scan_recv', { loadId: S.recvId, raw: v });
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            $('scanres').innerHTML = recvResultHtml(r);
            if (r.view) paintRecv(r.view);
        }
        ACT.rdamaged = async el => {
            const r = await api('recv_damaged', { palletId: el.dataset.id, loadId: S.recvId });
            if (!r.ok) { alert(r.error); return; }
            $('scanres').innerHTML = flash('amber', '🟡 Damaged: ' + esc(r.pallet.code), esc(r.pallet.summary), 'Still received (it is here), flagged for review.');
            if (r.view) paintRecv(r.view);
        };
        ACT.rundo = async el => {
            const r = await api('recv_undo', { palletId: el.dataset.id, loadId: S.recvId });
            if (!r.ok) { alert(r.error); return; }
            $('scanres').innerHTML = flash('amber', '↩ Scan undone');
            paintRecv(r.view);
        };
        ACT.recvother = async el => {
            const r = await api('recv_other', { palletId: el.dataset.id, otherLoadId: el.dataset.load, loadId: S.recvId });
            if (!r.ok) { alert(r.error); return; }
            tone(r.tone);
            $('scanres').innerHTML = flash('green', '✅ Received on ' + esc(r.loadNumber), esc(r.pallet.code + ' · ' + r.pallet.summary));
            paintRecv(r.view);
        };
        ACT.recvready = async el => {
            if (!confirm('Done unloading? A manager will approve the receipt.')) return;
            busy(el, true);
            const r = await api('recv_ready', { loadId: S.recvId });
            busy(el, false);
            if (!r.ok) { alert(r.error); return; }
            recvDetail();
        };

        // ── Inbound: manager "To receive" and catch-ups ──────────────────
        SCREENS.toreceive = async (msg) => {
            main('<div class="muted">Loading…</div>');
            const r = await api('toreceive_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<div id="rmsg">' + (msg || '') + '</div>' + (r.loads.map(L => {
                const retry = L.status === 'error' || L.status === 'receiving_tx';
                return '<div class="card bt"><h4>' + esc(L.number) + ' ' + (L.late ? '<span class="pill p-amber">late arrival</span>' : statusPill(L.status)) + '</h4>' +
                    '<div class="muted">' + L.scanned + ' of ' + L.expected + ' scanned in' + (L.damaged.length ? ' · ' + L.damaged.length + ' damaged' : '') + '</div>' +
                    (L.missing.length ? '<div class="warnrow"><span>' + (L.late ? 'Still missing' : 'Missing (will stay in transit)') + ': ' + L.missing.map(x => esc(x.code)).join(', ') + '</span></div>' : '') +
                    (L.damaged.length ? '<div class="warnrow"><span>Damaged: ' + L.damaged.map(x => esc(x.code + ' ' + x.summary)).join(', ') + '</span></div>' : '') +
                    (L.error ? '<div class="muted warn">Last error: ' + esc(L.error) + '</div>' : '') +
                    '<button class="btn teal sm" data-act="recvapprove" data-id="' + L.id + '">' + (retry ? 'Retry receipt' : (L.late ? 'Approve late receipt' : 'Approve Receipt')) +
                    ' (' + num(L.unpostedPieces) + ' pcs)</button></div>';
            }).join('') || '<div class="muted">Nothing waiting for a receipt</div>') +
                '<h3>In transit</h3>' + (r.transit.map(L => '<div class="card"><h4>' + esc(L.number) + ' ' + statusPill(L.status) + '</h4><div class="muted">' + L.pallets + ' pallets · ' +
                    esc(L.approvedAt) + '</div></div>').join('') || '<div class="muted">None</div>'));
        };
        ACT.recvapprove = async el => {
            if (!confirm('Create the item receipt? ' + B.toName + ' inventory goes up now.')) return;
            busy(el, true);
            const r = await api('recv_approve', { loadId: el.dataset.id });
            busy(el, false);
            if (!r.ok) { tone('bad'); SCREENS.toreceive(errBox(r.error)); return; }
            tone('ok');
            SCREENS.toreceive(flash('green', '✅ ' + esc(r.number) + ' received · ' + esc(r.receiptNumber), esc(num(r.pieces) + ' pcs'), r.missing ? r.missing + ' pallets still missing' : ''));
        };

        SCREENS.catchup = async (msg) => {
            main('<div class="muted">Loading…</div>');
            const r = await api('catchup_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<div id="cmsg">' + (msg || '') + '</div>' + (r.pallets.map(p => '<div class="card bo"><h4>' + esc(p.code) + ' · ' + esc(p.summary) + '</h4>' +
                '<div class="muted">Arrived on ' + esc(p.arrivedOnNumber || '?') + ' without an outbound scan · ' + esc(p.arrivedAt) + '</div>' +
                '<div class="muted">Approving creates a small transfer order, ships it and receives it at once: ' + esc(B.fromName) + ' −' + p.pieces + ', ' + esc(B.toName) + ' +' + p.pieces + '.</div>' +
                (p.ok ? '' : '<div class="muted warn">⚠ Not enough available at ' + esc(B.fromName) + ': ' + esc(p.short) + '. NetSuite has that stock reserved for customer orders; check with the office.</div>') +
                '<div class="row2"><button class="dbtn gh" data-act="cureject" data-id="' + p.id + '">Reject</button><button class="dbtn go" data-act="cuapprove" data-id="' + p.id + '"' +
                (p.ok ? '' : ' disabled') + '>Approve catch-up</button></div></div>').join('') || '<div class="muted">No catch-ups waiting</div>'));
        };
        ACT.cuapprove = async el => {
            if (!confirm('Create the catch-up transfer and receipt?')) return;
            busy(el, true);
            const r = await api('catchup_approve', { palletId: el.dataset.id });
            busy(el, false);
            if (!r.ok) { tone('bad'); SCREENS.catchup(errBox(r.error)); return; }
            tone('ok');
            SCREENS.catchup(flash('green', '✅ Catch-up ' + esc(r.number) + ' done', esc(r.receiptNumber)));
        };
        ACT.cureject = async el => {
            if (!confirm('Reject? The label goes back to "labeled" and the office investigates.')) return;
            const r = await api('catchup_reject', { palletId: el.dataset.id });
            SCREENS.catchup(r.ok ? flash('amber', 'Rejected') : errBox(r.error));
        };

        // ── Dashboard ────────────────────────────────────────────────────
        function barChart(days, needed) {
            if (!days.length) return '<div class="muted">No move days yet</div>';
            const W = 900, H = 190, x0 = 40, base = 160, top = 20;
            const max = Math.max(needed || 0, 1, ...days.map(d => d.n)) * 1.15;
            const w = (W - x0 - 10) / days.length;
            const y = v => base - v / max * (base - top);
            let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Pallets moved per day">';
            days.forEach((d, i) => {
                const bx = x0 + i * w + w * 0.15, bw = w * 0.7, by = y(d.n);
                s += '<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + (base - by) + '" rx="3" fill="' + (needed && d.n >= needed ? '#0d9488' : '#94a3b8') + '"/>';
                if (days.length <= 45) s += '<text x="' + (bx + bw / 2) + '" y="' + (by - 4) + '" font-size="10" text-anchor="middle" fill="#374151">' + d.n + '</text>' +
                    '<text x="' + (bx + bw / 2) + '" y="176" font-size="9" text-anchor="middle" fill="#6b7280">' + d.day.slice(5) + '</text>';
            });
            if (needed) s += '<line x1="' + x0 + '" x2="' + (W - 10) + '" y1="' + y(needed) + '" y2="' + y(needed) + '" stroke="#dc2626" stroke-dasharray="6 5"/>' +
                '<text x="' + (x0 + 4) + '" y="' + (y(needed) - 5) + '" font-size="11" fill="#dc2626">' + needed + ' needed</text>';
            return s + '<line x1="' + x0 + '" x2="' + (W - 10) + '" y1="' + base + '" y2="' + base + '" stroke="#cbd5e1"/></svg>';
        }
        SCREENS.dash = async () => {
            main('<div class="muted">Loading…</div>');
            const r = await api('dashboard');
            if (!r.ok) { main(errBox(r.error)); return; }
            const m = r.m, fin = m.projectedFinish;
            const k = (label, big, sub, cls) => '<div class="kpi ' + (cls || '') + '"><small>' + esc(label) + '</small><b>' + big + '</b><span>' + sub + '</span></div>';
            main('<div class="grid4">' +
                k('Total pallets to move (est.)', num(m.total), num(r.labeled) + ' labeled, not shipped') +
                k('Pallets moved (shipped)', num(m.moved), num(r.received) + ' received at ' + esc(B.toName)) +
                k('Pallets remaining', num(m.remaining), m.total ? Math.round(m.remaining / m.total * 100) + '% left' : '') +
                k('Move days left', m.daysLeft, 'Mon–Sat through ' + esc(r.target)) +
                k('Needed per day', m.neededPerDay == null ? '—' : m.neededPerDay, 'remaining ÷ days left', m.neededPerDay == null && m.remaining ? 'bad' : '') +
                k('Moved today · 7-day avg', m.movedToday + ' · ' + m.avg7, 'all-time avg ' + m.avgAll) +
                k('Projected finish', fin || '—', fin ? (m.onTrack ? '✅ on track for ' + esc(r.target) : '⚠ after ' + esc(r.target)) : 'needs a few days of data', fin ? (m.onTrack ? 'good' : 'bad') : '') +
                k('In transit', num(r.inTransit), r.exc.missing + ' missing') + '</div>' +
                '<div class="card"><h4>Pallets moved per day</h4>' + barChart(r.days, m.neededPerDay) + '</div><div class="grid3">' +
                '<div class="card"><h4>Recent loads</h4>' + (r.loads.map(L => '<div class="warnrow"><span>' + esc(L.number) + ' · ' + L.pallets + ' plt</span>' + statusPill(L.status) + '</div>').join('') ||
                    '<div class="muted">None</div>') + '</div>' +
                '<div class="card"><h4>Exceptions</h4>' + [['Missing pallets (in transit)', r.exc.missing], ['Waiting for catch-up', r.exc.arrivedUnshipped], ['Catch-ups last 7 days', r.exc.catchups7],
                    ['Damaged, flagged', r.exc.damaged], ['Edited at dock', r.exc.edited], ['Labeled, never loaded (stale)', r.exc.stale], ['SKUs with stock but no config', r.exc.noConfig]]
                    .map(x => '<div class="warnrow"><span>' + esc(x[0]) + '</span><b>' + x[1] + '</b></div>').join('') +
                    (r.noConfigSkus.length ? '<div class="muted">' + r.noConfigSkus.map(esc).join(', ') + '</div>' : '') + '</div>' +
                '<div class="card"><h4>Remaining by SKU</h4>' + r.bySku.map(x => '<div class="warnrow"><span>' + esc(x.sku) + '</span><b>' + x.palletsLeft + '</b></div>').join('') + '</div></div>');
        };

        shell();
    }

    function buildPage(boot) {
        const json = JSON.stringify(boot).replace(/</g, '\\u003c');
        return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<title>Move Portal</title><style>' + CSS + '</style></head><body><div class="muted" style="padding:20px">Loading…</div>' +
            '<script>(' + clientMain.toString() + ')(' + json + ');</script></body></html>';
    }

    return { buildPage: buildPage, _clientMain: clientMain };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 49 tests.

- [ ] **Step 5: Run the browser app locally against a stub, to catch runtime errors before NetSuite.** Write the scratch script `move_portal/test/preview_server.js` (not committed; add it to `.gitignore`). It serves `buildPage` and answers every action from the in-memory fakes:

```js
// move_portal/test/preview_server.js — local preview only, NOT deployed or committed.
const http = require('http');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const data = require('./fake_data').makeFakeData(core);
const tx = require('./fake_tx').makeFakeTx();
const tpl = loadAmd('move_label_template.js');
const ui = loadAmd('move_ui.js');
data.db.items.push({ item: '11', sku: 'YSN201', desc: '20# LP Cylinder w/OPD', upc: '111' }, { item: '12', sku: 'YSN301', desc: '30# LP Cylinder', upc: '112' });
data.db.stock['35'] = { '11': { onHand: 12000, avail: 11000 }, '12': { onHand: 6000, avail: 6000 } };
data.db.configs.push({ item: '11', code: 'A', pcs: 120, isDefault: true, batch: 'B1' }, { item: '11', code: 'B', pcs: 60, isDefault: false, batch: 'B1' }, { item: '12', code: 'A', pcs: 60, isDefault: true, batch: 'B1' });
const mgr = process.argv[2] !== 'floor';
const sl = loadAmd('sl_move_portal.js', {
    'N/runtime': { getCurrentUser: () => ({ id: 5, name: 'Preview', roleId: mgr ? 'administrator' : 'x', role: mgr ? 3 : 9 }), getCurrentScript: () => ({ id: 's', deploymentId: 'd' }) },
    'N/log': { error: console.error, debug() {}, audit() {} }, 'N/render': {}, 'N/url': {},
    'N/format': { format: () => '10/14/2026 2:14:05 pm', Type: { DATETIMETZ: 1 }, Timezone: { AMERICA_LOS_ANGELES: 1 } },
    './move_core': core, './move_data': data, './move_tx': tx, './move_label_template': tpl, './move_ui': ui
});
http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const action = u.searchParams.get('action');
    if (!action) { res.end(ui.buildPage({ url: '/?script=1&deploy=1', mode: mgr ? 'manager' : 'floor', me: 'Preview', roster: ['Miguel', 'Santiago'], fromName: 'Riverside', toName: 'Tippecanoe', maxPrint: 250 })); return; }
    if (action === 'pdf') { res.setHeader('Content-Type', 'text/plain'); res.end('PDF would render here (' + u.search + ')'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
        let out;
        try { out = Object.assign({ ok: true }, sl._runAction(action, JSON.parse(body || '{}'), mgr)); }
        catch (e) { out = { ok: false, error: e.message }; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out));
    });
}).listen(8765, () => console.log('Move Portal preview on http://localhost:8765 (' + (mgr ? 'manager' : 'floor') + ')'));
```

Add `move_portal/test/preview_server.js` to `.gitignore`. Then add a `.claude/launch.json` entry named `move-preview` (runtimeExecutable `node`, runtimeArgs `["move_portal/test/preview_server.js"]`, port 8765) and open it with the preview tool. At phone width (375px), check each of these:
1. **Header:** the toggle switches Outbound/Inbound.
2. **Print a SKU:** YSN201 → Config B → 30 labels → Print. The PDF tab shows the stub text.
3. **Load:**
   - Open a load.
   - Type `PLT` + the first label id into the scan box and press Enter: green card, totals 1.
   - The same code again: amber.
   - `123`: red.
   - Load done.
4. **To ship:** Approve & Ship. The load then appears under Recently shipped.
5. **Inbound → Receive:** scan in, Unloading done. Then **To receive** → Approve Receipt.
6. **Dashboard:** it renders without console errors (`read_console_messages`).

Fix any runtime error in `move_ui.js`, re-run `node --test "move_portal/test/*.test.js"`, and repeat.

- [ ] **Step 6: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js .gitignore .claude/launch.json
git commit -m "feat(move): mobile-first browser app for labels, loading, receiving, dashboard"
```

---

### Task 13: Deploy to sandbox and verify labels (P1)

**Files:** none changed unless a defect is found. Record the results in the CLAUDE.md Move Portal block.

- [ ] **Step 1: Final local checks**

Run: `node --test "move_portal/test/*.test.js"` → expected: PASS, 49 tests.
Run: `for f in move_portal/*.js; do node --check "$f" || echo "FAIL $f"; done` → expected: no FAIL lines.

- [ ] **Step 2: Upload the six files** to the sandbox File Cabinet folder **SuiteScripts/MovePortal** (create the folder if it's missing):
  - `move_core.js`, `move_label_template.js`, `move_data.js`, `move_tx.js`, `move_ui.js`, `sl_move_portal.js`
  - The file names must be exact, because the Suitelet loads them by relative path (`./move_core` …).

- [ ] **Step 3: Create the Script record the file-first way.**
  - Customization → Scripting → Scripts → **New Script** → pick `sl_move_portal.js` → Create Script Record. **Do not use the "Select 1.0 Script Type" chooser.** It creates an API 1.0 record that fails on ES6.
  - Name `Move Portal`, ID typed `_move_portal` → `customscript_move_portal`.
- [ ] **Step 4: Create the Deployment.**
  - ID typed `_move_portal` → `customdeploy_move_portal`.
  - **Status Testing**, Log Level Debug, **Execute As Role = Current Role**. Available Without Login OFF.
  - Audience roles: Administrator, Warehouse Portal Manager, Portal Picker, and the FK Warehouse Manager variants Jack uses.
  - Save, then copy the deployment URL into the CLAUDE.md block.

- [ ] **Step 5: Smoke test as Administrator.**
  1. Open the URL. The header shows "Move Portal · manager" and the toggle, with no console errors.
  2. SKU configs → paste a 3-row CSV:

     ```
     SKU,Config,Pcs per pallet,Default
     YSN201,A,120,Y
     YSN201,B,60,N
     YSN301,A,60,Y
     ```
     Preview, then Replace. The list shows both SKUs.
  3. Print a SKU → YSN201, Config A, 3 labels → Print.
     - The PDF opens as 1 header card + 3 labels, each 4×6.
     - **Scan each barcode** with a real scanner and a phone camera app. Each must read `PLT<id>`.
     - If BFO rejects the `width`/`height` attributes on `<body>`, change it to `size="4in 6in"`. Update `move_label_template.js` and its test regex, and re-run the tests.
  4. Print a SKU → a mixed pallet (YSN201 ×24 + YSN301 ×40) → 1 label. It prints as MIXED with both lines.
  5. Reprint one label (same code) and void another.
  6. Print plan: rows show YSN201/YSN301 with suggested counts. Print one row.

- [ ] **Step 6: Floor test** as a Portal Picker login (or a test employee with that role) on a phone:
  - The header shows no "manager" and only the floor tabs.
  - Request label → YSN301 → Config A → change pieces to 52 → Send.
  - As Administrator, the Print queue shows it. Print it: the label shows EDITED, and the request shows "Printed · on its way" on the phone.

- [ ] **Step 7: Record the P1 results** (deployment URL, what passed, any fix) in CLAUDE.md, then commit any code fix together with the record:

```bash
git add CLAUDE.md move_portal
git commit -m "chore(move): sandbox P1 (labels) verified"
```

---

### Task 14: Sandbox verification of loading, shipping, receiving, catch-up and dashboard (P2–P4)

Use the labels from Task 13, plus 4 more printed for YSN201 Config A. Keep the Task 0 Step 2 on-hand notes open for comparison.

- [ ] **Step 1: Loading (phone, Outbound).**
  1. Open a new load: door 4, carrier Test, trailer T1, seal S1.
  2. Scan 3 labels: green each time, and the totals match.
  3. Scan one again: amber, "Already on this load".
  4. Scan a voided label: red.
  5. Scan a product UPC: red, unknown.
  6. Edit one pallet's pieces, then Remove and re-scan it.
  7. Load done: the phone says "Waiting for manager approval" and scanning is closed.

- [ ] **Step 2: Approve & Ship (manager).**
  1. Note Riverside on-hand/available for YSN201.
  2. Open To ship. The row shows on-truck vs available with ✅.
  3. Approve & Ship. The load sheet PDF opens.
  4. In NetSuite, open the new Transfer Order (memo `Move MV-001 [mv:…:to]`) and the IF:
     - The IF is **Shipped** and has only the load's quantity.
     - Riverside on-hand dropped by exactly the load's pieces.
  5. Check the execution logs of the IF User Events from Task 0 Step 2.6: no new errors, and no "Filled" stamped on the TO line.
  6. Double-click protection: press Approve on the shipped load again. It's refused.

- [ ] **Step 3: Receiving (phone, Inbound, same login).**
  1. Toggle to Inbound and open MV-001.
  2. Scan 2 of the 3 pallets, and mark one damaged.
  3. Scan a label printed but never loaded: orange, "Loaded without scan".
  4. Unloading done.

- [ ] **Step 4: Approve Receipt (manager).**
  1. Open To receive: 2 of 3 scanned, 1 missing, 1 damaged.
  2. Approve. In NetSuite, the Item Receipt has only the 2 pallets' pieces, and Tippecanoe on-hand rose by exactly that amount.
  3. The load shows "Received · short".
  4. Scan the missing pallet on Inbound: "Late arrival". Approve the late receipt. A second receipt appears and the load becomes Received.

- [ ] **Step 5: Catch-up (manager).**
  1. Open Catch-ups: the orange pallet shows with "ok".
  2. Approve. A `MV-001-C1` TO, IF (Shipped) and receipt are created.
  3. Riverside is down and Tippecanoe is up by that pallet.

- [ ] **Step 6: Failure paths.**
  - Force a stock shortage: open a load holding more YSN201 than Riverside available (or temporarily raise a pallet's pieces with Edit before Load done). Approve & Ship is blocked with the SKU named, and no TO is created.
  - Send back works while no TO exists.

- [ ] **Step 7: Dashboard.**
  - Moved, remaining, days left (Mon–Sat to Nov 14) and needed/day should match a hand calculation from the settings `start` and the on-hand report.
  - Projected finish shows once there's pace data.
  - The Exceptions list counts the damaged pallet and the catch-up.

- [ ] **Step 8: Real-world dry run.**
  - The office 4×6 thermal printer prints at true size.
  - An Android scanner in keystroke mode with an Enter suffix, at both docks: rapid scans of 10 pallets, and none are lost.
  - Walk each dock with the phone for dead spots in cell signal. Record the result. If scans fail anywhere, stop and raise the offline-queue item with Jack before go-live.

- [ ] **Step 9: Picker portal regression.** Open sandbox script 747 and load the queue. It renders with no change. Approve one normal SO. That works as before.

- [ ] **Step 10: Record everything** in CLAUDE.md (pass/fail per step, TO/IF/receipt numbers used), set the settings `labelCode` per the scanner result, then commit:

```bash
git add CLAUDE.md move_portal
git commit -m "chore(move): sandbox P2-P4 verified"
```

---

### Task 15: Production rollout (only after Jack's explicit go)

- [ ] **Step 1: Repeat Task 0 Steps 3–6 in production (account 8211645).** That means:
  - manager role permissions;
  - the six record types and their fields, with identical ids;
  - the settings row, with prod `locFrom` = 35 and prod `locTo` = the Tippecanoe prod id;
  - the real roster, and `start` = the first real move day.
  - Double-check every field id after saving.
- [ ] **Step 2: Upload the same six files** to prod SuiteScripts/MovePortal, and create the Script and Deployment as in Task 13 Steps 3–4, with Status **Testing** (owner only).
- [ ] **Step 3: Prod config import.**
  1. Build the per-SKU CSV from the Product Matrix sheets (per-customer configs de-duplicated into A/B/C per SKU).
  2. Jack corrects it.
  3. Import it. SKU configs shows 0 or close to 0 "no config" SKUs with stock.
- [ ] **Step 4: Pilot one real truck end to end:** labels → load → Approve & Ship → drive → receive → Approve Receipt. Check the NetSuite inventory at both warehouses against the load sheet.
- [ ] **Step 5: Go live.**
  - Set the deployment Status to **Released**, keeping the same audience. Hand out the URL.
  - Set the Log Level to Error after the first week.
- [ ] **Step 6: Update CLAUDE.md** (prod ids, URL, go-live date) and `ns_optimization_artifact.html`, then commit:

```bash
git add CLAUDE.md ns_optimization_artifact.html
git commit -m "docs: Move Portal live in production"
```

---

## Self-review notes (plan author)

- **Spec coverage:**
  - D1 separate app → Global Constraints and Task 13.
  - D2 truck = TO = IF → Task 9.
  - D3 approvals → `runAction` manager gate plus Tasks 9 and 10.
  - D4 toggle → Task 12.
  - D5 office printing, requests and radio → Tasks 8 and 12.
  - D6 label content and code mode → Task 5.
  - D7 configs and import → Tasks 3, 8 and 12.
  - D8 relabel, void and dock edit → Tasks 8, 9 and 12.
  - D9 scan receiving, missing and damaged → Task 10.
  - D10 catch-up → Task 10.
  - D11 tracker → Tasks 4, 11 and 12.
  - D12 scanners and camera → keystroke scanners in Task 12. The camera button is the later phase in spec §15. Phone camera apps that type into the field also work.
  - Spec §9.4 script interactions → Task 0 Step 2 and Task 14 Step 2.
  - Spec §13 prerequisites → Task 0.
- **Deliberate v1 cuts** (recorded in the spec): the inline print preview and "Add to today's plan" on Print a SKU; offline scan queue; camera scanning button.
- **Type consistency:**
  - Load ids are strings everywhere and pallet ids are numbers.
  - `loadId` on pallets is compared as a string.
  - `lines` are always `[{item:String, sku, cfg, pcs:Number, desc}]`.
  - Aggregations are keyed by item id string.
