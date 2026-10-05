# Move Portal v3 — Verify Load Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Verify Load step to load-out:
- **Match → Ready to ship** (shipping info is entered only then).
- **Mismatch → Needs IF fix**, with instructions. The truck stays open, and the office or a manager corrects the IF.
- A **Take off** scan mode.
- New-IF suggestions.
- An alert when a waiting truck becomes ready.
- Departure-time corrections and manager departure approval are removed.

**Architecture:**
- **Pure rules** are new functions in `move_portal/move_verify.js`: `verifyLoad`, `diffText`, `ifSuggestions`, `correctionOps`. Each task gives their full code.
- **Suitelet actions** in `move_portal/sl_move_portal.js` reuse the existing hardened helpers:
  - `mustTruck`, `isOpen`, `pushStack`, `claimLoad(Ld, status, phase, mustBe, extraData)`, `assertClaim`;
  - `scanCtx`, `reservedToLines`, `truckView`, `truckSummary`, `departPlan`, `finishDepart`;
  - `writeMode`, `c.user`, `c.mgr`.

  For those tasks the plan specifies the exact behavior and tests. The implementer fits the code to the current helpers. The file has changed a lot since the first plan, so read the helper you call before using it.
- **UI** is in `move_portal/move_ui.js`. Tests are node tests with fakes.

**Tech Stack:** SuiteScript 2.1 AMD, node 18 `node:test`, the fakes in `move_portal/test/` (`fake_data`, `fake_tx`, fixture snapshot through `local/snapshot_ns`), and the local preview server.

**Spec:** `docs/superpowers/specs/2026-10-05-move-portal-verify-load-design.md` (L1–L8). It amends `2026-10-01-move-portal-verification-design.md`.

## Global Constraints

- **Tests:** run `node --test "move_portal/test/*.test.js"` from the repo root `G:\My Drive\Move-portal`. The quoted glob is required on Windows. The suite is 142/142 at the start and must end green with pristine output.
- **Branch:** `feat/v3-verification`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push until the controller says so.
- **Truck statuses:** `loading · needs_fix · ready · departing · departed · receiving · approving · received` (two are new: `needs_fix` and `ready`).
- **Scanning and take-off** are allowed only in `loading`, `needs_fix` and `ready` (and never while a claim is held). Any pallet change on a `ready` truck sets it back to `loading`.
- **Departure:**
  - Only from `ready`.
  - Re-verify first. On a mismatch, set `needs_fix` and return the diffs; don't depart.
  - No manager gate.
  - The plan contains only `if_stamp` ops.
- **Correct the IF** is manager only. It goes through `move_tx.apply` and `verify.runOps` under the write mode:
  - `if_qty` is written in `qty` and `on`.
  - `if_create` is written only in `on`, and creates the IF **Packed**, not Shipped.
  - Dropping an IF is portal-only.
  - The approver is `c.user`.
- **A new IF is attached only by an explicit Add** (`truck_add_if`). Never attach one silently.
- **Removed:** `data.pending`, `savePending`, `depart_cancel`, `depart_skip_write`, the departures section of `approvals`, and the floor "send to manager" path.
- **Lesson:** `data.updateLoad(L, patch)` merges `patch.data` over the copy passed in. Always re-read with `data.getLoad(id)` right before an update, and re-check status and claim.
- **Never kill node processes by image name.** Jack's preview runs on :8765. Use `--port` and `--store` with a temp file for smoke tests.

---

## File map

| File | Change |
|---|---|
| `move_portal/move_verify.js` | Add `verifyLoad`, `diffText`, `ifSuggestions`, `correctionOps`. Add `TRUCK.NEEDS_FIX`/`READY`. Reservations treat `needs_fix`/`ready` like `loading`, and reserve unwritten correction ops |
| `move_portal/move_tx.js` | `createIf` honors `op.ship === false` (Packed, no stamp) |
| `move_portal/sl_move_portal.js` | New actions `truck_verify`, `trucks_recheck`, `truck_add_if`, `truck_drop_if`, `truck_correct`. `truck_scan` gains `mode`. Departure reworked. Pending and skip-write removed. `approvals` gains `needsFix` |
| `move_portal/move_ui.js` | Truck stages UI, Verify, take-off toggle, needs-fix and ready cards, badges, recheck polling + alert, Add IF, manager needs-fix cards with Correct buttons. Pending and skip UI removed |
| `move_portal/test/verify.test.js`, `portal.test.js`, `move_tx.test.js`, `ui.test.js` | Tests |
| `CLAUDE.md`, `docs/sdd-ledger/progress.md` | Handoff (last task) |

---

