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

test('local store round-trips db to a file', () => {
    const os = require('os'), path = require('path'), fs = require('fs');
    const { makeLocalStore } = require('../local/local_store');
    const core = require('./amd').loadAmd('move_core.js');
    const f = path.join(os.tmpdir(), 'mv-store-' + Date.now() + '.json');
    try {
        const a = makeLocalStore(core, f);
        a.data.createLoad({ number: 'X', status: 'loading', data: { v3: true } });
        a.data.db.settings.writeMode = 'off';
        const seq = a.data.db.seq;
        a.save();
        assert.equal(fs.existsSync(f + '.tmp'), false);
        const b = makeLocalStore(core, f);
        assert.equal(b.data.loadsByStatus(['loading']).length, 1);
        assert.equal(b.data.db.settings.writeMode, 'off');
        assert.equal(b.data.db.seq, seq);
        fs.writeFileSync(f, '{ not json');
        assert.throws(() => makeLocalStore(core, f), /corrupted.*mv-store-/);
    } finally { try { fs.unlinkSync(f); } catch (e) {} try { fs.unlinkSync(f + '.tmp'); } catch (e) {} }
});

test('fake data: palletStatusCounts groups by load and status with pieces', () => {
    const d = makeFakeData(core);
    const mk = (load, status, pieces) => d.createPallet({ status, load, pieces, lines: [], data: {} });
    mk('7', 'loaded', 12); mk('7', 'loaded', 10); mk('7', 'received', 5); mk('8', 'missing', 3); mk('9', 'loaded', 1);
    assert.deepEqual(d.palletStatusCounts(['7', '8']), { 7: { loaded: { n: 2, pcs: 22 }, received: { n: 1, pcs: 5 } }, 8: { missing: { n: 1, pcs: 3 } } });
    assert.deepEqual(d.palletStatusCounts([]), {});
});
