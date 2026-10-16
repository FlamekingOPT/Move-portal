# Move Portal — Drop-Trailer Docs Flow (design)

Date: 2026-10-16 · Amends: `2026-10-14-move-portal-scan-built-to-design.md` (scan-built TO + IF, `officeIfs: false`)

## 1. Why

Move trucks are **drop trailers**. A trailer is loaded at the Riverside dock and then waits there, sometimes for hours, until the carrier hooks it. The paperwork (TO + IF) has to exist while the trailer is parked, and inventory should leave Riverside only when the carrier actually takes it.

The current scan-built flow has the floor mark the trailer shipped first. The manager's Approve then writes the TO and IF and marks the IF Shipped, all at once. That doesn't fit drop trailers.

Out of scope: **BOL generation** (to be added later), and the office-IF flow (`officeIfs: true`), which is unchanged.

## 2. Decisions (Jack, 2026-10-16)

| # | Decision |
|---|---|
| D1 | No BOL now. The docs step writes only the TO + IF. |
| D2 | The IF is written as **Picked** when the docs are approved and is marked **Shipped** only when the carrier picks the trailer up. |
| D3 | The **floor** sends the trailer for docs, and the **floor** taps **Picked up**. |
| D4 | The seal # is optional at Send for docs. It can be entered any time before or at Picked up, and is required at Picked up. |
| D5 | After the docs exist, the trailer stays editable. Every inventory scan on or take-off updates the existing TO + IF immediately, with no manager step. |
| D6 | A non-inventory "other item" added after the docs exist is a portal-only change (no NetSuite write). |
| D7 | A post-docs scan that Riverside stock can't cover is **refused**: the pallet stays off the trailer. |
| D8 | NetSuite writes happen **per scan**. The scan reports ✅ only after the TO + IF match the trailer. |

## 3. States (scan-built trucks)

These replace `ship_pending` / `departing` for `kind = 'scan'` trucks.

| State | Pill | Actor | Exits |
|---|---|---|---|
| `loading` | Loading | floor scans | Finish loading → Verify → `ready` |
| `ready` | ✅ Ready for docs | floor: optional seal #, **Send for docs** | `docs_pending`; any scan/take-off → `loading` (as today) |
| `docs_pending` | Waiting for docs | manager: **Approve docs** / **Reject** | Approve → `docs_writing`; Reject (reason) → `loading` |
| `docs_writing` | Writing docs… | system (claim held) | success → `at_dock`; failure → stays here with **Retry** / **Release** (existing rules) |
| `at_dock` | 📄 Docs ready · at dock | floor: scan / take off / seal / **Picked up** | Picked up → `in_transit` |
| `in_transit` | In transit | — | receiving unchanged |

- **Approve docs** = stock check (short → "Can't approve: <SKU> on truck N, available M", nothing written) → `to_create` (status B, 35 → 46, memo `[MV-<ref>] Trailer … · Truck N · MM/DD`) → `if_create` with **shipstatus Picked** (A), trailer stamped, seal stamped if entered (memo `Truck N · MM/DD · [MV-<ref>]`).
- **Picked up** → a dialog shows trailer, TO #, IF #, pallets, pcs. It prompts for the seal # if blank. **Confirm** → stamp seal + pickup time on the IF → shipstatus **Shipped** (C) → `in_transit`.
- **Seal edit** (in `ready` or `at_dock`): saved on the truck. In `at_dock` it also re-stamps the IF.
- `at_dock` shows the TO # / IF # on the floor and manager screens. The manager Dashboard stage list gets **Waiting for docs** and **At dock** in place of "Waiting for manager" and "Departing".
- Retry, Release, `-R<n>` refs, and the late-pallet TO + IF are unchanged. A late pallet's IF is still created Shipped, because it is accepted at Tippecanoe after the trailer arrived.

## 4. Edits after the docs exist (`at_dock`)

Each scan on or take-off runs under the existing truck claim, in this order:

