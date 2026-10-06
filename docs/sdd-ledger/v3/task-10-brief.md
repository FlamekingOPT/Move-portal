### Task 10: Remove the old load/ship/receive/catch-up code

**Files:**
- Modify: `move_portal/sl_move_portal.js`, `move_portal/move_core.js`, `move_portal/move_tx.js`, `move_portal/test/fake_tx.js`, `move_portal/test/fake_data.js`, `move_portal/test/core.test.js`, `move_portal/test/portal.test.js`

**Interfaces:**
- Produces:
  - `core.PALLET = {LABELED:'labeled', LOADED:'loaded', IN_TRANSIT:'in_transit', RECEIVED:'received', MISSING:'missing', VOID:'void'}`, the same values as `verify.VP`.
  - `move_tx` exports only `apply`.
  - The dashboard counts in-transit pallets as `in_transit` + `missing`.

- [ ] **Step 1: Delete the old actions in `sl_move_portal.js`.** Remove these `act(...)` blocks completely:
  `load_list, load_create, load_get, scan_load, load_move_here, pallet_edit, pallet_remove, load_ready, load_sendback, ship_list, load_approve, inbound_list, recv_get, scan_recv, recv_other, recv_damaged, recv_undo, recv_ready, toreceive_list, recv_approve, catchup_list, catchup_approve, catchup_reject`.

  Then remove the helpers only they used. First check each with Grep (`pubLoad`, `countsFromPallets`, `mustLoad`, `stale`, `ensureClaim`, `loadSheetModel`, and any other helper defined between the old actions). A helper still used elsewhere (e.g. `pubPallet`, `mustPallet`, `claimLoad`) stays.

  In `pdf()`, delete the `q.type === 'loadsheet'` branch.

  Delete `const P = core.PALLET, L = core.LOAD;`, replace it with `const P = core.PALLET;`, and change every remaining `L.` reference (there should be none after the deletes; Grep `\bL\.` to confirm).

- [ ] **Step 2: Update the dashboard action** in `sl_move_portal.js`:

```js
    act('dashboard', true, (a, c) => {
        const sm = stockModel(c);
        const m = tracker(c, sm.est);
        const moved = data.movedByDay();
        const end = c.now.dayIso < c.S.target ? c.now.dayIso : c.S.target;
        const days = core.moveDays(c.S.start, end, c.S.skip || []).map(d => ({ day: d, n: moved[d] || 0 }));
        const trucks = allTrucks().slice(0, 15);
        const exc = {
            missing: data.countPallets({ status: [P.MISSING] }),
            neverLoaded: data.findPalletsWhere({ status: [P.LABELED, P.LOADED] }).filter(p => p.data.flag === 'never_loaded').length,
            damaged: data.countPallets({ damaged: true }),
            edited: data.countPallets({ edited: true, status: [P.IN_TRANSIT, P.RECEIVED, P.MISSING] }),
            stale: data.countPallets({ status: [P.LABELED], printedBefore: core.isoAddDays(c.now.dayIso, -(Number(c.S.staleDays) || 5)) }),
            noConfig: sm.est.unknownItems.length
        };
        const skuOf = k => (sm.stock[k] ? sm.stock[k].sku : k);
        const bySku = Object.keys(sm.est.byItem).map(k => ({ sku: skuOf(k), palletsLeft: sm.est.byItem[k] }))
            .sort((x, y) => y.palletsLeft - x.palletsLeft).slice(0, 20);
        return {
            m: Object.assign({}, m, { neededPerDay: isFinite(m.neededPerDay) ? m.neededPerDay : null }),
            labeled: data.countPallets({ status: [P.LABELED, P.LOADED] }),
            inTransit: data.countPallets({ status: [P.IN_TRANSIT, P.MISSING] }),
            received: data.countPallets({ status: [P.RECEIVED] }),
            target: c.S.target, days: days, trucks: trucks.map(truckSummary), exc: exc, bySku: bySku,
            noConfigSkus: sm.est.unknownItems.map(skuOf)
        };
    });
```

  `tracker()` and `movedByDay()` need no change: they count pallets by `shippedDay`, which `finishDepart` sets. `pubLoad` (it uses `P.SHIPPED`) goes away with the old actions; Grep `P\.SHIPPED` afterwards and expect no hits.

- [ ] **Step 3: Trim `move_core.js`**:
  - Set `PALLET` as above.
  - Delete `LOAD`, `loadScanRule`, `receiveScanRule`, `TONE`, `toneFor`, `aggregate`, `shortages`, `nextLoadNumber`, `catchupNumber` and `txToken`, and remove them from the returned object. Grep first: if `sl_move_portal.js` still uses `core.aggregate` or `core.toneFor`, switch that use to `verify.sumLines` / `verify.toneFor`.
  - Update the header comment's `Spec:` line to the 2026-10-01 spec.

- [ ] **Step 4: Trim `move_tx.js` and the fakes**:
  - `move_tx.js`: delete `findByToken`, `locationSubsidiary`, `createTransferOrder`, `committedShortfalls`, `fulfillTransferOrder` and `receiveTransferOrder`. **Keep `setLines`**, because `createIf` and `createReceipt` use it. The return becomes `return { apply };`.
  - `fake_tx.js`: keep only `_t` and `apply`.
  - `fake_data.js`: remove `arrivedOn` and `catchup` from `PKEYS`, `createPallet`'s defaults and `matchQ`, but only if Grep shows no remaining caller. `move_data.js` keeps its NetSuite field map unchanged: the record fields still exist, they're just unused.

- [ ] **Step 5: Trim the tests**:
  - `core.test.js`: delete the tests for the removed functions (scan rules, `aggregate`/`shortages`, numbering, `txToken`) and any `const ... L = core.LOAD` usage.
  - `portal.test.js`: delete every test that calls a removed action (Grep `'load_create'`, `'scan_load'`, `'load_approve'`, `'recv_`, `'catchup_'`, `'ship_list'`, `'toreceive_list'`, `'inbound_list'`). Keep the print, config, request, void/reprint, plan, dashboard and all v3 tests. If the dashboard test asserts `loads`, change it to `trucks`.

- [ ] **Step 6: Run the full suite**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass, 0 failures. Note the new total for the CLAUDE.md update in Task 14.

Run: `grep -n "SHIPPED\|ARRIVED_UNSHIPPED\|catchup\|LOAD\." move_portal/*.js`
Expected: no hits in `sl_move_portal.js` or `move_core.js`. `move_ui.js` is cleaned in Task 11; the field-map names in `move_data.js` may stay.

- [ ] **Step 7: Commit**

```bash
git add -A move_portal
git commit -m "refactor(v3): remove old load/ship/receive/catch-up flow; pallet statuses now v3"
```

---

