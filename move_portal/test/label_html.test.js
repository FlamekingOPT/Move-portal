'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadAmd } = require('./amd');
const { labelsHtml } = require('../local/label_html');
const core = loadAmd('move_core.js');

const P = (code, lines, extra) => Object.assign({ code, lines, pieces: lines.reduce((a, l) => a + l.pcs, 0), edited: false, printedDay: '10/5/2026', by: 'Jack', summary: lines.map(l => l.sku + l.pcs).join(',') }, extra);
const count = (s, re) => (s.match(re) || []).length;
const single = P('PLT12', [{ sku: 'YSN401', cfg: '', pcs: 48, desc: 'Tank' }]);
const mixed = P('PLT13', [{ sku: 'YSN401', cfg: '', pcs: 10 }, { sku: 'YSN201', cfg: 'A', pcs: 20 }]);
const opts = { fromName: 'Riverside', toName: 'Tippecanoe', core };

test('one label div per pallet, no header by default', () => {
    const h = labelsHtml([single, mixed, P('PLT14', [{ sku: 'X1', cfg: '', pcs: 1 }])], opts);
    assert.strictEqual(count(h, /class="label"/g), 3);
    assert.ok(!h.includes('BATCH HEADER'));
    assert.ok(h.includes('RIVERSIDE &gt; TIPPECANOE'));
    assert.ok(h.includes('size:4in 6in'));
});

test('header card first when requested, one per run of equal summaries', () => {
    const h = labelsHtml([single, Object.assign({}, single, { code: 'PLT15' }), mixed], Object.assign({ header: true }, opts));
    assert.strictEqual(count(h, /BATCH HEADER/g), 2);
    assert.ok(h.indexOf('BATCH HEADER') < h.indexOf('class="label"'));
    assert.ok(h.includes('2 labels') && h.includes('PLT12 - PLT15'));
});

test('payload is core.barcodePayload with tabs, single and mixed', () => {
    const h = labelsHtml([single, mixed], opts);
    assert.ok(h.includes('data-payload="PLT12&#9;YSN401&#9;48"'));
    assert.ok(h.includes('data-payload="PLT13&#9;YSN401&#9;10&#9;YSN201&#9;20"'));
    assert.strictEqual(core.barcodePayload('PLT12', single.lines), 'PLT12\tYSN401\t48');
    assert.ok(h.includes('MIXED') && h.includes('30 pcs'));
});

test('values are HTML-escaped', () => {
    const h = labelsHtml([P('PLT<1>', [{ sku: '<b>"x"&', cfg: '', pcs: 1, desc: '<u>d</u>' }], { by: '<i>' })], opts);
    assert.ok(!h.includes('<b>"x"'));
    assert.ok(!h.includes('<u>d'));
    assert.ok(!h.includes('<i>'));
    assert.ok(h.includes('&lt;b&gt;&quot;x&quot;&amp;'));
    assert.ok(h.includes('PLT&lt;1&gt;'));
});

test('EDITED shown only when flagged', () => {
    assert.ok(!labelsHtml([single], opts).includes('EDITED</b>'));
    assert.ok(labelsHtml([Object.assign({}, single, { edited: true })], opts).includes('EDITED</b>'));
});
