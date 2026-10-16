const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');

// In-memory record: lines = [{item, quantity, quantityfulfilled, itemreceive}]
function makeRec(values, lines, missing) {
    const r = { values: Object.assign({}, values), lines: (lines || []).map(l => Object.assign({ itemreceive: true }, l)), cur: -1, saved: 0 };
    if (missing) r.getField = o => (missing.indexOf(o.fieldId) !== -1 ? null : { id: o.fieldId });   // N/record: null for a field the account lacks
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
        create: o => { const r = makeRec({}, []); r.id = '650'; r.type = o.type; log.created = r;
            r.selectNewLine = () => { r.lines.push({}); r.cur = r.lines.length - 1; }; return r; },
        transform: o => {
            log.transforms.push(o);
            const r = makeRec({}, spec.toLines || [{ item: '975', quantity: 24 }, { item: '111', quantity: 5 }], spec.missing);
            r.id = '888'; log.last = r; return r;
        }
    };
    recs['itemfulfillment:9'] = makeRec({ shipstatus: spec.status || 'B' }, spec.ifLines, spec.missing);
    recs['transferorder:600'] = makeRec({}, spec.to || [{ item: '975', quantity: 600, quantityfulfilled: 0 }]);
    recs['transferorder:600'].selectNewLine = () => { const r = recs['transferorder:600']; r.lines.push({ itemreceive: true }); r.cur = r.lines.length - 1; };
    log.toRec = recs['transferorder:600'];
    log.searches = [];
    const fakeSearch = {
        Type: { TRANSACTION: 'transaction', TRANSFER_ORDER: 'transferorder', LOCATION: 'location' },
        create: o => { log.searches.push(o); return { run: () => ({ getRange: () => (spec.found ? [{ id: spec.found }] : []) }) }; },
        lookupFields: o => (o.type === 'location' ? { subsidiary: [{ value: '2', text: 'Flame King' }] } : { tranid: 'TO8812' })
    };
    const tx = loadAmd('move_tx.js', { 'N/record': fakeRecord, 'N/search': fakeSearch, './move_verify': loadAmd('move_verify.js') });
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

test('an account without the seal/trailer body fields (sandbox) still stamps, creates and receives; those fields are skipped', () => {
    const missing = ['custbody7', 'custbody_rsm_container_no'];
    const s = setup({ ifLines: split(), missing });
    s.tx.apply({ op: 'if_stamp', ifId: '9', ifNum: 'IF1', trailer: 'T5', seal: '123', memo: 'Truck 1 · 10/06', lines: { 975: 504 } });
    assert.deepEqual([s.f.values.shipstatus, s.f.values.memo, s.f.saved], ['C', 'Truck 1 · 10/06', 1]);
    assert.equal('custbody7' in s.f.values, false);
    assert.equal('custbody_rsm_container_no' in s.f.values, false);
    // idempotent: already Shipped counts as stamped when the account has no seal/trailer to compare
    const c = setup({ status: 'C', ifLines: split(), missing });
    assert.equal(c.tx.apply({ op: 'if_stamp', ifId: '9', ifNum: 'IF1', trailer: 'T5', seal: '123', memo: 'm', lines: { 975: 504 } }), '9');
    assert.equal(c.f.saved, 0);
    const r = setup({ ifLines: split(), missing });
    assert.equal(r.tx.apply({ op: 'receipt', toId: '600', ifId: '9', ifNum: 'IF1', trailer: 'T5', seal: '123', lines: { 975: 24 } }), '888');
    assert.deepEqual([r.log.last.values.memo, 'custbody7' in r.log.last.values], ['Move receipt · IF1', false]);
    // only the seal missing: the trailer is still written and still compared
    const t = setup({ status: 'C', ifLines: split(), missing: ['custbody7'] });
    Object.assign(t.f.values, { custbody_rsm_container_no: 'T9' });
    assert.throws(() => t.tx.apply({ op: 'if_stamp', ifId: '9', ifNum: 'IF1', trailer: 'T5', seal: '123', memo: 'm' }), /no longer Picked\/Packed/);
});

