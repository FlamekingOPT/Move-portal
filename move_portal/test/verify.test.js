const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const v = loadAmd('move_verify.js');
const VP = v.VP, T = v.TRUCK;

// TO 500 (YSN100, item 975) has an IF on this truck; TO 600 is an older open TO for the same item; TO 700 has YSN201 only.
const IFS = [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', status: 'B', lines: [{ item: '975', sku: 'YSN100', qty: 504 }] }];
const TOS = [
    { toId: '500', toNum: 'TO500', trandate: '2026-10-01', toStatus: 'D', item: '975', sku: 'YSN100', qty: 10080, remaining: 24 },
    { toId: '600', toNum: 'TO600', trandate: '2026-09-29', toStatus: 'B', item: '975', sku: 'YSN100', qty: 504, remaining: 504 },
    { toId: '700', toNum: 'TO700', trandate: '2026-09-28', toStatus: 'B', item: '11', sku: 'YSN201', qty: 1200, remaining: 1200 }
];
const pal = (id, status, loadId, lines) => ({ id, code: 'PLT' + id, status, loadId: loadId || '', lines: lines || [{ item: '975', sku: 'YSN100', pcs: 12 }] });
const ctx = (p, loaded, extra) => Object.assign({ pallet: p, truckId: '1', trucks: { 1: { status: T.LOADING, label: 'IF9001' }, 2: { status: T.LOADING, label: 'IF9002' }, 3: { status: T.DEPARTED, label: 'Truck 1 · 10/05' } },
    ifs: IFS, toLines: TOS, loadedByItem: loaded || {} }, extra || {});

test('sumLines and fillExpected', () => {
    assert.deepEqual(v.sumLines([pal(1, 'loaded'), pal(2, 'loaded', '', [{ item: '975', pcs: 12 }, { item: '11', pcs: 5 }])]), { 975: 24, 11: 5 });
    const two = IFS.concat([{ ifId: '9002', ifNum: 'IF9002', toId: '500', toNum: 'TO500', lines: [{ item: '975', qty: 100 }] }]);
    assert.deepEqual(v.fillExpected(two, { 975: 550, 11: 5 }), { alloc: { 9001: { 975: 504 }, 9002: { 975: 46 } }, left: { 975: 0, 11: 5 } });
});

test('itemCapacity: expected from IFs, raise from their TOs, add-on from other open TOs oldest first', () => {
    assert.deepEqual(v.itemCapacity('975', IFS, TOS), { expected: 504, raise: 24, addon: 504, addonTo: { toId: '600', toNum: 'TO600' } });
    assert.deepEqual(v.itemCapacity('11', IFS, TOS), { expected: 0, raise: 0, addon: 1200, addonTo: { toId: '700', toNum: 'TO700' } });
    assert.deepEqual(v.itemCapacity('999', IFS, TOS), { expected: 0, raise: 0, addon: 0, addonTo: null });
});

test('classifyLoadScan: state rows', () => {
    assert.equal(v.classifyLoadScan(ctx(null)).result, 'unknown');
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.VOID))).result, 'void');
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.LOADED, '1'))).result, 'dup');
    assert.deepEqual(v.classifyLoadScan(ctx(pal(5, VP.LOADED, '2'))), { result: 'other_truck', otherTruckId: '2', otherLabel: 'IF9002' });
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.LOADED, '3'))).result, 'locked');
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.IN_TRANSIT, '3'))).result, 'shipped');
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.RECEIVED, '3'))).result, 'shipped');
});

test('classifyLoadScan: capacity rows ok / over / addon / no_to', () => {
    const ok = v.classifyLoadScan(ctx(pal(5, VP.LABELED), { 975: 480 }));
    assert.deepEqual(ok, { result: 'ok', addonTo: null, set: { status: VP.LOADED, loadId: '1' } });
    assert.equal(v.classifyLoadScan(ctx(pal(5, VP.LABELED), { 975: 504 })).result, 'over');           // 516 ≤ 504 + 24
    const add = v.classifyLoadScan(ctx(pal(5, VP.LABELED), { 975: 528 }));                            // 540 > 528 → add-on
    assert.equal(add.result, 'addon');
    assert.deepEqual(add.addonTo, { toId: '600', toNum: 'TO600' });
    assert.deepEqual(v.classifyLoadScan(ctx(pal(5, VP.LABELED), { 975: 1032 })), { result: 'no_to', sku: 'YSN100' }); // > 504+24+504
    const extra = v.classifyLoadScan(ctx(pal(6, VP.LABELED, '', [{ item: '11', sku: 'YSN201', pcs: 120 }])));
    assert.equal(extra.result, 'addon');
    assert.deepEqual(v.classifyLoadScan(ctx(pal(7, VP.LABELED, '', [{ item: '999', sku: 'YSN999', pcs: 1 }]))), { result: 'no_to', sku: 'YSN999' });
});

