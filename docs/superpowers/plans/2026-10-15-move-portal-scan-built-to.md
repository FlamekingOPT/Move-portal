# Scan-built TO + IF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With Move Settings `officeIfs` off, a move truck is built only from its scans, and the manager's Approve creates its TO (status B, Riverside → Tippecanoe) and a Shipped IF in NetSuite; labels gain an odd pallet, an over-stock warning and an Excel upload.

**Architecture:** A scan-built truck is a normal v3 Move Load with `data.kind = 'scan'` and no IFs. It walks the existing state machine (loading → ready → ship_pending → departing → departed → receiving → received). Verify always matches. The departure plan becomes two ops, `to_create` then `if_create` (`ship: true`), run by the existing `runOps` / `finishDepart` / Retry machinery. The IF op points at its TO through a `new:to:<ref>` placeholder that `resolveNew` swaps for the written TO id. After the writes, the truck's `alloc` holds the real TO / IF ids, so receiving is unchanged. Every office-IF entry point asks `core.officeIfs(S)`.

**Tech Stack:** SuiteScript 2.1 AMD modules (N/record, N/search, N/query), node `node:test` with in-memory fakes, single-page client in `move_ui.js`, SheetJS `xlsx@0.18.5` from cdnjs (browser only).

**Spec:** `docs/superpowers/specs/2026-10-14-move-portal-scan-built-to-design.md`

## Global Constraints

- Riverside `locFrom` = 35, Tippecanoe `locTo` = 46 in prod (42 in the sandbox); read from Move Settings, never hard-coded.
- New TO `orderstatus` = Settings `toStatus` (default `'B'`).
- Settings `officeIfs` default **false** (real `move_data` DEFAULTS); `palletTare` default **45** (lb).
- Write modes: `to_create` and `if_create` write only in `on`; `off` / `qty` = plan only, truck ships in the portal only, never back-filled.
- Nothing is written to NetSuite before the manager's Approve (`ship_confirm`).
- Stock short at Approve blocks with "<SKU> on truck <n>, available <m>" and writes nothing. Labels over Riverside's unlabeled quantity **warn, never block**.
- Excel / label print cap = Settings `maxPrint` (250) labels per print job.
- Truck tag in memos: `[MV-<ref>]` where `ref` = load id (truck) or `<loadId>-P<palletId>` (late pallet). The brackets stop `[MV-12]` matching `[MV-123]`.
- With `officeIfs: true` every existing test passes unchanged (`test/fake_data.js` sets `officeIfs: true` for that reason).
- Tests: run from the repo root, `node --test "move_portal/test/*.test.js"` (the quoted glob is required on Windows). Baseline 291/291 pass.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch `feat/v3-verification`; `git pull` before starting, `git push` at the end.

## Where the plan simplifies the spec (same behaviour)