### Task 1: Pure rules (`verifyLoad`, `diffText`, `ifSuggestions`, `correctionOps`)

**Files:**
- Modify: `move_portal/move_verify.js`
- Test: `move_portal/test/verify.test.js` (append)

**Interfaces:**
- Consumes (existing, in-module): `refreshIfs(saved, fresh) → {ifs, gone, changes}`, `fillExpected(ifs, scannedByItem) → {alloc, left}`, `sumLines(pallets)`, `ifQty(f, item)`, `oldestFirst`, `byIfOrder`.
- Produces:
  - `TRUCK.NEEDS_FIX = 'needs_fix'` and `TRUCK.READY = 'ready'`.
  - `verifyLoad({savedIfs, freshIfs, pallets, toLines})` returns `{match, diffs, ifs}`. `ifs` = the fresh IFs still on the truck. Each `diffs` entry has `{key, kind, ...}`:
    - `if_gone`: `{ifId, ifNum}`
    - `if_empty`: `{ifId, ifNum}`
    - `if_short` / `if_over`: `{ifId, ifNum, toId, toNum, item, ifQty, loaded}`
    - `no_if`: `{item, qty, toId|null, toNum|null}`
  - `diffText(d, sku, pcsPerPallet) → string`: the instruction text from spec §4. `sku` is the SKU name. `pcsPerPallet` may be `null`.
  - `ifSuggestions({truckIfs, diffs, planned, takenIfIds}) → [planned IF]`: IFs on the truck's TOs or the `no_if` TOs, not on the truck, not taken.
  - `correctionOps(diffs)` returns ops:
    - `if_short`/`if_over` → `{op:'if_qty', ifId, ifNum, toId, item, from: ifQty, to: loaded, key}`
    - `no_if` with a `toId` → `{op:'if_create', toId, toNum, lines:{[item]: qty}, ship:false, key}`
    - `if_empty`/`if_gone` → `{op:'drop_if', ifId, ifNum, key}`
    - `no_if` without a `toId` → no op.

- [ ] **Step 1: Write the failing tests** (append to `verify.test.js`. `v`, `VP`, `pal` and `TOS` are already defined at the top of the file. `TOS` has TO500 item 975 remaining 24, TO600 item 975 remaining 504, TO700 item 11 remaining 1200.)

