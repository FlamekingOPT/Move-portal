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

test('classifyUnloadScan rows', () => {
    const tr = { 1: { status: T.RECEIVING, label: 'Truck 1 · 10/05' }, 2: { status: T.DEPARTED, label: 'Truck 2 · 10/05' }, 5: { status: T.DEPARTING, label: 'IF9' } };
    const c = p => v.classifyUnloadScan({ pallet: p, truckId: '1', trucks: tr });
    assert.equal(c(null).result, 'unknown');
    assert.equal(c(pal(1, VP.VOID)).result, 'void');
    assert.deepEqual(c(pal(1, VP.IN_TRANSIT, '1')), { result: 'ok', set: { status: VP.RECEIVED } });
    assert.deepEqual(c(pal(1, VP.MISSING, '1')), { result: 'late', set: { status: VP.RECEIVED } });
    assert.deepEqual(c(pal(1, VP.IN_TRANSIT, '2')), { result: 'other_truck', otherTruckId: '2', otherLabel: 'Truck 2 · 10/05' });
    assert.equal(c(pal(1, VP.RECEIVED, '1')).result, 'dup');
    assert.equal(c(pal(1, VP.RECEIVED, '2')).result, 'dup_other');
    assert.equal(c(pal(1, VP.LOADED, '5')).result, 'locked');
    assert.equal(c(pal(1, VP.LABELED)).result, 'never_loaded');
    assert.equal(c(pal(1, VP.LOADED, '7')).result, 'never_loaded');
});

test('planReceipts: per IF, short leaves missing, a late second receipt only carries the new qty', () => {
    const alloc = [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', lines: { 975: 504 }, addOn: false },
        { ifId: 'new:600', ifNum: '(new)', toId: '600', toNum: 'TO600', lines: { 975: 24 }, addOn: true }];
    const ps = loaded(44).map((p, i) => Object.assign(p, { status: i < 41 ? VP.RECEIVED : VP.IN_TRANSIT }));   // 41 × 12 = 492 in
    const r1 = v.planReceipts({ alloc, pallets: ps, received: {}, stamp: { trailer: '537224', seal: '5249330' }, seq: 1 });
    assert.deepEqual(r1.ops, [{ op: 'receipt', ifId: '9001', ifNum: 'IF9001', toId: '500', lines: { 975: 492 }, trailer: '537224', seal: '5249330', seq: 1 }]);
    assert.deepEqual(r1.perIf, [{ ifId: '9001', ifNum: 'IF9001', shipped: 504, received: 492, short: 12 }, { ifId: 'new:600', ifNum: '(new)', shipped: 24, received: 0, short: 24 }]);
    assert.deepEqual(r1.missing, ['PLT141', 'PLT142', 'PLT143']);
    assert.deepEqual(r1.cumulative, { 9001: { 975: 492 }, 'new:600': { 975: 0 } });
    ps.forEach(p => { p.status = VP.RECEIVED; });                                                    // the 3 missing arrive late
    const r2 = v.planReceipts({ alloc, pallets: ps, received: r1.cumulative, stamp: { trailer: '537224', seal: '5249330' }, seq: 2 });
    assert.deepEqual(r2.ops.map(o => [o.ifId, o.lines[975], o.seq]), [['9001', 12, 2], ['new:600', 24, 2]]);
    assert.deepEqual(r2.missing, []);
});

test('opKey / opAllowed / normMode', () => {
    assert.equal(v.opKey({ op: 'if_qty', ifId: '9', item: '975' }), 'if_qty:9:975');
    assert.equal(v.opKey({ op: 'if_stamp', ifId: '9' }), 'if_stamp:9');
    assert.equal(v.opKey({ op: 'if_create', toId: '600' }), 'if_create:600');
    assert.equal(v.opKey({ op: 'receipt', ifId: '9', seq: 2 }), 'receipt:9:2');
    assert.deepEqual(['if_qty', 'if_stamp', 'if_create', 'receipt'].map(op => [v.opAllowed({ op }, 'off'), v.opAllowed({ op }, 'qty'), v.opAllowed({ op }, 'on')]),
        [[false, true, true], [false, false, true], [false, false, true], [false, false, true]]);
    assert.equal(v.normMode('weird'), 'off');
    assert.equal(v.normMode('qty'), 'qty');
});

