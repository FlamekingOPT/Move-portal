# Task 9 Report: Loading and Approve & Ship

## Summary
Task 9 successfully implemented loading and approval/shipping actions for the Move Portal Suitelet. This task adds truck-loading workflow and resumable shipment creation with full error recovery.

## What Was Implemented

### Code Changes: `move_portal/sl_move_portal.js`
Inserted a complete code block (270 lines) after line 301 containing:

1. **Loading Actions** (`load_*`, `scan_load`, `pallet_*`):
   - `load_list`: Lists all open outbound loads, filtering by phase
   - `load_create`: Creates a new load with door, carrier, trailer, seal info; handles duplicate numbering from concurrent creates
   - `load_get`: Returns full load view with pallets (newest first) and totals
   - `scan_load`: Scans pallets into loads, detects duplicates, voids, unknowns, and other loads
   - `load_move_here`: Moves a pallet between open loads while both are in LOADING status
   - `pallet_edit`: Edits piece counts on loaded pallets (only while loading)
   - `pallet_remove`: Removes a pallet from a load back to LABELED status
   - `load_ready`: Closes loading phase, requires at least one loaded pallet
   - `load_sendback`: Manager action to reset a READY or ERROR load back to LOADING for retry

2. **Shipping Actions** (`ship_*`, `load_approve`):
   - `ship_list`: Shows loads ready to ship with stock availability and recent completed loads
   - `load_approve`: Resumable shipment creation (manager-only) that:
     - Creates a Transfer Order (TO) if not already created
     - Creates an Item Fulfillment (IF) if not already created
     - Detects committed shortfalls and stops before IF
     - Handles crashes via memo tokens (resumable without duplication)
     - Marks all loaded pallets as SHIPPED
     - Returns TO and IF transaction numbers

3. **Helper Functions**:
   - `loadView(loadId)`: Returns structured load with pallets, counts, and totals
   - `shipLoad(Ld, c)`: Resumable core shipment logic with crash recovery

### Test Changes: `move_portal/test/portal.test.js`
Appended 6 new test functions (68 lines):

1. **load scanning: ok, dup, unknown, void, other open load, move here**
   - Tests all scan outcomes: successful load, duplicate detection, unknown codes, voided pallets
   - Tests moving pallets between loads
   - Verifies load numbering (MV-001, MV-002)
   - Confirms scan logging

2. **edit and remove only while loading; ready closes scanning**
   - Tests pallet editing restrictions (only piece counts)
   - Tests pallet removal reverting to LABELED
   - Tests that load_ready closes scanning (further scans blocked)
   - Tests manager-only sendback action
   - Tests status lifecycle transitions

3. **approve & ship creates one TO and one IF and ships the pallets**
   - Tests full approval workflow
   - Verifies manager-only gate (floor users blocked)
   - Confirms TO creation with correct lines and locations
   - Confirms IF creation with memo tokens
   - Verifies pallet status changed to SHIPPED with shippedDay
   - Tests that already-shipped loads drop from queue
   - Tests recent completed loads appear in ship_list

4. **stock shortage blocks approval and leaves the load ready**
   - Tests availability checking before TO creation
   - Verifies error messages with SKU name and quantities
   - Confirms load reverts to READY status on shortage
   - Verifies no transactions created on shortage

5. **an IF failure is retried without a second TO; a crash after the IF saved does not duplicate it**
   - Tests IF creation failure and recovery (failNext='if')
   - Tests crash after IF saved (failNext='if_after')
   - Verifies TO created once, retryable without creating second TO
   - Confirms final successful approval completes shipping

6. **committed shortfall on the TO stops before the IF**
   - Tests NetSuite-side shortfall detection (lines committed less than needed)
   - Verifies IF not created when TO has reserved less than load requires
   - Confirms error message with item name and quantities
   - Tests successful retry after shortfall cleared

## Test Results

### Before Implementation
- 33 passing tests
- 6 failing tests with "Unknown action: load_create"

### After Implementation
```
ℹ tests 39
ℹ suites 0
ℹ pass 39
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 805.7531
```

All 6 new tests passing:
- ✔ load scanning: ok, dup, unknown, void, other open load, move here (2.3592ms)
- ✔ edit and remove only while loading; ready closes scanning (1.3947ms)
- ✔ approve & ship creates one TO and one IF and ships the pallets (2.3656ms)
- ✔ stock shortage blocks approval and leaves the load ready (1.0747ms)
- ✔ an IF failure is retried without a second TO; a crash after the IF saved does not duplicate it (1.0176ms)
- ✔ committed shortfall on the TO stops before the IF (0.8745ms)

## Files Changed
- `move_portal/sl_move_portal.js`: Added 270 lines of action handlers and helper functions
- `move_portal/test/portal.test.js`: Added 68 lines of test code
- Total: +338 lines

## Syntax Validation
`node --check move_portal/sl_move_portal.js` passed with no errors.

