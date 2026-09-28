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

// ── Task 12b ──
test('barcode value carries code, SKU and pieces with tabs as XML char refs', () => {
    const x = tpl.labelsXml([lab('PLT9', A)], O);
    assert.equal(count(x, 'value="PLT9&#9;YSN201&#9;120"'), 2);
    assert.match(x, />PLT9<\/p>/);
    const mixed = tpl.labelsXml([lab('PLT10', A.concat(B))], O);
    assert.match(mixed, /value="PLT10&#9;YSN201&#9;120&#9;YSN301&#9;60"/);
    assert.equal(x.indexOf('\t'), -1);
});
