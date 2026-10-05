const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');

// Minimal N/search + N/record stubs: search.create returns canned rows; lookupFields returns canned values.
function setup(o) {
    const log = { creates: [], lookups: [] };
    const row = vals => ({ id: vals.id, getValue: c => (typeof c === 'string' ? vals[c] : vals[c.name + (c.summary ? ':' + c.summary : '')]) });
    const search = {
        Summary: { GROUP: 'group', COUNT: 'count', SUM: 'sum' }, Sort: { ASC: 'ASC', DESC: 'DESC' }, Type: {},
        createColumn: c => c,
        create: s => {
            log.creates.push(s);
            const rows = (o.rows || []).map(row);
            return { run: () => ({ each: cb => { rows.every(r => cb(r) !== false); }, getRange: () => rows }),
                runPaged: () => ({ pageRanges: [{ index: 0 }], fetch: () => ({ data: rows }) }) };
        },
        lookupFields: q => { log.lookups.push(q); if (o.lookup instanceof Error) throw o.lookup; return o.lookup; }
    };
    const data = loadAmd('move_data.js', { 'N/search': search, 'N/record': {}, './move_core': core });
    return { data, log };
}

test('move_data: palletStatusCounts runs one grouped search', () => {
    const { data, log } = setup({ rows: [
        { 'custrecord_mvp_load:group': '7', 'custrecord_mvp_status:group': 'loaded', 'internalid:count': '2', 'custrecord_mvp_pieces:sum': '24' },
        { 'custrecord_mvp_load:group': '7', 'custrecord_mvp_status:group': 'received', 'internalid:count': '1', 'custrecord_mvp_pieces:sum': '12' }] });
    assert.deepEqual(data.palletStatusCounts(['7', '7', '8']), { 7: { loaded: { n: 2, pcs: 24 }, received: { n: 1, pcs: 12 } } });
    assert.equal(log.creates.length, 1);
    assert.deepEqual(log.creates[0].filters, [['custrecord_mvp_load', 'anyof', ['7', '8']]]);
    assert.deepEqual(data.palletStatusCounts([]), {});
    assert.equal(log.creates.length, 1);
});