test('if_create with ship:false creates the IF Packed (B) with no trailer, seal or memo stamp', () => {
    const s = setup({ ifLines: split() });
    assert.equal(s.tx.apply({ op: 'if_create', toId: '600', lines: { 975: 24 }, ship: false }), '888');
    const r = s.log.last;
    assert.equal(r.values.shipstatus, 'B');
    assert.equal('custbody7' in r.values, false);
    assert.equal('custbody_rsm_container_no' in r.values, false);
    assert.deepEqual(q(r), [24, 0]);
});

test('if_create ship:false finds an IF already made with its token instead of creating a second one', () => {
    const op = { op: 'if_create', toId: '600', lines: { 975: 24 }, ship: false, token: '[mv:5:if_create:600:975x24]' };
    const f = setup({ ifLines: split(), found: '555' });
    assert.equal(f.tx.apply(op), '555');
    assert.equal(f.log.transforms.length, 0);
    const flt = JSON.stringify(f.log.searches[0].filters);
    ['"memo","contains","[mv:5:if_create:600:975x24]"', '"mainline","is","T"', '"type","anyof","ItemShip"', '"createdfrom","anyof","600"', '"ItemShip:A","ItemShip:B"']
        .forEach(x => assert.ok(flt.indexOf(x) !== -1, x + ' in ' + flt));
    const n = setup({ ifLines: split() });
    assert.equal(n.tx.apply(op), '888');
    assert.deepEqual([n.log.last.values.shipstatus, n.log.last.values.memo], ['B', '[mv:5:if_create:600:975x24]']);
    const shipped = setup({ ifLines: split(), found: '555' });     // a shipped add-on never searches
    assert.equal(shipped.tx.apply({ op: 'if_create', toId: '600', trailer: 'T5', seal: '1', memo: 'm', lines: { 975: 24 } }), '888');
    assert.equal(shipped.log.searches.length, 0);
});

const toOp = () => ({ op: 'to_create', ref: '12', token: '[MV-12]', fromLoc: '35', toLoc: '46', orderStatus: 'B', lines: { '975': 504, '111': 36 }, memo: '[MV-12] Trailer 537224 · Truck 3 · 11/02' });

test('to_create makes an approved TO 35 → 46 with one line per item', () => {
    const s = setup({});
    assert.equal(s.tx.apply(toOp()), '650');
    const r = s.log.created;
    assert.deepEqual([r.values.subsidiary, r.values.location, r.values.transferlocation, r.values.orderstatus, r.values.memo], ['2', '35', '46', 'B', '[MV-12] Trailer 537224 · Truck 3 · 11/02']);
    assert.deepEqual(r.lines.map(l => [l.item, l.quantity]), [['111', 36], ['975', 504]]);   // integer-like keys sort numerically
    assert.equal(r.saved, 1);
});

test('to_create finds a TO an earlier request made, by its tag, and creates nothing', () => {
    const s = setup({ found: '640' });
    assert.equal(s.tx.apply(toOp()), '640');
    assert.equal(s.log.created, undefined);
    const f = JSON.stringify(s.log.searches[0].filters);
    assert.ok(f.indexOf('[MV-12]') !== -1 && f.indexOf('TrnfrOrd') !== -1);
});

test('if_create Shipped with a token finds an earlier Shipped IF on that TO, else stamps a new one', () => {
    let s = setup({ found: '901' });
    const op = { op: 'if_create', ref: '12', toId: '600', ship: true, token: '[MV-12]', lines: { '975': 24 }, trailer: '537224', seal: '0048812', memo: 'Truck 3 · 11/02 · [MV-12]' };
    assert.equal(s.tx.apply(op), '901');
    assert.equal(s.log.transforms.length, 0);
    assert.ok(JSON.stringify(s.log.searches[0].filters).indexOf('ItemShip:C') !== -1);
    s = setup({ toLines: [{ item: '975', quantity: 24 }] });
    assert.equal(s.tx.apply(op), '888');
    assert.deepEqual([s.log.last.values.shipstatus, s.log.last.values.memo, s.log.last.values.custbody7], ['C', 'Truck 3 · 11/02 · [MV-12]', 'SEAL: 0048812']);
});