- **No `labels_print_batch` action.** Print all reuses the existing retry-safe `print_chunk` through the client's `printMany`. That already makes one print job and one 4×6 page for several SKUs. The only new server action is `labels_preview`.
- **No stored `data.lock`.** A truck whose TO landed without its IF is in `departing` with an error. That state already refuses scans, take-offs and send-back, so the lock is that state plus `writes['to_create:<id>']`.
- **Stock check reads `data.locationStock`** (the item search's `locationquantityavailable`, the same figure the print plan uses), not a separate SuiteQL query.

## Review Focus

1. **Weight unit ids.** NetSuite's item `weightunit` may come back as an id (`1`–`4`) or as text (`lb`). `verify.lbs` must handle both and return `null` (shown as "no weight") for anything else, never a wrong number. Pinned in Task 1.
2. **A retry after a request died between the TO save and recording it.** Retry must find the TO by `[MV-<ref>]` and not create a second one, then find a Shipped IF by token on that TO. Pinned in Task 3 (tx) and Task 6 (flow).
3. **Two scan trucks on the same day, or a truck plus a late pallet.** Write keys must never collide (`to_create:<ref>`, `if_create:new:to:<ref>`). Pinned in Task 2 and Task 7.
4. **An empty scan truck pressing Verify or Approve.** This must be refused with "Nothing is loaded on this truck", not shipped as an empty TO. Pinned in Task 5.
5. **Excel quirks:** header case and spacing, a numeric SKU cell (`201`), blank rows, the same SKU twice (warnings must use a running total), an "Odd pallet pcs" column that is missing. Pinned in Task 8.

---

## File Structure

| File | Change |
|---|---|
| `move_portal/move_core.js` | + `officeIfs(S)`, `palletTare(S)` |
| `move_portal/move_verify.js` | + `lbs`, `truckLines`, `linesPcs`, `truckWeight`, `stockCheck`, `stockText`, `scanTag`, `scanApprovePlan`, `labelRows`; `classifyLoadScan` scan branch; `opKey` / `resolveNew` extended; SQL `items` + `buildReads` items carry weight |
| `move_portal/move_tx.js` | + `to_create`, Shipped-IF find by token, `toClosed`, `tranIds(…, 'to')` |
| `move_portal/move_data.js` | DEFAULTS `officeIfs`, `palletTare`; item rows carry `weight`, `wunit` |
| `move_portal/sl_move_portal.js` | scan truck start / scan / verify / view; departure plan, stock block, finishDepart ids, release guard; late-pallet accept; dashboard row; `labels_preview`; boot `officeIfs` |
| `move_portal/move_ui.js` | Start truck without IFs; Load panel + Finish loading; Verify panel with weight; Shipments lbs; Approve / Reject card; Retry / Release text; Labels odd pallet, warn, Excel upload |
| `move_portal/local/snapshot_ns.js` | stand-in `to_create`, Shipped `if_create` |
| `move_portal/test/fake_tx.js`, `fake_data.js` | `to_create` ids, `toClosed`, `tranIds` 'to'; `officeIfs: true` |
| tests | `core.test.js`, `verify.test.js`, `move_tx.test.js`, `portal.test.js`, `ui.test.js`, `move_data.test.js` |

---

### Task 1: Pure rules for truck contents, weight and stock (move_core + move_verify)

**Files:**
- Modify: `move_portal/move_core.js` (add 2 functions + export)
- Modify: `move_portal/move_verify.js` (add functions near `sumLines`, export)
- Test: `move_portal/test/core.test.js`, `move_portal/test/verify.test.js`

**Interfaces:**
- Produces:
  - `core.officeIfs(S) → boolean`. True only when `S.officeIfs === true`.
  - `core.palletTare(S) → number`. `Number(S.palletTare)` if > 0, else 45.
  - `verify.lbs(weight, unit) → number|null`
  - `verify.truckLines(pallets) → { [item]: { pallets, pcs } }`
  - `verify.linesPcs(tl) → { [item]: pcs }`
  - `verify.truckWeight(tl, info, tare, palletCount) → { rows: { [item]: number|null }, tare, total, noWeight }`
  - `verify.stockCheck(pcsByItem, avail) → [{ item, need, avail }]`
  - `verify.stockText(shorts, sk) → string`

- [ ] **Step 1: Write the failing tests**

Append to `move_portal/test/core.test.js`:

```js
test('officeIfs is on only when set true; palletTare defaults to 45', () => {
    assert.equal(core.officeIfs({}), false);
    assert.equal(core.officeIfs({ officeIfs: 'true' }), false);
    assert.equal(core.officeIfs({ officeIfs: true }), true);
    assert.equal(core.palletTare({}), 45);
    assert.equal(core.palletTare({ palletTare: 50 }), 50);
    assert.equal(core.palletTare({ palletTare: 0 }), 45);
});
```

Append to `move_portal/test/verify.test.js`:

```js
test('lbs converts NetSuite weight units by id or text; unknown is null', () => {
    assert.equal(verify.lbs(20, '1'), 20);
    assert.equal(verify.lbs(20, 'lb'), 20);
    assert.equal(verify.lbs(32, '2'), 2);
    assert.equal(verify.lbs(32, 'oz'), 2);
    assert.equal(verify.lbs(10, 'kg'), 22.05);
    assert.equal(verify.lbs(1000, '4'), 2.2);
    assert.equal(verify.lbs(0, 'lb'), null);
    assert.equal(verify.lbs('', 'lb'), null);
    assert.equal(verify.lbs(20, 'stone'), null);
    assert.equal(verify.lbs(20, ''), 20);          // NetSuite leaves the unit blank for lb on some items
});

test('truckLines counts pallets and pieces per SKU; truckWeight adds tare and counts SKUs without weight', () => {
    const ps = [{ lines: [{ item: '11', pcs: 72 }] }, { lines: [{ item: '11', pcs: 72 }] }, { lines: [{ item: '12', pcs: 36 }] }];
    const tl = verify.truckLines(ps);
    assert.deepEqual(tl, { '11': { pallets: 2, pcs: 144 }, '12': { pallets: 1, pcs: 36 } });
    assert.deepEqual(verify.linesPcs(tl), { '11': 144, '12': 36 });
    const w = verify.truckWeight(tl, { '11': { weight: 10, wunit: 'lb' }, '12': { weight: 0, wunit: '' } }, 45, 3);
    assert.deepEqual(w, { rows: { '11': 1440, '12': null }, tare: 135, total: 1575, noWeight: 1 });
});

test('stockCheck lists every SKU the truck needs more of than is available', () => {
    const shorts = verify.stockCheck({ '11': 504, '12': 36 }, { '11': 360, '12': 36 });
    assert.deepEqual(shorts, [{ item: '11', need: 504, avail: 360 }]);
    assert.deepEqual(verify.stockCheck({ '13': 5 }, {}), [{ item: '13', need: 5, avail: 0 }]);
    assert.equal(verify.stockText(shorts, { '11': 'YSN201' }), 'YSN201 on truck 504, available 360');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/core.test.js" "move_portal/test/verify.test.js"`
Expected: FAIL with `core.officeIfs is not a function` and `verify.lbs is not a function`.

- [ ] **Step 3: Implement**

In `move_portal/move_core.js`, add before the `return {` at the end:

```js
    // Settings switches for the scan-built flow (spec 2026-10-14). officeIfs: only an explicit true turns the office-IF screens on.
    function officeIfs(S) { return !!S && S.officeIfs === true; }
    function palletTare(S) { const n = Number(S && S.palletTare); return n > 0 ? n : 45; }
```

and add `officeIfs, palletTare` to the returned object.

In `move_portal/move_verify.js`, add after `sumLines`:

```js
    // ── scan-built trucks (spec 2026-10-14) ──────────────────────────────
    // NetSuite weightunit: an id (1 lb, 2 oz, 3 kg, 4 g) or its text. Blank unit = lb. Anything else, or no weight, = null ("no weight").
    const LB_PER = { '': 1, '1': 1, lb: 1, lbs: 1, '2': 1 / 16, oz: 1 / 16, '3': 2.20462, kg: 2.20462, '4': 0.00220462, g: 0.00220462 };
    function lbs(weight, unit) {
        const w = Number(weight), f = LB_PER[String(unit == null ? '' : unit).trim().toLowerCase()];
        if (!(w > 0) || f == null) return null;
        return Math.round(w * f * 100) / 100;
    }
    // Pallets and pieces per SKU. A mixed pallet counts once on each SKU it carries.
    function truckLines(pallets) {
        const out = {};
        (pallets || []).forEach(p => {
            const seen = {};
            (p.lines || []).forEach(l => {
                const k = String(l.item), r = (out[k] = out[k] || { pallets: 0, pcs: 0 });
                r.pcs += Number(l.pcs) || 0;
                if (!seen[k]) { r.pallets++; seen[k] = true; }
            });
        });
        return out;
    }
    function linesPcs(tl) { const o = {}; Object.keys(tl || {}).forEach(k => { o[k] = tl[k].pcs; }); return o; }
    // info: { item: { weight, wunit } }. Line weights are rounded to the pound; the tare is palletCount × tare.
    function truckWeight(tl, info, tare, palletCount) {
        const rows = {};
        let total = 0, noWeight = 0;
        Object.keys(tl || {}).forEach(k => {
            const i = (info || {})[k] || {}, per = lbs(i.weight, i.wunit);
            if (per == null) { rows[k] = null; noWeight++; return; }
            rows[k] = Math.round(per * tl[k].pcs);
            total += rows[k];
        });
        const t = Math.round((Number(tare) || 0) * (Number(palletCount) || 0));
        return { rows: rows, tare: t, total: total + t, noWeight: noWeight };
    }
    function stockCheck(pcsByItem, avail) {
        return Object.keys(pcsByItem || {}).filter(k => (Number(pcsByItem[k]) || 0) > (Number((avail || {})[k]) || 0))
            .map(k => ({ item: k, need: Number(pcsByItem[k]) || 0, avail: Number((avail || {})[k]) || 0 }));
    }
    function stockText(shorts, sk) {
        return (shorts || []).map(s => ((sk || {})[s.item] || s.item) + ' on truck ' + fmt(s.need) + ', available ' + fmt(s.avail)).join('; ');
    }
```

(`fmt` is the module's existing number formatter, exported as `_fmt`.) Add `lbs, truckLines, linesPcs, truckWeight, stockCheck, stockText` to the returned object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 294 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_core.js move_portal/move_verify.js move_portal/test/core.test.js move_portal/test/verify.test.js
git commit -m "feat(scan): pure rules for truck lines, weight and stock check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Approve plan, write keys and scan classification (move_verify)

**Files:**
- Modify: `move_portal/move_verify.js` (`classifyLoadScan`, `opKey`, `resolveNew`, new `scanTag`, `scanApprovePlan`)
- Test: `move_portal/test/verify.test.js`

**Interfaces:**
- Consumes: `memoFor(truckNo, dayIso)` (existing).
- Produces:
  - `verify.scanTag(ref) → '[MV-<ref>]'`
  - `verify.scanApprovePlan({ ref, lines: {item: pcs}, stamp: { trailer, seal, truckNo, dayIso }, S: { locFrom, locTo, toStatus } }) → { ops: [toOp, ifOp], alloc: [{ ifId: 'new:<ref>', ifNum: '(new)', toId: 'new:to:<ref>', toNum: '(new TO)', lines, addOn: false }], unplanned: [], corrections: [], bol: null }`
  - `toOp = { op: 'to_create', ref, token, fromLoc, toLoc, orderStatus, lines, memo }`
  - `ifOp = { op: 'if_create', ref, toId: 'new:to:<ref>', ship: true, token, lines, trailer, seal, memo }`
  - `opKey(toOp) = 'to_create:<ref>'`; `opKey(ifOp) = 'if_create:new:to:<ref>'` (existing rule)
  - `resolveNew(op, writes)` also resolves `toId: 'new:to:<ref>'` → `writes['to_create:<ref>']`
  - `classifyLoadScan({ pallet, truckId, trucks, scanBuilt: true })` → `{ result: 'ok', set: { status: 'loaded', loadId } }` for a labeled pallet

- [ ] **Step 1: Write the failing tests**

Append to `move_portal/test/verify.test.js`:

```js
test('scanApprovePlan: a TO then a Shipped IF on it, tagged, with keys that never collide', () => {
    const p = verify.scanApprovePlan({ ref: '12', lines: { '11': 504, '12': 36 }, stamp: { trailer: '537224', seal: '0048812', truckNo: 3, dayIso: '2026-11-02' },
        S: { locFrom: '35', locTo: '46', toStatus: 'B' } });
    const [to, f] = p.ops;
    assert.deepEqual(to, { op: 'to_create', ref: '12', token: '[MV-12]', fromLoc: '35', toLoc: '46', orderStatus: 'B', lines: { '11': 504, '12': 36 },
        memo: '[MV-12] Trailer 537224 · Truck 3 · 11/02' });
    assert.deepEqual(f, { op: 'if_create', ref: '12', toId: 'new:to:12', ship: true, token: '[MV-12]', lines: { '11': 504, '12': 36 },
        trailer: '537224', seal: '0048812', memo: 'Truck 3 · 11/02 · [MV-12]' });
    assert.deepEqual(p.alloc, [{ ifId: 'new:12', ifNum: '(new)', toId: 'new:to:12', toNum: '(new TO)', lines: { '11': 504, '12': 36 }, addOn: false }]);
    assert.deepEqual([p.unplanned, p.corrections, p.bol], [[], [], null]);
    assert.equal(verify.opKey(to), 'to_create:12');
    assert.equal(verify.opKey(f), 'if_create:new:to:12');
    const late = verify.scanApprovePlan({ ref: '12-P900', lines: { '11': 72 }, stamp: { trailer: 't', seal: 's', truckNo: 3, dayIso: '2026-11-02' }, S: { locFrom: '35', locTo: '46' } });
    assert.equal(late.ops[0].orderStatus, 'B');                       // toStatus missing → B
    assert.notEqual(verify.opKey(late.ops[0]), verify.opKey(to));
    assert.notEqual(verify.opKey(late.ops[1]), verify.opKey(f));
});

test('to_create writes only in on mode; resolveNew swaps the new TO and IF ids', () => {
    const to = { op: 'to_create', ref: '12' };
    assert.deepEqual([verify.opAllowed(to, 'off'), verify.opAllowed(to, 'qty'), verify.opAllowed(to, 'on')], [false, false, true]);
    const writes = { 'to_create:12': '700', 'if_create:new:to:12': '800' };
    assert.deepEqual(verify.resolveNew({ op: 'if_create', toId: 'new:to:12', ref: '12' }, writes), { op: 'if_create', toId: '700', ref: '12' });
    assert.deepEqual(verify.resolveNew({ op: 'receipt', ifId: 'new:12', toId: 'new:to:12' }, writes), { op: 'receipt', ifId: '800', toId: '700' });
    assert.throws(() => verify.resolveNew({ op: 'if_create', toId: 'new:to:13' }, writes), /The TO for 13 was not created yet/);
    assert.deepEqual(verify.resolveNew({ op: 'receipt', ifId: 'new:600', toId: '600' }, { 'if_create:600': '901' }), { op: 'receipt', ifId: '901', toId: '600' });   // office add-on: unchanged
});

test('a scan-built truck loads any labeled pallet without a TO check', () => {
    const p = { id: 5, status: 'labeled', loadId: '', lines: [{ item: '99', pcs: 10 }] };
    assert.deepEqual(verify.classifyLoadScan({ pallet: p, truckId: '7', trucks: {}, scanBuilt: true }), { result: 'ok', set: { status: 'loaded', loadId: '7' } });
    assert.equal(verify.classifyLoadScan({ pallet: Object.assign({}, p, { status: 'void' }), truckId: '7', trucks: {}, scanBuilt: true }).result, 'void');
    assert.equal(verify.classifyLoadScan({ pallet: p, truckId: '7', trucks: {}, ifs: [], toLines: [], loadedByItem: {} }).result, 'no_to');   // office truck: unchanged
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `verify.scanApprovePlan is not a function`.

- [ ] **Step 3: Implement**

In `classifyLoadScan`, replace the last line `return fitOnTruck(p, o);` with:

```js
        if (o.scanBuilt) return { result: 'ok', set: { status: VP.LOADED, loadId: String(o.truckId) } };   // the scans are the order: no TO to fit
        return fitOnTruck(p, o);
```

In `opKey`, add as the first line:

```js
        if (op.op === 'to_create') return 'to_create:' + op.ref;
```

Replace `resolveNew` with:

```js
    // 'new:' placeholders in a stored plan: an add-on IF (ifId 'new:<toId>', key if_create:<toId>) and, on a scan-built truck,
    // its new TO (toId 'new:to:<ref>', key to_create:<ref>). The IF is resolved first, by the op's toId as stored.
    function resolveNew(op, writes) {
        let out = op;
        if (out.ifId && String(out.ifId).indexOf('new:') === 0) {
            const id = writes && writes['if_create:' + out.toId];
            if (!id) throw new Error('The add-on IF from TO ' + out.toId + ' was not created yet');
            out = Object.assign({}, out, { ifId: String(id) });
        }
        if (out.toId && String(out.toId).indexOf('new:to:') === 0) {
            const ref = String(out.toId).slice(7), id = writes && writes['to_create:' + ref];
            if (!id) throw new Error('The TO for ' + ref + ' was not created yet');
            out = Object.assign({}, out, { toId: String(id) });
        }
        return out;
    }
```

Add after `memoFor`:

```js
    function scanTag(ref) { return '[MV-' + ref + ']'; }
    // Approve on a scan-built truck (spec 2026-10-14 §3): a new TO for what was scanned, then its IF saved Shipped with the stamp.
    function scanApprovePlan(o) {
        const ref = String(o.ref), tag = scanTag(ref), st = o.stamp || {}, S = o.S || {}, memo = memoFor(st.truckNo, st.dayIso);
        const lines = Object.assign({}, o.lines);
        const to = { op: 'to_create', ref: ref, token: tag, fromLoc: String(S.locFrom), toLoc: String(S.locTo), orderStatus: S.toStatus || 'B', lines: lines,
            memo: tag + ' Trailer ' + st.trailer + ' · ' + memo };
        const f = { op: 'if_create', ref: ref, toId: 'new:to:' + ref, ship: true, token: tag, lines: Object.assign({}, lines), trailer: st.trailer, seal: st.seal,
            memo: memo + ' · ' + tag };
        return { ops: [to, f], alloc: [{ ifId: 'new:' + ref, ifNum: '(new)', toId: 'new:to:' + ref, toNum: '(new TO)', lines: Object.assign({}, lines), addOn: false }],
            unplanned: [], corrections: [], bol: null };
    }
```

Add `scanTag, scanApprovePlan` to the exports. (`opAllowed` already allows only `if_qty` in `qty` mode, so `to_create` is on-only with no change.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 297 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(scan): approve plan (TO then Shipped IF), new:to placeholders, scan-built load scans

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: NetSuite writes: create TO, find by tag, TO closed check (move_tx + fake_tx)

**Files:**
- Modify: `move_portal/move_tx.js`
- Modify: `move_portal/test/fake_tx.js`
- Test: `move_portal/test/move_tx.test.js`

**Interfaces:**
- Consumes: ops from Task 2.
- Produces:
  - fake `_t.failOn` may be a key string (as today) or a predicate `op => boolean` (used by Task 6).
  - `tx.apply(toOp) → toId string`. Finds an existing TO whose memo contains the token, else creates one.
  - `tx.apply(ifOp with ship: true and token) → ifId string`. Finds an existing Shipped IF created from `toId` whose memo contains the token, else transforms, stamps and saves it.
  - `tx.toClosed(toId) → boolean`. True when the TO is Closed (`orderstatus` `H`), every line is closed, or the TO no longer exists.
  - `tx.tranIds(ids, 'to') → { id: 'TO8812' }`
  - fake: `makeFakeTx()._t.closed = {}` (ids the fake treats as closed); `to_create` returns a new seq id.

- [ ] **Step 1: Write the failing tests**

In `move_portal/test/move_tx.test.js`, extend `setup` so the fakes support create, lookupFields and the TO type:

```js
// in setup(): add to fakeRecord
        create: o => { const r = makeRec({}, []); r.id = '650'; r.type = o.type; log.created = r;
            r.selectNewLine = () => { r.lines.push({}); r.cur = r.lines.length - 1; }; return r; },
// and in fakeSearch: add the transfer-order type and lookupFields
    fakeSearch.Type.TRANSFER_ORDER = 'transferorder';
    fakeSearch.Type.LOCATION = 'location';
    fakeSearch.lookupFields = o => (o.type === 'location' ? { subsidiary: [{ value: '2', text: 'Flame King' }] } : { tranid: 'TO8812' });
```

(`fakeSearch` is declared with `const`; add the two `Type` keys and `lookupFields` right after it is built, before `loadAmd`.) Then append:

```js
const toOp = () => ({ op: 'to_create', ref: '12', token: '[MV-12]', fromLoc: '35', toLoc: '46', orderStatus: 'B', lines: { '975': 504, '111': 36 }, memo: '[MV-12] Trailer 537224 · Truck 3 · 11/02' });

test('to_create makes an approved TO 35 → 46 with one line per item', () => {
    const s = setup({});
    assert.equal(s.tx.apply(toOp()), '777');
    const r = s.log.created;
    assert.deepEqual([r.values.subsidiary, r.values.location, r.values.transferlocation, r.values.orderstatus, r.values.memo], ['2', '35', '46', 'B', '[MV-12] Trailer 537224 · Truck 3 · 11/02']);
    assert.deepEqual(r.lines.map(l => [l.item, l.quantity]), [['975', 504], ['111', 36]]);
    assert.equal(r.saved, 1);
});

test('to_create finds a TO an earlier request made, by its tag, and creates nothing', () => {
    const s = setup({ found: '640' });
    assert.equal(s.tx.apply(toOp()), '640');
    assert.equal(s.log.created, undefined);
    const f = JSON.stringify(s.log.searches[0].filters);
    assert.ok(f.indexOf('[MV-12]') !== -1 && f.indexOf('TrnfrOrd') !== -1);
});

test('if_create Shipped with a token finds an earlier Shipped IF on that TO, else stamps a new one', () => {
    let s = setup({ found: '901' });
    const op = { op: 'if_create', ref: '12', toId: '600', ship: true, token: '[MV-12]', lines: { '975': 24 }, trailer: '537224', seal: '0048812', memo: 'Truck 3 · 11/02 · [MV-12]' };
    assert.equal(s.tx.apply(op), '901');
    assert.equal(s.log.transforms.length, 0);
    assert.ok(JSON.stringify(s.log.searches[0].filters).indexOf('ItemShip:C') !== -1);
    s = setup({ toLines: [{ item: '975', quantity: 24 }] });
    assert.equal(s.tx.apply(op), '888');
    assert.deepEqual([s.log.last.values.shipstatus, s.log.last.values.memo, s.log.last.values.custbody7], ['C', 'Truck 3 · 11/02 · [MV-12]', 'SEAL: 0048812']);
});

test('toClosed: Closed status, every line closed, or gone', () => {
    const s = setup({ to: [{ item: '975', quantity: 600, isclosed: true }] });
    assert.equal(s.tx.toClosed('600'), true);
    const s2 = setup({ to: [{ item: '975', quantity: 600, isclosed: false }] });
    assert.equal(s2.tx.toClosed('600'), false);
    assert.equal(s2.tx.toClosed('999'), true);                     // no such TO (deleted)
    assert.deepEqual(s2.tx.tranIds(['5'], 'to'), { '5': 'TO8812' });
});
```

In the gone case the fake `load` throws `no rec …`. `toClosed` treats any load error whose message contains `RCRD_DSNT_EXIST` **or** `no rec` as gone. The real NetSuite error code is `RCRD_DSNT_EXIST`; the `no rec` match exists only for the fake, and a comment in the code says so.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/move_tx.test.js"`
Expected: FAIL. `to_create` throws `Unknown op to_create`, and `s.tx.toClosed is not a function`.

- [ ] **Step 3: Implement**

In `move_portal/move_tx.js`, add after `findPackedByToken`:

```js
    // A transaction the portal made earlier, found by the [MV-<ref>] tag in its memo (a request that died after the save, before it was recorded).
    function findByToken(tok, typeCode, more) {
        const r = search.create({ type: search.Type.TRANSACTION,
            filters: [['memo', 'contains', tok], 'AND', ['mainline', 'is', 'T'], 'AND', ['type', 'anyof', typeCode]].concat(more || []),
            columns: ['internalid'] }).run().getRange({ start: 0, end: 1 });
        return r && r[0] ? String(r[0].id) : null;
    }
    function locationSubsidiary(locId) {
        const f = search.lookupFields({ type: search.Type.LOCATION, id: locId, columns: ['subsidiary'] });
        const s = f && f.subsidiary;
        return Array.isArray(s) && s.length ? s[0].value : null;
    }
    // Scan-built truck (spec 2026-10-14 §3.1): an approved TO from Riverside to Tippecanoe, one line per item.
    function createTransferOrder(op) {
        const found = findByToken(op.token, 'TrnfrOrd');
        if (found) return found;
        const to = record.create({ type: record.Type.TRANSFER_ORDER, isDynamic: true });
        const sub = locationSubsidiary(op.fromLoc);
        if (sub) to.setValue({ fieldId: 'subsidiary', value: sub });
        to.setValue({ fieldId: 'location', value: op.fromLoc });
        to.setValue({ fieldId: 'transferlocation', value: op.toLoc });
        to.setValue({ fieldId: 'orderstatus', value: op.orderStatus || 'B' });
        to.setValue({ fieldId: 'memo', value: op.memo });
        Object.keys(op.lines).forEach(item => {
            to.selectNewLine({ sublistId: 'item' });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: item });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: op.lines[item] });
            to.commitLine({ sublistId: 'item' });
        });
        return String(to.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    // Release check: a TO the manager closed (or deleted) in NetSuite. "no rec" is the test fake's not-found message.
    function toClosed(toId) {
        let to;
        try { to = record.load({ type: record.Type.TRANSFER_ORDER, id: toId }); }
        catch (e) { const m = String((e && (e.name || '')) + ' ' + (e && e.message || '')); if (/RCRD_DSNT_EXIST|no rec/.test(m)) return true; throw e; }
        if (String(to.getValue({ fieldId: 'orderstatus' }) || '') === 'H') return true;
        const n = to.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < n; i++) if (to.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i }) !== true) return false;
        return n > 0;
    }
```

At the top of `createIf`, after the Packed-token block, add:

```js
        if (op.ship === true && op.token) {           // scan-built: a Shipped IF an earlier request saved on this TO
            const found = findByToken(op.token, 'ItemShip', ['AND', ['createdfrom', 'anyof', String(op.toId)], 'AND', ['status', 'anyof', ['ItemShip:C']]]);
            if (found) return found;
        }
```

In `apply`, add `if (op.op === 'to_create') return createTransferOrder(op);` as the first line. In `tranIds`, replace the type/prefix line with:

```js
        const isIf = kind === 'if', isTo = kind === 'to';
        const type = isTo ? search.Type.TRANSFER_ORDER : isIf ? search.Type.ITEM_FULFILLMENT : search.Type.ITEM_RECEIPT, pre = isTo ? 'TO' : isIf ? 'IF' : 'IR';
```

and change the replace regex to `/^(I[FR]|TO)/i`. Export `toClosed`.

In `move_portal/test/fake_tx.js`: set `const t = { seq: 900, ops: [], failOn: null, closed: {} };`. Let `failOn` also be a predicate on the op, because a scan truck's IF op reaches `apply` already resolved, so its key isn't known in advance:
`if (t.failOn && (typeof t.failOn === 'function' ? t.failOn(op) : t.failOn === key)) { t.failOn = null; throw … }`. Keep `apply` (it already returns `++seq` for any op other than `if_qty` / `if_stamp`, so `to_create` gets an id), add `toClosed: id => !!t.closed[String(id)]`, and change `tranIds` to `(kind === 'to' ? 'TO' : kind === 'if' ? 'IF' : 'IR') + id`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 301 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_tx.js move_portal/test/fake_tx.js move_portal/test/move_tx.test.js
git commit -m "feat(scan): create the move TO, find TO/IF by tag on retry, TO closed check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Settings defaults and item weight in the data layers

**Files:**
- Modify: `move_portal/move_data.js` (DEFAULTS, `itemCols`, `itemRow`)
- Modify: `move_portal/move_verify.js` (`SQL.items`, `buildReads` items)
- Modify: `move_portal/test/fake_data.js` (settings `officeIfs: true`)
- Test: `move_portal/test/move_data.test.js`, `move_portal/test/verify.test.js`

**Interfaces:**
- Produces: `data.getSettings()` includes `officeIfs` (default false) and `palletTare` (default 45). `data.itemInfo(ids)[id]`, `data.itemLookup`, `data.locationStock` rows carry `weight` (number, 0 if blank) and `wunit` (string). `ns.items()` rows carry `weight`, `wunit`.

- [ ] **Step 1: Write the failing tests**

Look at `move_portal/test/move_data.test.js` for how it fakes `N/search` rows (`getValue(name)`). Add a test in that style:

```js
test('settings default to scan-built (officeIfs false, tare 45) and item rows carry weight', () => {
    // use the file's existing fake-search helper; give the settings row '{}' and one item row with weight 20, weightunit '1'
    const s = d.getSettings();
    assert.equal(s.officeIfs, false);
    assert.equal(s.palletTare, 45);
    const i = d.itemInfo(['11'])['11'];
    assert.deepEqual([i.weight, i.wunit], [20, '1']);
});
```

Before writing it, read the top of `move_data.test.js` and build `d` with the same helper its other tests use. Make the item row's `getValue('weight')` return `'20'` and `getValue('weightunit')` return `'1'`.

Append to `move_portal/test/verify.test.js`:

```js
test('the items query and reads carry weight and unit', () => {
    assert.match(verify.SQL('35', '46').items, /i\.weight AS weight, i\.weightunit AS wunit/);
    const r = verify.buildReads({ items: [{ item: 11, sku: 'YSN201', descr: 'x', upc: '', weight: '20', wunit: '1' }] });
    assert.deepEqual(r.items()[0], { item: '11', sku: 'YSN201', desc: 'x', upc: '', weight: 20, wunit: '1' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/move_data.test.js" "move_portal/test/verify.test.js"`
Expected: FAIL (no `officeIfs` default, no `weight`).

- [ ] **Step 3: Implement**

`move_portal/move_data.js`:

```js
    const DEFAULTS = { locFrom: '', locTo: '', fromName: 'Riverside', toName: 'Tippecanoe', target: '2026-11-15', start: '2026-10-01',
        skip: [], labelCode: 'both', roster: [], maxPrint: 250, staleDays: 5, toStatus: 'B', activeBatch: '', officeIfs: false, palletTare: 45 };
...
    function itemCols() { return ['itemid', 'salesdescription', 'displayname', 'upccode', 'weight', 'weightunit'].map(n => search.createColumn({ name: n })); }
    function itemRow(r) {
        return { item: String(r.id), sku: skuOfName(r.getValue('itemid')),
            desc: r.getValue('salesdescription') || r.getValue('displayname') || '', upc: r.getValue('upccode') || '',
            weight: Number(r.getValue('weight')) || 0, wunit: String(r.getValue('weightunit') || '') };
    }
```

`move_portal/move_verify.js`. Change the `items` SQL to:

```js
            items: "SELECT i.id AS item, i.itemid AS sku, i.displayname AS descr, i.upccode AS upc, i.weight AS weight, i.weightunit AS wunit FROM item i WHERE i.id IN ({IDS})",
```

and the `items` read to:

```js
            items: () => (raw.items || []).map(i => ({ item: S(i.item), sku: S(i.sku), desc: S(i.descr), upc: S(i.upc), weight: Number(i.weight) || 0, wunit: S(i.wunit) })),
```

`move_portal/test/fake_data.js`: add `officeIfs: true, palletTare: 45` to `db.settings`. The existing office-IF tests then run unchanged; scan tests set `ctx.data.db.settings.officeIfs = false`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 303 tests. If an existing `verify.test.js` test deep-equals an `items()` row, add `weight: 0, wunit: ''` to its expected value.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_data.js move_portal/move_verify.js move_portal/test/fake_data.js move_portal/test/move_data.test.js move_portal/test/verify.test.js
git commit -m "feat(scan): officeIfs/palletTare settings; items carry NetSuite weight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Floor flow for a scan-built truck (start, scan, view, verify)

**Files:**
- Modify: `move_portal/sl_move_portal.js` (`truck_start`, `truck_planned`, `scanCtx`, `checkTruck`, `verifyTruck`, `truckView`, `truck_add_if`, `page`)
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `core.officeIfs`, `core.palletTare`, `verify.truckLines`, `verify.linesPcs`, `verify.truckWeight`, `verify.classifyLoadScan({ scanBuilt })`.
- Produces:
  - `isScan(x) → boolean` (`x.data.kind === 'scan'`), used by Tasks 6–7.
  - `scanRows(x, ps, c) → { rows: [{ item, sku, pallets, pcs, lbs, avail, short }], pallets, pcs, tare, total, noWeight, short }` (loaded pallets only).
  - `truckView(x, c).scan`: the `scanRows` result for a scan truck, else `null`.
  - `truck_planned` returns `officeIfs` (boolean) and `planned: []` when off.
  - Boot data `officeIfs` for the UI.

- [ ] **Step 1: Write the failing tests**

Append to `move_portal/test/portal.test.js`:

```js
function scanSetup() {
    const ctx = setup();
    ctx.data.db.settings.officeIfs = false;
    ctx.data.db.items.find(i => i.item === '11').weight = 10;
    ctx.data.db.items.find(i => i.item === '11').wunit = 'lb';
    return ctx;
}
function scanTruck(ctx, n) {
    const ps = printLabels(ctx, n || 2);
    const v = ctx.run('truck_start', { trailer: tr() }, false).view;
    ps.forEach(p => ctx.run('truck_scan', { truckId: v.truck.id, raw: p.code }, false));
    return { id: v.truck.id, ps };
}

test('scan-built: start with only a trailer, load any labeled pallet, see SKU rows with weight and stock', () => {
    const ctx = scanSetup();
    assert.deepEqual(ctx.run('truck_planned', {}, false).planned, []);
    assert.equal(ctx.run('truck_planned', {}, false).officeIfs, false);
    const t = scanTruck(ctx, 2);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.kind, x.data.ifs], ['loading', 'scan', []]);
    const v = ctx.run('truck_get', { truckId: t.id }, false).view;
    assert.deepEqual(v.scan.rows, [{ item: '11', sku: 'YSN201', pallets: 2, pcs: 240, lbs: 2400, avail: 1000, short: false }]);
    assert.deepEqual([v.scan.pallets, v.scan.pcs, v.scan.tare, v.scan.total, v.scan.noWeight, v.scan.short], [2, 240, 90, 2490, 0, false]);
});

test('scan-built: Verify always matches when something is loaded, and refuses an empty truck', () => {
    const ctx = scanSetup();
    const empty = ctx.run('truck_start', { trailer: tr() }, false).view.truck.id;
    assert.throws(() => ctx.run('truck_verify', { truckId: empty }, false), /Nothing is loaded on this truck/);
    const t = scanTruck(ctx, 1);
    const r = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.equal(r.match, true);
    assert.equal(ctx.data.getLoad(t.id).status, 'ready');
});

test('scan-built: over Riverside available shows as short (a warning, not a block, on the floor)', () => {
    const ctx = scanSetup();
    ctx.data.db.stock['35']['11'].avail = 100;
    const t = scanTruck(ctx, 1);
    const v = ctx.run('truck_get', { truckId: t.id }, false).view;
    assert.deepEqual([v.scan.rows[0].short, v.scan.short], [true, true]);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).match, true);
});

test('office IFs on: a truck still needs an IF; off: office-IF actions refuse a scan truck', () => {
    const on = setup();
    assert.throws(() => on.run('truck_start', { trailer: tr() }, false), /Pick at least one IF/);
    const ctx = scanSetup();
    const t = scanTruck(ctx, 1);
    assert.throws(() => ctx.run('truck_add_if', { truckId: t.id, ifId: '1' }), /no IFs/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL. `truck_start` throws "Pick at least one IF" with office IFs off.

- [ ] **Step 3: Implement**

In `move_portal/sl_move_portal.js`:

Add near `isOpen`:

```js
    // Scan-built truck (spec 2026-10-14): no IFs; Approve creates its TO + IF.
    function isScan(x) { return !!(x && x.data && x.data.kind === 'scan'); }
    // SKU rows for the floor's Load / Verify / Shipments: loaded pallets only, with weight and Riverside available.
    function scanRows(x, ps, c) {
        const loaded = ps.filter(p => p.status === VP.LOADED), tl = verify.truckLines(loaded), items = Object.keys(tl);
        const info = data.itemInfo(items), avail = items.length ? data.locationStock(c.S.locFrom, items) : {};
        const w = verify.truckWeight(tl, info, core.palletTare(c.S), loaded.length);
        const rows = items.map(k => {
            const av = avail[k] ? Number(avail[k].avail) || 0 : 0;
            return { item: k, sku: info[k] ? info[k].sku : k, pallets: tl[k].pallets, pcs: tl[k].pcs, lbs: w.rows[k], avail: av, short: tl[k].pcs > av };
        }).sort((p, q) => p.sku < q.sku ? -1 : p.sku > q.sku ? 1 : 0);
        return { rows: rows, pallets: loaded.length, pcs: rows.reduce((s, r) => s + r.pcs, 0), tare: w.tare, total: w.total, noWeight: w.noWeight, short: rows.some(r => r.short) };
    }
```

`truck_start`: replace the two checks `if (!ids.length) throw…` and the `ifs` / `createLoad` block with:

```js
        if (!core.officeIfs(c.S)) {
            const trailer = checkTrailer(a.trailer, null);
            const id = data.createLoad({ number: 'Trailer ' + trailer, status: T.LOADING,
                data: { v3: true, kind: 'scan', ifs: [], trailer: trailer, startedBy: c.actor, startedAt: c.now.stamp, stack: [], lastStep: stepOf('started', c) } });
            return { view: truckView(mustTruck(id), c) };
        }
        if (!ids.length) throw userErr('Pick at least one IF');
```

(keep the existing trailer check and IF code after it, unchanged).

`truck_planned`: replace `planned: ns.plannedIfs().filter(…)…` with
`planned: core.officeIfs(c.S) ? ns.plannedIfs().filter(f => !taken[f.ifId]).map(f => pubIf(f, dp)) : [], officeIfs: core.officeIfs(c.S),`
(and when `officeIfs` is off, `pulledAt` stays as is).

`scanCtx`: first line `if (isScan(x)) return { truckId: x.id, trucks: scanTruckMap(allTrucks()), scanBuilt: true };`

`verifyTruck`: right after `if (!isOpen(x)) throw closedErr(x);` add:

```js
        if (isScan(x) && !data.palletsByLoad(x.id, [VP.LOADED]).length) throw userErr('Nothing is loaded on this truck');
```

`checkTruck`: at the top add:

```js
        if (isScan(x)) {                                // the scans are the order: always a match (spec 2026-10-14 §4)
            const ps = opt && opt.loadedAll ? opt.loadedAll.filter(p => String(p.loadId) === String(x.id)) : data.palletsByLoad(x.id, [VP.LOADED]);
            return { r: { match: true, keep: [], diffs: [], ifs: [] }, ps: ps, trucks: (opt && opt.trucks) || allTrucks(), planned: [] };
        }
```

`truckView`: add `scan: isScan(x) ? scanRows(x, ps, c) : null,` to the returned object.

`truck_add_if`: first line after the truck is read: `if (isScan(x)) throw userErr('This truck has no IFs: it is built from its scans');`. Read `truck_add_if` first to get its variable name for the truck.

`page()`: add `officeIfs: core.officeIfs(S)` to the `ui.buildPage({ … })` boot object.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 307 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(scan): floor start/scan/verify for scan-built trucks with weight and stock rows

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Approve writes the TO + Shipped IF; stock block; Retry / Release; Reject; receipt

**Files:**
- Modify: `move_portal/sl_move_portal.js` (`departPlan`, `ship_confirm`, `finishDepart`, `depart_release`, `approvalsView` ship items + retries)
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `verify.scanApprovePlan`, `verify.stockCheck`, `verify.stockText`, `verify.resolveNew`, `tx.toClosed`, `tx.tranIds(…, 'to')`, `isScan`, `scanRows` (Task 5).
- Produces:
  - After `on`-mode Approve the truck has load fields `to` / `if` set, and `data.toId`, `data.toNum`, `data.ifId`, `data.ifNum` set. `data.alloc` holds the real ids.
  - Approvals `shipPending[i]` gains `scan` (boolean), `lines: [{ sku, pcs }]` and `lbs` (number).
  - Approvals `retries[i]` gains `scan` and `toNum`.
  - `depart_release` on a scan truck whose TO landed requires `tx.toClosed(toId)`.

- [ ] **Step 1: Write the failing tests**

Append to `move_portal/test/portal.test.js`:

```js
function shipScan(ctx, n, mode) {
    ctx.data.db.settings.writeMode = mode || 'on';
    const t = scanTruck(ctx, n || 2);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id, seal: 'S' + t.id }, false);
    return t;
}

