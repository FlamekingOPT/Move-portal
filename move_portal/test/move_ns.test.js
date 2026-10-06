// move_portal/test/move_ns.test.js — the live NetSuite read layer against a fake N/query.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const verify = loadAmd('move_verify.js');
const sample = require('./fixtures/snapshot_sample.json');

// A fake N/query that answers each of move_verify.SQL()'s six queries with the fixture's rows,
// recording the SQL it was asked to run.
function fakeQuery(fx) {
    const ran = [];
    return {
        ran,
        runSuiteQL: ({ query: sql }) => {
            ran.push(sql);
            let out;
            if (/FROM transaction t JOIN transactionline tl/.test(sql) && /'TrnfrOrd'/.test(sql) && !/'ItemShip'/.test(sql)) out = fx.toLines;
            else if (/'ItemShip'/.test(sql)) out = fx.ifLines;
            else if (/previoustransactionlink/.test(sql)) out = fx.links.filter(l => sql.indexOf(String(l.ifid)) !== -1);
            else if (/'ItemRcpt'/.test(sql)) out = fx.receipts.filter(r => sql.indexOf(String(r.rcptid)) !== -1);
            else if (/aggregateItemLocation/.test(sql)) out = fx.onHand || [];
            else if (/FROM item i/.test(sql)) out = fx.items.filter(i => new RegExp('[(,]' + i.item + '[,)]').test(sql));
            else throw new Error('unexpected SQL: ' + sql.slice(0, 80));
            return { asMappedResults: () => JSON.parse(JSON.stringify(out)) };
        }
    };
}
function load(fx, settings) {
    const q = fakeQuery(fx);
    const data = { getSettings: () => Object.assign({ locFrom: '35', locTo: '46' }, settings || {}) };
    const ns = loadAmd('move_ns.js', { 'N/query': q, './move_data': data, './move_verify': verify });
    return { ns, q };
}

test('move_ns builds the same reads as the snapshot stand-in from the six SuiteQL queries', () => {
    const { ns, q } = load(sample);
    const snap = verify.buildReads(JSON.parse(JSON.stringify(sample)));
    assert.deepEqual(ns.plannedIfs(), snap.plannedIfs());
    assert.deepEqual(ns.openToLines(), snap.openToLines());
    assert.deepEqual(ns.ifInfo(), snap.ifInfo());
    assert.deepEqual(ns.ifsByTo(), snap.ifsByTo());
    assert.deepEqual(ns.receiptsByIf(), snap.receiptsByIf());
    assert.deepEqual(ns.items().map(i => i.sku).sort(), snap.items().map(i => i.sku).sort());
    assert.equal(ns.pulledAt().slice(-3), 'UTC');
    // links / receipts / items were asked with the real ids, not the {IDS} placeholder
    assert.ok(q.ran.every(s => s.indexOf('{IDS}') === -1), 'no placeholder left in SQL');
    assert.ok(q.ran.some(s => /previoustransactionlink/.test(s) && /9000/.test(s)), 'links asked for the fixture IF ids');
});

test('move_ns pulls once per action: reads share one pull until resetCache()', () => {
    const { ns, q } = load(sample);
    ns.plannedIfs(); ns.ifInfo(); ns.openToLines(); ns.receiptsByIf();
    const n = q.ran.length;
    assert.ok(n >= 5 && n <= 6, 'one pull = 5 or 6 queries, got ' + n);
    ns.items(); ns.onHand();
    assert.equal(q.ran.length, n, 'no new queries without a reset');
    ns.resetCache();
    ns.plannedIfs();
    assert.equal(q.ran.length, 2 * n, 'a reset pulls everything again');
});

test('move_ns uses the settings locations and chunks long id lists', () => {
    const many = { toLines: [], ifLines: [], links: [], receipts: [], items: [], onHand: [] };
    for (let i = 1; i <= 1200; i++) { many.onHand.push({ item: 10000 + i, onhand: 5 }); many.items.push({ item: 10000 + i, sku: 'S' + i, descr: '', upc: '' }); }
    const { ns, q } = load(many, { locFrom: '35', locTo: '42' });
    assert.equal(Object.keys(ns.onHand()).length, 1200);
    assert.equal(ns.items().length, 1200);
    const itemQs = q.ran.filter(s => /FROM item i/.test(s));
    assert.equal(itemQs.length, 3, '1200 ids → 3 chunks of ≤500');
    assert.ok(q.ran.some(s => /transferlocation = 42/.test(s)), 'queries use the settings locTo');
    assert.equal(q.ran.filter(s => /previoustransactionlink/.test(s)).length, 0, 'no links query when there are no IFs');
});

test('move_ns: an account without the seal/trailer body fields still reads receipts (columns null)', () => {
    const q = fakeQuery(sample), real = q.runSuiteQL;
    q.runSuiteQL = (o) => {
        if (/'ItemRcpt'/.test(o.query) && /custbody7/.test(o.query)) throw new Error("Search error occurred: Field 'custbody7' for record 'transaction' was not found. Reason: REMOVED - Field is removed");
        const r = real(o);
        if (/'ItemRcpt'/.test(o.query)) { const rows = r.asMappedResults().map(x => Object.assign({}, x, { trailer: null, seal: null })); return { asMappedResults: () => rows }; }
        return r;
    };
    const data = { getSettings: () => ({ locFrom: '35', locTo: '46' }) };
    const ns = loadAmd('move_ns.js', { 'N/query': q, './move_data': data, './move_verify': verify });
    const byIf = ns.receiptsByIf();
    assert.ok(Object.keys(byIf).length > 0, 'receipts still read');
    assert.equal(Object.values(byIf)[0][0].seal, '');
    assert.ok(q.ran.some(s => /NULL AS trailer, NULL AS seal/.test(s)), 'fallback SQL ran');
});
