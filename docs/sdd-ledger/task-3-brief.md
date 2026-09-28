### Task 3: Core CSV config import

**Files:**
- Modify: `move_portal/move_core.js` (fill the `(Task 3)` section and extend the `return`)
- Test: `move_portal/test/core.test.js` (append)

**Interfaces:**
- Produces:
  - `parseCsv(text) → string[][]` (trimmed cells, blank rows dropped, quotes and CRLF handled)
  - `buildConfigImport(rows, skuToItem) → {configs:[{item, sku, code, pcs, isDefault}], errors:[{row, msg}], unknownSkus:[sku]}`
  - `skuToItem` keys are UPPERCASE SKUs. Row numbers are 1-based and count the header. A `row` of 0 means an error for the whole SKU.

- [ ] **Step 1: Append the failing tests**

```js
// ── Task 3 ──
test('parseCsv handles quotes, CRLF and blank lines', () => {
    const rows = core.parseCsv('SKU,Config,Pcs,Default\r\n"YSN,201",A,120,Y\r\n\r\nYSN301, B ,"60",\n"say ""hi""",C,1,N');
    assert.deepEqual(rows, [
        ['SKU', 'Config', 'Pcs', 'Default'],
        ['YSN,201', 'A', '120', 'Y'],
        ['YSN301', 'B', '60', ''],
        ['say "hi"', 'C', '1', 'N']
    ]);
    assert.deepEqual(core.parseCsv(''), []);
});

test('buildConfigImport validates rows and resolves one default per SKU', () => {
    const skus = { YSN201: '11', YSN301: '12', YSN401: '13' };
    const rows = [
        ['SKU', 'Config', 'Pcs per pallet', 'Default'],
        ['ysn201', 'a', '120', 'Y'],
        ['YSN201', 'B', '60', 'N'],
        ['YSN301', 'A', '60', ''],
        ['NOPE', 'A', '5', 'Y'],
        ['YSN301', 'B', '0', 'N'],
        ['YSN201', 'A', '100', 'N'],
        ['YSN401', 'A', '10', 'Y'],
        ['YSN401', 'B', '20', 'yes'],
        ['', 'A', '1', 'Y']
    ];
    const r = core.buildConfigImport(rows, skus);
    assert.deepEqual(r.unknownSkus, ['NOPE']);
    assert.deepEqual(r.configs, [
        { item: '11', sku: 'YSN201', code: 'A', pcs: 120, isDefault: true },
        { item: '11', sku: 'YSN201', code: 'B', pcs: 60, isDefault: false },
        { item: '12', sku: 'YSN301', code: 'A', pcs: 60, isDefault: true },
        { item: '13', sku: 'YSN401', code: 'A', pcs: 10, isDefault: true },
        { item: '13', sku: 'YSN401', code: 'B', pcs: 20, isDefault: false }
    ]);
    assert.deepEqual(r.errors.map(e => e.row), [6, 7, 10, 0]);
    assert.match(r.errors[0].msg, /YSN301 B: pieces must be a whole number/);
    assert.match(r.errors[1].msg, /YSN201 A: duplicate config/);
    assert.match(r.errors[2].msg, /Missing SKU/);
    assert.match(r.errors[3].msg, /YSN401: more than one default, using A/);
});

test('buildConfigImport works without a header row', () => {
    const r = core.buildConfigImport([['YSN201', 'A', '120', 'Y']], { YSN201: '11' });
    assert.equal(r.configs.length, 1);
    assert.equal(r.errors.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `core.parseCsv is not a function`.

- [ ] **Step 3: Replace the `// ── (Task 3) …` line with:**

```js
    // ── CSV config import ─────────────────────────────────────────────────
    function parseCsv(text) {
        const s = String(text || '').replace(/\r\n?/g, '\n');
        const rows = [];
        let row = [], f = '', q = false;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (q) {
                if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
                else f += c;
            } else if (c === '"') q = true;
            else if (c === ',') { row.push(f); f = ''; }
            else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
            else f += c;
        }
        if (f !== '' || row.length) { row.push(f); rows.push(row); }
        return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
    }

    function buildConfigImport(rows, skuToItem) {
        const out = { configs: [], errors: [], unknownSkus: [] };
        const start = rows.length && /sku/i.test(rows[0][0] || '') ? 1 : 0;
        const bySku = {}, order = [];
        for (let i = start; i < rows.length; i++) {
            const r = rows[i], rn = i + 1;
            const sku = String(r[0] || '').toUpperCase();
            if (!sku) { out.errors.push({ row: rn, msg: 'Missing SKU' }); continue; }
            const item = skuToItem[sku];
            if (!item) { if (out.unknownSkus.indexOf(sku) === -1) out.unknownSkus.push(sku); continue; }
            const code = String(r[1] || '').toUpperCase();
            if (!code) { out.errors.push({ row: rn, msg: sku + ': missing config code' }); continue; }
            const pcs = Number(r[2]);
            if (!(pcs > 0) || Math.floor(pcs) !== pcs) { out.errors.push({ row: rn, msg: sku + ' ' + code + ': pieces must be a whole number above 0' }); continue; }
            if (!bySku[sku]) { bySku[sku] = []; order.push(sku); }
            if (bySku[sku].some(x => x.code === code)) { out.errors.push({ row: rn, msg: sku + ' ' + code + ': duplicate config' }); continue; }
            bySku[sku].push({ item: String(item), sku, code, pcs, isDefault: /^(y|yes|true|1)$/i.test(String(r[3] || '')) });
        }
        order.forEach(sku => {
            const list = bySku[sku];
            const defs = list.filter(x => x.isDefault);
            if (defs.length > 1) {
                out.errors.push({ row: 0, msg: sku + ': more than one default, using ' + defs[0].code });
                list.forEach(x => { x.isDefault = x === defs[0]; });
            }
            if (!defs.length) list[0].isDefault = true;
            list.forEach(x => out.configs.push(x));
        });
        return out;
    }
```

In the `return` object, add: `parseCsv, buildConfigImport`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_core.js move_portal/test/core.test.js
git commit -m "feat(move): CSV pallet-config import parsing and validation"
```

---

