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

