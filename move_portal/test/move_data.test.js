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
    const data = loadAmd('move_data.js', { 'N/search': search, 'N/record': o.rec || {}, './move_core': core });
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

test('move_data: getLoad reads the record with record.load; bad JSON throws, never {}', () => {
    const big = JSON.stringify({ v3: true, stack: Array.from({ length: 2000 }, (_, i) => 'x' + i) });
    const recStub = (vals, err) => ({ loads: [], load(o) { this.loads.push(o); if (err) throw err; if (!vals) throw Object.assign(new Error('nope'), { name: 'RCRD_DSNT_EXIST' });
        return { getValue: q => vals[q.fieldId !== undefined ? q.fieldId : q] }; } });
    const mk = (vals, err) => { const rec = recStub(vals, err); const s = setup({ rec }); return Object.assign(s, { rec }); };
    let s = mk({ custrecord_mvl_number: 'IF1', custrecord_mvl_status: 'loading', custrecord_mvl_to: '500', custrecord_mvl_if: '', custrecord_mvl_receipts: '', custrecord_mvl_data: big });
    const L = s.data.getLoad('7');
    assert.deepEqual([L.id, L.number, L.status, L.to, L.if, L.data.stack.length], ['7', 'IF1', 'loading', '500', '', 2000]);
    assert.deepEqual([s.log.creates.length, s.log.lookups.length, s.rec.loads[0].type, s.rec.loads[0].id], [0, 0, 'customrecord_mv_load', '7']);
    s = mk({ custrecord_mvl_status: 'loading', custrecord_mvl_data: big.slice(0, 1000) });
    assert.throws(() => s.data.getLoad('7'), /Truck 7 data is unreadable/);
    assert.equal(mk(null).data.getLoad('7'), null);
    assert.throws(() => mk({}, new Error('boom')).data.getLoad('7'), /boom/);
    s = setup({ rows: [{ id: '8', custrecord_mvl_status: 'loading', custrecord_mvl_data: '{"v3":tr' }] });
    assert.throws(() => s.data.loadsByStatus(['loading']), /Truck 8 data is unreadable/);
});