```js
const VIF = (id, toId, qty, item) => ({ ifId: String(id), ifNum: 'IF' + id, toId: String(toId), toNum: 'TO' + toId, status: 'B', lines: [{ item: item || '975', sku: 'YSN100', qty }] });
const onTruck = (n, item, pcs) => Array.from({ length: n }, (_, i) => pal(300 + i, VP.LOADED, '1', [{ item: item || '975', sku: 'YSN100', pcs: pcs || 12 }]));

test('verifyLoad: exact match', () => {
    const r = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual([r.match, r.diffs, r.ifs.map(f => f.ifId)], [true, [], ['9001']]);
});

test('verifyLoad: short, over, no IF (oldest open TO), empty IF, gone IF, fresh qty wins', () => {
    const short = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(40), toLines: TOS });
    assert.deepEqual(short.diffs, [{ key: 'if_short:9001:975', kind: 'if_short', ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', item: '975', ifQty: 504, loaded: 480 }]);
    const over = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(44), toLines: TOS });
    assert.deepEqual(over.diffs.map(d => [d.kind, d.loaded]), [['if_over', 528]]);
    const extra = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42).concat(onTruck(1, '11', 120)), toLines: TOS });
    assert.deepEqual(extra.diffs, [{ key: 'no_if:11', kind: 'no_if', item: '11', qty: 120, toId: '700', toNum: 'TO700' }]);
    const none = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42).concat(onTruck(1, '999', 5)), toLines: TOS });
    assert.deepEqual(none.diffs, [{ key: 'no_if:999', kind: 'no_if', item: '999', qty: 5, toId: null, toNum: null }]);
    const empty = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504), VIF(9002, 500, 504)], freshIfs: [VIF(9001, 500, 504), VIF(9002, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual(empty.diffs, [{ key: 'if_empty:9002', kind: 'if_empty', ifId: '9002', ifNum: 'IF9002' }]);
    const gone = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504), VIF(9002, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual(gone.diffs, [{ key: 'if_gone:9002', kind: 'if_gone', ifId: '9002', ifNum: 'IF9002' }]);
    const fixed = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 480)], pallets: onTruck(40), toLines: TOS });
    assert.equal(fixed.match, true);                                   // the office lowered the IF → now matches
});

test('diffText', () => {
    const d = { kind: 'if_short', ifNum: 'IF72287', item: '1031', ifQty: 1152, loaded: 1056 };
    assert.equal(v.diffText(d, 'YSN401', 48), 'IF72287 YSN401: IF 1,152 · loaded 1,056 → IF needs −96 (2 pallets)');
    assert.equal(v.diffText(Object.assign({}, d, { kind: 'if_over', loaded: 1200 }), 'YSN401', null), 'IF72287 YSN401: IF 1,152 · loaded 1,200 → IF needs +48');
    assert.equal(v.diffText({ kind: 'no_if', item: '1021', qty: 64, toNum: 'TO11710' }, 'YSN301'), 'YSN301 ×64 loaded, not on any IF → needs an IF from TO11710 (oldest open TO)');
    assert.equal(v.diffText({ kind: 'no_if', item: '9', qty: 5, toNum: null }, 'X1'), 'X1 ×5 loaded, not on any IF → no open TO: take it off the truck');
    assert.equal(v.diffText({ kind: 'if_empty', ifNum: 'IF72288' }), 'IF72288 has nothing loaded → take it off this truck');
    assert.equal(v.diffText({ kind: 'if_gone', ifNum: 'IF72288' }), 'IF72288 is no longer Packed in NetSuite → take it off this truck');
});

test('ifSuggestions: new IFs on the truck TOs or no_if TOs, not on the truck, not taken', () => {
    const planned = [VIF(9001, 500, 504), VIF(9050, 700, 120, '11'), VIF(9051, 500, 48), VIF(9052, 800, 10), VIF(9053, 700, 5, '11')];
    const diffs = [{ kind: 'no_if', item: '11', qty: 120, toId: '700', toNum: 'TO700' }];
    assert.deepEqual(v.ifSuggestions({ truckIfs: [VIF(9001, 500, 504)], diffs, planned, takenIfIds: { 9053: true } }).map(f => f.ifId), ['9050', '9051']);
});

test('correctionOps', () => {
    const ops = v.correctionOps([
        { key: 'if_short:9001:975', kind: 'if_short', ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', item: '975', ifQty: 504, loaded: 480 },
        { key: 'no_if:11', kind: 'no_if', item: '11', qty: 120, toId: '700', toNum: 'TO700' },
        { key: 'no_if:999', kind: 'no_if', item: '999', qty: 5, toId: null, toNum: null },
        { key: 'if_empty:9002', kind: 'if_empty', ifId: '9002', ifNum: 'IF9002' }]);
    assert.deepEqual(ops, [
        { op: 'if_qty', ifId: '9001', ifNum: 'IF9001', toId: '500', item: '975', from: 504, to: 480, key: 'if_short:9001:975' },
        { op: 'if_create', toId: '700', toNum: 'TO700', lines: { 11: 120 }, ship: false, key: 'no_if:11' },
        { op: 'drop_if', ifId: '9002', ifNum: 'IF9002', key: 'if_empty:9002' }]);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `v.verifyLoad is not a function`.

- [ ] **Step 3: Implement.** Add `NEEDS_FIX: 'needs_fix', READY: 'ready'` to `TRUCK`. Add the functions below before the `return`, and export them.

```js
    // ── Verify Load (spec 2026-10-05 amendment §4) ───────────────────────
    function verifyLoad(o) {
        const fr = refreshIfs(o.savedIfs, o.freshIfs), ifs = byIfOrder(fr.ifs), diffs = [];
        fr.gone.forEach(g => diffs.push({ key: 'if_gone:' + g.ifId, kind: 'if_gone', ifId: String(g.ifId), ifNum: g.ifNum }));
        const fill = fillExpected(ifs, sumLines(o.pallets));
        ifs.forEach(f => {
            const a = fill.alloc[String(f.ifId)] || {};
            if (!Object.keys(a).some(k => a[k] > 0)) { diffs.push({ key: 'if_empty:' + f.ifId, kind: 'if_empty', ifId: String(f.ifId), ifNum: f.ifNum }); return; }
            Object.keys(a).forEach(k => {
                const q = ifQty(f, k);
                if (a[k] < q) diffs.push({ key: 'if_short:' + f.ifId + ':' + k, kind: 'if_short', ifId: String(f.ifId), ifNum: f.ifNum, toId: String(f.toId), toNum: f.toNum, item: k, ifQty: q, loaded: a[k] });
            });
        });
        Object.keys(fill.left).forEach(k => {
            const left = fill.left[k];
            if (!(left > 0)) return;
            const carriers = ifs.filter(f => ifQty(f, k) > 0);
            if (carriers.length) {
                const f = carriers[carriers.length - 1], q = ifQty(f, k);
                diffs.push({ key: 'if_over:' + f.ifId + ':' + k, kind: 'if_over', ifId: String(f.ifId), ifNum: f.ifNum, toId: String(f.toId), toNum: f.toNum, item: k, ifQty: q, loaded: q + left });
                return;
            }
            const to = (o.toLines || []).filter(r => String(r.item) === k && Number(r.remaining) > 0).sort(oldestFirst)[0];
            diffs.push({ key: 'no_if:' + k, kind: 'no_if', item: k, qty: left, toId: to ? String(to.toId) : null, toNum: to ? to.toNum : null });
        });
        return { match: diffs.length === 0, diffs: diffs, ifs: ifs };
    }

    function fmt(n) { return Number(n).toLocaleString('en-US'); }
    function diffText(d, sku, pcsPerPallet) {
        const s = sku || d.item;
        if (d.kind === 'if_gone') return d.ifNum + ' is no longer Packed in NetSuite → take it off this truck';
        if (d.kind === 'if_empty') return d.ifNum + ' has nothing loaded → take it off this truck';
        if (d.kind === 'no_if') return s + ' ×' + fmt(d.qty) + ' loaded, not on any IF → ' + (d.toNum ? 'needs an IF from ' + d.toNum + ' (oldest open TO)' : 'no open TO: take it off the truck');
        const delta = d.loaded - d.ifQty, n = Math.abs(delta);
        const pal = pcsPerPallet && n % pcsPerPallet === 0 ? ' (' + (n / pcsPerPallet) + ' pallet' + (n / pcsPerPallet === 1 ? '' : 's') + ')' : '';
        return d.ifNum + ' ' + s + ': IF ' + fmt(d.ifQty) + ' · loaded ' + fmt(d.loaded) + ' → IF needs ' + (delta < 0 ? '−' : '+') + fmt(n) + pal;
    }

    function ifSuggestions(o) {
        const tos = {}, onTruck = {};
        (o.truckIfs || []).forEach(f => { tos[String(f.toId)] = true; onTruck[String(f.ifId)] = true; });
        (o.diffs || []).forEach(d => { if (d.kind === 'no_if' && d.toId) tos[String(d.toId)] = true; });
        return (o.planned || []).filter(f => tos[String(f.toId)] && !onTruck[String(f.ifId)] && !(o.takenIfIds || {})[String(f.ifId)]);
    }

    function correctionOps(diffs) {
        const ops = [];
        (diffs || []).forEach(d => {
            if (d.kind === 'if_short' || d.kind === 'if_over') ops.push({ op: 'if_qty', ifId: d.ifId, ifNum: d.ifNum, toId: d.toId, item: d.item, from: d.ifQty, to: d.loaded, key: d.key });
            else if (d.kind === 'no_if' && d.toId) ops.push({ op: 'if_create', toId: d.toId, toNum: d.toNum, lines: { [d.item]: d.qty }, ship: false, key: d.key });
            else if (d.kind === 'if_empty' || d.kind === 'if_gone') ops.push({ op: 'drop_if', ifId: d.ifId, ifNum: d.ifNum, key: d.key });
        });
        return ops;
    }
