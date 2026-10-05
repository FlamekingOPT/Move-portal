# Move Portal v3 — Verify Load step (amendment)

**Date:** 2026-10-05 · **Status:** decisions confirmed by Jack in brainstorm; spec awaiting review.
**Amends:** `2026-10-01-move-portal-verification-design.md`. It replaces V5 (departure-time corrections) and the departure part of §7. Everything else stands: labels, scan rules, unload, receipts (every receipt needs a manager OK), write modes, shadow report, rollout.
**Built on:** branch `feat/v3-verification` (local beta, 142 tests).

## 1. Why

Today the loader scans and enters trailer/seal. At departure the portal plans corrections (lower or raise the IF, add-on IF), and a manager approves them. Jack wants the IF fixed **before** shipping info is entered. The loader verifies the load against the IF. A match goes to a shipping stage. A mismatch waits until the IF is corrected, while the loader carries on with other trucks.

## 2. Decisions (Jack, 2026-10-05)

| # | Decision |
|---|---|
| L1 | After scanning, the loader presses **Verify load**. Exact match → **Ready to ship**. Any difference → **Needs IF fix**. Trailer/seal/departure are entered only in Ready to ship. |
| L2 | **Who corrects the IF: both (option C).** Normally the office fixes it in NetSuite. A manager can also press **Correct the IF** in the portal as a backup. |
| L3 | A truck in Needs IF fix **stays open**: scanning, removing and re-verifying are allowed. The loader can also leave it and **load another truck**. |
| L4 | The floor screen **alerts** the loader when a waiting truck now matches its IF (banner + tone + badge). |
| L5 | Pallets can be **taken off** a truck without voiding: a **➖ Take off** scan mode, plus the existing ✕. A taken-off pallet goes back to `labeled`. |
| L6 | **Departure needs no manager**, because Ready to ship always matches. Departure never changes IF qty. |
| L7 | A **new IF the office creates** is attached to the waiting truck only after someone taps **Add to this truck**. The portal never attaches it silently. |
| L8 | There are several managers, so the manager page stays the NetSuite login (no PIN). |

## 3. Truck stages

```
loading ──Verify──▶ needs_fix ──(re-verify ok)──▶ ready ──Confirm──▶ departing ▶ departed ▶ receiving ▶ approving ▶ received
   ▲                    │  ▲                         │
   └──── scan / take-off┘  └──────── scan / take-off ┘  (any pallet change drops ready → loading)
```

- New statuses: `needs_fix` and `ready`. The existing `loading`, `departing`, `departed`, `receiving`, `approving` and `received` are unchanged.
- **Scanning and take-off** are allowed in `loading`, `needs_fix` and `ready`. Any change of pallets on a `ready` truck sets it back to `loading`.
- `data.pending` (floor departure requests) is **removed**.

## 4. Verify (pure rule, `move_verify.verifyLoad`)

**Input:**
- the truck's IFs, **re-read from NetSuite** (`ns.plannedIfs()`, filtered to the truck's IF ids);
- the pallets on the truck;
- the open TO lines.

**Output:** `{ match: bool, diffs: [...], ifs: freshIfs }`. Each entry in `diffs` is one of:

| kind | when | text (floor and office) |
|---|---|---|
| `if_short` | an IF item has less loaded than the IF qty | "IF72287 YSN401: IF 1,152 · loaded 1,056 → IF needs −96 (2 pallets)" |
| `if_over` | more loaded than the IF qty for an item on that IF | "IF72287 YSN401: IF 1,152 · loaded 1,200 → IF needs +48" |
| `no_if` | loaded SKU on none of the truck's IFs | "YSN301 ×64 loaded, not on any IF → needs an IF from TO11710 (oldest open TO)" |
| `if_empty` | an IF on the truck has nothing loaded | "IF72288 has nothing loaded → take it off this truck" |
| `if_gone` | an IF is no longer Picked/Packed in NetSuite | "IF72288 is no longer Packed in NetSuite → take it off this truck" |

Rules:
- Loaded qty per item is filled across the truck's IFs in IF-id order, the same way `fillExpected` does it today.
- `match` = no diffs.
- `no_if` names the oldest open TO with room (after reservations). A SKU with no open TO is still blocked at scan time, as today.
- **Pallet counts** in the text use the loaded pallets' pcs when they're all equal. Otherwise the text shows pcs only.

## 5. Floor screens

- **Truck screen:**
  - A scan box with a mode toggle **➕ Load / ➖ Take off**.
    - Take off has an amber outline, its own tone, and the result text "Taken off: PLT122 → back to Riverside".
    - The mode resets to Load after 2 minutes without a scan.
  - Below the scan box: the scanned-vs-expected table (as today) and a **Verify load** button.
- **Needs IF fix:** an amber card with the diff list and two buttons:
  - **Keep loading**: the scan box stays.
  - **← Other trucks**