test('scan-built Approve (on): writes TO then Shipped IF and the receipt lands on them', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 2);
    ctx.run('ship_confirm', { truckId: t.id });
    const x = ctx.data.getLoad(t.id), d = x.data;
    const [to, f] = ctx.tx._t.ops;
    assert.deepEqual([to.op, to.orderStatus, to.fromLoc, to.toLoc, to.lines, to.token], ['to_create', 'B', '35', '99', { '11': 240 }, '[MV-' + t.id + ']']);
    assert.deepEqual([f.op, f.ship, f.toId, f.seal, f.trailer, f.lines], ['if_create', true, d.toId, 'S' + t.id, d.trailer, { '11': 240 }]);
    assert.deepEqual([x.status, x.to, x.if, d.toNum, d.ifNum], ['departed', d.toId, d.ifId, 'TO' + d.toId, 'IF' + d.ifId]);
    assert.deepEqual(d.alloc, [{ ifId: d.ifId, ifNum: 'IF' + d.ifId, toId: d.toId, toNum: 'TO' + d.toId, lines: { '11': 240 }, addOn: false }]);
    t.ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const ir = ctx.tx._t.ops[2];
    assert.deepEqual([ir.op, ir.ifId, ir.toId, ir.lines], ['receipt', d.ifId, d.toId, { '11': 240 }]);
});