## Git Commit
```
fd9ab63 feat(move): load scanning and resumable approve & ship
```

## Self-Review

### Code Quality
- All code copied verbatim from brief to avoid transcription errors
- Code follows existing patterns: `act()` helper for actions, error handling via `throw userErr()`, state mutations via `data.update*()`
- Resumability pattern uses memo tokens and pre-checks for existing TO/IF (proven pattern from earlier tasks)
- Error recovery sets load to SHIPPING status with workingAt timestamp to prevent stale work detection
- Crash handling via try/catch updates error field on load and preserves SHIPPING status for retry detection

### Test Coverage
- Tests cover all major action outcomes: success, various failures, edge cases
- Tests exercise the crash recovery and retry-safety logic thoroughly
- Tests verify interdependencies: stock shortages block IF, committed shortfalls block IF, scan rule compliance
- Scanning tests verify load logic against palletsByLoad, loadScanRule, and multi-load scenarios

### No Concerns
- Code was inserted at exact location (after marker line)
- Marker line preserved in place
- No other modifications to existing code
- All test assertions are strong (deepEqual for exact matching, not just truthiness)
- All manager-only actions properly gated with `true` second parameter to `act()`

## Dependencies Verified
All interfaces consumed are provided:
- `data.loadsByStatus()`, `data.createLoad()`, `data.getLoad()`, `data.updateLoad()` ✓
- `data.palletsByLoad()`, `data.updatePallet()` ✓
- `core.nextLoadNumber()`, `core.loadScanRule()`, `core.aggregate()`, `core.shortages()`, `core.txToken()` ✓
- `tx.findByToken()`, `tx.createTransferOrder()`, `tx.committedShortfalls()`, `tx.fulfillTransferOrder()` ✓
- Load/pallet constants (L.LOADING, P.LOADED, etc.) ✓
- Helper functions `mustLoad()`, `mustPallet()`, `pubLoad()`, `pubPallet()`, `countsFromPallets()` ✓
- Context properties `c.actor`, `c.now`, `c.S.locFrom`, `c.S.locTo`, `c.S.fromName`, `c.S.toStatus` ✓

---

## Fix Round 1: Concurrent Approval Safety & Error Handling

### Changes Made to `move_portal/sl_move_portal.js`

**1. IMPORTANT: Concurrent Double-Approve Race Guard**
- Added claim token generation in `shipLoad`: `const claim = String(Date.now()) + Math.random().toString(36).slice(2, 8);`
- Updated first `data.updateLoad` call to include `claim: claim` in the data object
- Added check immediately after re-reading load: `if (Ld.data.claim !== claim) throw userErr(Ld.number + ' is already being shipped by someone else. Refresh in a minute.');`
- Guard placed BEFORE the `try` block so it doesn't demote the other request's load to error status

**2. MINOR: Safe Transaction ID Lookup**
- Wrapped `data.tranids([Ld.to, Ld.if])` call in try/catch to prevent lookup failures from breaking successful shipments:
  ```js
  let t = {}; try { t = data.tranids([Ld.to, Ld.if]); } catch (e) { t = {}; }
  ```

**3. MINOR: Revert Load on Empty Pallet List**
- Added revert-to-READY before throwing when no loaded pallets exist:
  ```js
  if (!loaded.length) {
      data.updateLoad(Ld, { status: L.READY, data: { workingAt: 0, phase: '' } });
      throw userErr('No pallets on ' + Ld.number);
  }
  ```

### Changes Made to `move_portal/test/portal.test.js`

**Added 1 new test: `'approve & ship refuses when another request claimed the load first'`**
- Tests concurrent approval race condition
- Wraps `data.updateLoad` to simulate concurrent claim via claim field modification
- Verifies first request is blocked with appropriate error message
- Confirms no TO created when claim guard triggers
- Verifies that after resetting load to READY, a normal approval succeeds

### Test Results

```
node --test "move_portal/test/*.test.js"

✔ approve & ship refuses when another request claimed the load first (1.9546ms)

Summary:
ℹ tests 40
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 887.1675
```

All 40 tests passing, including the new concurrent race guard test.

### Git Commit

```
053d0c9 fix(move): claim guard against concurrent approve; safe tranid lookup
```

### Safety Guarantees

1. **Concurrent Requests**: Two managers cannot both execute `load_approve` on the same load. The first wins with its claim token; the second is blocked with a clear error before any transactions are created.

2. **Crash Recovery**: If a crash occurs after the load is marked SHIPPING:
   - First request's claim token is on the load
   - Second request will see different claim and be blocked
   - Retry by the first request (via stale() check) recovers without transaction duplication

3. **Error Handling**: Transaction ID lookup cannot break the shipment result. Even if tranids() fails, the shipment is already complete and marked SHIPPED; the response carries empty strings for missing transaction numbers.

4. **Rollback Safety**: When pallets exist but cannot be loaded (empty list case), the load reverts to READY status before error, matching the shortage and other error paths.
