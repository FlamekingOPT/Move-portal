const test = require('node:test');
const assert = require('node:assert/strict');
const { bolHtml } = require('../local/bol_html');

const bol = extra => Object.assign({
    date: '10/19/2026', bolNo: 'TO11702', rev: 1, planOnly: false,
    from: { name: 'Riverside', addr: '1 A St', csz: 'X, IN 46000' }, to: { name: 'Tippecanoe', addr: '2 B St', csz: 'Y, IN 47000' },
    carrier: 'ArcBest', trailer: '537224', seal: '1846', ifNums: ['IF54012'],
    plan: { lines: [{ sku: 'YSN201', desc: '20# LP <Cylinder>', units: 2, pcs: 132, type: 'CYL', hm: true, lbs: 2446 }], units: 2, pcs: 132, lbs: 2446, missing: [] }
}, extra || {});

test('bolHtml fills the boxes and escapes values', () => {
    const h = bolHtml(bol());
    ['BILL OF LADING', 'TO11702', 'ArcBest', '2,446', '#IF54012', '537224'].forEach(s => assert.ok(h.includes(s), s));
    assert.ok(h.includes('YSN201 · 20# LP &lt;Cylinder&gt;'));
    assert.ok(!h.includes('H.M.'));
    assert.ok(!h.includes('<Cylinder>'));
    assert.ok(!h.includes('REV'));
    assert.ok(bolHtml(bol({ rev: 2 })).includes('REV 2'));
    const po = bolHtml(bol({ planOnly: true }));
    assert.ok(po.includes('PLAN ONLY') && !po.includes('TO11702'));
});
