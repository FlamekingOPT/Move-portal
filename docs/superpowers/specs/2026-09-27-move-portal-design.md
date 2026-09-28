# Move Portal: Riverside → Tippecanoe Warehouse Move — Design

**Date:** 2026-09-27 · **Status:** design approved by Jack (mockup reviewed). Spec awaiting review. No code yet.
**Mockup:** `docs/mockups/2026-09-27 move portal mockup.html`
**Supersedes:** `2026-09-25-pallet-labels-scan-design.md` (labels tied to SO/TO picking). That idea is dropped for the move.

---

## 1. Goal

Move all Riverside inventory (≈891,739 pcs across 376 SKUs, per `CurrentInventoryOnHand903.xlsx`) to the new Tippecanoe warehouse.
- **Timeline:** starts soon, runs about 6 weeks, **target Nov 15**. Move days are **Mon–Sat**.
- **Riverside keeps shipping customer orders the whole time.**
- NetSuite inventory must follow the pallets exactly:
  - **Riverside on-hand drops when a truck is approved and shipped.**
  - **Tippecanoe on-hand rises when the pallets are scanned in and the receipt is approved.**
  - Anything not scanned in stays in transit, visible, until resolved.

## 2. Decisions (from brainstorm, all confirmed by Jack)

| # | Decision |
|---|---|
| D1 | **Separate app.** A new Suitelet with its own script, deployment and files. The picker portal (prod script 913, v19.8) is not touched, and nothing depends on v20. |
| D2 | **SUPERSEDED 2026-09-28 by `2026-09-28-move-portal-bulk-to-design.md` (office per-SKU TOs, N IFs per truck).** Original: **1 truck = 1 Load = 1 Transfer Order = 1 Item Fulfillment.** The TO is built from the pallets scanned onto the truck. Nothing is committed in NetSuite until a manager approves the load, so customer orders are never starved. |
| D3 | **Pick/approve model.** Floor workers only scan and request; that writes custom records only, so no new NetSuite permissions. **Managers approve every inventory-changing step:** Approve & Ship, Approve Receipt, Approve catch-up. |
| D4 | **Outbound / Inbound toggle** in the header. The same login and phone work at both sites. Managers also get separate Outbound and Inbound screens. |
| D5 | **Labels are printed by one office person** on a 4×6 thermal printer, and floor workers stick them on. Sources: the **Print Plan** (daily batches by SKU), **floor label requests** from phones (short, mixed, rebuilt or lost-label pallets), and **radio requests** entered by the office. |
| D6 | **Label content:** SKU, config, pieces, description, a `PLT<id>` code as Code128 and/or QR (stacked; office setting Both / Barcode only / QR only), printed date and source, and **EDITED** when the pieces differ from the config. **No dims.** No weight. |
| D7 | **Pallet configs:** the Google Sheet / Excel is the master. The office imports a CSV copy into NetSuite. A SKU can have several configs, and one is the default. Every pallet's pieces are editable. |
| D8 | **Labels are descriptive, not reservations.** A labeled pallet can still be broken up or go to a customer. Relabel and Void flows exist, and the dock **Edit** fixes mismatches at load time. Unused labels are harmless because only scanned-onto-truck pallets count. |
| D9 | **Receiving is by scan.** The receipt includes only scanned pallets. Missing pallets stay in transit and are flagged. **Damaged** pallets are received and flagged. |
| D10 | **`arrived unshipped`**: a pallet that reaches Tippecanoe without an outbound scan. It's fixed by a manager-approved **catch-up** (a small TO → IF shipped → receipt, all at once). |
| D11 | **Move tracker** on the dashboard: total pallets (estimated), moved per day, remaining, move days left, pallets/day needed, projected finish vs Nov 15. |
| D12 | **Scanners:** any device that types the code plus Enter (Android scanner in keystroke mode, or a Bluetooth scanner paired to a phone). The phone camera is a backup. No bins or lots at Riverside. |

## 3. Architecture

