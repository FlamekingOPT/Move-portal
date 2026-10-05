const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const { makeFakeData } = require('./fake_data');

test('fake data: pallet create/update merges data and exposes lines', () => {
    const d = makeFakeData(core);
    const id = d.createPallet({ status: 'labeled', job: 'J1', summary: 's', pieces: 5, lines: [{ item: '11', sku: 'X', cfg: 'A', pcs: 5 }], data: { source: 'plan' } });
    let p = d.getPallet(id);
    assert.equal(p.code, 'PLT' + id);
    assert.equal(p.loadId, '');
    assert.deepEqual(p.lines, [{ item: '11', sku: 'X', cfg: 'A', pcs: 5 }]);
    d.updatePallet(p, { status: 'loaded', load: '7', data: { loadedBy: 'M' } });
    p = d.getPallet(id);
    assert.equal(p.status, 'loaded');
    assert.equal(p.loadId, '7');
    assert.equal(p.data.source, 'plan');
    assert.equal(p.data.loadedBy, 'M');
    assert.equal(d.palletsByLoad('7', ['loaded']).length, 1);
    assert.equal(d.countPallets({ status: ['loaded'] }), 1);
    assert.equal(d.countByJob('J1'), 1);
});

test('fake data: loads keep string ids and merge data', () => {
    const d = makeFakeData(core);
    const id = d.createLoad({ number: 'MV-001', status: 'loading', data: { door: '4' } });
    assert.equal(typeof id, 'string');
    let L = d.getLoad(id);
    d.updateLoad(L, { status: 'ready', receipts: ['9'], data: { readyBy: 'M' } });
    L = d.getLoad(id);
    assert.deepEqual([L.status, L.receipts, L.data.door, L.data.readyBy], ['ready', ['9'], '4', 'M']);
});