test('findIf finds a Shipped IF by its tag on that TO', () => {
    const s = setup({ found: '902' });
    assert.equal(s.tx.findIf('[MV-12]', '600'), '902');
    const f = JSON.stringify(s.log.searches[0].filters);
    assert.ok(f.indexOf('[MV-12]') !== -1 && f.indexOf('ItemShip:C') !== -1 && f.indexOf('"600"') !== -1);
    assert.equal(setup({}).tx.findIf('[MV-12]', '600'), null);
});

test('toClosed: Closed status, every line closed, or gone', () => {
    const s = setup({ to: [{ item: '975', quantity: 600, isclosed: true }] });
    assert.equal(s.tx.toClosed('600'), true);
    const s2 = setup({ to: [{ item: '975', quantity: 600, isclosed: false }] });
    assert.equal(s2.tx.toClosed('600'), false);
    assert.equal(s2.tx.toClosed('999'), true);                     // no such TO (deleted)
    assert.deepEqual(s2.tx.tranIds(['5'], 'to'), { '5': 'TO8812' });
});

test('if_create ship:picked saves Picked (A), stamps trailer + memo, skips a blank seal', () => {
    const s = setup({});
    s.tx.apply({ op: 'if_create', ship: 'picked', toId: '600', token: '[MV-7]', lines: { '975': 24 }, trailer: 'T1', seal: '', memo: 'Truck 1 · 10/16 · [MV-7]' });
    const r = s.log.last;
    assert.deepEqual([r.values.shipstatus, r.values.custbody_rsm_container_no, r.values.memo, 'custbody7' in r.values], ['A', 'T1', 'Truck 1 · 10/16 · [MV-7]', false]);
});

test('if_create ship:picked finds an earlier IF by token (A/B/C) and creates nothing', () => {
    const s = setup({ found: '4242' });
    assert.equal(s.tx.apply({ op: 'if_create', ship: 'picked', toId: '600', token: '[MV-7]', lines: { '975': 24 }, trailer: 'T1', memo: 'm' }), '4242');
    assert.equal(s.log.transforms.length, 0);
    assert.deepEqual(JSON.stringify(s.log.searches[0].filters).includes('ItemShip:A'), true);
});

test('to_line raises, adds, closes at 0, reopens, and refuses a stale from', () => {
    let s = setup({ to: [{ item: '975', quantity: 240, quantityfulfilled: 0 }] });
    s.tx.apply({ op: 'to_line', toId: '600', item: '975', from: 240, to: 360 });
    const rec = s.log.toRec;
    assert.equal(rec.lines[0].quantity, 360);
    s.tx.apply({ op: 'to_line', toId: '600', item: '111', from: 0, to: 60 });
    assert.deepEqual([rec.lines[1].item, rec.lines[1].quantity], ['111', 60]);
    s.tx.apply({ op: 'to_line', toId: '600', item: '111', from: 60, to: 0 });
    assert.equal(rec.lines[1].isclosed, true);
    s.tx.apply({ op: 'to_line', toId: '600', item: '111', from: 0, to: 12 });
    assert.deepEqual([rec.lines[1].isclosed, rec.lines[1].quantity], [false, 12]);
    const saves = rec.saved;
    s.tx.apply({ op: 'to_line', toId: '600', item: '111', from: 0, to: 12 });   // already at target: done, no save
    assert.equal(rec.saved, saves);
    assert.throws(() => s.tx.apply({ op: 'to_line', toId: '600', item: '975', from: 100, to: 200 }), /^Error: IF changed in NetSuite/);
});

test('if_qty newLine on an IF without that item throws NO_IF_LINE and saves nothing', () => {
    const s = setup({ status: 'A', ifLines: [{ item: '975', quantity: 24 }] });
    assert.throws(() => s.tx.apply({ op: 'if_qty', ifId: '9', ifNum: 'IF9', toId: '600', item: '111', from: 0, to: 5, newLine: true }), /^Error: NO_IF_LINE/);
    assert.equal(s.f.saved, 0);
});

test('if_seal sets only the seal on a Picked IF; refuses a Shipped one', () => {
    let s = setup({ status: 'A', ifLines: [{ item: '975', quantity: 24 }] });
    s.tx.apply({ op: 'if_seal', ifId: '9', ifNum: 'IF9', seal: '5249330' });
    assert.deepEqual([s.f.values.custbody7, s.f.values.shipstatus, s.f.saved], ['SEAL: 5249330', 'A', 1]);
    s = setup({ status: 'C', ifLines: [{ item: '975', quantity: 24 }] });
    assert.throws(() => s.tx.apply({ op: 'if_seal', ifId: '9', ifNum: 'IF9', seal: 'x' }), /no longer Picked/);
});