```
            ┌──────────── Move Portal Suitelet (sl_move_portal.js) ────────────┐
Office PC → │ Queue+Plan · Print a SKU · SKU Configs · Reprint/Void · Dashboard│ → PDF labels (N/render)
Phones    → │ Outbound: Request · Load · Void   Inbound: Receive               │
Managers  → │ Outbound: To ship · Open loads    Inbound: To receive · Catch-ups │
            └───────┬────────────────────────────────────────────┬──────────────┘
                    │ custom records (floor + manager)           │ transactions (manager only)
          mv_config · mv_pallet · mv_load · mv_scan ·     Transfer Order → Item Fulfillment (Shipped)
          mv_label_req · mv_settings                       Transfer Order → Item Receipt
```

**Files** (new, dated test copies per the standing rule until Jack approves):
- `sl_move_portal.js`: one Suitelet serving every HTML screen and every AJAX action (`action=` routing, the same pattern as the picker portal).
- `move_label_template.js`: a small module that returns the BFO XML for labels, header cards and the load sheet. Kept separate so the label layout can change without touching logic.
- No User Events are needed.

**Deployment:**
- Login required, **not** Available Without Login.
- **Execute As Current Role.**
- Audience: Portal Picker (2537), Warehouse Portal Manager (2536), Administrator, and the FK Warehouse Manager variants.
- The URL is bookmarked on the office PC and the dock devices.

**Roles inside the app**, using the same logic as picker-portal `getUserMode()`, copied, not shared:
- **MANAGER:** Administrator, a role in `MANAGER_ROLE_SCRIPT_IDS`, or the Employee checkbox `custentity_portal_manager`. Can print, approve, void anyone's label, and change settings.
- **FLOOR:** everyone else. Can request, void, load, remove, receive, and flag catch-ups.
- Every manager-only action is also rejected server-side for FLOOR users.

**Location constants** (per environment, at the top of the file):
- `LOC_RIVERSIDE` is 35 in prod; the sandbox id is still to be confirmed.
- `LOC_TIPPECANOE` is to be filled in prod and sandbox.
- The direction is fixed: Riverside → Tippecanoe. The toggle only changes which screens show, so it can never reverse a transfer.

## 4. Data model (NetSuite setup)

All custom records use **Access Type = No Permission Required** (like Picker Status) and **Include Name Field = OFF**. Only fields that searches filter or group on are real fields. Everything else lives in one Long Text JSON field per record, which keeps NetSuite setup to about 30 fields. **All timestamps are text:** the display stamp comes from `N/format` DATETIMETZ in America/Los_Angeles, and "day" fields are `YYYY-MM-DD`. That avoids date-field parsing and timezone bugs.

| Record | Real fields (type) | JSON field holds |
|---|---|---|
| `customrecord_mv_settings` (1 row) | `custrecord_mvs_data` (Long Text) | `{locFrom, locTo, fromName, toName, target:"2026-11-15", start, skip:[iso…], labelCode:"both"|"c128"|"qr", roster:[names], maxPrint:250, staleDays:5, toStatus:"B", activeBatch}` |
| `customrecord_mv_config` | `_mvc_item` (List/Record → Item), `_mvc_code` (Text), `_mvc_pcs` (Integer), `_mvc_default` (Checkbox), `_mvc_batch` (Text) | — |
| `customrecord_mv_load` | `_mvl_number` (Text), `_mvl_status` (Text), `_mvl_to` (List/Record → Transaction), `_mvl_if` (List/Record → Transaction), `_mvl_receipts` (Text, ids comma-joined) | `custrecord_mvl_data`: door, carrier, trailer, seal, lines snapshot `{item:qty}`, created/ready/approved/recvReady/recvApproved by+at, error, catchupFor, workingAt (ms), pendingRecv `{seq, ids}`, recvSeq |
| `customrecord_mv_pallet` | `_mvp_status`, `_mvp_job`, `_mvp_receipt` (receipt id), `_mvp_shipped_day`, `_mvp_printed_day`, `_mvp_summary` (all Text), `_mvp_load`, `_mvp_arrived_on` (List/Record → mv_load), `_mvp_damaged`, `_mvp_catchup`, `_mvp_edited` (Checkbox), `_mvp_pieces` (Integer) | `custrecord_mvp_data`: lines `[{item, sku, cfg, pcs, desc}]`, source, replacedBy, printedAt/By, printCount, loadedAt/By, shippedAt, receivedAt/By, arrivedAt/By, editedAt/By, voidReason/At/By, catchupLoad |
| `customrecord_mv_scan` | `_mvsc_pallet` (List/Record → mv_pallet), `_mvsc_load` (List/Record → mv_load), `_mvsc_result` (Text) | `custrecord_mvsc_data`: raw, mode, actor, at |
| `customrecord_mv_label_req` | `_mvr_status` (Text), `_mvr_requester` (Text) | `custrecord_mvr_data`: lines, count, note, via, job, at |

