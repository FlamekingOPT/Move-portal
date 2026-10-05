const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');

// In-memory record: lines = [{item, quantity, quantityfulfilled, itemreceive}]
function makeRec(values, lines) {
    const r = { values: Object.assign({}, values), lines: lines.map(l => Object.assign({ itemreceive: true }, l)), cur: -1, saved: 0 };
    r.getValue = o => r.values[o.fieldId];
    r.setValue = o => { r.values[o.fieldId] = o.value; };
    r.getLineCount = () => r.lines.length;
    r.getSublistValue = o => r.lines[o.line][o.fieldId];
    r.selectLine = o => { r.cur = o.line; };
    r.getCurrentSublistValue = o => r.lines[r.cur][o.fieldId];
    r.setCurrentSublistValue = o => { r.lines[r.cur][o.fieldId] = o.value; };
    r.commitLine = () => {};
    r.removeLine = () => { throw new Error('removeLine must never be called'); };
    r.save = () => { r.saved++; return r.id || '777'; };
    return r;
}
function setup(spec) {
    const recs = {}, log = { transforms: [] };
    const fakeRecord = {
        Type: { TRANSFER_ORDER: 'transferorder', ITEM_FULFILLMENT: 'itemfulfillment', ITEM_RECEIPT: 'itemreceipt' },
        load: o => { const r = recs[o.type + ':' + o.id]; if (!r) throw new Error('no rec ' + o.type + o.id); return r; },
        transform: o => {
            log.transforms.push(o);
            const r = makeRec({}, spec.toLines || [{ item: '975', quantity: 24 }, { item: '111', quantity: 5 }]);
            r.id = '888'; log.last = r; return r;
        }
    };
    recs['itemfulfillment:9'] = makeRec({ shipstatus: spec.status || 'B' }, spec.ifLines);
    recs['transferorder:600'] = makeRec({}, spec.to || [{ item: '975', quantity: 600, quantityfulfilled: 0 }]);
    const tx = loadAmd('move_tx.js', { 'N/record': fakeRecord, 'N/search': {}, './move_verify': loadAmd('move_verify.js') });
    return { tx, f: recs['itemfulfillment:9'], log };
}
const split = () => [{ item: '975', quantity: 300 }, { item: '975', quantity: 204 }];
const qop = to => ({ op: 'if_qty', ifId: '9', ifNum: 'IF1', toId: '600', item: '975', from: 504, to });
const q = f => f.lines.map(l => l.itemreceive === false ? 0 : l.quantity);

test('if_qty fill on split item', () => {
    let s = setup({ ifLines: split() });
    assert.equal(s.tx.apply(qop(480)), '777');
    assert.deepEqual(q(s.f), [300, 180]);
    s = setup({ ifLines: split() }); s.tx.apply(qop(200));
    assert.deepEqual(q(s.f), [200, 0]); assert.equal(s.f.lines[1].itemreceive, false);
    s = setup({ ifLines: split() }); s.tx.apply(qop(600));
    assert.deepEqual(q(s.f), [300, 300]);
});

test('if_qty refusals save nothing', () => {
    const cases = [
        [{ status: 'C', ifLines: split() }, qop(480)],
        [{ ifLines: split() }, Object.assign(qop(480), { from: 500 })],
        [{ ifLines: split(), to: [{ item: '975', quantity: 600, quantityfulfilled: 550 }] }, qop(600)],
        [{ ifLines: [{ item: '975', quantity: 504 }] }, qop(0)]
    ];
    cases.forEach(([spec, op]) => {
        const s = setup(spec);
        assert.throws(() => s.tx.apply(op), /^Error: IF changed in NetSuite/);
        assert.equal(s.f.saved, 0);
    });
});

test('if_qty to 0 is fine when other items remain', () => {
    const s = setup({ ifLines: split().concat([{ item: '111', quantity: 5 }]) });
    s.tx.apply(qop(0));
    assert.deepEqual(q(s.f), [0, 0, 5]);
});

test('if_stamp', () => {
    const s = setup({ ifLines: split() });
    s.tx.apply({ op: 'if_stamp', ifId: '9', ifNum: 'IF1', trailer: 'T5', seal: '123', memo: 'Truck 1 · 10/05' });
    assert.equal(s.f.values.custbody_rsm_container_no, 'T5');
    assert.equal(s.f.values.custbody7, 'SEAL: 123');
    assert.equal(s.f.values.memo, 'Truck 1 · 10/05');
    assert.equal(s.f.values.shipstatus, 'C');
    const c = setup({ status: 'C', ifLines: split() });
    assert.throws(() => c.tx.apply({ op: 'if_stamp', ifId: '9', ifNum: 'IF1' }), /^Error: IF changed in NetSuite/);
    assert.equal(c.f.saved, 0);
});

