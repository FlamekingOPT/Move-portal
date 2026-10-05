const test = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeTx } = require('./fake_tx');

test('fake tx.apply records ops, returns ids, can fail once on a key', () => {
    const tx = makeFakeTx();
    assert.equal(tx.apply({ op: 'if_qty', ifId: '9', item: '975', from: 504, to: 480 }), '9');
    assert.equal(tx.apply({ op: 'if_create', toId: '600', lines: { 975: 24 } }), '901');
    tx._t.failOn = 'if_stamp:9';
    assert.throws(() => tx.apply({ op: 'if_stamp', ifId: '9' }), /IF changed in NetSuite/);
    assert.equal(tx.apply({ op: 'if_stamp', ifId: '9' }), '9');
    assert.deepEqual(tx._t.ops.map(o => o.op), ['if_qty', 'if_create', 'if_stamp']);
});