test('runOps writes only what the mode allows, skips done keys, reports each write', () => {
    const ops = [{ op: 'if_qty', ifId: '9', item: '975', from: 504, to: 480 }, { op: 'if_stamp', ifId: '9' }, { op: 'if_qty', ifId: '8', item: '975', from: 10, to: 5 }];
    const calls = [], saved = {};
    const r = v.runOps(ops, 'qty', op => { calls.push(v.opKey(op)); return 'id' + calls.length; }, { 'if_qty:8:975': 'old' }, (k, id) => { saved[k] = id; });
    assert.deepEqual(calls, ['if_qty:9:975']);
    assert.deepEqual(saved, { 'if_qty:9:975': 'id1' });
    assert.deepEqual(r, { written: ['if_qty:9:975'], planOnly: ['if_stamp:9'] });
    assert.deepEqual(v.runOps(ops, 'off', () => { throw new Error('no'); }, {}, null).written, []);
});

test('resolveNew', () => {
    assert.deepEqual(v.resolveNew({ op: 'receipt', ifId: 'new:600', toId: '600' }, { 'if_create:600': '77' }), { op: 'receipt', ifId: '77', toId: '600' });
    assert.throws(() => v.resolveNew({ op: 'receipt', ifId: 'new:600', toId: '600' }, {}), /add-on IF from TO 600 was not created/);
    const op = { op: 'receipt', ifId: '9' };
    assert.equal(v.resolveNew(op, {}), op);
});

test('shadowRows compares plan vs NetSuite and leaves not-yet-done checks as null', () => {
    const truck = { id: '1', data: { depart: { truckNo: 3, day: '2026-10-05', trailer: '537224', seal: '5249330' },
        alloc: [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', lines: { 975: 480 }, addOn: false },
            { ifId: 'new:600', ifNum: '(new)', toId: '600', toNum: 'TO600', lines: { 975: 24 }, addOn: true }],
        received: { 9001: { 975: 480 } } } };
    const rows = v.shadowRows({ trucks: [truck], sku: { 975: 'YSN100' },
        ifInfo: { 9001: { ifNum: 'IF9001', status: 'C', toId: '500', lines: [{ item: '975', qty: 504 }] }, 9100: { ifNum: 'IF9100', status: 'C', toId: '600', lines: [{ item: '975', qty: 24 }] } },
        ifsByTo: { 500: ['9001'], 600: ['9100'] },
        receipts: { 9001: [{ id: '1', tranid: 'IR1', trailer: '537224', seal: 'SEAL: 5249330', lines: { 975: 480 } }],
            9100: [{ id: '2', tranid: 'IR2', trailer: '537224', seal: 'SEAL: 5249330', lines: { 975: 24 } }] } });
    const pick = (ifNum, check) => rows.find(r => r.ifNum === ifNum && r.check === check);
    assert.deepEqual(pick('IF9001', 'IF qty YSN100'), { truck: 'Truck 3 · 10/05', seal: '5249330', ifNum: 'IF9001', check: 'IF qty YSN100', portal: '480', netsuite: '504', ok: false });
    assert.equal(pick('IF9001', 'Shipped').ok, true);
    assert.equal(pick('IF9001', 'Trailer').ok, true);
    assert.equal(pick('IF9001', 'Seal').ok, true);
    assert.equal(pick('IF9001', 'Receipt qty YSN100').ok, true);
    assert.equal(pick('IF9100', 'Add-on IF on TO600').ok, true);                // found by the seal on its receipt
    assert.equal(pick('IF9100', 'Receipt qty YSN100').ok, null);               // portal hasn't approved that receipt yet
});