```

Also, in `reservationsFromTrucks`, trucks with status `needs_fix` or `ready` are placed like `loading` trucks. Their loaded surplus reserves room. Change `t.status === TRUCK.LOADING` to `[TRUCK.LOADING, TRUCK.NEEDS_FIX, TRUCK.READY].indexOf(t.status) !== -1`. And for any truck with `t.data.corrections` (ops planned by Correct the IF, Task 4), every `if_qty` raise or `if_create` whose key isn't written in NetSuite (`inNetSuite`) reserves room, the same way `t.data.plan` ops do. Add a test where a `needs_fix` truck's surplus reserves room against a second truck.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/verify.test.js"`, then the full suite.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(verify-load): verifyLoad, diffText, ifSuggestions, correctionOps"
```

---

### Task 2: Stages, take-off, Verify, recheck, add/drop IF (Suitelet)

**Files:**
- Modify: `move_portal/sl_move_portal.js`
- Test: `move_portal/test/portal.test.js` (append)

**Interfaces:**
- Consumes: Task 1 functions; the existing helpers listed in the plan header.
- Produces (all floor-allowed unless noted, all `{actor}`):

| Action | Body | Effect / returns |
|---|---|---|
| `truck_scan` | `{truckId, raw, mode:'load'\|'off'}` | `load`: as today, but also allowed on `needs_fix`/`ready`. `off`: the pallet must be `loaded` on this truck → `labeled`, load cleared, `logScan` with result `taken_off` (tone `warn`); otherwise result `not_on_truck` (tone `bad`). Any change on a `ready` truck sets it to `loading`. Returns `{result, tone, pallet, view}` |
| `truck_verify` | `{truckId}` | Truck must be `loading`/`needs_fix`/`ready` with no claim. Runs `verifyLoad` (fresh `ns.plannedIfs()`, the truck's loaded pallets, `reservedToLines`). Saves `data.ifs = r.ifs`, `data.verify = {at, by, diffs}`. Status → `ready` on a match, else `needs_fix`. Returns `{match, diffs: pubDiffs, suggestions, view}` |
| `trucks_recheck` | `{}` | Re-verify every `needs_fix` truck. Return `{nowReady: [{id, label}]}` for the ones that turned `ready` |
| `truck_add_if` | `{truckId, ifId}` | Floor: only an IF in the truck's current `ifSuggestions`. Manager: any Picked/Packed IF not on another truck. Append it to `data.ifs`, then verify. Returns like `truck_verify` |
| `truck_drop_if` | `{truckId, ifId}` (manager) | Remove the IF from `data.ifs`, then verify |

- `pubDiffs`: each diff plus `text` (`diffText` with the SKU name from `skuNames` and pallet pcs from the loaded pallets of that item when they all share one pcs value).
- `isOpen(x)` becomes: status in `[loading, needs_fix, ready]` and no `claim` and no `depart`. Remove the `pending` check, because pending is gone.
- `truckView` adds `verify: data.verify || null`, `suggestions` (only when `needs_fix`), and `stage: x.status`.
- `truckSummary` drops `pending`.
- Every verify write re-reads the truck and refuses if it's no longer open. Use `data.getLoad(id)` before `updateLoad`.

- [ ] **Step 1: Write the failing tests** (append to `portal.test.js`. `setup`, `printLabels`, `L975`, `truckWith(ctx, n, ifId)` and `departed` already exist. In the fixture, IF9001 and IF9002 are on TO500, YSN100, 504 each. TO500 has 48 remaining, TO600 504, TO700 item 11 1200.)

```js
test('verify: exact → ready; short → needs_fix with instructions; scanning after ready drops back to loading', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    const r = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.deepEqual([r.match, r.view.truck.status], [true, 'ready']);
    const extra = printLabels(ctx, 1, 'Jx1', [L975]);
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: extra[0].code }, false).view.truck.status, 'loading');
    const v2 = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.deepEqual([v2.match, v2.view.truck.status, v2.diffs[0].kind], [false, 'needs_fix', 'if_over']);
    assert.match(v2.diffs[0].text, /IF9001 YSN100: IF 504 · loaded 516 → IF needs \+12 \(1 pallet\)/);
});