- **Ready to ship:** a green card plus the departure form: trailer (known list + Other), seal (required; reuse refused), carrier (default Armstrong Group) and time (auto). **Confirm departure** is a floor action.
  - On Confirm the portal **re-verifies**.
  - If it still matches: Truck # of the day and departure as today, with only `if_stamp` ops in the plan.
  - If it no longer matches: the truck goes to `needs_fix` with the new diffs.
- **Trucks list:** each truck shows a badge: Loading / ⚠ Needs IF fix / ✅ Ready to ship.
- **Alert:**
  - While any floor screen is open, the page calls `trucks_recheck` about every 30 s.
  - That re-verifies every `needs_fix` truck in one request. NetSuite reads are cached per request, so the cost doesn't grow with the number of trucks.
  - When one moves to `ready`, show a green banner on any screen with a double tone: "✅ <truck> now matches its IF: ready to ship [Open]". It's shown once per truck per device.

## 6. Manager / office

- **Approvals → "Needs IF fix"** (top section). One card per `needs_fix` truck, with:
  - the diff list written as instructions;
  - who verified, and when;
  - any **new IFs found** (§7).
- **Correct the IF** (manager only; one button per diff, plus "Correct all"). It is planned and written through `move_tx` under the write mode:

  | diff | op | written in |
  |---|---|---|
  | `if_short` / `if_over` | `if_qty` (from → to = loaded) | `qty`, `on` |
  | `no_if` | `if_create` from the named TO, **status Packed** (not Shipped), stamped with nothing yet | `on` |
  | `if_empty` / `if_gone` | take the IF off the truck (portal only, no NetSuite write) | always |

  - In `off` mode, or for ops the mode doesn't allow, the card says "Plan only: fix this in NetSuite". The op is recorded as planned on the truck.
  - Writes use the existing guards: claim, re-read before writing, refused if the IF changed, "already done" counts as success, and the approver is the NetSuite user.
  - After corrections the portal re-verifies right away.
  - A created add-on IF is attached to the truck automatically, because the manager created it from this card.
- **`if_create` change:** add-on IFs are now created **Packed**, not Shipped. Departure's `if_stamp` ships them with the rest.
- Removed:
  - pending departures and departure approval;
  - `depart_skip_write`. A refused correction stays on the card with its error, and the office fixes it in NetSuite.

## 7. Attaching a new IF the office created

When a `needs_fix` truck is re-verified, the portal looks for **new Picked/Packed IFs** that:
- are on the TO named in a `no_if` diff, or on a TO of one of the truck's IFs; and
- are not on any other truck.

These show on the truck (floor and manager) as "New IF72350 on TO11710 · YSN301 ×64 · [Add to this truck]". Tapping Add attaches the IF and re-verifies. A manager can also add **any** Picked/Packed IF that's not on another truck, using a picker on the card.

## 8. Actions (server)

| Action | Who | Purpose |
|---|---|---|
| `truck_scan` | floor | gains `mode: 'load' \| 'off'`. Off = take off, allowed in loading/needs_fix/ready; ready → loading |
| `truck_verify` | floor | re-read IFs, run `verifyLoad`, move the truck to `ready` or `needs_fix`, return the diffs and new IF suggestions |
| `trucks_recheck` | floor | re-verify all `needs_fix` trucks; return the ones that became `ready` |
| `truck_add_if` | floor + manager | attach a suggested IF (floor: suggestions only; manager: any eligible IF), then re-verify |
| `truck_drop_if` | manager | take an IF off a waiting truck, then re-verify |
| `truck_correct` | manager | run the Correct-the-IF ops for the given diff keys, then re-verify |
| `depart_preview` / `depart_confirm` | floor | only from `ready`; re-verify, then stamp-only plan; no manager gate |

Removed actions: `depart_cancel`, `depart_skip_write`, and the pending-departure parts of `approvals`. `depart_retry` stays, for a failed `if_stamp` in `on` mode.

## 9. Tests

- `verifyLoad`: each diff kind, exact match, the oldest-TO choice for `no_if`, and fresh IF lines used over saved ones.
- Stages: Verify → ready/needs_fix; a scan or take-off on `ready` → loading; Confirm re-verifies and can send the truck back to `needs_fix`; Confirm is refused unless the truck is `ready`.
- Take-off mode: pallet → labeled, load cleared, logged; refused on a departed truck.
- `trucks_recheck`: an office fix in the snapshot (IF qty changed) → `ready` and reported.
- New IF suggestion: a new Packed IF on the named TO appears; Add attaches it; an IF on another truck is not suggested.
- `truck_correct` per write mode: `off` = plan only; `qty` = `if_qty` written; `on` = `if_create` Packed + attached; manager-only; claim-guarded.
- UI: the cross-check test (every `api()` has an `act`, every `data-act` has a handler) stays green; the Verify/Ready/Take-off strings are present.

## 10. Out of scope

- Push notifications to phones that aren't on the portal page. The alert works only while a floor screen is open.
- The office getting an email or Slack message about a needs-fix truck. They see it in Approvals.
