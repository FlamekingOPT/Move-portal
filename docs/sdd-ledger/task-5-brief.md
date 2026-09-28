### Task 5: Label, header-card and load-sheet XML

**Files:**
- Create: `move_portal/move_label_template.js`
- Test: `move_portal/test/template.test.js`

**Interfaces:**
- Produces:
  - `labelsXml(labels, opts) → BFO XML string`
    - `labels` is `[{code, lines:[{sku, cfg, pcs, desc}], pieces, edited, printedDay, by, summary}]`.
    - `opts` is `{codeMode:'both'|'c128'|'qr', header:boolean, fromName, toName}`.
    - Pages are joined with `<pbr/>`. With `header`, a batch header card goes before each run of consecutive labels with the same `summary`.
  - `loadSheetXml(model)`
    - `model` is `{number, fromName, toName, toNumber, ifNumber, door, carrier, trailer, seal, approvedAt, approvedBy, pallets:[{code, summary, pieces}], totals:[{sku, qty}]}`.
  - `esc(s)`, `skuSize(sku)`.

- [ ] **Step 1: Write the failing tests**

```js
// move_portal/test/template.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const tpl = loadAmd('move_label_template.js');

const lab = (code, lines, extra) => Object.assign({
    code, lines, pieces: lines.reduce((a, l) => a + l.pcs, 0), edited: false, printedDay: '2026-10-14', by: 'Miguel',
    summary: lines.map(l => l.sku + l.pcs).join('+')
}, extra || {});
const A = [{ sku: 'YSN201', cfg: 'A', pcs: 120, desc: '20# LP Cylinder' }];
const B = [{ sku: 'YSN301', cfg: '', pcs: 60, desc: '30#' }];
const O = { codeMode: 'both', header: false, fromName: 'Riverside', toName: 'Tippecanoe' };
const count = (s, sub) => s.split(sub).length - 1;

test('one page per label, header card per run of identical labels', () => {
    const labels = [lab('PLT1', A), lab('PLT2', A), lab('PLT3', B)];
    const plain = tpl.labelsXml(labels, O);
    assert.equal(count(plain, '<pbr/>'), 2);
    assert.equal(count(plain, 'BATCH HEADER'), 0);
    const withHdr = tpl.labelsXml(labels, Object.assign({}, O, { header: true }));
    assert.equal(count(withHdr, '<pbr/>'), 4);
    assert.equal(count(withHdr, 'BATCH HEADER'), 2);
    assert.match(withHdr, /2 labels/);
    assert.match(withHdr, /PLT1 - PLT2/);
    assert.ok(withHdr.startsWith('<?xml'));
    assert.match(withHdr, /<body width="4in" height="6in"/);
});

test('code mode controls which barcodes print', () => {
    const one = [lab('PLT9', A)];
    const both = tpl.labelsXml(one, O);
    assert.equal(count(both, 'codetype="code128"'), 1);
    assert.equal(count(both, 'codetype="qrcode"'), 1);
    const c128 = tpl.labelsXml(one, Object.assign({}, O, { codeMode: 'c128' }));
    assert.equal(count(c128, 'codetype="qrcode"'), 0);
    const qr = tpl.labelsXml(one, Object.assign({}, O, { codeMode: 'qr' }));
    assert.equal(count(qr, 'codetype="code128"'), 0);
    assert.match(qr, /width="1.5in"/);
    assert.match(both, /value="PLT9"/);
});

test('single, custom, mixed and edited labels', () => {
    const x = tpl.labelsXml([lab('PLT1', A), lab('PLT2', B, { edited: true }), lab('PLT3', A.concat(B))], O);
    assert.match(x, /Config A/);
    assert.match(x, /Custom/);
    assert.match(x, /MIXED/);
    assert.match(x, /180 pcs/);
    assert.equal(count(x, 'EDITED'), 1);
    assert.match(x, /RIVERSIDE &gt; TIPPECANOE/);
});

test('text is XML-escaped', () => {
    const x = tpl.labelsXml([lab('PLT1', [{ sku: 'A&B<1>', cfg: 'A', pcs: 1, desc: '"q"' }])], O);
    assert.match(x, /A&amp;B&lt;1&gt;/);
    assert.match(x, /&quot;q&quot;/);
    assert.equal(x.indexOf('A&B<1>'), -1);
    assert.equal(tpl.skuSize('YSN201'), 48);
    assert.equal(tpl.skuSize('YSNEZFSTND2.0'), 30);
});

test('load sheet lists totals, pallets and signature lines', () => {
    const x = tpl.loadSheetXml({ number: 'MV-014', fromName: 'Riverside', toName: 'Tippecanoe', toNumber: 'TO9412', ifNumber: 'IF72031',
        door: '4', carrier: 'Estes', trailer: '53-1', seal: '9', approvedAt: '10/14/2026 2:14 pm', approvedBy: 'Jack',
        pallets: [{ code: 'PLT1', summary: 'YSN201 · A · 120', pieces: 120 }], totals: [{ sku: 'YSN201', qty: 120 }] });
    assert.match(x, /Move load sheet · MV-014/);
    assert.match(x, /TO9412/);
    assert.match(x, /Pallets \(1\)/);
    assert.match(x, /Driver signature/);
    assert.match(x, /size="Letter"/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `ENOENT ... move_label_template.js`.

- [ ] **Step 3: Write `move_label_template.js`**

```js
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: BFO XML for 4x6 pallet labels, batch header cards and the load sheet.
 * Pure string building (no N/ modules) so it is unit-tested in node.
 */