test('shadowRows compares seals by digits, not by typed format', () => {
    const mk = seal => ({ id: '1', data: { depart: { truckNo: 3, day: '2026-10-05', trailer: '537224', seal: '5249330' },
        alloc: [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', lines: { 975: 504 }, addOn: false },
            { ifId: 'new:600', ifNum: '(new)', toId: '600', toNum: 'TO600', lines: { 975: 24 }, addOn: true }] } });
    const run = seal => v.shadowRows({ trucks: [mk()], sku: { 975: 'YSN100' },
        ifInfo: { 9001: { ifNum: 'IF9001', status: 'C', toId: '500', lines: [{ item: '975', qty: 504 }] }, 9100: { ifNum: 'IF9100', status: 'C', toId: '600', lines: [{ item: '975', qty: 24 }] } },
        ifsByTo: { 500: ['9001'], 600: ['9100'] },
        receipts: { 9001: [{ id: '1', trailer: '537224', seal: seal, lines: { 975: 504 } }], 9100: [{ id: '2', trailer: '537224', seal: seal, lines: { 975: 24 } }] } });
    const pick = (rows, ifNum, check) => rows.find(r => r.ifNum === ifNum && r.check === check);
    ['SEAL:5249330', 'seal  5249330', 'SEAL: 5249330', '5249330'].forEach(s => {
        const rows = run(s);
        assert.equal(pick(rows, 'IF9001', 'Seal').ok, true, s);
        assert.equal(pick(rows, 'IF9100', 'Add-on IF on TO600').ok, true, s);
    });
    assert.equal(pick(run('SEAL: 1111111'), 'IF9001', 'Seal').ok, false);
});

test('sealUsed ignores the SEAL: prefix and spacing', () => {
    const trucks = [{ id: '1', data: { depart: { seal: '5249330', day: '2026-10-05', truckNo: 1 } } }];
    assert.equal(v.sealUsed(trucks, 'SEAL: 5249330', '9'), true);
    assert.equal(v.sealUsed(trucks, 'seal:5249330', '9'), true);
    assert.equal(v.sealUsed(trucks, 'SEAL: 5249331', '9'), false);
});

test('runOps refuses a write that returned no id and does not record it', () => {
    [undefined, null, ''].forEach(ret => {
        const saved = [];
        assert.throws(() => v.runOps([{ op: 'if_stamp', ifId: '9' }], 'on', () => ret, {}, k => saved.push(k)), /returned no id/);
        assert.deepEqual(saved, []);
    });
});