test('take off mode: pallet back to labeled, logged; not on truck → refused; ready → loading', () => {
    const ctx = setup();
    const { t, ps } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const r = ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false);
    assert.deepEqual([r.result, r.tone, r.view.truck.status], ['taken_off', 'warn', 'loading']);
    assert.deepEqual([ctx.data.getPallet(ps[0].id).status, ctx.data.getPallet(ps[0].id).loadId], ['labeled', '']);
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false).result, 'not_on_truck');
    assert.equal(ctx.data.db.scans.filter(s => s.result === 'taken_off').length, 1);
});

test('recheck: an office fix in NetSuite turns a needs_fix truck ready', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'needs_fix');
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 480 })] }) : f);
    const r = ctx.run('trucks_recheck', {}, false);
    assert.deepEqual(r.nowReady.map(x => x.id), [t.id]);
    assert.equal(ctx.data.getLoad(t.id).status, 'ready');
});

test('new IF suggestion: floor can add a suggested IF; not an IF on another truck', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 43);                                         // 516 on a 504 IF → over
    const v1 = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.deepEqual(v1.suggestions.map(f => f.ifId), ['9002']);              // same TO500, not on a truck
    const r = ctx.run('truck_add_if', { truckId: t.id, ifId: '9002' }, false);
    assert.deepEqual(r.view.truck.status, 'needs_fix');                       // now 516 vs 1008 → short on IF9002
    assert.throws(() => ctx.run('truck_add_if', { truckId: t.id, ifId: '9000' }, false), /not a suggested IF/);
    assert.throws(() => ctx.run('truck_drop_if', { truckId: t.id, ifId: '9002' }, false), /Managers only/);
    assert.equal(ctx.run('truck_drop_if', { truckId: t.id, ifId: '9002' }).view.truck.status, 'needs_fix');
});

test('scans and verify are refused on a departing truck', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const x = ctx.data.getLoad(t.id);
    ctx.data.updateLoad(x, { data: { claim: 'other', workingAt: Date.now() } });
    assert.throws(() => ctx.run('truck_verify', { truckId: t.id }, false), /closed|departing/);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: 'PLT1', mode: 'off' }, false), /closed/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL with `Unknown action: truck_verify`.

