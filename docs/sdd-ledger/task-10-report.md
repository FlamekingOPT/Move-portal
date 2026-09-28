# Task 10: Receiving, receipts and catch-ups — Report

## Summary
Task 10 implementation is complete. All 48 tests pass (40 pre-existing + 8 new from brief including 1 ruling extra test). The code implements scan-based receiving, resumable receipt creation, and catch-up handling for pallets that arrive without an outbound scan.

## Implementation Details

### Step 1: Tests Appended
Appended 8 tests from the brief to the END of `move_portal/test/portal.test.js`:
1. `receiving: missing pallets stay in transit; a late arrival gets a second receipt`
2. `undo returns a scanned pallet; recv_ready needs a scan`
3. `a pallet from another shipped load can be received on that load`
4. `a receipt crash right after save is retried without a second receipt`
5. `a pallet loaded without an outbound scan is caught up with its own TO, IF and receipt`
6. `catch-up is blocked when NetSuite has the stock reserved; reject returns the label`
7. `a pallet on a load that was never approved is refused at receiving`
8. **[Ruling Extra]** `approve receipt refuses when another request claimed the load first`

### Step 2: Initial Test Run (Expected Failure)
Tests failed as expected with `Unknown action: scan_recv` error.

### Step 3: Code Block Inserted
Inserted the complete code block from the brief after line 480 in `move_portal/sl_move_portal.js`:
- `recvView(loadId)` — builds receiving view with load, totals, received count, expected pallets, and recent received
- `act('inbound_list')` — list open inbound loads
- `act('recv_get')` — get specific load receiving view
- `receiveOne()` — core logic for receiving a single pallet
- `act('scan_recv')` — scan a pallet barcode to receive
- `act('recv_other')` — move a pallet from another load to this one
- `act('recv_damaged')` — mark a received pallet as damaged
- `act('recv_undo')` — undo a received pallet scan
- `act('recv_ready')` — mark load as ready for receipt approval
- `act('toreceive_list')` — list loads ready for receipt approval
- `receiveLoad()` — create receipt for all received pallets on a load (resumable)
- `act('recv_approve')` — manager approval to create receipts
- `act('catchup_list')` — list pallets that arrived unshipped
- `act('catchup_approve')` — create TO, IF and receipt for catch-up pallet
- `act('catchup_reject')` — reject a catch-up pallet

### Step 4: Applied Ruling Modifications
Applied the ruling's required changes to `receiveLoad()`:

**Concurrency Guard (claim token):**
```javascript
const claim = String(Date.now()) + Math.random().toString(36).slice(2, 8);
data.updateLoad(Ld, { status: L.RECEIVING_TX, data: { workingAt: Date.now(), error: '', phase: 'recv', claim: claim } });
Ld = data.getLoad(Ld.id);
if (Ld.data.claim !== claim) throw userErr(Ld.number + ' is already being received by someone else. Refresh in a minute.');
```

**Safe tranids lookup:**
```javascript
let t = {}; try { t = data.tranids([rid]); } catch (e) { t = {}; }
```

### Step 5: Tests Pass
After code insertion, all 48 tests pass (40 + 8 new).

### Step 6: Syntax Check
`node --check move_portal/sl_move_portal.js` passed with no errors.

### Step 7: Commit
```
commit c984667
feat(move): scan-based receiving, resumable receipts, catch-ups
```

## Test Results

### GREEN: All 48 tests passing
```
ℹ tests 48
ℹ pass 48
ℹ fail 0
```

Complete test run shows all tests passing, including:
- Task 9 tests (14): load scanning, approval & ship, stock shortage, IF failure recovery, etc.
- Task 10 tests (7 from brief + 1 ruling extra = 8):
  - Receiving flow with missing pallets and late arrivals
  - Undo/recv_ready validation
  - Cross-load pallet reception
  - Receipt crash recovery
  - Catch-up handling (unshipped pallets)
  - Concurrent request blocking (ruling extra test)

### Code Quality
- Syntax check: PASS
- 326 insertions in 2 files
- No compiler errors or warnings

## Self-Review

### Ruling Application
✓ Concurrency guard implemented in `receiveLoad()` with claim token
✓ Safe tranids lookup with try/catch wrapping
✓ Extra test added: "approve receipt refuses when another request claimed the load first"
  - Models on existing "approve & ship refuses..." test
  - Wraps `ctx.data.updateLoad` to simulate concurrent claim
  - Expects error matching `/already being received by someone else/`
  - Verifies ItemRcpt count = 0 on failure, then 1 on success after unwrap

### Code Implementation
✓ All 13 new actions properly defined with correct signatures
✓ Resumable receipt creation with `pendingRecv` tracking
✓ Memo token-based idempotency guard for crash recovery
✓ Proper error handling and state transitions
✓ Support for multiple receipts per load (late arrivals)
✓ Catch-up flow creates its own TO, IF and receipt

### Integration
✓ Uses existing helpers: `mustLoad`, `mustPallet`, `data.*`, `core.*`, `tx.*`
✓ References correct status constants: `L.RECEIVING`, `L.RECEIVING_TX`, `P.RECEIVED`, etc.
✓ Integrates with Task 9's `shipLoad()` logic
✓ Proper manager-only gating on `recv_approve` and `catchup_approve`

## Concerns

None. All requirements met:
- Tests pass (48/48)
- Syntax valid
- Commit successful
- Ruling modifications applied correctly
- Code follows existing patterns

---

## Fix Round 1: recv_undo In-flight Guard

### Issue Found
Review identified critical vulnerability in `recv_undo`: no guard against undoing pallets that are pinned to an in-progress receipt. If a receipt is being posted or a failed receipt is pinned for retry, undoing one of its pallets makes NetSuite receive pieces the worker said weren't there.

### Fix Applied
Added in-flight guard to `act('recv_undo', …)` in `move_portal/sl_move_portal.js` after `const Ld = mustLoad(p.loadId);`:

```javascript
const pinned = Ld.data.pendingRecv && (Ld.data.pendingRecv.ids || []).map(Number).indexOf(Number(p.id)) !== -1;
if (Ld.status === L.RECEIVING_TX || pinned) throw userErr(p.code + ' is being received right now and can no longer be undone');
```

### Test Added
New test: `undo is refused while the pallet is pinned to a receipt in progress`
- Simulates receipt failure via `failNext = 'r'` to leave load in `error` state with `pendingRecv` pinned
- Verifies undo throws `/can no longer be undone/`
- Confirms recovery: reset failNext and retry recv_approve succeeds with exactly 1 ItemRcpt

### Commit
```
commit 1e44236
fix(move): block undo of pallets pinned to an in-progress receipt
```

### Test Results (After Fix)
```
ℹ tests 49
ℹ pass 49
ℹ fail 0
```

All 49 tests pass (40 + 8 original Task 10 + 1 new fix test).

### Code Quality
- Syntax check: PASS
- 16 insertions in 2 files
- No compiler errors