test('classifyLoadScan: mixed pallet takes the worst line', () => {
    const p = pal(8, VP.LABELED, '', [{ item: '975', sku: 'YSN100', pcs: 12 }, { item: '999', sku: 'YSN999', pcs: 1 }]);
    assert.deepEqual(v.classifyLoadScan(ctx(p)), { result: 'no_to', sku: 'YSN999' });
});

test('toneFor', () => {
    assert.equal(v.toneFor('ok'), 'ok');
    ['over', 'addon', 'dup', 'other_truck', 'dup_other', 'late'].forEach(r => assert.equal(v.toneFor(r), r === 'late' ? 'ok' : 'warn'));
    ['no_to', 'void', 'unknown', 'locked', 'shipped', 'never_loaded'].forEach(r => assert.equal(v.toneFor(r), 'bad'));
});

const stamp = { trailer: '537224', seal: '5249330', truckNo: 3, dayIso: '2026-10-05' };
const loaded = (n, item, pcs) => Array.from({ length: n }, (_, i) => pal(100 + i, VP.LOADED, '1', [{ item: item || '975', sku: 'YSN100', pcs: pcs || 12 }]));

test('memoFor, sealUsed, truckNoForDay', () => {
    assert.equal(v.memoFor(3, '2026-10-05'), 'Truck 3 · 10/05');
    const trucks = [{ id: '1', data: { depart: { seal: '5249330 ', day: '2026-10-05', truckNo: 1 } } }, { id: '2', data: {} },
        { id: '4', data: { depart: { seal: 'X1', day: '2026-10-04', truckNo: 7 } } }];
    assert.equal(v.sealUsed(trucks, ' 5249330', '9'), true);
    assert.equal(v.sealUsed(trucks, '5249330', '1'), false);   // its own seal
    assert.equal(v.sealUsed(trucks, '', '9'), false);
    assert.equal(v.truckNoForDay(trucks, '2026-10-05', '9'), 2);
    assert.equal(v.truckNoForDay(trucks, '2026-10-06', '9'), 1);
});

test('planDeparture: exact match → only stamps, no manager', () => {
    const p = v.planDeparture({ ifs: IFS, pallets: loaded(42), toLines: TOS, stamp });
    assert.deepEqual(p.ops, [{ op: 'if_stamp', ifId: '9001', ifNum: 'IF9001', trailer: '537224', seal: '5249330', memo: 'Truck 3 · 10/05' }]);
    assert.equal(p.needsManager, false);
    assert.deepEqual(p.bol, { number: 'TO500', changed: false, ifNums: ['IF9001'] });
    assert.deepEqual(p.alloc, [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', lines: { 975: 504 }, addOn: false }]);
});

test('planDeparture: short lowers, over raises within TO, beyond goes to add-on from the oldest other TO', () => {
    const short = v.planDeparture({ ifs: IFS, pallets: loaded(40), toLines: TOS, stamp });
    assert.deepEqual(short.ops[0], { op: 'if_qty', ifId: '9001', ifNum: 'IF9001', toId: '500', item: '975', from: 504, to: 480 });
    assert.equal(short.needsManager, true);
    assert.equal(short.bol.changed, true);
    const over = v.planDeparture({ ifs: IFS, pallets: loaded(44), toLines: TOS, stamp });          // 528 = 504 + 24 raise
    assert.deepEqual(over.ops.map(o => [o.op, o.to]), [['if_qty', 528], ['if_stamp', undefined]]);
    const addon = v.planDeparture({ ifs: IFS, pallets: loaded(46), toLines: TOS, stamp });         // 552 = 504 + 24 + 24 add-on
    assert.deepEqual(addon.ops.map(o => o.op), ['if_qty', 'if_stamp', 'if_create']);
    assert.deepEqual(addon.ops[2], { op: 'if_create', toId: '600', toNum: 'TO600', lines: { 975: 24 }, trailer: '537224', seal: '5249330', memo: 'Truck 3 · 10/05' });
    assert.deepEqual(addon.alloc[1], { ifId: 'new:600', ifNum: '(new)', toId: '600', toNum: 'TO600', lines: { 975: 24 }, addOn: true });
    assert.deepEqual(addon.bol.ifNums, ['IF9001', '(new from TO600)']);
});

test('planDeparture: extra SKU → add-on; empty IF → unplanned; over capacity throws', () => {
    const two = IFS.concat([{ ifId: '9002', ifNum: 'IF9002', toId: '500', toNum: 'TO500', lines: [{ item: '975', qty: 504 }] }]);
    const p = v.planDeparture({ ifs: two, pallets: loaded(42).concat(loaded(1, '11', 120)), toLines: TOS, stamp });
    assert.deepEqual(p.unplanned, [{ ifId: '9002', ifNum: 'IF9002' }]);
    assert.deepEqual(p.ops.map(o => o.op + ':' + (o.ifId || o.toId)), ['if_stamp:9001', 'if_create:700']);
    assert.equal(p.needsManager, true);
    assert.throws(() => v.planDeparture({ ifs: IFS, pallets: loaded(1, '999', 1), toLines: TOS, stamp }), /No open transfer order covers 1 pcs of item 999/);
});