(Field ids are shown without the `custrecord` prefix, e.g. `_mvp_status` = `custrecord_mvp_status`.)

**Pallet statuses:** `labeled` · `loaded` · `shipped` · `received` (scanned in; posted once `_mvp_receipt` is set) · `missing` · `arrived_unshipped` · `void`.
**Load statuses:** `loading` · `ready` · `shipping` · `shipped` · `receiving` · `recv_ready` · `receiving_tx` · `received` · `received_short` · `error`.
**Label code = `PLT` + the pallet internal id.** A print "job" id (`_mvp_job`) groups the pallets of one print click, so a retry never duplicates them and the PDF prints exactly that set.

## 5. Pallet config import

- Office → **SKU Configs** → **Import from sheet (CSV)**. Paste the CSV or pick a file (read client-side, posted as text).
- **Columns:** `SKU, Config, Pcs per pallet, Default (Y/N)`.
- Server steps:
  1. Resolve each SKU to an item id with an `itemid` search, batched.
  2. Validate: pcs > 0, exactly one default per SKU. If no row is marked Y, the first row becomes the default.
  3. Preview: show counts, unknown SKUs, and SKUs with Riverside stock but no config. **Commit** is a second click.
  4. On commit, write the new rows under a new batch id in chunks. Then set `activeBatch` in settings, so the switch-over is atomic and readers only ever see one complete batch. Then delete the other batches in chunks.