test('shadowRows compares string quantities numerically', () => {
    const truck = { id: '1', data: { depart: { truckNo: 3, day: '2026-10-05', trailer: '1', seal: '5' },
        alloc: [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', lines: { 975: 480 }, addOn: false }], received: { 9001: { 975: 480 } } } };
    const rows = v.shadowRows({ trucks: [truck], sku: {}, ifInfo: { 9001: { ifNum: 'IF9001', status: 'C', lines: [{ item: '975', qty: '480' }] } },
        receipts: { 9001: [{ trailer: '1', seal: '5', lines: { 975: '480' } }] } });
    assert.equal(rows.find(r => r.check === 'IF qty 975').ok, true);
    assert.equal(rows.find(r => r.check === 'Receipt qty 975').ok, true);
});

const raw = require('./fixtures/snapshot_sample.json');

test('buildReads: planned IFs (A/B), merged lines, TO remaining after every IF, open TOs only', () => {
    const r = v.buildReads(raw);
    assert.deepEqual(r.plannedIfs().map(f => [f.ifId, f.status, f.toNum, f.lines]), [
        ['9001', 'B', 'TO500', [{ item: '975', sku: 'YSN100', qty: 504 }]],
        ['9002', 'A', 'TO500', [{ item: '975', sku: 'YSN100', qty: 504 }]]]);
    assert.deepEqual(r.openToLines().map(t => [t.toId, t.item, t.remaining]), [['500', '975', 48], ['600', '975', 504], ['700', '11', 1200]]);
    assert.deepEqual(r.ifsByTo(), { 500: ['9000', '9001', '9002'], 800: ['9050'] });
    assert.deepEqual(r.receiptsByIf(), { 9000: [{ id: '7000', tranid: 'IR7000', trailer: '537224', seal: 'SEAL: 5249300', lines: { 975: 504 } }] });
    assert.equal(r.ifInfo()['9000'].status, 'C');
    assert.deepEqual(r.items()[0], { item: '975', sku: 'YSN100', desc: '100# LP cylinder', upc: '0975' });
    assert.equal(r.pulledAt(), '2026-10-05T14:00:00-07:00');
});

test('SQL builds location-specific queries', () => {
    const q = v.SQL('35', '46');
    assert.match(q.toLines, /t\.transferlocation = 46/);
    assert.match(q.toLines, /x\.location = 35/);
    assert.match(q.ifLines, /tl\.location = 35/);
    assert.match(q.links, /linktype = 'TOrdCost'/);
    assert.match(q.receipts, /\{IDS\}/);
});

test('local snapshot_ns reads a file path', () => {
    const { makeSnapshotNs } = require('../local/snapshot_ns');
    const ns = makeSnapshotNs(v, require('path').join(__dirname, 'fixtures', 'snapshot_sample.json'));
    assert.equal(ns.plannedIfs().length, 2);
    ns.resetCache();
});

test('refreshIfs: fresh lines win; a missing IF is gone; changes are listed', () => {
    const saved = [{ ifId: '1', ifNum: 'IF1', lines: [{ item: '9', qty: 10 }] }, { ifId: '2', ifNum: 'IF2', lines: [{ item: '9', qty: 5 }] }, { ifId: '3', ifNum: 'IF3', lines: [{ item: '9', qty: 7 }] }];
    const fresh = [{ ifId: '1', ifNum: 'IF1', lines: [{ item: '9', qty: 8 }] }, { ifId: '3', ifNum: 'IF3', lines: [{ item: '9', qty: 7 }] }, { ifId: '4', ifNum: 'IF4', lines: [] }];
    const r = v.refreshIfs(saved, fresh);
    assert.deepEqual(r.ifs.map(f => [f.ifId, f.lines[0].qty]), [['1', 8], ['3', 7]]);
    assert.deepEqual(r.gone, [{ ifId: '2', ifNum: 'IF2' }]);
    assert.deepEqual(r.changes.map(x => [x.ifNum, x.wasPcs, x.nowPcs, x.now === 'not Packed']), [['IF1', 10, 8, false], ['IF2', 5, null, true]]);
    assert.deepEqual(v.refreshIfs(saved.slice(2), fresh).changes, []);
});

test('reserveToLines subtracts reservations per TO and item, never below 0', () => {
    const r = v.reserveToLines(TOS, { '500|975': 10, '600|975': 900 });
    assert.deepEqual(r.map(x => x.remaining), [14, 0, 1200]);
    assert.equal(TOS[0].remaining, 24);                                  // input untouched
});

test('reservationsFromTrucks: loading surplus, and unwritten raises/add-ons of departed trucks', () => {
    const loading = { id: '1', status: T.LOADING, data: { v3: true, ifs: IFS } };
    const departedOff = { id: '2', status: T.DEPARTED, data: { v3: true, writes: {}, plan: [
        { op: 'if_qty', ifId: '8', toId: '500', item: '975', from: 100, to: 112 },
        { op: 'if_qty', ifId: '8', toId: '500', item: '11', from: 50, to: 40 },
        { op: 'if_create', toId: '700', lines: { 11: 120 } }, { op: 'if_stamp', ifId: '8' }] } };
    const departedOn = { id: '3', status: T.RECEIVING, data: { v3: true, writes: { 'if_qty:7:975': '7', 'if_qty:6:975': 'skipped:boom' }, plan: [
        { op: 'if_qty', ifId: '7', toId: '600', item: '975', from: 12, to: 24 }, { op: 'if_qty', ifId: '6', toId: '600', item: '975', from: 12, to: 36 }] } };
    const received = { id: '4', status: T.RECEIVED, data: { v3: true, writes: {}, plan: [{ op: 'if_create', toId: '700', lines: { 11: 5 } }] } };
    // Truck 1 has 60 pcs over IF9001. Departed reservations come first, so TO500 has 24 - 12 = 12 left to raise; the other 48 is an add-on from TO600.
    const loadedByTruck = { 1: { 975: 504 + 60 } };
    const o = { trucks: [loading, departedOff, departedOn, received], loadedByTruck: loadedByTruck, toLines: TOS };
    assert.deepEqual(v.reservationsFromTrucks(Object.assign({ mode: 'off' }, o)), { '500|975': 12 + 12, '700|11': 120, '600|975': 12 + 24 + 48 });
    assert.deepEqual(v.reservationsFromTrucks(Object.assign({ mode: 'on' }, o)), { '500|975': 12 + 12, '700|11': 120, '600|975': 24 + 48 });   // written key 7 is in NetSuite; a skipped one is not
    assert.deepEqual(v.reservationsFromTrucks(Object.assign({ mode: 'off', exceptId: '1' }, o)), { '500|975': 12, '700|11': 120, '600|975': 36 });
});

test('planReceipts: the cumulative never drops below an earlier approved qty', () => {
    const pallets = [{ status: VP.RECEIVED, lines: [{ item: '9', pcs: 12 }] }];
    const r = v.planReceipts({ alloc: [{ ifId: '1', ifNum: 'IF1', toId: '5', lines: { 9: 24 } }], pallets: pallets, received: { 1: { 9: 24 } }, stamp: {}, seq: 2 });
    assert.deepEqual([r.ops, r.cumulative], [[], { 1: { 9: 24 } }]);
});

// ── Verify Load rules ───────────────────────────────────────────────────
const VIF = (id, toId, qty, item) => ({ ifId: String(id), ifNum: 'IF' + id, toId: String(toId), toNum: 'TO' + toId, status: 'B', lines: [{ item: item || '975', sku: 'YSN100', qty }] });
const onTruck = (n, item, pcs) => Array.from({ length: n }, (_, i) => pal(300 + i, VP.LOADED, '1', [{ item: item || '975', sku: 'YSN100', pcs: pcs || 12 }]));

test('verifyLoad: exact match', () => {
    const r = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual([r.match, r.diffs, r.ifs.map(f => f.ifId)], [true, [], ['9001']]);
});

test('verifyLoad: short, over, no IF (oldest open TO), empty IF, gone IF, fresh qty wins', () => {
    const short = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(40), toLines: TOS });
    assert.deepEqual(short.diffs, [{ key: 'if_short:9001:975', kind: 'if_short', ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', item: '975', ifQty: 504, loaded: 480 }]);
    const over = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(44), toLines: TOS });
    assert.deepEqual(over.diffs.map(d => [d.kind, d.loaded]), [['if_over', 528]]);
    const extra = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42).concat(onTruck(1, '11', 120)), toLines: TOS });
    assert.deepEqual(extra.diffs, [{ key: 'no_if:11', kind: 'no_if', item: '11', qty: 120, toId: '700', toNum: 'TO700' }]);
    const none = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42).concat(onTruck(1, '999', 5)), toLines: TOS });
    assert.deepEqual(none.diffs, [{ key: 'no_if:999', kind: 'no_if', item: '999', qty: 5, toId: null, toNum: null }]);
    const empty = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504), VIF(9002, 500, 504)], freshIfs: [VIF(9001, 500, 504), VIF(9002, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual(empty.diffs, [{ key: 'if_empty:9002', kind: 'if_empty', ifId: '9002', ifNum: 'IF9002' }]);
    const gone = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504), VIF(9002, 500, 504)], freshIfs: [VIF(9001, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual(gone.diffs, [{ key: 'if_gone:9002', kind: 'if_gone', ifId: '9002', ifNum: 'IF9002' }]);
    const fixed = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504)], freshIfs: [VIF(9001, 500, 480)], pallets: onTruck(40), toLines: TOS });
    assert.equal(fixed.match, true);                                   // the office lowered the IF → now matches
});