test('scan-built Approve is blocked on a stock short and writes nothing', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 2);
    ctx.data.db.stock['35']['11'].avail = 100;
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }), /Can't approve: YSN201 on truck 240, available 100/);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getLoad(t.id).status, 'ship_pending');
});

test('scan-built Approve in off / qty: plan only, the truck ships in the portal, no TO', () => {
    ['off', 'qty'].forEach(m => {
        const ctx = scanSetup();
        const t = shipScan(ctx, 1, m);
        ctx.run('ship_confirm', { truckId: t.id });
        assert.equal(ctx.tx._t.ops.length, 0);
        assert.equal(ctx.data.getLoad(t.id).status, 'departed');
    });
});

test('scan-built: TO saved, IF failed → locked; Retry makes only the IF; Release needs the TO closed', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_create';             // the fake sees the resolved op, so match by op, not by key
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }), /A manager can press Retry/);
    let x = ctx.data.getLoad(t.id);
    assert.equal(x.status, 'departing');
    assert.ok(x.data.writes['to_create:' + t.id]);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: 'PLT1' }, false), /closed|waiting/);
    assert.throws(() => ctx.run('ship_sendback', { truckId: t.id, note: 'x' }), /already being processed|not waiting/);
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /Close TO/);
    ctx.run('depart_retry', { truckId: t.id });
    assert.deepEqual(ctx.tx._t.ops.map(o => o.op), ['to_create', 'if_create']);
    assert.equal(ctx.data.getLoad(t.id).status, 'departed');
});