test('if_create transforms the TO and stamps', () => {
    const s = setup({ ifLines: split() });
    assert.equal(s.tx.apply({ op: 'if_create', toId: '600', trailer: 'T5', seal: '123', memo: 'm', lines: { 975: 24 } }), '888');
    const t = s.log.transforms[0], r = s.log.last;
    assert.equal(t.fromId, '600'); assert.equal(t.toType, 'itemfulfillment');
    assert.equal(r.values.shipstatus, 'C'); assert.equal(r.values.custbody7, 'SEAL: 123');
    assert.equal(r.values.custbody_rsm_container_no, 'T5'); assert.equal(r.values.memo, 'm');
    assert.deepEqual(q(r), [24, 0]);
});

test('receipt transforms with itemfulfillment default and default memo', () => {
    const s = setup({ ifLines: split() });
    assert.equal(s.tx.apply({ op: 'receipt', toId: '600', ifId: '9', ifNum: 'IF1', trailer: 'T5', seal: '123', lines: { 975: 24 } }), '888');
    const t = s.log.transforms[0], r = s.log.last;
    assert.equal(t.toType, 'itemreceipt'); assert.deepEqual(t.defaultValues, { itemfulfillment: '9' });
    assert.equal(r.values.memo, 'Move receipt · IF1'); assert.equal(r.values.custbody7, 'SEAL: 123');
    assert.equal(r.values.custbody_rsm_container_no, 'T5');
});

test('unknown op throws', () => {
    assert.throws(() => setup({ ifLines: split() }).tx.apply({ op: 'nope' }), /Unknown op/);
});

test('if_qty already at the target qty counts as done and saves nothing', () => {
    const s = setup({ ifLines: [{ item: '975', quantity: 300 }, { item: '975', quantity: 180 }] });
    assert.equal(s.tx.apply(qop(480)), '9');
    assert.equal(s.f.saved, 0);
    const c = setup({ status: 'C', ifLines: [{ item: '975', quantity: 480 }] });
    assert.throws(() => c.tx.apply(qop(480)), /no longer Picked\/Packed/);
});

test('if_stamp checks the expected lines against the ticked IF lines', () => {
    const st = lines => ({ op: 'if_stamp', ifId: '9', ifNum: 'IF1', trailer: 'T5', seal: '123', memo: 'm', lines: lines });
    let s = setup({ ifLines: split() });
    s.tx.apply(st({ 975: 504 }));
    assert.deepEqual([s.f.values.shipstatus, s.f.saved], ['C', 1]);
    s = setup({ ifLines: split() });                                                   // office lowered nothing, plan says 480
    assert.throws(() => s.tx.apply(st({ 975: 480 })), /^Error: IF changed in NetSuite.*IF1/);
    assert.equal(s.f.saved, 0);
    s = setup({ ifLines: [{ item: '975', quantity: 300 }, { item: '975', quantity: 204, itemreceive: false }] });   // unticked line does not count
    assert.throws(() => s.tx.apply(st({ 975: 504 })), /IF changed in NetSuite/);
    s = setup({ ifLines: [{ item: '975', quantity: 300 }, { item: '975', quantity: 204, itemreceive: false }] });
    s.tx.apply(st({ 975: 300 }));
    assert.equal(s.f.saved, 1);
    s = setup({ ifLines: split().concat([{ item: '111', quantity: 5 }]) });            // an item the plan does not expect
    assert.throws(() => s.tx.apply(st({ 975: 504 })), /IF changed in NetSuite/);
    assert.equal(s.f.saved, 0);
});

test('if_stamp is idempotent: an IF already shipped with this trailer and seal is done, nothing saved', () => {
    const s = setup({ status: 'C', ifLines: split() });
    Object.assign(s.f.values, { custbody7: 'SEAL: 123', custbody_rsm_container_no: 'T5' });
    assert.equal(s.tx.apply({ op: 'if_stamp', ifId: '9', ifNum: 'IF1', trailer: 'T5', seal: '123', memo: 'm', lines: { 975: 504 } }), '9');
    assert.equal(s.f.saved, 0);
    const o = setup({ status: 'C', ifLines: split() });
    Object.assign(o.f.values, { custbody7: 'SEAL: 999', custbody_rsm_container_no: 'T5' });
    assert.throws(() => o.tx.apply({ op: 'if_stamp', ifId: '9', ifNum: 'IF1', trailer: 'T5', seal: '123', memo: 'm' }), /no longer Picked\/Packed/);
    assert.equal(o.f.saved, 0);
});

test('if_stamp idempotence compares seal digits: SEAL:5249330 on the IF is the same seal as 5249330', () => {
    const s = setup({ status: 'C', ifLines: split() });
    Object.assign(s.f.values, { custbody7: 'SEAL:5249330', custbody_rsm_container_no: '537224' });
    assert.equal(s.tx.apply({ op: 'if_stamp', ifId: '9', ifNum: 'IF1', trailer: '537224', seal: '5249330', memo: 'm', lines: { 975: 504 } }), '9');
    assert.equal(s.f.saved, 0);
});
