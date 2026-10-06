# Task 2 Report: Departure Plan, Truck # of the Day, Seal Reuse Check

## Status
**COMPLETE** - All 4 new tests passing, full suite 72/72 pass, commit 5eacc6e created.

## TDD Evidence

### Step 1: Added Failing Tests
Added 4 test cases to `move_portal/test/verify.test.js`:
- `test('memoFor, sealUsed, truckNoForDay', ...)`
- `test('planDeparture: exact match → only stamps, no manager', ...)`
- `test('planDeparture: short lowers, over raises within TO, beyond goes to add-on...', ...)`
- `test('planDeparture: extra SKU → add-on; empty IF → unplanned; over capacity throws', ...)`

### Step 2: Ran Tests - RED
```
node --test "move_portal/test/*.test.js"
```
Output (tail):
```
✖ memoFor, sealUsed, truckNoForDay
  TypeError: v.memoFor is not a function

✖ planDeparture: exact match → only stamps, no manager
  TypeError: v.planDeparture is not a function

✖ planDeparture: short lowers, over raises within TO, beyond goes to add-on...
  TypeError: v.planDeparture is not a function

✖ planDeparture: extra SKU → add-on; empty IF → unplanned; over capacity throws
  TypeError: v.planDeparture is not a function

ℹ pass 68
ℹ fail 4
```

### Step 3: Implemented Functions in move_verify.js

Added to module before return statement (lines 91–138):
- `memoFor(truckNo, dayIso)` - Formats "Truck N · MM/DD"
- `normSeal(s)` - Normalizes seal strings (trim, uppercase)
- `departOf(t)` - Helper to extract depart data from truck row
- `sealUsed(trucks, seal, exceptId)` - Checks if a seal is already assigned to another truck today
- `truckNoForDay(trucks, dayIso, exceptId)` - Suggests the next truck number for a day
- `planDeparture(o)` - Core logic:
  - Takes IFs, pallets (scanned), TOs, and departure stamp
  - Fills each IF from scanned pallets in IF-id order
  - For leftover scans: raises qty on the IF's own TO if available, then adds to oldest other open TO
  - Throws if scans exceed all capacity
  - Returns ops (if_qty/if_stamp/if_create), alloc (allocation rows), unplanned (empty IFs), corrections, needsManager flag, and BOL info

Added all 5 new names to module return object.

### Step 4: Ran Tests - GREEN
```
node --test "move_portal/test/*.test.js"
```
Output (tail):
```
✔ memoFor, sealUsed, truckNoForDay (0.1698ms)
✔ planDeparture: exact match → only stamps, no manager (0.4361ms)
✔ planDeparture: short lowers, over raises within TO, beyond goes to add-on... (0.9118ms)
✔ planDeparture: extra SKU → add-on; empty IF → unplanned; over capacity throws (0.4707ms)

ℹ pass 72
ℹ fail 0
```

### Step 5: Committed
```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(v3): departure plan, truck # of the day, seal reuse check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Commit SHA: `5eacc6e`

## Files Changed
- `move_portal/move_verify.js`: +48 lines (departure logic)
- `move_portal/test/verify.test.js`: +37 lines (4 new test cases)

## Implementation Review

### Correctness
- `memoFor`: Correctly formats MM/DD from dayIso slice(5, 10): "2026-10-05" → "10/05" ✓
- `normSeal`: Handles whitespace and case; empty seal returns falsy string ✓
- `sealUsed`: Compares normalized seals, excludes the truck being checked ✓
- `truckNoForDay`: Counts existing trucks on that day + 1 (lowest free number) ✓
- `planDeparture`:
  - `fillExpected` distributes scanned qty to IFs in order ✓
  - Raises within same TO before seeking add-on TOs ✓
  - Add-on TOs sorted by `trandate` (oldest first) per `oldestFirst` comparator ✓
  - Empty IFs (alloc[ifId] has no positive values) go to `unplanned`, never stamped ✓
  - Throws only when `left > 0` after exhausting all capacity ✓
  - BOL `changed` flag reflects any corrections or unplanned IFs ✓
  - `ifNums` in BOL includes '(new from TOXXX)' for add-on rows, sorted by TO id ✓

### Edge Cases Verified by Tests
1. **Exact match (42 pallets × 12 = 504 pcs)**: No corrections, no manager needed ✓
2. **Short (40 pallets × 12 = 480 pcs)**: `if_qty` lowers from 504 → 480, needs manager ✓
3. **Over (44 pallets × 12 = 528 pcs)**: Raises within TO from 504 → 528 (using 24 remaining on TO500), needs manager ✓
4. **Add-on (46 pallets × 12 = 552 pcs)**: Raises TO500 to 528, creates new IF from TO600 (oldest other TO) for remaining 24 pcs ✓
5. **Empty IF**: IF9002 scanned but has 0 items, correctly marked unplanned, not included in BOL ifNums (line 93 logic) ✓
6. **Extra SKU (item 11)**: Correctly routed to oldest open TO700 for that item ✓
7. **No capacity**: Throws "No open transfer order covers 1 pcs of item 999" ✓

### Alignment with Constraints
- Uses internal helpers `byIfOrder`, `sumLines`, `ifQty`, `oldestFirst`, `fillExpected` per Task 1 ✓
- Memo format matches spec: "Truck N · MM/DD" ✓
- Seal normalization (trim, uppercase) handles operator input ✓
- Departments on load rows keyed under `data.depart` (standard Netsuite custom record shape) ✓
- No hard-coded values; uses provided arrays/objects ✓

## Concerns
None. The implementation follows the spec exactly, all edge cases pass, and integration with Task 1 helpers is correct.

## Next Steps
Ready for Task 3 (receive scan and approval logic).