1. **Item type.** For a non-inventory other item, update the portal record only. Done.
2. **Stock check** (scan on only). If Riverside available < the added pcs: refuse with "Can't add: <SKU> short, available N", and the pallet stays off.
3. **Write order.**
   - **Increase / new SKU:** first the TO (raise the line qty, or add a line), then the IF (raise the line qty, or add the line).
   - **Decrease:** first the IF (lower it, or remove the line at 0), then the TO (lower it, or remove/close the line at 0).
4. **New SKU fallback:** if NetSuite won't let the existing IF take the new TO line (see sandbox check S1), create a one-line add-on IF on the same TO with status Picked and the same stamps.
5. **Report ✅** only after both writes succeed. Pallets, pcs and weight recompute on the truck views.

**Failures**
- First write fails: nothing changed. Refuse the scan with the NetSuite message.
- Second write fails: undo the first write. If the undo also fails, the truck shows **⚠ Docs out of sync** with Retry. Scanning on that truck is paused and a Dashboard alert is raised for the manager. Retry re-reads the TO + IF and brings both in line with the trailer.
- A scan in `in_transit` or later is refused ("Trailer has left Riverside").

**Write modes:** in `off` / `qty`, every step runs as "plan saved" with no NetSuite write, the same as today.

## 5. Components touched

- `move_verify`: state rules for the new states. A pure `atDockDelta(truck, change)` returns the TO/IF ops for a scan or take-off (op order, line remove vs qty, the add-on fallback flag). Stock check reuse.
- `move_tx`: new ops `to_qty` (set or add a TO line, remove at 0), `if_qty` extended to add or remove a line, `if_ship` (Picked → Shipped with seal + pickup stamp), and `if_create` taking a `shipstatus` argument.
- `sl_move_portal`: actions `send_for_docs`, `docs_approve` (replaces `ship_confirm` for scan trucks), `docs_reject`, `seal_set`, `picked_up`. The scan/take-off handlers branch on `at_dock`.
- `move_ui`: Shipments tab becomes **Docs** (Send for docs, optional seal) plus **At dock** (TO/IF #, seal, Picked up). The manager Approvals card text changes to "Approve docs writes the TO + IF (Picked). Shipped happens at pickup." New pills and Dashboard stages.
- `move_data`: no new custom fields. The state, seal and pickup time live in the truck record's existing data JSON.

## 6. Testing

**Node tests** (in-memory fakes):
- Every state transition, including Reject going back to loading.
- Send for docs with no seal. Picked up refused while the seal is blank, then allowed once it's entered.
- Approve docs writes TO B + IF Picked. A stock short writes nothing.
- at_dock, same SKU: scan on raises TO + IF and take-off lowers them. A line at 0 is removed.
- at_dock new SKU: TO line plus IF line, and the add-on IF when the fake refuses the line.
- A non-inventory other item makes no NetSuite write.
- A short scan is refused.
- IF failure undoes the TO change. A failed undo puts the truck in Docs out of sync with scanning paused, and Retry reconciles.
- A scan after Picked up is refused.
- Retry in docs_writing finds the TO/IF by `[MV-<ref>]` and doesn't duplicate them.
- `officeIfs: true` regression.

**Local beta click-through:** Excel labels → load → Send for docs (no seal) → Approve docs → at dock, add a pallet of a SKU already on the truck, add a pallet of a new SKU, add an other item → take one off → Picked up (seal prompt) → receive.

**Sandbox checks, in order:**
- **S1** Can an existing Picked IF take a line for a TO line added after it? This decides whether the step 4 fallback is the main path.
- **S2** An IF saved as Picked leaves Riverside on-hand unchanged until Shipped.
- **S3** A TO line qty can be raised or lowered while an open IF references it.
- **S4** The decrease order (IF before TO) holds, and NetSuite refuses a TO qty below the IF qty.
- **S5** Picked → Shipped moves stock to in transit, and the receipt on the new TO works.

## 7. Rollout

Sandbox in `on` first (S1–S5 + click-through). Then prod on Jack's go. No new custom fields or roles beyond the existing scan-built prod checklist.