test('to_line distributes across two open lines of one item', () => {
    let s = setup({ to: [{ item: '975', quantity: 300, quantityfulfilled: 0 }, { item: '975', quantity: 204, quantityfulfilled: 0 }] });
    s.tx.apply({ op: 'to_line', toId: '600', item: '975', from: 504, to: 100 });
    let r = s.log.toRec;
    assert.equal(r.lines[0].quantity, 100); assert.equal(r.lines[1].isclosed, true); assert.equal(r.lines[1].quantity, 204);
    s = setup({ to: [{ item: '975', quantity: 300, quantityfulfilled: 0 }, { item: '975', quantity: 204, quantityfulfilled: 0 }] });
    s.tx.apply({ op: 'to_line', toId: '600', item: '975', from: 504, to: 600 });
    r = s.log.toRec;
    assert.deepEqual([r.lines[0].quantity, r.lines[1].quantity], [300, 300]);
});

test('to_line refuses to go below what is already fulfilled', () => {
    const s = setup({ to: [{ item: '975', quantity: 240, quantityfulfilled: 100 }] });
    assert.throws(() => s.tx.apply({ op: 'to_line', toId: '600', item: '975', from: 240, to: 50 }), /already has 100 fulfilled/);
    assert.equal(s.log.toRec.saved, 0);
});

test('if_seal: blank refused, same seal is a no-op', () => {
    let s = setup({ status: 'A', ifLines: [{ item: '975', quantity: 24 }] });
    assert.throws(() => s.tx.apply({ op: 'if_seal', ifId: '9', ifNum: 'IF9', seal: ' ' }), /Seal is blank/);
    s.f.values.custbody7 = 'SEAL: 5249330';
    assert.equal(s.tx.apply({ op: 'if_seal', ifId: '9', ifNum: 'IF9', seal: '5249330' }), '9');
    assert.equal(s.f.saved, 0);
});

// ── final review I4: if_qty counts ticked lines only and re-ticks an unticked line on a raise ──
test('if_qty final fix: an unticked line for the item at qty 24 is re-ticked and set on a raise from 0', () => {
    const s = setup({ status: 'A', ifLines: [{ item: '975', quantity: 100 }, { item: '111', quantity: 24, itemreceive: false }],
        to: [{ item: '975', quantity: 100, quantityfulfilled: 0 }, { item: '111', quantity: 12, quantityfulfilled: 0 }] });
    s.tx.apply({ op: 'if_qty', ifId: '9', ifNum: 'IF9', toId: '600', item: '111', from: 0, to: 12, newLine: true });
    assert.deepEqual([s.f.lines[1].itemreceive, s.f.lines[1].quantity, s.f.saved], [true, 12, 1]);
    assert.deepEqual([s.f.lines[0].itemreceive, s.f.lines[0].quantity], [true, 100]);
});

test('if_qty final fix: ticked 100 plus unticked 50 counts as 100; the unticked line stays unticked', () => {
    let s = setup({ status: 'A', ifLines: [{ item: '975', quantity: 100 }, { item: '975', quantity: 50, itemreceive: false }] });
    s.tx.apply({ op: 'if_qty', ifId: '9', ifNum: 'IF9', toId: '600', item: '975', from: 100, to: 80 });
    assert.deepEqual([s.f.lines[0].quantity, s.f.lines[1].itemreceive, s.f.saved], [80, false, 1]);
    s = setup({ status: 'A', ifLines: [{ item: '975', quantity: 100 }, { item: '975', quantity: 50, itemreceive: false }] });
    assert.equal(s.tx.apply({ op: 'if_qty', ifId: '9', ifNum: 'IF9', toId: '600', item: '975', from: 50, to: 100 }), '9');   // already 100: done
    assert.equal(s.f.saved, 0);
    assert.throws(() => s.tx.apply({ op: 'if_qty', ifId: '9', ifNum: 'IF9', toId: '600', item: '975', from: 150, to: 160 }), /is 100, expected 150/);
});