- [ ] **Step 3: Implement** the actions and helper changes from the Interfaces block. Notes:
  - `truck_scan` with `mode: 'off'` must not call `scanCtx` (no capacity check is needed to take a pallet off).
  - The status flip `ready → loading` happens in the same re-read update that `pushStack` or the scan does. A pallet change must leave a `ready` truck in `loading`, even when the stack write is skipped.
  - `truck_move_here`, `truck_remove` and `truck_undo` follow the same rule.
  - `verifyTruck(id, c)` is a shared helper used by `truck_verify`, `trucks_recheck`, `truck_add_if`, `truck_drop_if` and (Task 3) departure. It returns `{r, x}` and does the guarded write.

- [ ] **Step 4: Run the tests and confirm they pass.** Then run the full suite. Old tests that relied on scanning only in `loading`, or on `pending`, may need updating. Keep their intent, and note each change in the report.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(verify-load): verify/needs_fix/ready stages, take-off scan mode, recheck, add/drop IF"
```

---

### Task 3: Departure only from Ready; remove pending and skip-write

**Files:**
- Modify: `move_portal/sl_move_portal.js`, `move_portal/move_verify.js` (only if `planDeparture` needs a guard)
- Test: `move_portal/test/portal.test.js`

**Behavior:**
- `depart_preview`:
  - Refuses unless the status is `ready`, with "Verify the load first".
  - Re-verifies with `verifyTruck`. On a mismatch, returns `{needsFix: true, diffs, view}`, with the truck now `needs_fix`.
  - Otherwise returns the stamp-only plan (`departPlan`).
- `depart_confirm`:
  - Floor-allowed, with no manager gate.
  - Claims with a guard: status `ready`, no claim, no depart.
  - Re-verifies inside the claim (via `claimLoad`'s `extraData` callback, which already supports building data from the claimed state).
  - On a mismatch: release the claim, set `needs_fix` with the diffs, and return `{needsFix: true, diffs, view}`.
  - On a match: write `depart` / `plan` / `alloc` / `ifs` with the claim and run `finishDepart`.
  - The plan must contain only `if_stamp` ops. If `planDeparture` returns corrections, treat it as a mismatch, as a safety net.
- **Remove:**
  - `savePending`, `data.pending` everywhere;
  - `depart_cancel`, `depart_skip_write`, `NEEDS_MGR`;
  - the departures section of `approvals`;
  - the skip-write rows in `report` / `shadowRows`. Keep `shadowRows` working for stamps and receipts.
- `depart_retry` stays, for a failed `if_stamp` in `on` mode.
- The `retries` entries in `approvals` drop the `errorKey` / skip affordance.
- `departData` drops `requestedBy` / `pending`. `approvedBy` is `c.mgr ? c.user : ''` as today.

- [ ] **Step 1: Write the failing tests** (append, and delete or adapt the old pending, skip-write and manager-gate departure tests. List each one in the report.)

```js
test('depart only from ready; floor confirms; stamp-only plan', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'R1' }, false), /Verify the load first/);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const pv = ctx.run('depart_preview', { truckId: t.id, trailer: '537224', seal: 'R1' }, false);
    assert.deepEqual(pv.plan.ops.map(o => o.op), ['if_stamp']);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'R1' }, false);
    assert.deepEqual([r.departed, r.view.truck.status], [true, 'departed']);
});

test('confirm re-verifies: an IF changed in NetSuite after Ready sends the truck to needs_fix', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 456 })] }) : f);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'R2' }, false);
    assert.deepEqual([r.needsFix, r.view.truck.status, r.diffs[0].kind], [true, 'needs_fix', 'if_over']);
    assert.equal(ctx.data.getLoad(t.id).data.claim, '');
});

test('removed: depart_cancel, depart_skip_write, pending', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('depart_cancel', { truckId: '1' }), /Unknown action/);
    assert.throws(() => ctx.run('depart_skip_write', { truckId: '1' }), /Unknown action/);
    assert.equal(ctx.run('approvals').departures, undefined);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suite. It must pass.** The receipt, unload and report tests use `departed(ctx, …)`. Update that helper to verify before confirming: `truck_verify`, then `depart_confirm`. A short truck can no longer depart, so tests that departed short trucks must first make the IF match. Either stub `ctx.ns.plannedIfs` to the loaded qty, or load exactly. Keep each test's intent and list the changes in the report.
- [ ] **Step 5: Commit** with the message `feat(verify-load): departure only from Ready (re-verified, stamp-only); remove pending and skip-write`.