- **Governance:** about 400 rows × (create 2 + delete 2) ≈ 1,600 units, which exceeds one Suitelet request. So the commit runs in chunks of 100 rows, driven by the page (same as the backfill Suitelet's batching). A failed chunk leaves the old batch in place, because old rows are deleted only after all new rows are written.
- **One-time prep (me, before go-live):** build a draft per-SKU CSV from the Product Matrix sheets (per-customer configs, de-duplicated into A/B/C per SKU) for Jack to correct.

## 6. Labels and printing

- **Rendering:** `N/render` `xmlToPdf` with BFO XML, page size 4in × 6in.
  - Barcodes use BFO's native `<barcode codetype="code128" value="PLT48213"/>` and `<barcode codetype="qrcode" …/>`, stacked (Code128 full width, QR centered below). The office setting hides one of them.
  - With QR only, the QR prints at 1.5".
- **Label layout** (see the mockup's 🏷 tab):
  - `MOVE · RIVERSIDE ▶ TIPPECANOE` header;
  - the SKU very large, then the config;
  - pieces large, or for MIXED up to 5 SKU/pcs rows plus a total;
  - the description (single-SKU only);
  - the barcode block;
  - a footer with printed date and source/requester, plus `EDITED` when flagged.
- **Header card:** before each plan or SKU batch, a card showing SKU · config · N labels · the PLT id range.
- **Print flow:**
  1. The office clicks Print. The server creates the pallet records (status `labeled`) and returns the PDF URL in a new tab.
  2. The office prints to the Zebra (or similar) driver at 4×6.
  3. Each print job is capped at `max_print` labels; bigger batches are split into jobs.
  4. Governance: about 4–5 units per pallet create, so 200 labels ≈ 1,000 units. Batches over 150 are created in chunks of 150 before rendering (page-driven), then a single render call follows.
- **Reprint:** same pallet id and a `print_count++`. It doesn't show REPRINT (the id is what matters).
- **Edit + reprint (relabel):** a new pallet with the new lines; the old one becomes `void` with `replaced_by` set. The old label can't be relabeled if it's `loaded` or `shipped`; fix those via dock Edit instead.
- **Void:** status `void` plus a reason. Allowed only from `labeled` (a `loaded` pallet is removed from its load first).

## 7. Screens

All screens are one Suitelet page. The page loads once, and screen switches plus actions use AJAX with no reloads, so dock scanning stays fast. Phone screens are one column with tap targets of at least 48px. The scan field keeps focus after every action. Each scan result has its own color **and** its own tone (WebAudio: rising = ok, double = amber, low buzz = red).

### Header
Title, the "I am ___" picker (from settings roster, stored per device in `localStorage`), and the **📤 Outbound · Riverside / 📥 Inbound · Tippecanoe** toggle (remembered per device). Managers see extra tabs.

### Office (desktop, MANAGER)
- **Queue + Plan:**
  - The *Print Queue* lists queued label requests, polled every 15s: time, requester, lines, count, note, and **Print** per row. **+ Add request (radio)** opens the same form as the phone.
  - The *Print Plan* lists every SKU with Riverside on-hand > 0 and a default config, sorted by remaining pallets. Columns: SKU, default config, pallets left, suggested count, editable count, Print. **Print all** and **+ Add SKU** are available.
  - **Suggested counts** split today's *needed/day* across SKUs in proportion to pallets left, rounded, largest SKUs first, capped at pallets left. They're only suggestions.
- **Print a SKU:** SKU search (shows on-hand), config chips (default preselected), pieces/pallet (editable), number of labels, **+ Add another SKU** (mixed), **Print** (the PDF opens in a new tab, which is the preview). *The mockup's inline preview and "Add to today's plan" button are cut from v1 (YAGNI).*
- **SKU Configs:** a table (SKU, description, configs, default, Riverside on-hand, estimated pallets), red rows for SKUs with stock and no config, Import (CSV) and Download CSV.
- **Reprint / Void:** scan or type a label id, then pallet details, then Reprint / Edit + reprint / Void.
- **Dashboard:** §10.

### Outbound, FLOOR (phone)
- **Request label:**
  - SKU (typed or scanned product barcode, matched against item `upccode` or `itemid`);
  - config chips, with pieces filled in (the `EDITED` hint shows when changed);
  - number of labels, optional note, and **+ Mixed pallet**.
  - **Send** creates an `mv_label_req`. **My requests today** shows the status (queued / printed).
- **Load:**
  - The list of open loads, plus **+ New load** (door, carrier, trailer, seal; the number is assigned).
  - Inside a load: scan field → result card (§8.1), totals (pallets / pieces / SKUs), the pallet list with Edit / ✕, and **Load done: send for approval** (status `ready`).
  - A load in `ready` becomes read-only to FLOOR. A manager can send it back to `loading`.
- **Void:** scan → details → reason (broken up / sent to customer / damaged / other) → Void.

### Inbound, FLOOR (phone)
- **Inbound loads:** loads in `shipped` or `receiving`, with ship date and pallet count.
- **Receive:**
  - Pick a load; it goes to `receiving` on the first scan.
  - Scan field → result card (§8.2), "N of M in" with a progress bar, the still-expected list, **Mark damaged** on the last scanned pallet, and **Undo** on the last scan.
  - **Unloading done: send for approval** sets status `recv_ready`.

### Manager, Outbound (phone or desktop)
- **To ship:** each `ready` load shows its per-SKU table: *on truck* vs *Riverside available*, with ✅ or ❌ per SKU. Actions: **Approve & Ship** (disabled while any ❌) and **Send back**.
- **Open loads** and recently shipped loads (with TO / IF links and **Reprint load sheet**).
- **Print queue**: the same as the office screen.

### Manager, Inbound
- **To receive:** each `recv_ready` load shows scanned / expected counts, the missing and damaged lists, and **Approve Receipt (N pcs)**.
- **Catch-ups:** pallets flagged `arrived_unshipped`, each with **Approve catch-up** or **Reject** (Reject returns it to its previous status and the office investigates).
- **In transit:** shipped loads not yet received.

## 8. Scan rules (server `action=scan`)

The input is the raw scanned text, trimmed. `PLT(\d+)` → a pallet id; anything else → `unknown`. Every attempt writes one `mv_scan` row.

### 8.1 Load mode (load L, status `loading`, Outbound)
| Pallet state | Result | Effect |
|---|---|---|
| `labeled` | ✅ ok | status `loaded`, load = L, loaded_at/by |
| `loaded`, load = L | 🟡 dup | none |
| `loaded`, load = other open load L2 | 🟡 other_load, with buttons **Move here** / **Leave** | Move: load = L |
| `loaded` on L2 in `ready` or later | ❌ "on MV-xxx awaiting approval" | none |
| `shipped` / `received` / `missing` / `arrived_unshipped` | ❌ shipped | none |
| `void` | ❌ void ("relabel this pallet") | none |
| not found / not PLT | ❌ unknown | none |

- **Edit count** (on the result card or a list row): per-line pieces for a MIXED pallet. It sets `edited` and rewrites `lines_json` and `pieces`.
- **Remove:** status back to `labeled`, load cleared.
- Both are allowed only while L is `loading`.

### 8.2 Receive mode (load L in `shipped` / `receiving`, Inbound)
| Pallet state | Result | Effect |
|---|---|---|
| `shipped`, load = L | ✅ ok | status `received`* , received_at/by |
| `received`, load = L | 🟡 dup | none |
| `shipped` on another load L2 | 🟡 "belongs to MV-xxx" with **Receive on MV-xxx** / **Set aside** | receive against L2 (L2 moves to `receiving`) |
| `labeled`, or `loaded` on a still-`loading` Riverside load | 🟠 arrived_unshipped (flagged automatically, no extra tap) | status `arrived_unshipped`, `arrived_on` = L, removed from any open load |
| `loaded` on a `ready`/`shipping`/`error` load (truck left before approval) | ❌ "MV-xxx not approved yet" | none. The manager approves that load first |
| `void` | ❌ void ("set aside, call supervisor") | none |
| not found | ❌ unknown | none |

\* "Received" on the pallet means **scanned in**. NetSuite inventory changes only at **Approve Receipt**, and pallet status is final once the receipt posts.

**Mark damaged** sets `damaged` on the pallet; it still counts as received. **Undo** reverts the last ok scan by this device on this load.

## 9. NetSuite transactions (manager actions)

All of these are server-side under the manager's own role, so the manager role needs the permissions listed in §12.

**Concurrency guard:** each action first flips the load status with `submitFields` from the expected state to a "working" state (`ready → shipping`, `recv_ready → receiving_tx`). It re-reads the status, and if another request got there first it refuses with "already in progress". Each step's resulting transaction id is saved on the load **immediately**, so **Retry** resumes from the first missing step. It never creates a second TO, IF or receipt.

### 9.1 Approve & Ship (load L: `ready`)
1. **Aggregate** the load's pallets (`status loaded`, load = L) into `{itemId: qty}`, and save the snapshot to `mvl_lines_json`.
2. **Stock check:** for each item, Riverside **available** (item search `locationquantityavailable`, location = Riverside) must be ≥ qty. If not, refuse and list the shortages (the load stays `ready`).
3. **Create the TO:** `record.create(TRANSFER_ORDER)` with subsidiary, `location` = Riverside, `transferlocation` = Tippecanoe, memo `Move MV-014 · trailer … · seal …`, and `orderstatus` = Pending Fulfillment (if TO approval routing requires it, confirm in sandbox, §13), plus one line per item with its quantity. Save it and store `mvl_to`.
4. **Create the IF:** `record.transform(TO → ITEM_FULFILLMENT)`, then set `shipstatus = C` (Shipped). For each line: `itemreceive = true`, quantity = the load qty. Save it and store `mvl_if`.
   - Riverside on-hand drops here; the stock is now in transit.
   - Before building, guard that the IF's fulfillable quantity per line equals the load qty. If NetSuite committed less, **don't save**: set `error`, and report it.
5. Pallets go to `shipped`, the load to `shipped` with approved_by/at. **Print the load sheet** (PDF: load #, trailer/seal, TO and IF numbers, pallet list, SKU totals, driver signature line).
6. **Governance:** roughly 10 (create TO) + 10 (transform) + 20 (save IF) + about 2 per pallet status update (`submitFields`, e.g. 26 pallets ≈ 52) ≈ 100 units. Fine.

### 9.2 Approve Receipt (load L: `recv_ready`)
1. **Aggregate the scanned-in pallets** (status `received`, load = L) into `{itemId: qty}`.
2. **Create the receipt:** `record.transform(TO → ITEM_RECEIPT)`. For each line, quantity = the scanned qty for that item; lines with nothing scanned get `itemreceive = false`. Save it and append the id to `mvl_receipt_ids`.
3. **Pallets:** shipped pallets on L that weren't scanned go to `missing`, and the load becomes `received_short`, or `received` if none are missing.
4. **A missing pallet found later:** scanning it in on Inbound shows ✅ "late arrival for MV-011". It goes to `received` and appears under To receive as **Approve late receipt**. That creates a second receipt for just those pallets, and the load becomes `received` once nothing is missing.

### 9.3 Approve catch-up (pallet P: `arrived_unshipped`)
1. **Stock check** at Riverside available, as in §9.1 step 2. If short, refuse ("NetSuite has this stock reserved for customer orders, check with the office").
2. **Create a catch-up load** `MV-xxx-Cn` (linked to the load it arrived on). Then create the TO, the IF (Shipped) and the receipt in sequence, with the same Retry/idempotency rules.
3. P becomes `received` with `catchup` set.

### 9.4 Things the transactions must not trip over (verify in sandbox, §13)
- `ue_if_filled_status` fires on every IF save. It must no-op for a TO-created IF (it reads SO lines via `createdfrom`). Check that it doesn't stamp "Filled" onto TO lines, now that `custcol_pick_status` applies to Transfer Orders in sandbox.
- `ue_if_packages` has no manifest, so it should no-op. `ue_portal_link` will stamp a picker-portal link on the IF, which is harmless.
- The RSM IF User Event mirrors freight fields to the "SO" on Pack/Ship. Confirm it doesn't error when `createdfrom` is a TO.
- SPS Commerce scripts: confirm a TO IF doesn't trigger an ASN.
- The Item Substitute bundle UE: this caused sandbox transform errors before. `record.transform` server-side bypassed it for SOs; confirm the same for TOs.

## 10. Dashboard / move tracker

The office dashboard is recomputed on load and each refresh (60s).

| Metric | Definition |
|---|---|
| Pallets moved | pallets whose load is `shipped` or later, counted by load `approved_at` date. Catch-ups count too |
| Pallets remaining (est.) | Σ over items with Riverside on-hand > 0 of `ceil(on-hand ÷ default pcs)`. Items with no config are listed separately as "unknown", not guessed |
| **Total pallets to move (est.)** | moved + remaining (it shrinks naturally as customer orders drain Riverside) |
| Labeled | pallets in `labeled` + `loaded` (shown under the total) |
| Moved per day | moved pallets grouped by date: a bar chart for the move period with a dashed "needed/day" line; also today, 7-day average and all-time average |
| Move days left | Mon–Sat dates from **today** (or tomorrow, if today already has shipped loads and it's after 3 pm) through the target date, minus `skip_dates` |
| Pallets/day needed | remaining ÷ move days left (∞ / red when 0 days left) |
| Projected finish | today + `ceil(remaining ÷ 7-day avg)` move days, skipping Sundays and skip dates. Green if ≤ target, red if later |
| In transit | pallets on loads `shipped`/`receiving`/`recv_ready` + `missing` |

**Lists:** loads with status; exceptions (missing, catch-ups this week, damaged, edited at dock, labeled but never loaded after `stale_days`, SKUs with no config); remaining by SKU.

**Governance:** the on-hand item search is one paged search over about 400 items (≈10–20 units). The pallet counts come from summary searches grouped by status and by date.

## 11. Error handling

- **Every AJAX action** returns `{ok, error?, ...}`, and the page shows errors in the same colored card system. It never shows a raw stack trace.
- **Scan requests are idempotent by design:** scanning twice gives `dup`. A timeout shows an amber "no response, scan again".
- **No offline mode in v1.** If the dry run finds dead spots, we revisit (queue scans in `localStorage` and replay them).
- **Transaction steps:** failure sets load `error` with the message. **Retry** resumes, and **Send back** (only when no TO exists yet) returns the load to `ready`/`loading`.
- **Import, print chunking and plan printing** show progress, and a failed chunk can be retried without duplicates. Print chunks are tagged with a job id; a retry reuses the pallets already created for that job.

## 12. Permissions

- **FLOOR (Portal Picker, 2537):** no changes needed. The app reads items for SKU lookup, which the role can already view, and writes only No-Permission-Required custom records.
  - ⚠ Verify that `N/render` `xmlToPdf` works under this role. Printing is MANAGER-only anyway.
  - ⚠ Verify that the item search for Riverside available works under the Location restriction "own and subordinates". Only managers run the stock check, but the SKU lookup shows on-hand to FLOOR.
- **MANAGER (Warehouse Portal Manager 2536, and the FK Warehouse Manager variants actually used):** add **Transfer Order: Create/Edit** and **Item Receipt: Create** if missing. Item Fulfillment Full and Fulfill Orders are already present.
  - Confirm whether TO approval routing is on. If it is, managers also need Approve permission, or TOs are created as Pending Fulfillment directly.
- **Office printer PC:** logged in as a manager.

## 13. Prerequisites (before building the approve steps)

1. **Sandbox:** create the location **Tippecanoe Warehouse** (copy prod's settings: subsidiary, "make inventory available") and note its id. The sandbox MCP connector can't read Location records, so use the UI.
2. **Sandbox:** one manual TO Riverside → Tippecanoe with 1 item. Ship the IF, then receive. **Record Riverside on-hand, in-transit and Tippecanoe on-hand at each step** to confirm §9 changes inventory the way we expect. Also note whether this account's TOs use the separate "In-Transit" location record or native in-transit.
3. **Sandbox:** check TO approval routing, the §9.4 script interactions, and whether the manager role can create a TO, transform it to an IF and to a receipt.
4. **Prod:** confirm the Tippecanoe location id; add the manager role permissions.
5. **Hardware:** scanner model; keystroke output + Enter suffix; wifi-only or cell (dock wifi status); printer loaded with 4×6 stock. Then set the label code setting (QR only for 2D imagers/camera, Code128 only for long-range/1D).
6. **Config CSV:** I draft it from the Product Matrix sheets, Jack corrects it, then it's imported.

## 14. Testing

**Sandbox functional pass** (dated test copy of `sl_move_portal.js`, per the standing rule):
1. Import the configs (including a bad SKU and a SKU with two defaults) → preview flags them; commit replaces the old batch.
2. Print: a plan batch of 3, a SKU batch of 2 with pieces edited (EDITED shows), a mixed pallet, a floor request, a radio request, a reprint (same id), a relabel (old one void), and a void. Scan the printed PDFs' barcodes with a real scanner **and** a phone camera.
3. Load:
   - every §8.1 row;
   - Edit and Remove;
   - Load done → FLOOR read-only;
   - manager Send back.
4. **Approve & Ship:**
   - stock-check block (force one short SKU) → then pass;
   - TO + IF created;
   - IF Shipped;
   - on-hand moves as expected (compare with prereq 2);
   - load sheet prints;
   - a double-click doesn't create 2 TOs;
   - kill mid-way (simulate an IF save error) → Retry resumes.
5. Receive:
   - every §8.2 row;
   - Approve Receipt with 2 missing → `received_short`;
   - Tippecanoe on-hand rises by the scanned qty only;
   - late arrival → second receipt.
6. **Catch-up:** a pallet labeled but never loaded, then scanned at Inbound → flag → approve → TO + IF + receipt, with both warehouses' on-hand correct.
7. **Dashboard:** numbers match a hand calculation from the test data; days-left skips Sundays and a skip date.
8. **Regression:** picker portal (sandbox 747) untouched, and a normal SO approve still works.

**Real-world dry run:**
- the office printer at 4×6;
- Android scanners at both docks, walked for signal;
- one short truck with 3–5 pallets.

**Prod pilot:** one real truck end-to-end before general use.

## 15. Build phases (smallest usable order)

| Phase | Contents | Needed by |
|---|---|---|
| **P0** | Prereqs §13 items 1–3, custom records + settings created in sandbox | before code test |
| **P1** | Suitelet shell (header, roles, toggle, routing), config import, label PDF, Print Plan / Print a SKU / Queue / Reprint-Void, floor Request + Void | move day 1 (labels can start before trucks) |
| **P2** | Load screen + scan rules, manager To ship + Approve & Ship + load sheet | first truck |
| **P3** | Receive + Approve Receipt + missing/late + catch-up | first truck's arrival |
| **P4** | Dashboard tracker + exception lists | week 1–2 of the move |
| later | camera scanning button, offline scan queue (only if needed) | as needed |

## 16. Open items
- Scanner model and wifi/cell status (Jack, parked).
- Label code default (Both until the scanners are known).
- Prod Tippecanoe location id; the sandbox Riverside id.
- Whether TO approval routing is on.
- The config CSV draft (me), then Jack's corrections.