test('diffText', () => {
    const d = { kind: 'if_short', ifNum: 'IF72287', item: '1031', ifQty: 1152, loaded: 1056 };
    assert.equal(v.diffText(d, 'YSN401', 48), 'IF72287 YSN401: IF 1,152 · loaded 1,056 → IF needs −96 (2 pallets)');
    assert.equal(v.diffText(Object.assign({}, d, { kind: 'if_over', loaded: 1200 }), 'YSN401', null), 'IF72287 YSN401: IF 1,152 · loaded 1,200 → IF needs +48');
    assert.equal(v.diffText({ kind: 'no_if', item: '1021', qty: 64, toNum: 'TO11710' }, 'YSN301'), 'YSN301 ×64 loaded, not on any IF → needs an IF from TO11710 (oldest open TO)');
    assert.equal(v.diffText({ kind: 'no_if', item: '9', qty: 5, toNum: null }, 'X1'), 'X1 ×5 loaded, not on any IF → no open TO: take it off the truck');
    assert.equal(v.diffText({ kind: 'if_empty', ifNum: 'IF72288' }), 'IF72288 has nothing loaded → take it off this truck');
    assert.equal(v.diffText({ kind: 'if_gone', ifNum: 'IF72288' }), 'IF72288 is no longer Packed in NetSuite → take it off this truck');
});