---

### Task 4: Correct the IF (manager) + Packed add-on IFs

**Files:**
- Modify: `move_portal/sl_move_portal.js`, `move_portal/move_tx.js`
- Test: `move_portal/test/portal.test.js`, `move_portal/test/move_tx.test.js`

**Behavior:**
- `move_tx.createIf(op)`:
  - When `op.ship === false`, set `shipstatus` **'B'** (Packed) and skip `stampOn`.
  - Otherwise behave as today.
  - Test with the fake N/record in `move_tx.test.js`: shipstatus B, and no custbody7 or container field set.
- `truck_correct {truckId, keys?}` (manager):
  - Requires the truck in `needs_fix`.
  - Takes a claim with `claimLoad(x, x.status, 'correct', guard)`. The guard requires status `needs_fix` and no claim. Status is unchanged; the claim only serializes.
  - Re-verifies to get the current diffs, then builds `correctionOps` for the requested keys (all keys if none are given).
  - Saves the ops to `data.corrections` (append, deduped by `key`), and records `{key, by: c.user, at}`.
  - Runs `verify.runOps(ops.filter(op => op.op !== 'drop_if'), writeMode(c), op => tx.apply(op), writes, onWrite)`. The writes go to `data.correctionWrites`. `runOps` uses `opKey`, so give `if_create` correction ops `opKey` `if_create:<toId>`, and include `ship:false`.
  - `drop_if` ops are applied directly: the IF is removed from `data.ifs`.
  - For each written `if_create`, attach `{ifId: <returned id>, ifNum: 'IF ' + id, toId, toNum, status: 'B', lines: [{item, sku, qty}]}` to `data.ifs`.
  - Release the claim with `claim: ''`, `workingAt: 0`, `phase: ''`.
  - Re-verify with `verifyTruck`.
  - Return `{written, planOnly, verify: {match, diffs}, view}`.
  - A refused write leaves its error in `data.correctError`. The response is `userErr('Correction refused: … — fix it in NetSuite')`. Ops already written stay recorded.
- **Approvals:**
  - `approvals` gets a `needsFix` list: `[{truck, diffs: pubDiffs, suggestions, corrections, correctError, writeMode}]` for `needs_fix` trucks.
  - It uses the grouped counts, with no per-truck `palletsByLoad` beyond what `verifyTruck` needs.
  - To stay cheap, use the stored `data.verify.diffs`. Only the manager's Re-check button calls `truck_verify` again.
- **Report** (optional, cheap): a row per correction op that is plan-only (`off`/`qty` `if_create`), with check `IF fix needed` and `ok:false`, so the office sees it. Skip this if it complicates `shadowRows`, and note that in the report.

- [ ] **Step 1: Write the failing tests**

```js
test('truck_correct: manager only; qty mode writes if_qty and the truck verifies ready', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.throws(() => ctx.run('truck_correct', { truckId: t.id }, false), /Managers only/);
    const real = ctx.ns.plannedIfs;
    ctx.tx._t.onApply = op => { if (op.op === 'if_qty') ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: op.to })] }) : f); };
    const r = ctx.run('truck_correct', { truckId: t.id });
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.to]), [['if_qty', 480]]);
    assert.deepEqual([r.verify.match, r.view.truck.status], [true, 'ready']);
    assert.equal(ctx.data.getLoad(t.id).data.claim, '');
});

test('truck_correct: off mode is plan-only; on mode creates a Packed add-on IF and attaches it', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jc1', [L975]).concat(printLabels(ctx, 1, 'Jc2', [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }]));
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id });
    const off = ctx.run('truck_correct', { truckId: t.id });
    assert.deepEqual([off.written, off.planOnly], [[], ['if_create:700']]);
    ctx.data.db.settings.writeMode = 'on';
    const on = ctx.run('truck_correct', { truckId: t.id });
    const created = ctx.tx._t.ops.find(o => o.op === 'if_create');
    assert.deepEqual([created.toId, created.ship], ['700', false]);
    assert.deepEqual(on.written, ['if_create:700']);
    // The re-verify reads NetSuite: the snapshot fixture doesn't know the new IF, so it isn't kept on the truck here.
    // Live NetSuite returns it as Packed, so it stays. The 'on'-mode attach is checked in the Stage 2 prod checklist.
});

test('approvals lists needs_fix trucks with instruction text', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const a = ctx.run('approvals');
    assert.equal(a.needsFix[0].truck.id, t.id);
    assert.match(a.needsFix[0].diffs[0].text, /IF needs −24/);
});
```