define([], function () {
    'use strict';
    const HEAD = '<?xml version="1.0"?>\n<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">\n';

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function skuSize(sku) { const n = String(sku || '').length; return n <= 7 ? 48 : n <= 10 ? 38 : n <= 13 ? 30 : 24; }
    function cfgText(l) { return l.cfg ? 'Config ' + l.cfg : 'Custom'; }

    function codeBlock(code, mode) {
        const text = '<p align="center" style="font-family:Courier;font-size:14pt;font-weight:bold">' + esc(code) + '</p>';
        const c128 = '<barcode codetype="code128" showtext="false" value="' + esc(code) + '" width="3.5in" height="0.9in"/>';
        const qrSize = mode === 'qr' ? '1.5in' : '1.1in';
        const qr = '<barcode codetype="qrcode" value="' + esc(code) + '" width="' + qrSize + '" height="' + qrSize + '"/>';
        let rows = '';
        if (mode !== 'qr') rows += '<tr><td align="center">' + c128 + '</td></tr><tr><td align="center">' + text + '</td></tr>';
        if (mode !== 'c128') rows += '<tr><td align="center" style="padding-top:4pt">' + qr + '</td></tr>';
        if (mode === 'qr') rows += '<tr><td align="center">' + text + '</td></tr>';
        return '<table width="100%" style="margin-top:8pt">' + rows + '</table>';
    }

    function labelPage(l, o) {
        const top = '<table width="100%" style="border-bottom:2pt solid #000"><tr>' +
            '<td style="font-size:12pt;font-weight:bold">MOVE</td>' +
            '<td align="right" style="font-size:12pt;font-weight:bold">' + esc(String(o.fromName).toUpperCase()) +
            ' &gt; ' + esc(String(o.toName).toUpperCase()) + '</td></tr></table>';
        let mid;
        if (l.lines.length === 1) {
            const s = l.lines[0];
            mid = '<p style="font-size:' + skuSize(s.sku) + 'pt;font-weight:bold;margin-top:8pt">' + esc(s.sku) + '</p>' +
                '<p style="font-size:18pt;font-weight:bold">' + esc(cfgText(s)) + '</p>' +
                '<p style="font-size:36pt;font-weight:bold;margin-top:4pt">' + esc(s.pcs) + ' pcs</p>' +
                '<p style="font-size:11pt;margin-top:4pt">' + esc(s.desc || '') + '</p>';
        } else {
            mid = '<p style="font-size:40pt;font-weight:bold;margin-top:8pt">MIXED</p><table width="100%" style="margin-top:4pt">' +
                l.lines.map(x => '<tr><td style="font-size:16pt;font-weight:bold;border-bottom:0.5pt solid #999">' + esc(x.sku) +
                    '</td><td align="right" style="font-size:16pt;font-weight:bold;border-bottom:0.5pt solid #999">' + esc(x.pcs) + ' pcs</td></tr>').join('') +
                '<tr><td style="font-size:16pt">Total</td><td align="right" style="font-size:16pt">' + esc(l.pieces) + ' pcs</td></tr></table>';
        }
        const foot = '<table width="100%" style="border-top:0.5pt solid #000;margin-top:6pt"><tr>' +
            '<td style="font-size:9pt">printed ' + esc(l.printedDay) + (l.by ? ' · ' + esc(l.by) : '') + '</td>' +
            '<td align="right" style="font-size:12pt;font-weight:bold">' + (l.edited ? 'EDITED' : '') + '</td></tr></table>';
        return top + mid + codeBlock(l.code, o.codeMode || 'both') + foot;
    }

    function headerPage(first, last, n) {
        const s = first.lines[0] || {};
        const single = first.lines.length === 1;
        const title = single ? s.sku : 'MIXED';
        const sub = single ? cfgText(s) + ' · ' + s.pcs + ' pcs' : first.summary;
        return '<p align="center" style="font-size:14pt;margin-top:0.8in">BATCH HEADER</p>' +
            '<p align="center" style="font-size:' + skuSize(title) + 'pt;font-weight:bold;margin-top:8pt">' + esc(title) + '</p>' +
            '<p align="center" style="font-size:18pt;font-weight:bold">' + esc(sub) + '</p>' +
            '<p align="center" style="font-size:32pt;font-weight:bold;margin-top:14pt">' + n + ' labels</p>' +
            '<p align="center" style="font-size:11pt;margin-top:8pt">' + esc(first.code) + ' - ' + esc(last.code) + '</p>';
    }

    function labelsXml(labels, o) {
        const pages = [];
        let i = 0;
        while (i < labels.length) {
            let j = i;
            while (j + 1 < labels.length && labels[j + 1].summary === labels[i].summary) j++;
            if (o.header) pages.push(headerPage(labels[i], labels[j], j - i + 1));
            for (let k = i; k <= j; k++) pages.push(labelPage(labels[k], o));
            i = j + 1;
        }
        return HEAD + '<pdf><head><style>p { margin: 0; }</style></head>' +
            '<body width="4in" height="6in" padding="0.15in" font-family="Helvetica">' + pages.join('<pbr/>') + '</body></pdf>';
    }

    function loadSheetXml(m) {
        const row = (a, b) => '<tr><td width="50%">' + a + '</td><td>' + b + '</td></tr>';
        return HEAD + '<pdf><head><style>td, th { padding: 3pt; } th { border-bottom: 1pt solid #000; }</style></head>' +
            '<body size="Letter" padding="0.5in" font-family="Helvetica" font-size="10pt">' +
            '<p style="font-size:18pt;font-weight:bold">Move load sheet · ' + esc(m.number) + '</p>' +
            '<table width="100%" style="margin-top:8pt">' +
            row('From: <b>' + esc(m.fromName) + '</b>', 'To: <b>' + esc(m.toName) + '</b>') +
            row('Transfer order: <b>' + esc(m.toNumber) + '</b>', 'Fulfillment: <b>' + esc(m.ifNumber) + '</b>') +
            row('Door: ' + esc(m.door), 'Carrier: ' + esc(m.carrier)) +
            row('Trailer: ' + esc(m.trailer), 'Seal: ' + esc(m.seal)) +
            row('Approved: ' + esc(m.approvedAt), 'By: ' + esc(m.approvedBy)) + '</table>' +
            '<p style="font-size:13pt;font-weight:bold;margin-top:12pt">SKU totals</p>' +
            '<table width="60%"><tr><th align="left">SKU</th><th align="right">Pieces</th></tr>' +
            m.totals.map(t => '<tr><td>' + esc(t.sku) + '</td><td align="right">' + esc(t.qty) + '</td></tr>').join('') + '</table>' +
            '<p style="font-size:13pt;font-weight:bold;margin-top:12pt">Pallets (' + m.pallets.length + ')</p>' +
            '<table width="100%"><tr><th align="left">#</th><th align="left">Label</th><th align="left">Contents</th><th align="right">Pcs</th></tr>' +
            m.pallets.map((p, i) => '<tr><td>' + (i + 1) + '</td><td>' + esc(p.code) + '</td><td>' + esc(p.summary) +
                '</td><td align="right">' + esc(p.pieces) + '</td></tr>').join('') + '</table>' +
            '<p style="margin-top:30pt">Driver signature: ________________________  Date: ____________</p>' +
            '<p style="margin-top:16pt">Received by: ________________________  Date: ____________</p>' +
            '</body></pdf>';
    }

    return { esc: esc, skuSize: skuSize, labelsXml: labelsXml, loadSheetXml: loadSheetXml };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_label_template.js move_portal/test/template.test.js
git commit -m "feat(move): 4x6 label, batch header and load sheet XML"
```

---

