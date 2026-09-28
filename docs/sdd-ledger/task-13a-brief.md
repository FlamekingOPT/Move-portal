# Task 12b: Barcode carries SKU + quantity (tab-separated)

New requirement from Jack (2026-09-28). The label barcode must hold more than the code, so scanning into a spreadsheet fills one column per field.

**Payload format:**
- Single-SKU pallet: `PLT<id>` TAB `<SKU>` TAB `<pcs>`, e.g. `PLT48213\tYSN201\t120`.
- Mixed pallet: every line in order, e.g. `PLT48301\tYSN330\t24\tYSN10LB\t40`.
- Human-readable text under the barcode stays just `PLT<id>`.
- The portal identifies the pallet by the leading `PLT<id>` only. Everything after the first separator is ignored for lookups, because the pallet record is the source of truth: dock edits can change the pieces after printing.

**Files:**
- Modify: `move_portal/move_core.js` (parseScan + new barcodePayload)
- Modify: `move_portal/move_label_template.js` (codeBlock / labelPage use the payload)
- Modify: `move_portal/move_ui.js` (scan inputs keep Tab)
- Test: `move_portal/test/core.test.js`, `move_portal/test/template.test.js` (append)

## Step 1: Append failing tests

To `move_portal/test/core.test.js`:
```js
// ── Task 12b ──
test('parseScan reads the pallet id from a tab/comma/pipe payload', () => {
    assert.deepEqual(core.parseScan('PLT48213\tYSN201\t120'), { raw: 'PLT48213\tYSN201\t120', palletId: 48213 });
    assert.equal(core.parseScan('plt48213,ysn201,120').palletId, 48213);
    assert.equal(core.parseScan('PLT48213|YSN201|120').palletId, 48213);
    assert.equal(core.parseScan(' PLT7\tX\t1 ').palletId, 7);
    assert.equal(core.parseScan('PLT48213X\tYSN201').palletId, null);
    assert.equal(core.parseScan('YSN201\tPLT48213').palletId, null);
});

test('barcodePayload lists code then SKU and pieces per line, tab-separated', () => {
    assert.equal(core.barcodePayload('PLT1', [{ sku: 'YSN201', pcs: 120 }]), 'PLT1\tYSN201\t120');
    assert.equal(core.barcodePayload('PLT2', [{ sku: 'YSN330', pcs: 24 }, { sku: 'YSN10LB', pcs: 40 }]), 'PLT2\tYSN330\t24\tYSN10LB\t40');
    assert.equal(core.barcodePayload('PLT3', []), 'PLT3');
});
```

To `move_portal/test/template.test.js`:
```js
// ── Task 12b ──
test('barcode value carries code, SKU and pieces with tabs as XML char refs', () => {
    const x = tpl.labelsXml([lab('PLT9', A)], O);
    assert.equal(count(x, 'value="PLT9&#9;YSN201&#9;120"'), 2);
    assert.match(x, />PLT9<\/p>/);
    const mixed = tpl.labelsXml([lab('PLT10', A.concat(B))], O);
    assert.match(mixed, /value="PLT10&#9;YSN201&#9;120&#9;YSN301&#9;60"/);
    assert.equal(x.indexOf('\t'), -1);
});
```

Remove the now-stale assertion `assert.match(both, /value="PLT9"/);` from the existing test 'code mode controls which barcodes print' in template.test.js. The value is no longer just the code, and the new test covers it.

Run: `node --test "move_portal/test/*.test.js"` → expect FAIL (barcodePayload missing, parseScan too strict, template value).

## Step 2: move_core.js

Replace the body of `parseScan` with:
```js
    function parseScan(raw) {
        const s = String(raw == null ? '' : raw).trim().toUpperCase();
        const m = /^PLT(\d+)(?:[\t,|]|$)/.exec(s);
        const id = m ? Number(m[1]) : 0;
        return { raw: s, palletId: id > 0 ? id : null };
    }
```
Add, right after parseScan:
```js
    // What the barcode encodes: label code, then SKU and pieces for each line, TAB-separated,
    // so a keyboard-mode scanner fills one spreadsheet column per field.
    function barcodePayload(code, lines) {
        return [String(code)].concat(...(lines || []).map(l => [String(l.sku), String(l.pcs)])).join('\t');
    }
```
Add `barcodePayload` to the returned object.

## Step 3: move_label_template.js

The template has no dependency on move_core, so keep it that way and build the payload locally.
- Change `function codeBlock(code, mode)` to `function codeBlock(code, payload, mode)`.
- Inside it, compute `const val = esc(payload).replace(/\t/g, '&#9;');` and use `val` in BOTH `value="..."` attributes (code128 and qrcode) instead of `esc(code)`. The `text` paragraph keeps `esc(code)`.
- In `labelPage`, change the call to `codeBlock(l.code, [l.code].concat(...l.lines.map(x => [x.sku, x.pcs])).join('\t'), o.codeMode || 'both')`.

A literal tab inside an XML attribute is normalized to a space by XML parsers, which is why it must be the `&#9;` character reference.

## Step 4: move_ui.js (browser)

Scanners in keyboard mode send the TAB separators as Tab key presses. A Tab would move focus out of the scan box, split the scan, and lose data. Keep it in the field:
1. In `wireScan`'s `i.onkeydown`, before the Enter check, add:
```js
                if (e.key === 'Tab') { e.preventDefault(); i.value += '\t'; return; }
```
2. In `palletTool`'s `i.onkeydown` (the `ptcode` input), before the Enter check, add:
```js
                if (e.key === 'Tab') { e.preventDefault(); i.value += '\t'; return; }
```
3. In `loadResultHtml` and `recvResultHtml`, the unknown-label message shows `r.raw`. Make tabs visible there: change `esc('"' + r.raw + '"')` to `esc('"' + String(r.raw).replace(/\t/g, ' ⇥ ') + '"')` in both functions.

## Step 5: Verify and commit
Run: `node --test "move_portal/test/*.test.js"` → expect PASS, 55 tests. Run `node --check` on the three modified modules.
```bash
git add move_portal/move_core.js move_portal/move_label_template.js move_portal/move_ui.js move_portal/test/core.test.js move_portal/test/template.test.js
git commit -m "feat(move): barcode carries code+SKU+qty tab-separated; scan fields keep Tab"
```