test('scan-built: Release after the manager closed the TO puts the truck back on the floor', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_create';
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }));
    const toId = ctx.data.getLoad(t.id).data.writes['to_create:' + t.id];
    ctx.tx._t.closed[toId] = true;
    ctx.run('depart_release', { truckId: t.id });
    const x = ctx.data.getLoad(t.id);
    assert.equal(x.status, 'ready');                     // released, re-verified (scan trucks always match)
    assert.equal(x.data.writes, null);
});

test('scan-built: Reject sends the truck back to the floor with the reason', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_sendback', { truckId: t.id, note: 'take 2 YSN201 off' });
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.sentBack.note], ['loading', 'take 2 YSN201 off']);
});

test('Approvals shows a scan truck as one plain card with lines and weight', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 2);
    const s = ctx.run('approvals').shipPending.find(q => String(q.truck.id) === String(t.id));
    assert.deepEqual([s.scan, s.lines, s.lbs], [true, [{ sku: 'YSN201', pcs: 240 }], 2490]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL. `ship_confirm` builds an office plan and throws "No open transfer order covers…".

- [ ] **Step 3: Implement**

`departPlan`: right after `if (!ps.length) throw userErr('Nothing is loaded on this truck');` add:

```js
        if (isScan(x)) {
            const plan = verify.scanApprovePlan({ ref: x.id, lines: verify.linesPcs(verify.truckLines(ps)),
                stamp: { trailer: inp.trailer, seal: inp.seal, truckNo: truckNo, dayIso: c.now.dayIso }, S: c.S });
            return { truckNo: truckNo, palletKey: palletKey(ps), plan: plan, ifs: [], otherItems: x.data.otherItems || [] };
        }
```

`ship_confirm`: after `sealTaken(inp.seal, x0.id);` add the stock block:

```js
        if (isScan(x0)) {                                // spec 2026-10-14 S4: blocked before anything is claimed or written
            const tl = verify.linesPcs(verify.truckLines(data.palletsByLoad(x0.id, [VP.LOADED]))), items = Object.keys(tl);
            const st = data.locationStock(c.S.locFrom, items), avail = {};
            items.forEach(k => { avail[k] = st[k] ? Number(st[k].avail) || 0 : 0; });
            const shorts = verify.stockCheck(tl, avail);
            if (shorts.length) throw userErr('Can\'t approve: ' + verify.stockText(shorts, skuNames(items)) + '. Send it back to take pallets off, or fix stock in NetSuite and approve again.');
        }
```

`finishDepart`: change `return tx.apply(op);` to `return tx.apply(verify.resolveNew(op, writes));`. Then, before the final `data.updateLoad(… status: T.DEPARTED …)`, add:

```js
        let ids = {};
        if (isScan(x) && writes['to_create:' + x.id] && writes['if_create:new:to:' + x.id]) {   // on mode: the TO and IF exist now
            const toId = String(writes['to_create:' + x.id]), ifId = String(writes['if_create:new:to:' + x.id]);
            let toNum = 'TO ' + toId;
            try { if (tx.tranIds) toNum = tx.tranIds([toId], 'to')[toId] || toNum; } catch (e) { /* shown as the id */ }
            const ifNum = newIfNum(ifId);
            ids = { toId: toId, toNum: toNum, ifId: ifId, ifNum: ifNum,
                alloc: (x.data.alloc || []).map(a => Object.assign({}, a, { ifId: ifId, ifNum: ifNum, toId: toId, toNum: toNum })) };
        }
```

and change that final update to:

```js
        data.updateLoad(data.getLoad(x.id), Object.assign({ status: T.DEPARTED, data: Object.assign({ error: '', writes: writes, workingAt: 0, claim: '', phase: '', shortNote: null }, ids) },
            ids.toId ? { to: ids.toId, if: ids.ifId } : {}));
```

`depart_release`: in `guard`, replace the `stampWritten` line with:

```js
            if (isScan(cur)) {
                const w = cur.data.writes || {}, toId = w['to_create:' + cur.id];
                if (w['if_create:new:to:' + cur.id]) throw userErr('This truck is already in NetSuite. Press Retry to finish the departure.');
                if (toId && !tx.toClosed(toId)) throw userErr('Close TO ' + toId + ' in NetSuite first (it has no IF yet), then Release.');
            } else if (stampWritten(cur)) throw userErr('This truck is already stamped in NetSuite. Press Retry to finish the departure.');
```

`approvalsView`: in the `shipPending` map add:

```js
            const sr = isScan(x) ? scanRows(x, data.palletsByLoad(x.id, [VP.LOADED]), c) : null;
```

and to its returned object `scan: !!sr, lines: sr ? sr.rows.map(r => ({ sku: r.sku, pcs: r.pcs })) : [], lbs: sr ? sr.total : null,`. In `retries`, change `canRelease: !stampWritten(x)` to
`scan: isScan(x), canRelease: isScan(x) ? !(x.data.writes || {})['if_create:new:to:' + x.id] : !stampWritten(x), toId: isScan(x) ? (x.data.writes || {})['to_create:' + x.id] || '' : ''`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 314 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(scan): Approve creates the TO + Shipped IF; stock block; Retry/Release with TO closed check

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Late pallet on a shipped scan truck gets its own one-pallet TO + IF; Dashboard row

**Files:**
- Modify: `move_portal/sl_move_portal.js` (`pallet_accept`, new `acceptScanPallet`, `dashboard` rows)
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes: `verify.scanApprovePlan`, `verify.stockCheck`, `verify.stockText`, `verify.resolveNew`, `completeAccept(id, p, dec, c)` (existing), `newIfNum`, `isScan`.
- Produces: `acceptScanPallet(x0, p0, item, sk, pcs, c) → { outcome: 'accepted'|'refused', text, view }`. Its writes land in the truck's `data.writes` under `to_create:<id>-P<palletId>` and `if_create:new:to:<id>-P<palletId>`.

- [ ] **Step 1: Write the failing tests**

First read the existing never-loaded / pallet_accept tests in `portal.test.js` (search for `pallet_accept`) to see how they flag a pallet at unload: a labeled pallet scanned on `unload_scan` of a departed truck is flagged `never_loaded`. Then append:

```js
test('scan-built: a late pallet accepted after shipping gets a one-pallet TO + Shipped IF and a late receipt', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_confirm', { truckId: t.id });
    const late = printLabels(ctx, 1, 'Jlate')[0];
    ctx.run('unload_scan', { truckId: t.id, raw: late.code }, false);           // never loaded → flagged
    const n0 = ctx.tx._t.ops.length;
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: late.id });
    assert.equal(r.outcome, 'accepted');
    const [to, f] = ctx.tx._t.ops.slice(n0);
    const ref = t.id + '-P' + late.id;
    assert.deepEqual([to.op, to.ref, to.lines, f.op, f.ship, f.seal], ['to_create', ref, { '11': 120 }, 'if_create', true, 'S' + t.id]);
    const x = ctx.data.getLoad(t.id);
    assert.ok(x.data.writes['to_create:' + ref] && x.data.writes['if_create:new:to:' + ref]);
    assert.equal(x.data.alloc.length, 2);
    assert.equal(ctx.data.getPallet(late.id).status, 'received');
});

test('scan-built: a late pallet is refused when Riverside cannot cover it, and nothing is written', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_confirm', { truckId: t.id });
    const late = printLabels(ctx, 1, 'Jlate2')[0];
    ctx.run('unload_scan', { truckId: t.id, raw: late.code }, false);
    ctx.data.db.stock['35']['11'].avail = 10;
    const n0 = ctx.tx._t.ops.length;
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: late.id });
    assert.equal(r.outcome, 'refused');
    assert.match(r.text, /YSN201 on truck 120, available 10/);
    assert.equal(ctx.tx._t.ops.length, n0);
});

test('Dashboard lists a loading scan truck as one row with its SKUs', () => {
    const ctx = scanSetup();
    const t = scanTruck(ctx, 2);
    const row = ctx.run('dashboard').rows.find(r => String(r.truckId) === String(t.id));
    assert.deepEqual([row.ifNum, row.toNum, row.skus, row.pallets, row.pcs], ['—', '—', [{ sku: 'YSN201', qty: 240 }], 2, 240]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/portal.test.js"`
Expected: FAIL. The accept goes down the office path ("no open TO covers"), and the dashboard has no row for the scan truck.

- [ ] **Step 3: Implement**

Add before `act('pallet_accept', …)`:

```js
    // Spec 2026-10-14 S13: a scan-built truck has no office TO to add to, so the pallet gets its own TO + Shipped IF, stamped like its truck.
    function acceptScanPallet(x0, p0, item, sk, pcs, c) {
        const st = data.locationStock(c.S.locFrom, [item]), shorts = verify.stockCheck({ [item]: pcs }, { [item]: st[item] ? Number(st[item].avail) || 0 : 0 });
        if (shorts.length) return { outcome: 'refused', text: '⛔ Can\'t accept: ' + verify.stockText(shorts, { [item]: sk }), view: unloadView(x0, c) };
        const cl = claimLoad(x0, null, 'accept', decideGuard, {});
        const id = cl.Ld.id, claim = cl.claim, label = truckLabel(cl.Ld);
        try { mustFlaggedOn(cl.Ld, p0.id); } catch (e) { dropClaim(id, claim); throw e; }
        const dep = cl.Ld.data.depart || {}, ref = id + '-P' + p0.id;
        const plan = verify.scanApprovePlan({ ref: ref, lines: { [item]: pcs }, stamp: { trailer: dep.trailer, seal: dep.seal, truckNo: dep.truckNo, dayIso: dep.day }, S: c.S });
        const writes = Object.assign({}, cl.Ld.data.writes);
        try {
            verify.runOps(plan.ops, writeMode(c), o => { assertClaim(id, claim, label, 'accept'); return tx.apply(verify.resolveNew(o, writes)); }, writes,
                (k, newId) => { writes[k] = String(newId); data.updateLoad(data.getLoad(id), { data: { writes: writes } }); });
        } catch (e) {
            if (e.user) throw e;
            log.error({ title: 'move pallet_accept ' + id, details: (e && e.stack) || String(e) });
            dropClaim(id, claim);
            throw userErr('Accept refused: ' + (e.message || e) + ' — fix it in NetSuite and accept again');
        }
        try {
            const toId = writes['to_create:' + ref], ifId = writes['if_create:new:to:' + ref];
            let toNum = toId ? 'TO ' + toId : '(new TO)';
            try { if (toId && tx.tranIds) toNum = tx.tranIds([String(toId)], 'to')[String(toId)] || toNum; } catch (e) { /* shown as the id */ }
            const dec = { kind: 'accepted', ifId: ifId ? String(ifId) : 'new:' + ref, ifNum: ifId ? newIfNum(ifId) : '(plan)', toId: toId ? String(toId) : 'new:to:' + ref, toNum: toNum,
                item: item, sku: sk, pcs: pcs, by: c.user, at: c.now.stamp };
            dec.text = acceptText(dec);
            unloadFromOther(data.getPallet(p0.id), c);
            completeAccept(id, data.getPallet(p0.id), dec, c);
            assertClaim(id, claim, label, 'accept');
            data.updateLoad(data.getLoad(id), { data: { claim: '', workingAt: 0, phase: '' } });
            return { outcome: 'accepted', text: dec.text, view: unloadView(mustTruck(id), c) };
        } catch (e) { dropClaim(id, claim); throw e; }
    }
```

In `pallet_accept`, after the `const sk = …` line, add:

```js
        if (isScan(x0)) return acceptScanPallet(x0, p0, item, sk, pcs, c);
```

In the `dashboard` action, inside `active.forEach` in the `else` branch (no departure), add before `const live = …`:

```js
                if (isScan(x)) {
                    const ps = loadedAll[String(x.id)] || [], tl = verify.truckLines(ps), sk = skuNames(Object.keys(tl));
                    rows.push(Object.assign({}, base, { ifId: '', ifNum: '—', toNum: '—', skus: Object.keys(tl).map(k => ({ sku: sk[k] || k, qty: tl[k].pcs })),
                        pallets: ps.length, pcs: Object.keys(tl).reduce((s, k) => s + tl[k].pcs, 0), received: null }));
                    return;
                }
```

(The sort compares `Number(p.ifId)`, so `''` sorts as 0, which is fine.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 317 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(scan): late pallet after shipping gets its own TO + Shipped IF; dashboard row for scan trucks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Label rows from a sheet: preview with warnings (move_verify + `labels_preview`)

**Files:**
- Modify: `move_portal/move_verify.js` (new `labelRows`)
- Modify: `move_portal/sl_move_portal.js` (new action `labels_preview`)
- Test: `move_portal/test/verify.test.js`, `move_portal/test/portal.test.js`

**Interfaces:**
- Produces:
  - `verify.labelRows(rows, ctx) → { rows: [{ n, sku, item, pcs, pallets, odd, total, labels, status: 'ok'|'warn'|'skip', msg, cfg }], labels, over }`. Input `rows` = `[{ sku, pcs, pallets, odd }]` (raw cell values). `ctx` = `{ skuMap: { SKU_UPPER: item }, items: { item: { sku } }, avail: { item: n }, labeled: { item: pcs }, cfg: { item: code }, maxPrint }`.
  - Action `labels_preview` (manager): `{ rows }` in, `verify.labelRows` result out. It also serves the single-SKU form's warning.

- [ ] **Step 1: Write the failing tests**

Append to `move_portal/test/verify.test.js`:

```js
test('labelRows: ok / warn on a running total / skip, labels with odd pallets, cap', () => {
    const ctx = { skuMap: { YSN201: '11', YSN401: '13', '201': '20' }, items: { '11': { sku: 'YSN201' }, '13': { sku: 'YSN401' }, '20': { sku: '201' } },
        avail: { '11': 720, '13': 2000, '20': 5 }, labeled: { '11': 288 }, cfg: { '11': 'A' }, maxPrint: 250 };
    const r = verify.labelRows([
        { sku: ' ysn401 ', pcs: '36', pallets: '20', odd: '' },
        { sku: 'YSN201', pcs: 72, pallets: 4, odd: 18 },            // 306 of 432 left
        { sku: 'YSN201', pcs: 72, pallets: 2, odd: '' },            // running 450 > 432 → warn
        { sku: 'NOPE', pcs: 10, pallets: 1 },
        { sku: 'YSN401', pcs: 36, pallets: 0 },
        { sku: '', pcs: '', pallets: '' },
        { sku: 201, pcs: 5, pallets: 1 }
    ], ctx);
    assert.deepEqual(r.rows.map(x => [x.n, x.status, x.labels]), [[2, 'ok', 20], [3, 'ok', 5], [4, 'warn', 2], [5, 'skip', 0], [6, 'skip', 0], [8, 'ok', 1]]);
    assert.equal(r.rows[2].msg, 'YSN201: 450 pcs labeled after this, Riverside shows 432 unlabeled');
    assert.equal(r.rows[3].msg, 'Unknown SKU NOPE');
    assert.equal(r.rows[4].msg, 'Pallets must be 1 or more');
    assert.deepEqual([r.rows[1].total, r.rows[1].cfg, r.labels, r.over], [306, 'A', 28, false]);
    assert.equal(verify.labelRows([{ sku: 'YSN401', pcs: 1, pallets: 251 }], ctx).over, true);
});
```

Row numbers `n` are sheet rows: header = row 1, so the first data row is `n: 2`. A fully blank row (row 7 here) is dropped without a message.

Append to `move_portal/test/portal.test.js`:

```js
test('labels_preview checks rows against NetSuite stock and is managers only', () => {
    const ctx = setup();
    printLabels(ctx, 2);                                   // 240 YSN201 labeled already; avail 1000
    const r = ctx.run('labels_preview', { rows: [{ sku: 'YSN201', pcs: 120, pallets: 7, odd: 0 }] });
    assert.deepEqual([r.rows[0].status, r.rows[0].total, r.labels], ['warn', 840, 7]);
    assert.throws(() => ctx.run('labels_preview', { rows: [] }, false), /Managers only/);
    assert.throws(() => ctx.run('labels_preview', { rows: new Array(501).fill({ sku: 'YSN201', pcs: 1, pallets: 1 }) }), /500 rows/);
});
```

(1000 − 240 = 760 unlabeled; 7 × 120 = 840 → warn.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/verify.test.js" "move_portal/test/portal.test.js"`
Expected: FAIL. `verify.labelRows is not a function`, and `Unknown action: labels_preview`.

- [ ] **Step 3: Implement**

`move_portal/move_verify.js`:

```js
    // Excel / single-SKU label preview (spec 2026-10-14 §6). Warnings never block; only an unmatched row is skipped.
    function labelRows(rows, ctx) {
        const out = [], used = {};
        let labels = 0;
        const int = v => { const s = String(v == null ? '' : v).trim(); return s === '' ? 0 : Math.floor(Number(s)); };
        (rows || []).forEach((r, i) => {
            const n = i + 2, raw = String(r.sku == null ? '' : r.sku).trim();
            const pcs = int(r.pcs), pallets = int(r.pallets), odd = int(r.odd);
            if (!raw && !pcs && !pallets && !odd) return;                                    // a blank sheet row
            const item = (ctx.skuMap || {})[raw.toUpperCase()] || '', sku = item && ctx.items[item] ? ctx.items[item].sku : raw;
            const row = { n: n, sku: sku, item: item, pcs: pcs, pallets: pallets, odd: odd > 0 ? odd : 0, total: 0, labels: 0, status: 'ok', msg: '', cfg: (ctx.cfg || {})[item] || '' };
            if (!item) { row.status = 'skip'; row.msg = 'Unknown SKU ' + (raw || '(blank)'); out.push(row); return; }
            if (!(pcs >= 1)) { row.status = 'skip'; row.msg = 'Pcs per pallet must be 1 or more'; out.push(row); return; }
            if (!(pallets >= 1) && !(odd >= 1)) { row.status = 'skip'; row.msg = 'Pallets must be 1 or more'; out.push(row); return; }
            row.labels = Math.max(0, pallets) + (row.odd ? 1 : 0);
            row.total = Math.max(0, pallets) * pcs + row.odd;
            used[item] = (used[item] || 0) + row.total;
            const left = (Number((ctx.avail || {})[item]) || 0) - (Number((ctx.labeled || {})[item]) || 0);
            if (used[item] > left) { row.status = 'warn'; row.msg = sku + ': ' + fmt(used[item]) + ' pcs labeled after this, Riverside shows ' + fmt(Math.max(0, left)) + ' unlabeled'; }
            labels += row.labels;
            out.push(row);
        });
        return { rows: out, labels: labels, over: labels > (Number(ctx.maxPrint) || 250) };
    }
```

Export `labelRows`. Check that the module's `fmt` formats 450 as `'450'` and 1,000 as `'1,000'`; the test messages use values under 1,000.

`move_portal/sl_move_portal.js`, after the `print_chunk` action:

```js
    // Spec 2026-10-14 §6: one preview for the Excel upload and the single-SKU form. Nothing is created here (Print uses print_chunk).
    act('labels_preview', true, (a, c) => {
        const rows = Array.isArray(a.rows) ? a.rows : [];
        if (rows.length > 500) throw userErr('Too many rows (500 rows max per file)');
        const skuMap = data.skuMap(), items = [...new Set(rows.map(r => skuMap[String(r.sku == null ? '' : r.sku).trim().toUpperCase()]).filter(Boolean))];
        const info = data.itemInfo(items), st = items.length ? data.locationStock(c.S.locFrom, items) : {}, avail = {}, cfg = {};
        const cs = data.configsByItem(c.S.activeBatch);
        items.forEach(k => { avail[k] = st[k] ? Number(st[k].avail) || 0 : 0; const d = (cs[k] || []).find(x => x.isDefault) || (cs[k] || [])[0]; if (d) cfg[k] = d.code; });
        return verify.labelRows(rows, { skuMap: skuMap, items: info, avail: avail, labeled: data.labeledPiecesByItem(), cfg: cfg, maxPrint: Number(c.S.maxPrint) || 250 });
    });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 319 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/sl_move_portal.js move_portal/test/verify.test.js move_portal/test/portal.test.js
git commit -m "feat(labels): labels_preview with running over-stock warnings, skips and the print cap

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Floor screens for scan-built trucks (move_ui)

**Files:**
- Modify: `move_portal/move_ui.js` (`truckList`, `ACT.starttruck`, `paintTruck`, `stageHtml`, `shipCard`, new `scanTable`)
- Test: `move_portal/test/ui.test.js`

**Interfaces:**
- Consumes: boot `B.officeIfs`; `truck_planned.officeIfs`; `truckView.scan` (Task 5).
- Produces: client functions `scanTable(sc, opt)`, and actions `ACT.finishload` (→ Verify) and `ACT.goship` (existing).

- [ ] **Step 1: Write the failing test**

Append to `move_portal/test/ui.test.js`:

```js
test('scan-built floor screens: no IF list when office IFs are off, Finish loading, weight on Verify, Finish → Shipments', () => {
    const src = ui._clientMain.toString();
    ['function scanTable(', 'ACT.finishload', 'Finish loading', 'Finish → Shipments', 'r.officeIfs', 'Start Trailer', 'pallets × ', 'without weight', 'Approve will be blocked']
        .forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL `missing function scanTable(`.

- [ ] **Step 3: Implement**

In `move_portal/move_ui.js`, add next to `ifRow`:

```js
        // Scan-built truck (spec 2026-10-14): SKU rows with pallets, pcs, weight and Riverside available.
        function scanTable(sc, opt) {
            opt = opt || {};
            const lb = n => n == null ? '<span class="muted">no weight</span>' : num(n) + ' lb';
            return '<table class="tbl"><tr><th>SKU</th><th>Pallets</th><th>Pcs</th>' + (opt.weight ? '<th>Weight</th>' : '') + (opt.avail ? '<th>Riverside avail.</th>' : '') + '</tr>' +
                sc.rows.map(r => '<tr class="' + (r.short && opt.avail ? 'warnrow' : '') + '"><td>' + esc(r.sku) + '</td><td>' + num(r.pallets) + '</td><td>' + num(r.pcs) + '</td>' +
                    (opt.weight ? '<td>' + lb(r.lbs) + '</td>' : '') + (opt.avail ? '<td>' + num(r.avail) + (r.short ? ' ⚠' : '') + '</td>' : '') + '</tr>').join('') +
                (opt.weight ? '<tr><td class="muted">Pallets (tare)</td><td class="muted">' + num(sc.pallets) + ' pallets × ' + num(sc.pallets ? sc.tare / sc.pallets : 0) + '</td><td></td><td class="muted">' + num(sc.tare) + ' lb</td>' + (opt.avail ? '<td></td>' : '') + '</tr>' +
                    '<tr><td><b>Total</b></td><td><b>' + num(sc.pallets) + '</b></td><td><b>' + num(sc.pcs) + '</b></td><td><b>' + num(sc.total) + ' lb</b>' +
                    (sc.noWeight ? ' <span class="muted">+ ' + sc.noWeight + ' SKU' + (sc.noWeight > 1 ? 's' : '') + ' without weight</span>' : '') + '</td>' + (opt.avail ? '<td></td>' : '') + '</tr>' : '') +
                '</table>' + (opt.avail && sc.short ? flash('amber', '⚠ More than Riverside has available', 'Approve will be blocked: take pallets off or call the office') : '');
        }
```

In `truckList`, replace the planned-IF section and button so that when `r.officeIfs` is false only the trailer picker shows:

```js
                (r.officeIfs ? '<h3>Planned trucks · Picked/Packed IFs</h3><div class="card plist">' + (r.planned.map(f => ifRow(f, true)).join('') || '<div class="muted">No planned IFs. The office creates them in NetSuite.</div>') + '</div>' : '<h3>Start a truck</h3>') +
                trailerHtml(r.trailers) + '<div id="tmsg"></div><button class="btn pri" data-act="starttruck">' + (r.officeIfs ? 'Start truck with selected IFs' : 'Start Trailer') + '</button>' +
```

In `ACT.starttruck`, change the IF check to `if (B.officeIfs && !ids.length) { … }`, and send `ifIds: ids` as before (the server ignores it when office IFs are off).

In `paintTruck`, replace the `$('tlines').innerHTML = …` assignment with:

```js
            $('tlines').innerHTML = v.scan ? (v.scan.rows.length ? scanTable(v.scan) : '<div class="muted">Scan pallets to load them</div>') :
                '<table class="tbl"><tr><th>IF</th><th>SKU</th><th>Scanned / expected</th></tr>' +
```

and keep the existing office-IF table expression after it.

In `stageHtml`, add at the top (after `const err = …`):

```js
            if (v.scan && st === 'loading') return err + '<button class="btn pri" data-act="finishload">Finish loading</button>' + undo;
            if (v.scan && st === 'ready') return err + '<div class="card greenc"><h4>Verify load</h4>' + when + scanTable(v.scan, { weight: true, avail: true }) +
                '<div class="muted">Check this against the trailer. Scanning or taking a pallet off sends it back to loading.</div>' +
                '<button class="btn go" data-act="goship">Finish → Shipments</button></div>' + undo;
```

Add the action (next to `ACT.goship`):

```js
        ACT.finishload = async el => { if (needWho()) return; busy(el, true); const r = await api('truck_verify', { truckId: S.truckId }); busy(el, false);
            if (!r.ok) { $('scanres').innerHTML = errBox(r.error); return; } paintTruck(r.view, false); };
```

A scan or take-off on a ready truck must send it back to `loading`. Check in `truck_scan` / `takeOff` / `truck_remove` (`touched`) that a pallet change already resets READY to LOADING. If not, add `status: T.LOADING` to the `touched` update for open trucks. Read `touched` first (sl ~229). If you change it, add a portal test: "scan-built: a scan after Verify sends the truck back to loading".

In `shipCard`, when `v.scan`, replace the IFs line with the weight:

```js
                '<div class="muted">' + esc('Trailer ' + (v.trailer || '')) + (v.scan ? ' · ' + num(v.scan.total) + ' lb' : ' · IFs ' + esc(ifs.join(', '))) + '</div>' +
```

and change the button text to `'🚚 Mark shipped · send for approval'` when `v.scan`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 320 tests (321 with the optional `touched` test).

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/sl_move_portal.js move_portal/test/ui.test.js move_portal/test/portal.test.js
git commit -m "feat(ui): floor screens for scan-built trucks: trailer-only start, Finish loading, Verify with weight

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Manager screens: Approve / Reject card, Retry / Release text, Labels (odd pallet, warn, Excel)

**Files:**
- Modify: `move_portal/move_ui.js` (`shipConfirmCard`, `paintApprove` retries, `labelSku`, `ACT.skuprint`, new `labelUpload`, `SCREENS.labels`)
- Test: `move_portal/test/ui.test.js`

**Interfaces:**
- Consumes: approvals `shipPending[i].scan/lines/lbs`, `retries[i].scan/toId` (Task 6); action `labels_preview` (Task 8); `printMany(specs, source, msgEl)` (existing).
- Produces: client `labelUpload(box)`, `readSheet(file) → Promise<rows>`, `ACT.xlsxpick`, `ACT.xlsxprint`, `ACT.xlsxtemplate`.

- [ ] **Step 1: Write the failing test**

Append to `move_portal/test/ui.test.js`:

```js
test('manager screens: plain Approve / Reject card, Excel label upload, odd pallet, over-stock warning', () => {
    const src = ui._clientMain.toString();
    ['✅ Approve', '↩ Reject', 'function labelUpload(', 'function readSheet(', 'xlsx/0.18.5/xlsx.full.min.js', "api('labels_preview'", 'Odd pallet', 'You can still print',
        'Download template', 'Close TO ', 'pcs per pallet', 'odd pallet pcs'].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "move_portal/test/ui.test.js"`
Expected: FAIL `missing ✅ Approve`.

- [ ] **Step 3: Implement**

`shipConfirmCard(x)`: at the top add the scan-truck card:

```js
            if (x.scan) {
                const id = esc(x.truck.id), lab = esc(x.truck.label);
                return '<div class="card bl"><h4>🚚 ' + lab + '</h4><div class="muted">' + esc(['Seal ' + x.seal, 'sent ' + (x.markedAt || '') + ' by ' + (x.markedBy || '?')].join(' · ')) + '</div>' +
                    '<div class="muted">' + esc(x.lines.map(l => l.sku + ' × ' + num(l.pcs)).join(' · ')) + ' · ' + num(x.pallets) + ' pallets' + (x.lbs != null ? ' · ' + num(x.lbs) + ' lb' : '') + '</div>' +
                    '<div class="row2"><button class="dbtn go" data-act="apconfirm" data-id="' + id + '" data-label="' + lab + '">✅ Approve</button>' +
                    '<button class="dbtn gh" data-act="apsendback" data-id="' + id + '" data-label="' + lab + '">↩ Reject</button></div>' +
                    '<div class="muted sm">Approve writes the TO + IF to NetSuite and marks it Shipped.</div></div>';
            }
```

(`ACT.apconfirm` and `ACT.apsendback` already call `ship_confirm` / `ship_sendback`. A blocked stock check comes back as `r.error` and shows in the existing error box. Read `ACT.apsendback` to confirm it prompts for the note, and change its prompt text to `'Reason for the floor (required)'`.)

In `paintApprove`'s retries, change the release button text to
`(t.scan ? (t.toId ? 'Release (after you Close TO ' + esc(t.toId) + ' in NetSuite)' : 'Release to the floor') : 'Release to Needs IF fix')`.

**Labels.** Change `SCREENS.labels` to add an upload section right after Print a SKU:
`sec('lb_sku', 'Print a SKU') + sec('lb_xlsx', 'Upload an Excel') + …` and call `labelUpload($('lb_xlsx'));`.

In `labelSku`, add an odd-pallet input and a warning box:

```js
            box.innerHTML = '<div id="sku_edbox"></div><label class="f" for="sku_odd">Odd pallet (optional) · pcs</label><input class="inp" id="sku_odd" type="number" min="0" placeholder="e.g. 18">' +
                '<div id="skuwarn"></div><div id="skumsg"></div><button class="btn pri" data-act="skuprint">Print labels</button>';
```

`ACT.skuprint`: before printing, call the preview and show a warning without blocking:

```js
            const odd = Math.floor(Number(($('sku_odd') || {}).value) || 0), l = edPayload()[0];
            const pv = await api('labels_preview', { rows: [{ sku: l.sku, pcs: l.pcs, pallets: n, odd: odd }] });
            if (pv.ok && pv.rows[0] && pv.rows[0].status === 'warn') $('skuwarn').innerHTML = flash('amber', '⚠ ' + esc(pv.rows[0].msg) + '. You can still print.');
            const specs = [{ lines: edPayload(), n: n }].concat(odd > 0 ? [{ lines: edPayload().map(x => Object.assign({}, x, { pcs: odd })), n: 1 }] : []);
            await printMany(specs, 'office', $('skumsg'));
```

(This replaces the existing `printMany([{ lines: edPayload(), n: n }], …)` call. For a multi-line pallet, the odd pallet takes `odd` pcs on each line.)

Add the Excel upload:

```js
        // Excel / CSV upload (spec 2026-10-14 §6): SheetJS on demand from cdnjs; headers matched loosely; preview; Print all through print_chunk.
        const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        function loadXlsx() {
            if (window.XLSX) return Promise.resolve(window.XLSX);
            return new Promise((ok, bad) => { const s = document.createElement('script'); s.src = XLSX_URL; s.onload = () => ok(window.XLSX); s.onerror = () => bad(new Error('Could not load the Excel reader (no internet?). Save the sheet as .csv and upload that.')); document.head.appendChild(s); });
        }
        const HEAD = { sku: ['sku'], pcs: ['pcs per pallet', 'pcs/pallet', 'pcs'], pallets: ['pallets'], odd: ['odd pallet pcs', 'odd pallet', 'odd'] };
        function mapRows(objs) {
            if (!objs.length) return [];
            const keys = Object.keys(objs[0]), pick = names => keys.find(k => names.indexOf(String(k).trim().toLowerCase()) !== -1);
            const col = { sku: pick(HEAD.sku), pcs: pick(HEAD.pcs), pallets: pick(HEAD.pallets), odd: pick(HEAD.odd) };
            if (!col.sku || !col.pcs || !col.pallets) throw new Error('The sheet needs the columns SKU, Pcs per pallet and Pallets (Odd pallet pcs is optional)');
            return objs.map(o => ({ sku: o[col.sku], pcs: o[col.pcs], pallets: o[col.pallets], odd: col.odd ? o[col.odd] : '' }));
        }
        function csvObjs(text) {
            const lines = String(text).split(/\r?\n/).filter(l => l.trim() !== '');
            const head = lines.shift().split(',').map(s => s.trim());
            return lines.map(l => { const c = l.split(','); const o = {}; head.forEach((h, i) => { o[h] = (c[i] || '').trim(); }); return o; });
        }
        async function readSheet(file) {
            if (/\.csv$/i.test(file.name)) return mapRows(csvObjs(await file.text()));
            const X = await loadXlsx(), wb = X.read(await file.arrayBuffer(), { type: 'array' });
            return mapRows(X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }));
        }
        function labelUpload(box) {
            box.innerHTML = '<div class="muted">Columns: SKU · Pcs per pallet · Pallets · Odd pallet pcs (optional). One row per SKU (pcs per pallet, pallets, odd pallet pcs).</div>' +
                '<input type="file" id="xlsx_file" accept=".xlsx,.xls,.csv"> <button class="btn ghost sm" data-act="xlsxtemplate">Download template</button>' +
                '<div id="xlsx_out"></div>';
            $('xlsx_file').onchange = () => ACT.xlsxpick();
        }
        ACT.xlsxpick = async () => {
            const f = $('xlsx_file').files[0], out = $('xlsx_out');
            if (!f) return;
            let rows;
            try { rows = await readSheet(f); } catch (e) { out.innerHTML = errBox(e.message); return; }
            const pv = await api('labels_preview', { rows: rows });
            if (!pv.ok) { out.innerHTML = errBox(pv.error); return; }
            S.xlsx = pv;
            const pill = r => r.status === 'ok' ? '✅' : r.status === 'warn' ? '<span class="pill p-amber">⚠ ' + esc(r.msg) + '</span>' : '<span class="pill p-red">' + esc(r.msg) + ': skipped</span>';
            out.innerHTML = '<div class="muted"><b>' + esc(f.name) + '</b> · ' + pv.rows.length + ' rows read</div><table class="tbl"><tr><th>Row</th><th>SKU</th><th>Pcs/plt</th><th>Pallets</th><th>Odd</th><th>Pcs</th><th></th></tr>' +
                pv.rows.map(r => '<tr><td>' + r.n + '</td><td>' + esc(r.sku) + '</td><td>' + num(r.pcs) + '</td><td>' + num(r.pallets) + '</td><td>' + (r.odd ? num(r.odd) : '—') + '</td><td>' + num(r.total) + '</td><td>' + pill(r) + '</td></tr>').join('') + '</table>' +
                (pv.over ? errBox(pv.labels + ' labels: split the file (max ' + B.maxPrint + ' per print)') :
                    '<div class="muted">Warnings don\'t stop printing.</div><div id="xlsx_msg"></div><button class="btn pri" data-act="xlsxprint">🖨 Print all · ' + pv.labels + ' labels</button>');
        };
        ACT.xlsxprint = async el => {
            const pv = S.xlsx;
            if (!pv) return;
            const specs = [];
            pv.rows.filter(r => r.status !== 'skip').forEach(r => {
                const line = { item: r.item, sku: r.sku, cfg: r.cfg, pcs: r.pcs };
                if (r.pallets > 0) specs.push({ lines: [line], n: r.pallets });
                if (r.odd > 0) specs.push({ lines: [Object.assign({}, line, { pcs: r.odd })], n: 1 });
            });
            busy(el, true);
            await printMany(specs, 'office', $('xlsx_msg'));
            busy(el, false);
        };
        ACT.xlsxtemplate = async () => {
            try {
                const X = await loadXlsx(), ws = X.utils.aoa_to_sheet([['SKU', 'Pcs per pallet', 'Pallets', 'Odd pallet pcs']]), wb = X.utils.book_new();
                X.utils.book_append_sheet(wb, ws, 'Labels'); X.writeFile(wb, 'move-labels-template.xlsx');
            } catch (e) { alert(e.message); }
        };
```

`edPayload()` rows carry `sku` (from `newLine()`). Confirm that by reading `newLine` / `edPayload`; if they don't, read the SKU from `S.ed.lines[0].sku`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 321 tests (or 322).

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_ui.js move_portal/test/ui.test.js
git commit -m "feat(ui): Approve/Reject card, Release after TO close, labels odd pallet + warning + Excel upload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Local beta stand-in, click-through, docs

**Files:**
- Modify: `move_portal/local/snapshot_ns.js` (`applyOp` handles `to_create` and Shipped `if_create`)
- Modify: `CLAUDE.md` (handoff: state, how scan trucks work, launch checklist additions)
- Test: `move_portal/test/move_ns.test.js` (or wherever `applyOp` is tested; search for `applyOp`)

**Interfaces:**
- Consumes: ops from Task 2.
- Produces: in the beta, `on` mode Approve returns ids and the re-read sees the new IF as Shipped (status `C`).

- [ ] **Step 1: Write the failing test**

Find the existing `applyOp` test (`grep -n applyOp move_portal/test/*.js`) and add next to it:

```js
test('snapshot stand-in: to_create returns a TO id; a Shipped if_create lands as status C on that TO', () => {
    const ns = makeSnapshotNs(verify, { toLines: [], ifLines: [], items: [{ item: 11, sku: 'YSN201' }] });
    const toId = ns.applyOp({ op: 'to_create', ref: '5', lines: { '11': 72 } });
    assert.ok(Number(toId) > 0);
    const ifId = ns.applyOp({ op: 'if_create', toId: toId, ship: true, lines: { '11': 72 }, memo: 'Truck 1 · 11/02 · [MV-5]' });
    assert.ok(Number(ifId) > 0);
    // the IF is Shipped, so it is not a planned (Picked/Packed) IF
    assert.equal(ns.plannedIfs().some(f => String(f.ifId) === String(ifId)), false);
});
```

Use whatever `makeSnapshotNs` / `verify` imports the test file already has.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL (`to_create` returns undefined).

- [ ] **Step 3: Implement**

In `applyOp`, add a branch before `if_create`:

```js
        } else if (op.op === 'to_create') {
            const tl = raw.toLines = raw.toLines || [];
            const id = tl.reduce((m, r) => Math.max(m, Number(r.toid) || 0), 80000) + 1;
            Object.keys(op.lines || {}).forEach(k => tl.push({ toid: id, tonum: 'TO' + id, tostatus: 'B', trandate: new Date().toISOString().slice(0, 10), item: Number(k),
                sku: ((raw.items || []).find(i => String(i.item) === String(k)) || {}).sku || String(k), qty: Number(op.lines[k]) }));
            created = String(id);
```

and in the `if_create` branch use `status: op.ship === true ? 'C' : 'B'`.

Then run the beta and click the whole flow through:

```bash
node move_portal/test/preview_server.js --store move_portal/local/smoke-store.json --port 8798
```

Use the launch config `move-preview-smoke` (port 8798) through the preview tools instead of a shell, if available. In the smoke store's Move Settings set `officeIfs: false` and `writeMode: 'on'`. Then:
1. Manager → Labels → Print a SKU with an odd pallet, then upload a 3-row .xlsx (one row over stock: amber; one unknown SKU: skipped). Print all.
2. Floor → Start Trailer → scan 3 labels → Finish loading → Verify shows weight → Finish → Shipments → seal → Mark shipped.
3. Manager → Approvals → Approve. The message shows the new TO/IF.
4. Floor → Unload → scan in → manager Approve receipt.
5. Repeat with a forced short (lower stock in the store) → Approve shows "Can't approve…".

Delete `move_portal/local/smoke-store.json` afterwards.

Update `CLAUDE.md`:
- Replace the "BRAINSTORM PAUSED" header with "SCAN-BUILT TO + IF BUILT (2026-10-xx)". List the commit range and the test count, and keep rulings 1–13.
- In "How the portal works now", describe the scan-built floor and manager flow, `officeIfs`, and `palletTare`.
- In the prod launch steps, add: Settings JSON gets `"officeIfs":false,"palletTare":45`; check whether **TO approval routing** lets the manager role save status B (create one test TO as that role); weight units on the move SKUs (`weight` / `weightunit` filled?); Riverside bins on the IF.

- [ ] **Step 4: Run all tests**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS (all).

- [ ] **Step 5: Commit and push**

```bash
git add move_portal/local/snapshot_ns.js move_portal/test CLAUDE.md
git commit -m "feat(beta): stand-in creates scan-built TOs and Shipped IFs; docs for the scan-built flow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push origin feat/v3-verification
```

---

## After the plan (not tasks here)

The sandbox run in `on` mode, from spec §8, needs Jack's go and happens after review:
- one clean truck;
- one truck with a forced IF failure (Retry, then Release after closing the TO);
- one late pallet;
- one Excel upload.

Upload order and recipe are the same as the prod launch section in `CLAUDE.md`.