- [ ] **Step 2: Run the tests and confirm they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suite. It must pass.**
- [ ] **Step 5: Commit** with the message `feat(verify-load): manager Correct the IF (if_qty / Packed if_create / drop), needs-fix approvals`.

---

### Task 5: UI

**Files:**
- Modify: `move_portal/move_ui.js`
- Test: `move_portal/test/ui.test.js`

**Behavior** (spec §5–§6):

1. **Truck screen**
   - A mode toggle `➕ Load / ➖ Take off` next to the scan box. Take off gets the class `takeoff` (amber outline). The mode resets to Load after 2 minutes without a scan.
   - `doTruckScan` sends `mode`. New result renderers:
     - `taken_off`: amber, "Taken off: PLTx → back to Riverside".
     - `not_on_truck`: red, "Not on this truck".
   - A **Verify load** button (`data-act="tverify"`) under the table.
2. **Stage cards** (replace the old departure footer):
   - **`loading`:** Verify button, Undo.
   - **`needs_fix`:** an amber card "⚠ Needs IF fix" with each diff's `text`. Under it, suggestions with **Add to this truck** (`data-act="taddif"`). Buttons **Verify again** and **← Other trucks**. The scan box stays.
   - **`ready`:** a green card "✅ Ready to ship" with the departure form (trailer list + Other, seal, carrier, Review departure → Confirm departure). Confirm needs no manager.
     - `depart_preview` / `depart_confirm` may return `needsFix`. In that case, repaint the needs_fix card with a red flash "IF changed in NetSuite: needs a fix again".
   - **`departing` / `departed`:** as today.
3. **Remove from the UI:** pending "waiting for manager", `dcancel`, `apdepart`, `apskip`, and the departure cards in Approvals.
4. **Trucks list badges:** Loading / ⚠ Needs IF fix / ✅ Ready to ship / Departing.
5. **Recheck and alert:**
   - On any floor screen (not manager), every 30 s call `trucks_recheck`.
   - For each `nowReady` truck not yet alerted on this device (a localStorage set `mv_alerted`), show a fixed green banner at the top with a double ok tone: "✅ <label> now matches its IF: ready to ship [Open]" (`data-act="opentruck"`).
   - The banner is dismissible.
   - Stop polling when the page is hidden (`document.hidden`).
6. **Manager Approvals:** a top section "Needs IF fix", one card per `needsFix` entry:
   - the diff texts;
   - suggestions with Add;
   - per-IF Drop buttons for `if_empty`/`if_gone` (`truck_drop_if`);
   - **Correct the IF** (`data-act="apcorrect"`, with `confirm()`). The confirm text depends on the write mode:
     - `off`: "Plan only: fix in NetSuite";
     - `qty`: "Changes IF quantities in NetSuite";
     - `on`: "Changes IF quantities and creates add-on IFs in NetSuite".
   - **Re-check** (`truck_verify`).
   - It shows `correctError` if present.
7. **Keep the cross-check test green:** every `api()` call has a matching `act`, and every `data-act` has a handler.

- [ ] **Step 1: Write the failing UI tests**

```js
test('verify-load UI: verify, take-off, stages, recheck alert, manager correct', () => {
    const src = ui._clientMain.toString();
    ["api('truck_verify'", "api('trucks_recheck'", "api('truck_add_if'", "api('truck_drop_if'", "api('truck_correct'", 'Needs IF fix', 'Ready to ship',
        'Take off', 'back to Riverside', 'now matches its IF', 'mv_alerted', 'document.hidden']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ["api('depart_cancel'", "api('depart_skip_write'", 'Waiting for manager'].forEach(t => assert.equal(src.indexOf(t), -1, 'still has ' + t));
});
```

- [ ] **Step 2: Run the test and confirm it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the full suite. It must pass.**
- [ ] **Step 5: Commit** with the message `feat(verify-load): UI for verify, take-off, stage cards, alerts, manager corrections`.

---

### Task 6: Smoke test in the browser + handoff (controller)

- [ ] Restart Jack's preview (`move-preview`). His store keeps its data. Old trucks in `loading` still work.
- [ ] Walk through:
  1. Floor: start a truck, scan, Verify. Short → needs_fix card with the text.
  2. Take off a pallet in Take off mode.
  3. Manager: Approvals → Needs IF fix card → Correct the IF. In `off` mode this is plan-only.
  4. Stub path: a match → Ready to ship → depart. Use the floor with a truck loaded exactly.
  5. Recheck banner: simulate it by loading exactly, then going to another screen and back.
- [ ] Check `read_console_messages` and `preview_logs` for errors. Check that the 375 px layout doesn't overflow.
- [ ] Update the CLAUDE.md READ FIRST block, the test count, and the SDD ledger section. Commit and push.