test('ifSuggestions: new IFs on the truck TOs or no_if TOs, not on the truck, not taken', () => {
    const planned = [VIF(9001, 500, 504), VIF(9050, 700, 120, '11'), VIF(9051, 500, 48), VIF(9052, 800, 10), VIF(9053, 700, 5, '11')];
    const diffs = [{ kind: 'no_if', item: '11', qty: 120, toId: '700', toNum: 'TO700' }];
    assert.deepEqual(v.ifSuggestions({ truckIfs: [VIF(9001, 500, 504)], diffs, planned, takenIfIds: { 9053: true } }).map(f => f.ifId), ['9050', '9051']);
});

test('correctionOps', () => {
    const ops = v.correctionOps([
        { key: 'if_short:9001:975', kind: 'if_short', ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', item: '975', ifQty: 504, loaded: 480 },
        { key: 'no_if:11', kind: 'no_if', item: '11', qty: 120, toId: '700', toNum: 'TO700' },
        { key: 'no_if:999', kind: 'no_if', item: '999', qty: 5, toId: null, toNum: null },
        { key: 'if_empty:9002', kind: 'if_empty', ifId: '9002', ifNum: 'IF9002' }]);
    assert.deepEqual(ops, [
        { op: 'if_qty', ifId: '9001', ifNum: 'IF9001', toId: '500', item: '975', from: 504, to: 480, key: 'if_short:9001:975' },
        { op: 'if_create', toId: '700', toNum: 'TO700', lines: { 11: 120 }, ship: false, key: 'no_if:11' },
        { op: 'drop_if', ifId: '9002', ifNum: 'IF9002', key: 'if_empty:9002' }]);
});

test('reservationsFromTrucks: needs_fix/ready reserve loaded surplus like loading; corrections are not double-reserved', () => {
    const o = { mode: 'off', toLines: TOS, loadedByTruck: { 1: { 975: 504 + 60 } } };
    const asLoading = v.reservationsFromTrucks(Object.assign({ trucks: [{ id: '1', status: T.LOADING, data: { v3: true, ifs: IFS } }] }, o));
    ['needs_fix', 'ready'].forEach(st => {
        assert.equal(T.NEEDS_FIX, 'needs_fix'); assert.equal(T.READY, 'ready');
        assert.deepEqual(v.reservationsFromTrucks(Object.assign({ trucks: [{ id: '1', status: st, data: { v3: true, ifs: IFS } }] }, o)), asLoading);
    });
    assert.ok(Object.keys(asLoading).length > 0);
    // corrections on a needs_fix truck don't add a second reservation: only the surplus is reserved, once
    const fixing = { id: '2', status: T.NEEDS_FIX, data: { v3: true, ifs: IFS, writes: {}, corrections: [
        { op: 'if_qty', ifId: '8', toId: '500', item: '975', from: 100, to: 112 }, { op: 'if_create', toId: '700', lines: { 11: 120 }, ship: false }] } };
    const loadedFix = { 2: { 975: 504 + 60 } };
    const base = v.reservationsFromTrucks({ mode: 'off', trucks: [{ id: '2', status: T.LOADING, data: { v3: true, ifs: IFS } }], toLines: TOS, loadedByTruck: loadedFix });
    assert.deepEqual(v.reservationsFromTrucks({ mode: 'off', trucks: [fixing], toLines: TOS, loadedByTruck: loadedFix }), base);
    assert.deepEqual(v.reservationsFromTrucks({ mode: 'off', exceptId: '2', trucks: [fixing], toLines: TOS, loadedByTruck: loadedFix }), {});
});

test('verifyLoad keeps a gone IF (flagged) in keep; a gone IF stays gone on the next verify', () => {
    const r1 = v.verifyLoad({ savedIfs: [VIF(9001, 500, 504), VIF(9002, 500, 504)], freshIfs: [VIF(9002, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual(r1.keep.map(f => [f.ifId, !!f.gone]), [['9002', false], ['9001', true]]);
    assert.deepEqual(r1.keep[1].lines, VIF(9001, 500, 504).lines);
    const r2 = v.verifyLoad({ savedIfs: r1.keep, freshIfs: [VIF(9002, 500, 504)], pallets: onTruck(42), toLines: TOS });
    assert.deepEqual([r2.match, r2.diffs.map(d => d.kind)], [false, ['if_gone']]);
    assert.deepEqual(r2.keep.map(f => [f.ifId, !!f.gone]), [['9002', false], ['9001', true]]);
    assert.deepEqual(v.liveIfs(r2.keep).map(f => f.ifId), ['9002']);
});

test('reservationsFromTrucks skips a gone IF on an open truck', () => {
    const live = { id: '1', status: T.NEEDS_FIX, data: { v3: true, ifs: [VIF(9001, 500, 504)] } };
    const gone = { id: '1', status: T.NEEDS_FIX, data: { v3: true, ifs: [Object.assign(VIF(9001, 500, 504), { gone: true })] } };
    const o = { loadedByTruck: { 1: { 975: 504 } }, toLines: TOS, mode: 'off' };
    assert.deepEqual(v.reservationsFromTrucks(Object.assign({ trucks: [live] }, o)), {});        // the IF covers the load
    assert.notDeepEqual(v.reservationsFromTrucks(Object.assign({ trucks: [gone] }, o)), {});     // a gone IF covers nothing: surplus takes TO room
});

test('verifyLoad: a truck with no live IF is never a match (no_ifs)', () => {
    const r = v.verifyLoad({ savedIfs: [], freshIfs: [], pallets: [], toLines: TOS });
    assert.deepEqual([r.match, r.diffs.map(d => d.kind)], [false, ['no_ifs']]);
    assert.equal(v.diffText(r.diffs[0]), 'This truck has no IF → add one');
    const g = v.verifyLoad({ savedIfs: [Object.assign(VIF(9001, 500, 504), { gone: true })], freshIfs: [], pallets: onTruck(1), toLines: TOS });
    assert.deepEqual(g.diffs.map(d => d.kind), ['if_gone', 'no_ifs', 'no_if']);
    assert.deepEqual(v.correctionOps([{ key: 'no_ifs', kind: 'no_ifs' }]), []);
});
