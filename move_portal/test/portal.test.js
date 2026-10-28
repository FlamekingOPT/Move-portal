const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const { makeFakeData } = require('./fake_data');
const { makeFakeTx } = require('./fake_tx');
const verify = loadAmd('move_verify.js');
const { makeSnapshotNs } = require('../local/snapshot_ns');

function setup(opts) {
    opts = opts || {};
    const rt = { deploymentId: opts.deploymentId || 'customdeploy_move_portal', userId: opts.userId != null ? opts.userId : 5 };
    const data = makeFakeData(core);
    const tx = makeFakeTx();
    data.db.items.push({ item: '11', sku: 'YSN201', desc: '20# cylinder', upc: '111' }, { item: '12', sku: 'YSN301', desc: '30# cylinder', upc: '112' });
    data.db.stock['35'] = { '11': { onHand: 1200, avail: 1000 }, '12': { onHand: 600, avail: 600 } };
    data.db.configs.push({ item: '11', code: 'A', pcs: 120, isDefault: true, batch: 'B1' }, { item: '12', code: 'A', pcs: 60, isDefault: true, batch: 'B1' });
    const ns = makeSnapshotNs(verify, JSON.parse(JSON.stringify(require('./fixtures/snapshot_sample.json'))));
    data.db.items.push({ item: '975', sku: 'YSN100', desc: '100# cylinder', upc: '0975' });
    data.db.configs.push({ item: '975', code: 'A', pcs: 12, isDefault: true, batch: 'B1' });
    const sl = loadAmd('sl_move_portal.js', {
        'N/runtime': { getCurrentUser: () => ({ id: rt.userId, name: 'Jack K', roleId: 'administrator', role: 3 }), getCurrentScript: () => ({ id: 's', deploymentId: rt.deploymentId }) },
        'N/log': { error() {}, debug() {}, audit() {} },
        'N/render': opts.render || {}, 'N/url': opts.url || {},
        'N/format': { format: () => '10/14/2026 2:14:05 pm', Type: { DATETIMETZ: 'dtz' }, Timezone: { AMERICA_LOS_ANGELES: 'la' } },
        './move_core': core, './move_data': data, './move_tx': tx, './move_label_template': opts.tpl || {}, './move_ui': opts.ui || {}, './move_verify': verify, './move_ns': ns
    });
    const run = (action, a, mgr = true) => sl._runAction(action, Object.assign({ actor: 'Miguel' }, a || {}), mgr);
    return { data, tx, run, ns, sl, rt };
}
let TRN = 0;
function tr() { return 'T' + (++TRN); }   // a unique trailer # per truck_start
const LINE201 = { item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 };
function printLabels(ctx, n, job, lines) {
    ctx.run('print_chunk', { job: job || 'Jtest1', lines: lines || [LINE201], upTo: n, source: 'plan' });
    return ctx.data.palletsByJob(job || 'Jtest1');
}

test('print_chunk creates labels once per job even when retried', () => {
    const ctx = setup();
    printLabels(ctx, 3);
    const again = printLabels(ctx, 3);
    assert.equal(again.length, 3);
    assert.deepEqual([again[0].status, again[0].summary, again[0].edited, again[0].printedDay, again[0].data.printedBy],
        ['labeled', 'YSN201 · A · 120', false, '2026-10-14', 'Miguel']);
    assert.equal(again[0].lines[0].desc, '20# cylinder');
    assert.equal(printLabels(ctx, 5).length, 5);
});

test('floor users cannot print, and a short pallet is flagged EDITED', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('print_chunk', { job: 'J1', lines: [LINE201], upTo: 1 }, false), /Managers only/);
    const ps = printLabels(ctx, 1, 'Jshort', [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 80 }]);
    assert.equal(ps[0].edited, true);
    assert.throws(() => ctx.run('print_chunk', { job: 'Jx', lines: [{ item: '999', pcs: 1 }], upTo: 1 }), /Unknown item/);
    assert.throws(() => ctx.run('print_chunk', { job: 'bad job', lines: [LINE201], upTo: 1 }), /print job id/);
});

test('item_lookup returns stock and configs, exact SKU first', () => {
    const ctx = setup();
    ctx.data.db.items.push({ item: '13', sku: 'YSN2010', desc: 'x', upc: '' });
    const r = ctx.run('item_lookup', { q: 'ysn201' }, false);
    assert.equal(r.items[0].sku, 'YSN201');
    assert.equal(r.items[0].onHand, 1200);
    assert.deepEqual(r.items[0].cfgs, [{ code: 'A', pcs: 120, isDefault: true }]);
});

test('label requests: floor asks, manager prints once, radio requests keep the caller name', () => {
    const ctx = setup();
    const { id } = ctx.run('req_create', { lines: [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 52 }], count: 2, note: 'aisle 3' }, false);
    assert.equal(ctx.run('req_list', { mine: true }, false).reqs[0].summary, 'YSN301 · A · 52');
    assert.throws(() => ctx.run('req_list', { status: 'queued' }, false), /Managers only/);
    assert.equal(ctx.run('req_list', { status: 'queued' }).reqs.length, 1);
    const p1 = ctx.run('req_print', { reqId: id });
    const p2 = ctx.run('req_print', { reqId: id });
    assert.equal(p1.job, p2.job);
    const ps = ctx.data.palletsByJob(p1.job);
    assert.equal(ps.length, 2);
    assert.equal(ps[0].edited, true);
    assert.equal(ps[0].data.source, 'request:' + id);
    assert.equal(ctx.run('req_list', { mine: true }, false).reqs[0].status, 'printed');
    const radio = ctx.run('req_create', { lines: [LINE201], count: 1, via: 'radio', requester: 'Santiago' });
    assert.equal(ctx.data.getReq(radio.id).requester, 'Santiago');
    const floorRadio = ctx.run('req_create', { lines: [LINE201], count: 1, via: 'radio', requester: 'Santiago' }, false);
    assert.equal(ctx.data.getReq(floorRadio.id).requester, 'Miguel');
    ctx.run('req_cancel', { reqId: floorRadio.id }, false);
    assert.equal(ctx.data.getReq(floorRadio.id).status, 'cancelled');
    assert.throws(() => ctx.run('req_create', { lines: [LINE201], count: 51 }, false), /1 to 50/);
});

test('void only unloaded labels; relabel prints a new one and voids the old', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2);
    assert.throws(() => ctx.run('pallet_void', { palletId: ps[0].id, reason: 'Sent to customer' }, false), /Managers only/);   // the floor can't void
    ctx.run('pallet_void', { palletId: ps[0].id, reason: 'Sent to customer' });
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'void');
    assert.throws(() => ctx.run('pallet_void', { palletId: ps[0].id }), /Only labels not on a load/);
    assert.throws(() => ctx.run('pallet_relabel', { palletId: ps[1].id, lines: [LINE201] }, false), /Managers only/);
    const r = ctx.run('pallet_relabel', { palletId: ps[1].id, lines: [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 90 }] });
    const fresh = ctx.data.palletsByJob(r.job)[0];
    const old = ctx.data.getPallet(ps[1].id);
    assert.deepEqual([old.status, old.data.replacedBy, fresh.pieces, fresh.edited, r.code], ['void', fresh.id, 90, true, fresh.code]);
    const got = ctx.run('pallet_get', { code: r.code.toLowerCase() }, false).pallet;
    assert.equal(got.edLines[0].cfgs.length, 1);
    assert.throws(() => ctx.run('pallet_get', { code: '12345' }, false), /Not a move label/);
    assert.deepEqual(ctx.run('pallet_reprint', { palletId: fresh.id }).ids, [fresh.id]);
    assert.equal(ctx.data.getPallet(fresh.id).data.printCount, 2);
});

test('relabeling an already-relabeled label is refused', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 1);
    const r = ctx.run('pallet_relabel', { palletId: ps[0].id, lines: [LINE201] });
    assert.throws(() => ctx.run('pallet_relabel', { palletId: ps[0].id, lines: [LINE201] }), new RegExp('was already relabeled as ' + r.code));
});

test('config import: preview flags problems; chunked commit is retry-safe; activate; cleanup', () => {
    const ctx = setup();
    const pv = ctx.run('cfg_preview', { csv: 'SKU,Config,Pcs per pallet,Default\nYSN201,A,120,Y\nYSN201,B,60,N\nYSN301,A,60,\nNOPE,A,5,Y\nYSN301,B,0,N' });
    assert.deepEqual([pv.configs.length, pv.unknownSkus, pv.errors.length, pv.skuCount, pv.noConfigWithStock], [3, ['NOPE'], 1, 2, []]);
    ctx.run('cfg_commit_chunk', { batch: 'B2', configs: pv.configs.slice(0, 2), upTo: 2 });
    ctx.run('cfg_commit_chunk', { batch: 'B2', configs: pv.configs.slice(0, 2), upTo: 2 });
    ctx.run('cfg_commit_chunk', { batch: 'B2', configs: pv.configs.slice(2), upTo: 3 });
    assert.equal(ctx.data.countConfigsInBatch('B2'), 3);
    assert.throws(() => ctx.run('cfg_cleanup', { batch: 'B2' }), /Activate/);
    ctx.run('cfg_activate', { batch: 'B2' });
    assert.equal(ctx.run('cfg_cleanup', { batch: 'B2' }).remaining, 0);
    assert.equal(ctx.data.db.configs.length, 3);
    const list = ctx.run('cfg_list');
    assert.equal(list.rows.find(r => r.sku === 'YSN201').cfgs.length, 2);
    assert.throws(() => ctx.run('cfg_commit_chunk', { batch: 'x', configs: [], upTo: 0 }), /Bad batch/);
});

test('plan counts only pallets scanned onto a truck, never printed-only labels, and lists SKUs with no config', () => {
    const ctx = setup();
    ctx.data.db.items.push({ item: '14', sku: 'NOCFG', desc: '', upc: '' });
    ctx.data.db.stock['35']['14'] = { onHand: 5, avail: 5 };
    printLabels(ctx, 3);                                   // printed, never scanned: counts as nothing
    let r = ctx.run('plan');
    let y201 = r.rows.find(x => x.sku === 'YSN201');
    assert.deepEqual([y201.palletsLeft, y201.labeled, y201.cfg, y201.pcs], [10, 0, 'A', 120]);
    assert.equal(r.labeledPallets, 0);
    assert.equal(r.rows.find(x => x.sku === 'YSN301').palletsLeft, 10);
    assert.deepEqual(r.noConfig.map(x => x.sku), ['NOCFG']);
    assert.equal(r.dayLabel, '2026-10-14');
    ctx.data.db.settings.officeIfs = false;                // scan two of them onto a truck: now they count
    const v = ctx.run('truck_start', { trailer: tr() }, false).view;
    ctx.data.palletsByJob('Jtest1').slice(0, 2).forEach(p => ctx.run('truck_scan', { truckId: v.truck.id, raw: p.code }, false));
    r = ctx.run('plan');
    y201 = r.rows.find(x => x.sku === 'YSN201');
    assert.deepEqual([y201.palletsLeft, y201.labeled, r.labeledPallets], [8, 2, 2]);
});

// ── dashboard ──
const L975 = { item: '975', sku: 'YSN100', cfg: 'A', pcs: 12 };
function truckWith(ctx, n, ifId) {
    const ps = printLabels(ctx, n, 'Jt' + n + Math.random().toString(36).slice(2, 6), [L975]);
    const t = ctx.run('truck_start', { ifIds: [ifId || '9001'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    return { t, ps };
}
// Make NetSuite's IF qty equal what was loaded (a departure needs an exact match now), then Verify → ready.
function matchIf(ctx, ifId, qty) {
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === ifId ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: qty })] }) : f);
}
function readyTruck(ctx, n, ifId) {
    const r = truckWith(ctx, n, ifId);
    const f = ctx.ns.plannedIfs().find(x => x.ifId === (ifId || '9001'));
    if (f && f.lines[0].qty !== n * 12) matchIf(ctx, ifId || '9001', n * 12);
    const v = ctx.run('truck_verify', { truckId: r.t.id }, false);
    assert.equal(v.view.truck.status, 'ready', 'readyTruck: ' + JSON.stringify(v.diffs));
    return r;
}

test('dashboard: trucks per day, waiting queues (non-zero only), one Active loads row per IF with stage and last step', () => {
    const ctx = setup();
    const a = departed(ctx, 42, '5260020');                                           // Truck 1 today, departed
    const b = readyTruck(ctx, 2, '9002');                                             // ready at the dock
    ctx.run('ship_mark', { truckId: b.t.id, seal: '5260021' }, false);                // waiting for manager
    strayOn(ctx, a.t);
    const r = ctx.run('dashboard');
    assert.deepEqual(r.waiting.map(w => [w.queue, w.count]), [['ship', 1], ['flagged', 1], ['receipts', 1]]);
    assert.equal(r.waiting[0].first.indexOf('Trailer'), 0);
    assert.deepEqual([r.tiles.today, r.tiles.plan, r.tiles.total, r.tiles.received, r.tiles.inTransitTrucks, r.tiles.inTransitPallets], [1, 8, 1, 0, 1, 42]);
    assert.deepEqual(r.days[r.days.length - 1], { day: '2026-10-14', n: 1 });
    assert.equal(r.days[0].day, '2026-10-01');
    const rows = [r.rows[1], r.rows[0]];                                              // server order = STAGE_ORDER: Waiting for manager comes before In transit
    assert.deepEqual(r.rows.map(x => [x.ifNum, x.stage]), [['IF9002', 'Waiting for manager'], ['IF9001', 'In transit']]);
    assert.deepEqual([rows[0].truck, rows[0].seal, rows[0].pallets, rows[0].pcs, rows[0].flagged, rows[0].lastKind], ['Truck 1 · 10/14', '5260020', 42, 504, 1, 'confirmed']);
    assert.deepEqual([rows[1].pallets, rows[1].pcs, rows[1].received, rows[1].lastKind, rows[1].lastBy], [2, 24, null, 'marked_shipped', 'Miguel']);
    assert.deepEqual([r.exc.neverLoaded, r.exc.missing], [1, 0]);
    assert.equal(r.m, undefined, 'pallet tracker maths gone');
    const ping = ctx.run('approvals_ping');                                           // the manager page alert poll: one item per decision
    assert.deepEqual(ping.items.map(i => i.key.split(':')[0]), ['ship', 'flag']);
    assert.equal(ping.items[0].text.indexOf('Ship confirmation · Trailer'), 0);
    assert.throws(() => ctx.run('approvals_ping', {}, false), /Managers only/);
    ctx.data.db.settings.trucksPerDay = 6;
    assert.equal(ctx.run('dashboard').tiles.plan, 6);
    assert.throws(() => ctx.run('dashboard', {}, false), /Managers only/);
});

test('dashboard: a received truck stays on Active loads for its receipt day, with stage Received', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 42, '5260022');
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('unload_done', { truckId: t.id }, false);
    ctx.run('receipt_approve', { truckId: t.id });
    let r = ctx.run('dashboard');
    assert.deepEqual([r.rows.length, r.rows[0].stage, r.rows[0].received, r.tiles.received], [1, 'Received', 504, 1]);
    const x = ctx.data.getLoad(t.id);
    ctx.data.updateLoad(x, { data: { recvApprovedAt: '10/13/2026 4:00:00 pm' } });
    r = ctx.run('dashboard');
    assert.equal(r.rows.length, 0);
});

// ── v3 trucks ──

test('truck_planned lists A/B IFs not on a truck; truck_start takes one', () => {
    const ctx = setup();
    const r = ctx.run('truck_planned');
    assert.deepEqual(r.planned.map(f => [f.ifNum, f.pcs, f.estPallets]), [['IF9001', 504, 42], ['IF9002', 504, 42]]);
    const v1 = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'P1' }).view;
    assert.deepEqual([v1.truck.status, v1.truck.label, v1.lines[0].expected, v1.lines[0].scanned], ['loading', 'Trailer P1', 504, 0]);
    assert.deepEqual(ctx.run('truck_planned').planned.map(f => f.ifNum), ['IF9002']);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }), /already on a truck/);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9000'], trailer: tr() }), /not Picked\/Packed/);
});

test('truck_scan: ok, dup, no_to blocked, undo and remove', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2, 'Jscan', [L975]);
    const bad = printLabels(ctx, 1, 'Jbad', [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 60 }]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    const r = ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code });
    assert.deepEqual([r.result, r.tone, r.view.lines[0].scanned], ['ok', 'ok', 12]);
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code }).result, 'dup');
    const b = ctx.run('truck_scan', { truckId: t.id, raw: bad[0].code });
    assert.deepEqual([b.result, b.sku, b.tone], ['no_to', 'YSN301', 'bad']);
    assert.equal(ctx.data.getPallet(bad[0].id).status, 'labeled');
    ctx.run('truck_scan', { truckId: t.id, raw: ps[1].code });
    assert.equal(ctx.run('truck_undo', { truckId: t.id }).view.lines[0].scanned, 12);
    assert.equal(ctx.run('truck_remove', { truckId: t.id, palletId: ps[0].id }).view.lines[0].scanned, 0);
    assert.equal(ctx.data.db.scans.length, 4);
});

test('truck_scan: pallet on another loading truck → other_truck → move here', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 1, 'Jmv', [L975]);
    const a = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    const b = ctx.run('truck_start', { ifIds: ['9002'], trailer: tr() }).view.truck;
    ctx.run('truck_scan', { truckId: a.id, raw: ps[0].code });
    const r = ctx.run('truck_scan', { truckId: b.id, raw: ps[0].code });
    assert.deepEqual([r.result, r.otherLabel], ['other_truck', a.label]);
    assert.equal(ctx.run('truck_move_here', { truckId: b.id, palletId: ps[0].id }).view.lines[0].scanned, 12);
    assert.equal(ctx.data.getPallet(ps[0].id).loadId, b.id);
});

test('depart: exact match → floor departs, stamps planned only in off mode, pallets in transit, truck # 1', () => {
    const ctx = setup();
    const { t, ps } = readyTruck(ctx, 42);
    const r = ship(ctx, { truckId: t.id, seal: '5249330' });
    assert.equal(r.departed, true);
    const dd = ctx.data.getLoad(t.id).data;
    assert.deepEqual([dd.depart.truckNo, dd.plan.length, dd.plan[0].op], [1, 1, 'if_stamp']);
    assert.deepEqual([r.view.truck.status, r.view.truck.label, r.view.truck.depart.carrier], ['departed', 'Truck 1 · 10/14', 'ArcBest']);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'in_transit');
    const t2 = readyTruck(ctx, 1, '9002').t;                                  // IF9001 is taken by the departed truck
    assert.throws(() => ship(ctx, { truckId: t2.id, seal: '5249330' }), new RegExp('Seal 5249330 is already on ' + t.label));
});

test('depart: a failed write leaves the truck departing with an error; a manager retry finishes without rewriting', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 42);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ship(ctx, { truckId: t.id, seal: '5249332' }), /NetSuite write failed/);
    assert.equal(ctx.data.getLoad(t.id).status, 'departing');
    assert.throws(() => ctx.run('depart_retry', { truckId: t.id }, false), /Managers only/);
    assert.equal(ctx.run('depart_retry', { truckId: t.id }).departed, true);
    assert.deepEqual(ctx.tx._t.ops.map(o => o.op), ['if_stamp']);
});

// ── v3 trucks: review round 1 ──
test('retry skips keys already written; pallets stay loaded until the retry finishes', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const ps = printLabels(ctx, 42, 'Jtwo', [L975]).concat(printLabels(ctx, 42, 'Jtwo2', [L975]));   // fills IF9001 and IF9002 exactly: two stamps
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');
    ctx.tx._t.failOn = 'if_stamp:9002';
    assert.throws(() => ship(ctx, { truckId: t.id, seal: '5249340' }), /NetSuite write failed/);
    const ld = ctx.data.getLoad(t.id);
    assert.ok(ld.data.error);
    assert.deepEqual(Object.keys(ld.data.writes), ['if_stamp:9001']);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'loaded');
    assert.equal(ctx.run('depart_retry', { truckId: t.id }).departed, true);
    assert.deepEqual(ctx.tx._t.ops.map(o => o.op + ':' + o.ifId), ['if_stamp:9001', 'if_stamp:9002']);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'in_transit');
    assert.equal(ctx.data.getLoad(t.id).data.error, '');
});

test('retry is refused while the departure is still running, and on a loading truck', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 42);
    assert.throws(() => ctx.run('depart_retry', { truckId: t.id }), /Nothing to retry/);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ship(ctx, { truckId: t.id, seal: '5249341' }), /NetSuite write failed/);
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { error: '', workingAt: Date.now() } });
    assert.throws(() => ctx.run('depart_retry', { truckId: t.id }), /still running/);
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { workingAt: 1 } });
    assert.equal(ctx.run('depart_retry', { truckId: t.id }).departed, true);
});

test('a claim stolen mid-write stops the next op and leaves pallets loaded', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t, ps } = readyTruck(ctx, 42);
    ctx.tx._t.onApply = () => { ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: 'stolen' } }); };
    assert.throws(() => ship(ctx, { truckId: t.id, seal: '5249342' }), /already being/);
    assert.equal(ctx.tx._t.ops.length, 1);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'loaded');
});

test('an empty IF blocks Ready; dropped by a manager, it goes back to the planned list and the truck departs', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Junp', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    assert.deepEqual(ctx.run('truck_verify', { truckId: t.id }, false).diffs.map(d => d.kind), ['if_empty']);
    assert.equal(ctx.run('truck_drop_if', { truckId: t.id, ifId: '9002' }).view.truck.status, 'ready');
    assert.equal(ship(ctx, { truckId: t.id, seal: '5249343' }).departed, true);
    assert.deepEqual(ctx.run('truck_planned').planned.map(f => f.ifNum), ['IF9002']);
});

test('off mode saves the would-write plan and allocation', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    ship(ctx, { truckId: t.id, seal: '5249344' });
    const d = ctx.data.getLoad(t.id).data;
    assert.ok(d.plan.some(o => o.op === 'if_stamp'));
    assert.equal(d.alloc.find(a => a.ifId === '9001').lines['975'], 504);
});

// ── v3 trucks: review round 2 ──
test('double-tap confirm: a second confirm that sees a departed record is refused and changes nothing', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 42);
    const realGet = ctx.data.getLoad;
    let armed = true;
    // After the confirm's first read, the "other request" has already claimed and saved its plan.
    ctx.data.getLoad = id => {
        const r = realGet(id);
        if (armed && String(id) === String(t.id) && r.status === 'ready') {
            armed = false;
            ctx.data.updateLoad(r, { status: 'departing', data: { depart: { truckNo: 1, day: '2026-10-14', seal: '5249350', trailer: '1' }, writes: { 'if_create:500': '777' }, claim: 'first', workingAt: Date.now() } });
        }
        return r;
    };
    assert.throws(() => ship(ctx, { truckId: t.id, seal: '5249351' }), /already departing/);
    ctx.data.getLoad = realGet;
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.depart.seal, d.data.writes], ['departing', 'first', '5249350', { 'if_create:500': '777' }]);
    assert.equal(ctx.tx._t.ops.length, 0);
});

test('a finished departure clears claim, workingAt and phase', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    ship(ctx, { truckId: t.id, seal: '5249352' });
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.workingAt, d.data.phase], ['departed', '', 0, '']);
});

// ── v3 unload and receipt approval ──
// Floor marks shipped, then a manager confirms (rework Task 2). A mark that stops (needsFix) is returned as is.
function ship(ctx, a) {
    const opt = o => Object.assign(o, a.actor ? { actor: a.actor } : {});
    const m = ctx.run('ship_mark', opt({ truckId: a.truckId, seal: a.seal, carrier: a.carrier }), false);
    return m.needsFix ? m : ctx.run('ship_confirm', opt({ truckId: a.truckId }));
}
function departed(ctx, n, seal, ifId) {
    const { t, ps } = readyTruck(ctx, n, ifId);
    ship(ctx, { truckId: t.id, seal: seal || '5249340' });
    return { t, ps };
}

test('unload: ok, dup, never loaded flagged, undo, done → manager receipt with missing pallets', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 42);
    const stray = printLabels(ctx, 1, 'Jstray', [L975]);
    assert.deepEqual(ctx.run('unload_list').trucks.map(x => x.label), ['Truck 1 · 10/14']);
    const r = ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.view.counts], ['ok', { in: 1, of: 42 }]);
    assert.equal(ctx.data.getLoad(t.id).status, 'receiving');
    assert.equal(ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false).result, 'dup');
    const nl = ctx.run('unload_scan', { truckId: t.id, raw: stray[0].code }, false);
    assert.equal(nl.result, 'never_loaded');
    assert.equal(ctx.data.getPallet(stray[0].id).data.flag, 'never_loaded');
    ps.slice(1, 40).forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('unload_scan', { truckId: t.id, raw: ps[40].code }, false);
    assert.equal(ctx.run('unload_undo', { truckId: t.id }, false).view.counts.in, 40);
    ctx.run('unload_done', { truckId: t.id }, false);
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }, false), /Managers only/);
    assert.deepEqual([ctx.run('approvals').receipts[0].canApprove, ctx.run('approvals').receipts[0].warn], [true, '1 flagged pallet still to decide']);   // the stray warns, no longer blocks
    ctx.run('pallet_reject', { truckId: t.id, palletId: stray[0].id, note: 'not ours' });
    const pv = ctx.run('receipt_preview', { truckId: t.id });
    assert.deepEqual(pv.perIf, [{ ifId: '9001', ifNum: 'IF9001', shipped: 504, received: 480, short: 24 }]);
    const ap = ctx.run('receipt_approve', { truckId: t.id });
    assert.equal(ap.missing.length, 2);
    assert.deepEqual(ap.written, []);                                     // off mode: plan only
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.recvSeq, x.data.received], ['received', 1, { 9001: { 975: 480 } }]);
    assert.deepEqual(x.data.rplan.map(o => [o.op, o.lines[975], o.seal]), [['receipt', 480, '5249340']]);
    assert.equal(ctx.data.getPallet(ps[41].id).status, 'missing');
    assert.equal(ctx.data.getPallet(ps[0].id).data.postedSeq, 1);
});

test('unload: late arrival → second receipt for only the new pallets; pallet from another truck', () => {
    const ctx = setup();
    const a = departed(ctx, 42, 'S1');
    a.ps.slice(0, 41).forEach(p => ctx.run('unload_scan', { truckId: a.t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: a.t.id });
    const late = ctx.run('unload_scan', { truckId: a.t.id, raw: a.ps[41].code }, false);
    assert.equal(late.result, 'late');
    const ap = ctx.run('receipt_approve', { truckId: a.t.id });
    assert.deepEqual(ctx.data.getLoad(a.t.id).data.rplan.map(o => [o.lines[975], o.seq]), [[492, 1], [12, 2]]);
    assert.deepEqual(ap.missing, []);
    // a pallet of truck A scanned while unloading truck B
    const ctx2 = setup();
    const A = departed(ctx2, 1, 'S2');
    const B = departed(ctx2, 1, 'S3', '9002');
    const o = ctx2.run('unload_scan', { truckId: B.t.id, raw: A.ps[0].code }, false);
    assert.equal(o.result, 'other_truck');
    assert.equal(ctx2.run('unload_other', { palletId: A.ps[0].id }, false).view.counts.in, 1);
});

// A second Packed IF (YSN201 ×240 on TO700) that the office made; add-ons are now real IFs on the truck before it departs.
function ifOn700(ctx) {
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().concat([{ ifId: '9901', ifNum: 'IF9901', status: 'B', trandate: '2026-10-05', toId: '700', toNum: 'TO700', lines: [{ item: '11', sku: 'YSN201', qty: 240 }] }]);
}
test('receipt_approve in on mode writes one receipt per IF, a second TO included', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    ifOn700(ctx);
    const ps = printLabels(ctx, 2, 'Jon', [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }]).concat(printLabels(ctx, 42, 'Jon2', [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001', '9901'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id }, false);
    ship(ctx, { truckId: t.id, seal: 'S9' });
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const rc = ctx.tx._t.ops.filter(o => o.op === 'receipt');
    assert.deepEqual(rc.map(o => [o.ifId, o.toId, JSON.stringify(o.lines)]), [['9001', '500', '{"975":504}'], ['9901', '700', '{"11":240}']]);
});

function mixedOnTruck(ctx, seal) {
    ifOn700(ctx);
    const ps = printLabels(ctx, 2, 'Jm' + seal, [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }]).concat(printLabels(ctx, 42, 'Jn' + seal, [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001', '9901'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id }, false);
    ship(ctx, { truckId: t.id, seal: seal });
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    return { t, ps };
}

test('receipt_approve refuses a truck that is not unloadable, and a claim race on status', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 3);                       // still loading
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }), /not ready to unload/);
    const d = departed(ctx, 3, 'SG1', '9002');
    d.ps.forEach(p => ctx.run('unload_scan', { truckId: d.t.id, raw: p.code }, false));
    const realGet = ctx.data.getLoad;
    let armed = true;
    ctx.data.getLoad = id => {                             // between the first read and the claim, the truck goes back to departing
        const r = realGet(id);
        if (armed && String(id) === String(d.t.id) && r.status === 'receiving') {
            armed = false;
            ctx.data.updateLoad(r, { status: 'departing' });
            return r;
        }
        return r;
    };
    assert.throws(() => ctx.run('receipt_approve', { truckId: d.t.id }), /not ready to approve/);
    ctx.data.getLoad = realGet;
    assert.equal(ctx.data.getLoad(d.t.id).status, 'departing');
    assert.equal(ctx.tx._t.ops.length, 0);
});

test('failed receipt write in on mode restores status, saves the error, and a re-approve skips written keys', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = mixedOnTruck(ctx, 'SF1');
    ctx.tx._t.failOn = 'receipt:9901:1';
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }), /Receipt write failed/);
    let x = ctx.data.getLoad(t.id);
    assert.equal(x.status, 'receiving');
    assert.match(x.data.error, /fake failure on receipt:9901:1/);
    assert.ok(x.data.writes['receipt:9001:1'] && !x.data.writes['receipt:9901:1']);
    assert.equal(x.data.recvSeq, undefined);
    const before = ctx.tx._t.ops.filter(o => o.op === 'receipt').length;
    assert.equal(before, 1);
    ctx.run('receipt_approve', { truckId: t.id });
    const rc = ctx.tx._t.ops.filter(o => o.op === 'receipt');
    assert.deepEqual(rc.map(o => o.ifId), ['9001', '9901']);   // 9001 was not repeated
    x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.recvSeq, x.data.error], ['received', 1, '']);
});

test('a finished approval clears claim, workingAt and phase', () => {
    const ctx = setup();
    const { t } = departed(ctx, 2, 'SC1');
    ctx.run('unload_scan', { truckId: t.id, raw: ctx.data.palletsByLoad(t.id, ['in_transit'])[0].code }, false);
    ctx.run('receipt_approve', { truckId: t.id });
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.workingAt, d.data.phase], ['received', '', 0, '']);
});

// ── v3 unload: review round 1 ──
test('approving: a stale or errored claim can be re-approved; a fresh one is refused; scans stay refused', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 2, 'SR1');
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { status: 'approving', data: { claim: 'old', workingAt: Date.now(), phase: 'receive', prevStatus: 'receiving' } });
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }), /already being approved/);
    assert.throws(() => ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false), /not ready to unload/);
    assert.equal(ctx.run('unload_get', { truckId: t.id }, false).view.counts.in, 2);
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { workingAt: Date.now() - 11 * 60 * 1000 } });
    ctx.run('receipt_approve', { truckId: t.id });
    assert.equal(ctx.data.getLoad(t.id).status, 'received');
});

test('approving with a saved error restores the saved prevStatus on another failure', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = mixedOnTruck(ctx, 'SR2');
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { status: 'approving', data: { claim: 'old', workingAt: Date.now(), error: 'boom', prevStatus: 'receiving' } });
    ctx.tx._t.failOn = 'receipt:9001:1';
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }), /Receipt write failed/);
    assert.equal(ctx.data.getLoad(t.id).status, 'receiving');
});

test('late arrival keeps the received truck in unload_list; rplan has each op once after a retry', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = mixedOnTruck(ctx, 'SR3');
    ctx.tx._t.failOn = 'receipt:9901:1';
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }), /Receipt write failed/);
    assert.equal((ctx.data.getLoad(t.id).data.rplan || []).length, 0);
    ctx.run('receipt_approve', { truckId: t.id });
    assert.deepEqual(ctx.data.getLoad(t.id).data.rplan.map(o => o.ifId + ':' + o.seq), ['9001:1', '9901:1']);
    assert.deepEqual(ctx.run('unload_list', {}, false).trucks, []);
    const ctx2 = setup();
    const a = departed(ctx2, 2, 'SR4');
    ctx2.run('unload_scan', { truckId: a.t.id, raw: a.ps[0].code }, false);
    ctx2.run('receipt_approve', { truckId: a.t.id });
    ctx2.run('unload_scan', { truckId: a.t.id, raw: a.ps[1].code }, false);
    assert.deepEqual(ctx2.run('unload_list', {}, false).trucks.map(x => x.id), [a.t.id]);
});

test('postedSeq is stamped only on pallets in the plan', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 3, 'SR5');
    ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false);
    ctx.data.db.settings.writeMode = 'on';
    const realApply = ctx.tx.apply;
    ctx.tx.apply = op => { ctx.data.updatePallet(ctx.data.getPallet(ps[1].id), { status: 'received' }); return realApply(op); };   // lands after the plan was computed
    ctx.run('receipt_approve', { truckId: t.id });
    ctx.tx.apply = realApply;
    assert.equal(ctx.data.getPallet(ps[0].id).data.postedSeq, 1);
    assert.equal(ctx.data.getPallet(ps[1].id).data.postedSeq, undefined);
});

test('unload_other and unload_damaged log scans; flagged, undo-skips-posted, damaged', () => {
    const ctx = setup();
    const A = departed(ctx, 2, 'SU1');
    departed(ctx, 1, 'SU2', '9002');
    const n0 = ctx.data.db.scans.length;
    ctx.run('unload_other', { palletId: A.ps[0].id }, false);
    assert.deepEqual(ctx.data.db.scans.slice(n0).map(s => s.result), ['ok']);
    ctx.run('unload_damaged', { palletId: A.ps[0].id }, false);
    assert.equal(ctx.data.getPallet(A.ps[0].id).damaged, true);
    assert.equal(ctx.data.db.scans[ctx.data.db.scans.length - 1].result, 'damaged');
    const stray = printLabels(ctx, 1, 'Jstray2', [L975]);
    ctx.run('unload_scan', { truckId: A.t.id, raw: stray[0].code }, false);
    assert.deepEqual(ctx.run('unload_get', { truckId: A.t.id }, false).view.flagged.map(p => p.id), [stray[0].id]);
    ctx.run('unload_scan', { truckId: A.t.id, raw: A.ps[1].code }, false);
    ctx.run('pallet_reject', { truckId: A.t.id, palletId: stray[0].id, note: 'not ours' });   // a flagged pallet must be decided before the receipt
    ctx.run('receipt_approve', { truckId: A.t.id });
    assert.equal(ctx.run('unload_undo', { truckId: A.t.id }, false).view.counts.in, 2);   // posted pallets are not undone
    assert.throws(() => ctx.run('unload_damaged', { palletId: stray[0].id }, false), /Scan the pallet in first/);
});

test('a stuck approving truck is listed and previewable; prevStatus is saved with the claim', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 2, 'SS1');
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { status: 'approving', data: { claim: 'old', workingAt: Date.now(), phase: 'receive' } });
    assert.deepEqual(ctx.run('unload_list', {}, false).trucks, []);            // fresh claim: still running
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { workingAt: Date.now() - 11 * 60 * 1000 } });
    assert.deepEqual(ctx.run('unload_list', {}, false).trucks.map(x => x.id), [t.id]);
    assert.equal(ctx.run('receipt_preview', { truckId: t.id }).perIf.length, 1);
    let seen;
    const realApply = ctx.tx.apply;
    ctx.data.db.settings.writeMode = 'on';
    ctx.tx.apply = op => { seen = ctx.data.getLoad(t.id).data.prevStatus; return realApply(op); };
    ctx.run('receipt_approve', { truckId: t.id });
    assert.equal(seen, 'receiving');
});

// ── v3 approvals and report ──
test('approvals lists receipts waiting (no departures section)', () => {
    const ctx = setup();
    truckWith(ctx, 40);                                                       // a loading truck is not an approval
    const d = departed(ctx, 1, 'P2', '9002');
    ctx.run('unload_scan', { truckId: d.t.id, raw: d.ps[0].code }, false);
    ctx.run('unload_done', { truckId: d.t.id }, false);
    const r = ctx.run('approvals');
    assert.deepEqual([r.departures, r.retries], [undefined, []]);
    assert.deepEqual(r.receipts.map(x => [x.truck.id, x.perIf[0].received]), [[d.t.id, 12]]);
    assert.throws(() => ctx.run('approvals', {}, false), /Managers only/);
});

test('approvals surfaces stuck departing trucks (error or stale) and stuck approving trucks', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 42);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ship(ctx, { truckId: t.id, seal: 'S1' }), /NetSuite write failed/);
    assert.deepEqual(ctx.run('approvals').retries.map(x => x.id), [t.id]);          // error set
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { error: '', workingAt: Date.now() } });
    assert.deepEqual(ctx.run('approvals').retries, []);                              // fresh claim: still running
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { workingAt: 1 } });
    assert.deepEqual(ctx.run('approvals').retries.map(x => x.id), [t.id]);          // stale
    ctx.run('depart_retry', { truckId: t.id });

    const d = departed(ctx, 2, 'S2', '9002');
    d.ps.forEach(p => ctx.run('unload_scan', { truckId: d.t.id, raw: p.code }, false));
    ctx.data.updateLoad(ctx.data.getLoad(d.t.id), { status: 'approving', data: { claim: 'old', workingAt: Date.now(), phase: 'receive', prevStatus: 'receiving' } });
    assert.deepEqual(ctx.run('approvals').receipts, []);                             // approving and fresh
    ctx.data.updateLoad(ctx.data.getLoad(d.t.id), { data: { error: 'boom' } });
    let r = ctx.run('approvals').receipts;
    assert.deepEqual(r.map(x => [x.truck.id, x.stuck, x.perIf[0].received]), [[d.t.id, true, 24]]);
    ctx.data.updateLoad(ctx.data.getLoad(d.t.id), { data: { error: '', workingAt: 1 } });
    assert.deepEqual(ctx.run('approvals').receipts.map(x => [x.truck.id, x.stuck]), [[d.t.id, true]]);   // stale
});

test('report compares plan with the snapshot', () => {
    const ctx = setup();
    departed(ctx, 42, '5249300');
    const r = ctx.run('report');
    assert.ok(r.rows.some(x => x.ifNum === 'IF9001' && x.check === 'IF qty YSN100' && x.ok === null));   // IF9001 is still B in the snapshot
    assert.deepEqual([r.days[0].trucks, r.days[0].pallets, r.writeMode], [1, 42, 'off']);
});

test('approvals: a receipt entry that throws becomes an error entry; stuck approving without unposted pallets is still listed', () => {
    const ctx = setup();
    const a = departed(ctx, 2, 'R1', '9001'), b = departed(ctx, 2, 'R2', '9002');
    [a, b].forEach(d => { ctx.run('unload_scan', { truckId: d.t.id, raw: d.ps[0].code }, false); ctx.run('unload_done', { truckId: d.t.id }, false); });
    const orig = verify.planReceipts;
    let n = 0;
    verify.planReceipts = function () { if (++n === 1) throw new Error('plan broke'); return orig.apply(this, arguments); };
    let r;
    try { r = ctx.run('approvals').receipts; } finally { verify.planReceipts = orig; }
    assert.equal(r.length, 2);
    const bad = r.filter(x => x.error), good = r.filter(x => !x.error);
    assert.deepEqual([bad.length, bad[0].error, Object.keys(bad[0].truck).sort(), good.length], [1, 'plan broke', ['id', 'label'], 1]);
    // stuck approving with every received pallet already posted
    ctx.data.palletsByLoad(a.t.id, ['received']).forEach(p => ctx.data.updatePallet(p, { data: { postedSeq: 1 } }));
    ctx.data.updateLoad(ctx.data.getLoad(a.t.id), { status: 'approving', data: { claim: 'old', workingAt: Date.now(), error: 'boom', prevStatus: 'receiving' } });
    const s = ctx.run('approvals').receipts.filter(x => x.truck.id === a.t.id);
    assert.deepEqual([s.length, s[0].stuck], [1, true]);
});

test('report counts a differing shipped IF qty as a diff, and lists days newest first', () => {
    const ctx = setup();
    const a = departed(ctx, 42, 'D1', '9001'), b = departed(ctx, 42, 'D2', '9002');
    const lb = ctx.data.getLoad(b.t.id);
    ctx.data.updateLoad(lb, { data: { depart: Object.assign({}, lb.data.depart, { day: '2026-10-13' }) } });
    const orig = ctx.ns.ifInfo;
    ctx.ns.ifInfo = () => { const o = orig(); o['9001'].status = 'C'; o['9001'].lines[0].qty = 500; return o; };
    const r = ctx.run('report');
    assert.ok(r.rows.some(x => x.ifNum === 'IF9001' && x.check === 'IF qty YSN100' && x.ok === false));
    assert.deepEqual(r.days.map(d => d.day), ['2026-10-14', '2026-10-13']);
    assert.deepEqual(r.days.map(d => d.diffs), [1, 0]);
});

// ── final-review fix wave ──
function extraIfs(ctx, n) {                                // more planned IFs (12 pcs of YSN100 each, on TO600)
    const orig = ctx.ns.plannedIfs;
    const more = Array.from({ length: n }, (_, i) => ({ ifId: String(9101 + i), ifNum: 'IF' + (9101 + i), status: 'B', trandate: '2026-10-05', toId: '600', toNum: 'TO600',
        lines: [{ item: '975', sku: 'YSN100', qty: 12 }] }));
    ctx.ns.plannedIfs = () => orig().concat(JSON.parse(JSON.stringify(more)));
    return more.map(f => f.ifId);
}
function countCalls(ctx, name) {
    const real = ctx.data[name], c = { n: 0, ids: [] };
    ctx.data[name] = function (id) { c.n++; c.ids.push(String(id)); return real.apply(this, arguments); };
    return c;
}

test('fix2: unposted and missing flags stay consistent through scan, undo, approval and a late arrival', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 3, 'F1');
    const flags = () => { const d = ctx.data.getLoad(t.id).data; return [d.unposted, d.missing]; };
    ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false);
    ctx.run('unload_scan', { truckId: t.id, raw: ps[1].code }, false);
    assert.deepEqual(flags(), [2, undefined]);
    ctx.run('unload_undo', { truckId: t.id }, false);
    assert.deepEqual(flags(), [1, undefined]);
    ctx.run('receipt_approve', { truckId: t.id });
    assert.deepEqual(flags(), [0, 2]);
    ctx.run('unload_scan', { truckId: t.id, raw: ps[2].code }, false);             // late
    assert.deepEqual(flags(), [1, 1]);
    ctx.run('unload_undo', { truckId: t.id }, false);
    assert.deepEqual(flags(), [0, 2]);
    ctx.run('unload_scan', { truckId: t.id, raw: ps[2].code }, false);
    ctx.run('receipt_approve', { truckId: t.id });
    assert.deepEqual(flags(), [0, 1]);
});

test('fix2: unload_list and approvals do not search pallets per truck for fully received trucks', () => {
    const ctx = setup();
    const ids = extraIfs(ctx, 6);
    const done = ids.slice(0, 5).map((id, i) => {
        const d = departed(ctx, 1, 'FR' + i, id);
        ctx.run('unload_scan', { truckId: d.t.id, raw: d.ps[0].code }, false);
        ctx.run('receipt_approve', { truckId: d.t.id });
        return d;
    });
    const open = departed(ctx, 1, 'FR9', ids[5]);
    ctx.run('unload_scan', { truckId: open.t.id, raw: open.ps[0].code }, false);
    ctx.run('unload_done', { truckId: open.t.id }, false);
    const byLoad = countCalls(ctx, 'palletsByLoad'), grouped = countCalls(ctx, 'palletStatusCounts');
    const ul = ctx.run('unload_list', {}, false);
    assert.deepEqual(ul.trucks.map(x => x.id), [open.t.id]);
    assert.deepEqual([byLoad.n, grouped.n], [0, 1]);
    const ap = ctx.run('approvals');
    assert.deepEqual(ap.receipts.map(x => [x.truck.id, x.truck.pallets, x.truck.received]), [[open.t.id, 1, 1]]);
    assert.ok(byLoad.n <= 1, 'palletsByLoad calls: ' + byLoad.ids.join(','));
    assert.ok(byLoad.ids.every(id => id === open.t.id));
    assert.equal(grouped.n, 2);
    assert.equal(done.length, 5);
    ['truck_planned', 'report'].forEach(a => { const b = byLoad.n; ctx.run(a); assert.equal(byLoad.n, b, a + ' searched pallets per truck'); });
    const b0 = byLoad.n, g0 = grouped.n;
    ctx.run('dashboard');                                      // reuses approvals (its one receipt card for the open truck), then one grouped read of its own
    assert.ok(byLoad.n - b0 <= 1, 'dashboard searched pallets per truck: ' + byLoad.ids.join(','));
    assert.ok(byLoad.ids.every(id => id === open.t.id));
    assert.equal(grouped.n - g0, 2);
    assert.equal(grouped.n, 6);
});

test('fix3: a truck scan re-checks the truck right before loading the pallet', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2, 'Jrc', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    const orig = ctx.ns.openToLines;
    ctx.ns.openToLines = () => { ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: 'X' } }); return orig(); };
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code }), /Scanning is closed/);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'labeled');
    ctx.ns.openToLines = orig;
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: '' } });
    const b = ctx.run('truck_start', { ifIds: ['9002'], trailer: tr() }).view.truck;
    ctx.run('truck_scan', { truckId: t.id, raw: ps[1].code });
    ctx.ns.openToLines = () => { ctx.data.updateLoad(ctx.data.getLoad(b.id), { status: 'departing', data: { claim: 'c1' } }); return orig(); };
    assert.throws(() => ctx.run('truck_move_here', { truckId: b.id, palletId: ps[1].id }), /Scanning is closed/);
    assert.equal(ctx.data.getPallet(ps[1].id).loadId, t.id);
});

test('fix3: the scan stack is not written over a truck that closed meanwhile; undo too', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2, 'Jst', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code });
    const realUp = ctx.data.updatePallet;
    ctx.data.updatePallet = (p, patch) => { realUp(p, patch); ctx.data.updateLoad(ctx.data.getLoad(t.id), { status: 'departing', data: { claim: 'other' } }); };
    ctx.run('truck_scan', { truckId: t.id, raw: ps[1].code });
    ctx.data.updatePallet = realUp;
    let d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.stack], ['departing', 'other', [String(ps[0].id)]]);
    ctx.data.updateLoad(d, { status: 'loading', data: { claim: '' } });
    ctx.data.updatePallet = (p, patch) => { realUp(p, patch); ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: 'Y' } }); };
    ctx.run('truck_undo', { truckId: t.id });
    ctx.data.updatePallet = realUp;
    d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.data.claim, d.data.stack.length], ['Y', 1]);
});

test('fix3: an unload scan re-checks the truck right before receiving the pallet', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 2, 'U3');
    const realTrucks = ctx.data.loadsByStatus;
    ctx.data.loadsByStatus = function () { const r = realTrucks.apply(this, arguments); ctx.data.updateLoad(ctx.data.getLoad(t.id), { status: 'approving', data: { claim: 'c' } }); return r; };
    assert.throws(() => ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false), /not ready to unload/);
    ctx.data.loadsByStatus = realTrucks;
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'in_transit');
});

test('fix3: the claim write carries depart, plan, alloc and writes', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    const realUpd = ctx.data.updateLoad;
    let seen = null;
    ctx.data.updateLoad = (L, patch) => { if (patch.status === 'departing' && !seen) seen = patch.data; realUpd(L, patch); };
    ship(ctx, { truckId: t.id, seal: 'C4' });
    ctx.data.updateLoad = realUpd;
    assert.ok(seen.claim && seen.depart && seen.plan && seen.alloc && seen.writes);
    assert.equal(seen.depart.seal, 'C4');
});

test('fix4: an IF the office shipped after Ready stops the departure (if_gone) until a manager drops it', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jif', [L975]).concat(printLabels(ctx, 42, 'Jif2', [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id }, false);
    const orig = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => orig().filter(f => f.ifId !== '9001');
    const r = ship(ctx, { truckId: t.id, seal: 'I2' });
    assert.deepEqual([r.needsFix, r.diffs.map(d => d.kind)], [true, ['if_gone', 'if_over']]);
    assert.deepEqual(ctx.data.getLoad(t.id).data.ifs.map(f => [f.ifId, !!f.gone]), [['9002', false], ['9001', true]]);
});

test('fix5: two trucks want the last 48 pcs of TO room; the second gets no_to, before and after the first departs', () => {
    const ctx = setup();
    const orig = ctx.ns.openToLines;
    ctx.ns.openToLines = () => orig().filter(r => r.toId === '500');              // TO500 has 48 left; no other TO for YSN100
    const a = truckWith(ctx, 46, '9001');                                          // 4 pallets (48 pcs) over IF9001: a raise on TO500
    assert.equal(ctx.data.palletsByLoad(a.t.id, ['loaded']).length, 46);
    const b = truckWith(ctx, 42, '9002');
    const extra = printLabels(ctx, 1, 'Jlast', [L975]);
    const r = ctx.run('truck_scan', { truckId: b.t.id, raw: extra[0].code });
    assert.deepEqual([r.result, r.sku], ['no_to', 'YSN100']);
    // The office raises IF9001 to 552 (TO500 now has no room left), then truck A verifies and departs.
    matchIf(ctx, '9001', 552);
    ctx.ns.openToLines = () => orig().filter(r => r.toId === '500').map(r => Object.assign({}, r, { remaining: 0 }));
    assert.equal(ctx.run('truck_verify', { truckId: a.t.id }, false).view.truck.status, 'ready');
    ship(ctx, { truckId: a.t.id, seal: 'R5' });
    assert.equal(ctx.data.getLoad(a.t.id).status, 'departed');
    assert.equal(ctx.run('truck_scan', { truckId: b.t.id, raw: extra[0].code }).result, 'no_to');
});

test('fix6: on the floor deployment an administrator is a floor user', () => {
    const FLOOR = 'customdeploy_move_portal_floor';
    const ctx = setup({ deploymentId: FLOOR });
    assert.throws(() => ctx.run('dashboard', {}, true), /Managers only/);
    assert.throws(() => ctx.run('depart_retry', { truckId: '1' }, true), /Managers only/);
    const out = {};
    ctx.sl.onRequest({ request: { parameters: { action: 'approvals' }, body: '{}' }, response: { setHeader() {}, write: x => { out.body = x; } } });
    assert.deepEqual(JSON.parse(out.body), { ok: false, error: 'Managers only' });
    const seen = {};
    const pg = setup({ deploymentId: FLOOR, userId: -4, ui: { buildPage: o => { seen.page = o; return 'html'; } }, url: { resolveScript: o => { seen.url = o; return 'https://ext/x'; } } });
    pg.sl.onRequest({ request: { parameters: {} }, response: { write() {} } });
    assert.deepEqual([seen.page.mode, seen.page.url, seen.url.returnExternalUrl, seen.url.deploymentId], ['floor', 'https://ext/x', true, FLOOR]);
    // A logged-in user on the floor deployment (the login-required sandbox test) keeps the internal URL.
    const li = setup({ deploymentId: FLOOR, ui: { buildPage: o => { seen.page = o; return 'html'; } }, url: { resolveScript: o => { seen.url = o; return '/int'; } } });
    li.sl.onRequest({ request: { parameters: {} }, response: { write() {} } });
    assert.deepEqual([seen.page.mode, seen.page.url, !!seen.url.returnExternalUrl], ['floor', '/int', false]);
    const mg = setup({ ui: { buildPage: o => { seen.page = o; return 'html'; } }, url: { resolveScript: o => { seen.url = o; return '/int'; } } });
    mg.sl.onRequest({ request: { parameters: {} }, response: { write() {} } });
    assert.deepEqual([seen.page.mode, !!seen.url.returnExternalUrl], ['manager', false]);
});

test('fix7: approvers are the NetSuite user; the roster name is kept separately', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 40);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ship(ctx, { truckId: t.id, seal: 'A7', actor: 'Boss' }), /NetSuite write failed/);
    ctx.run('depart_retry', { truckId: t.id, actor: 'Boss' });
    let d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([d.depart.approvedBy, d.depart.approvedByRoster, d.retriedBy], [{ id: '5', name: 'Jack K' }, 'Boss', { id: '5', name: 'Jack K' }]);
    ctx.data.palletsByLoad(t.id, ['in_transit']).slice(0, 2).forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code, actor: 'Ana' }, false));
    ctx.run('receipt_approve', { truckId: t.id, actor: 'Boss' });
    d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([d.recvApprovedBy, d.recvApprovedByRoster], [{ id: '5', name: 'Jack K' }, 'Boss']);
    assert.equal(ctx.data.palletsByLoad(t.id, ['received'])[0].data.receivedBy, 'Ana');   // floor actors stay roster names
});

test('fix8: the scan stack keeps the last 30 entries', () => {
    const ctx = setup();
    const { t, ps } = truckWith(ctx, 35);
    const st = ctx.data.getLoad(t.id).data.stack;
    assert.deepEqual([st.length, st[29]], [30, String(ps[34].id)]);
});

test('fix9: never-loaded flags live on the truck; unload view and dashboard read them by id, not by a broad search', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 2, 'N9');
    const stray = printLabels(ctx, 2, 'Jstray9', [L975]);
    const broad = countCalls(ctx, 'findPalletsWhere');
    ctx.run('unload_scan', { truckId: t.id, raw: stray[0].code }, false);
    ctx.run('unload_scan', { truckId: t.id, raw: stray[0].code }, false);           // same stray twice: flagged once
    const v = ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false).view;
    assert.deepEqual(v.flagged.map(p => p.id), [stray[0].id]);
    assert.deepEqual(ctx.data.getLoad(t.id).data.flagged, [String(stray[0].id)]);
    assert.equal(ctx.run('dashboard').exc.neverLoaded, 1);
    assert.equal(broad.n, 0);
    ctx.data.updatePallet(ctx.data.getPallet(stray[0].id), { status: 'void' });           // dealt with: no longer counted
    assert.equal(ctx.run('dashboard').exc.neverLoaded, 0);
    assert.deepEqual(ctx.run('unload_get', { truckId: t.id }, false).view.flagged, []);
});

test('fix10: an empty truck cannot depart (its IF is empty, so it never gets to Ready)', () => {
    const ctx = setup();
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    assert.deepEqual(ctx.run('truck_verify', { truckId: t.id }, false).diffs.map(d => d.kind), ['if_empty']);
    const a = { truckId: t.id, trailer: '537224', seal: 'E10' };
    assert.throws(() => ctx.run('ship_mark', a, false), /Verify the load first/);
    assert.throws(() => ship(ctx, a), /Verify the load first/);
    assert.equal(ctx.data.getLoad(t.id).status, 'needs_fix');
});

test('fix10: a truck emptied right after the claim goes to needs_fix, claim released', () => {
    const ctx = setup();
    const { t, ps } = readyTruck(ctx, 1);
    const realUpd = ctx.data.updateLoad;
    let armed = true;
    ctx.data.updateLoad = (L, patch) => {
        realUpd(L, patch);
        if (armed && patch.status === 'departing') { armed = false; ctx.data.updatePallet(ctx.data.getPallet(ps[0].id), { status: 'labeled', load: '' }); }
    };
    const r = ship(ctx, { truckId: t.id, seal: 'E11' });
    ctx.data.updateLoad = realUpd;
    assert.deepEqual([r.needsFix, r.diffs.map(x => x.kind)], [true, ['if_empty']]);
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.depart], ['needs_fix', '', null]);
});

test('fix11: a load scan that is not a labeled pallet reads no TO lines and no truck list', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 3, 'Jcls', [L975]);
    const a = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    const b = ctx.run('truck_start', { ifIds: ['9002'], trailer: tr() }).view.truck;
    ctx.run('truck_scan', { truckId: a.id, raw: ps[0].code });
    ctx.run('pallet_void', { palletId: ps[1].id });
    const to = { n: 0 }, origTo = ctx.ns.openToLines;
    ctx.ns.openToLines = () => { to.n++; return origTo(); };
    const lists = countCalls(ctx, 'loadsByStatus');
    const res = raw => ctx.run('truck_scan', { truckId: a.id, raw: raw });
    assert.equal(res(ps[0].code).result, 'dup');
    assert.equal(res(ps[1].code).result, 'void');
    assert.equal(res('PLT99999').result, 'unknown');
    const o = ctx.run('truck_scan', { truckId: b.id, raw: ps[0].code });
    assert.deepEqual([o.result, o.otherLabel], ['other_truck', a.label]);
    assert.deepEqual([to.n, lists.n], [0, 0]);
    assert.equal(res(ps[2].code).result, 'ok');
    assert.ok(to.n === 1 && lists.n >= 1);
});

// ── re-review follow-ups ──
test('gate: only the manager deployment with a real user can be manager', () => {
    const odd = setup({ deploymentId: 'customdeploy_something_else' });
    assert.throws(() => odd.run('dashboard', {}, true), /Managers only/);
    const anon = setup({ userId: -4 });
    assert.throws(() => anon.run('dashboard', {}, true), /Managers only/);
    const out = {};
    anon.sl.onRequest({ request: { parameters: { action: 'approvals' }, body: '{}' }, response: { setHeader() {}, write: x => { out.body = x; } } });
    assert.equal(JSON.parse(out.body).error, 'Managers only');
    const seen = {};
    const pg = setup({ deploymentId: 'customdeploy_x', ui: { buildPage: o => { seen.page = o; return 'h'; } }, url: { resolveScript: o => { seen.url = o; return 'u'; } } });
    pg.sl.onRequest({ request: { parameters: {} }, response: { write() {} } });
    assert.equal(seen.page.mode, 'floor');
    const w = {};
    pg.sl.onRequest({ request: { parameters: { action: 'pdf', job: 'J1' } }, response: { write: x => { w.out = x; } } });
    assert.equal(w.out, 'Managers only');
    assert.ok(setup().run('dashboard', {}, true));
});

test('finishDepart moves only the planned pallets; a pallet that slipped on after the plan is left at the dock', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t, ps } = readyTruck(ctx, 42);
    const late = printLabels(ctx, 1, 'Jlate', [L975])[0];
    ctx.tx._t.onApply = () => { ctx.tx._t.onApply = null; ctx.data.updatePallet(ctx.data.getPallet(late.id), { status: 'loaded', load: t.id }); };
    assert.equal(ship(ctx, { truckId: t.id, seal: 'LD1' }).departed, true);
    const lp = ctx.data.getPallet(late.id);
    assert.deepEqual([lp.status, lp.loadId, lp.data.flag], ['labeled', '', 'left_at_dock']);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'in_transit');
    assert.equal(ctx.data.palletsByLoad(t.id, ['in_transit']).length, 42);
});

test('receipt_approve re-checks its claim right before the final write', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 2, 'RA1');
    ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false);
    const real = ctx.data.palletStatusCounts;
    ctx.data.palletStatusCounts = function () { ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: 'other' } }); return real.apply(this, arguments); };
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }), /already being processed/);
    ctx.data.palletStatusCounts = real;
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.recvSeq, d.data.claim], ['approving', undefined, 'other']);
    assert.throws(() => ctx.run('unload_scan', { truckId: t.id, raw: ps[1].code }, false), /not ready to unload/);   // receiveOn refuses while approving
});

// ── Verify Load (Task 2) ──

test('verify: exact → ready; short → needs_fix with instructions; scanning after ready drops back to loading', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    const r = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.deepEqual([r.match, r.view.truck.status], [true, 'ready']);
    const extra = printLabels(ctx, 1, 'Jx1', [L975]);
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: extra[0].code }, false).view.truck.status, 'loading');
    const v2 = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.deepEqual([v2.match, v2.view.truck.status, v2.diffs[0].kind], [false, 'needs_fix', 'if_over']);
    assert.match(v2.diffs[0].text, /IF9001 YSN100: IF 504 · loaded 516 → IF needs \+12 \(1 pallet\)/);
});

test('take off mode: pallet back to labeled, logged; not on truck → refused; ready → loading', () => {
    const ctx = setup();
    const { t, ps } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const r = ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false);
    assert.deepEqual([r.result, r.tone, r.view.truck.status], ['taken_off', 'warn', 'loading']);
    assert.deepEqual([ctx.data.getPallet(ps[0].id).status, ctx.data.getPallet(ps[0].id).loadId], ['labeled', '']);
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false).result, 'not_on_truck');
    assert.equal(ctx.data.db.scans.filter(s => s.result === 'taken_off').length, 1);
});

test('recheck: an office fix in NetSuite turns a needs_fix truck ready', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    assert.equal(ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false).view.truck.status, 'needs_fix');
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 480 })] }) : f);
    const r = ctx.run('trucks_recheck', {}, false);
    assert.deepEqual(r.nowReady.map(x => x.id), [t.id]);
    assert.equal(ctx.data.getLoad(t.id).status, 'ready');
});

test('recheck lists every ready truck with its verify time, so a device that missed nowReady still alerts', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 480 })] }) : f);
    const r1 = ctx.run('trucks_recheck', {}, false);
    const at = ctx.data.getLoad(t.id).data.verify.at;
    assert.deepEqual(r1.ready, [{ id: t.id, label: r1.nowReady[0].label, at: at }]);
    const r2 = ctx.run('trucks_recheck', {}, false);                         // no needs_fix truck left: still listed
    assert.deepEqual([r2.nowReady, r2.ready.map(x => [x.id, x.at])], [[], [[t.id, at]]]);
});

test('recheck does not list a truck that is not ready', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false);
    assert.deepEqual(ctx.run('trucks_recheck', {}, false).ready, []);
});

test('new IF suggestion: floor can add a suggested IF; not an IF on another truck', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 43);                                         // 516 on a 504 IF → over
    const v1 = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.deepEqual(v1.suggestions.map(f => f.ifId), ['9002']);              // same TO500, not on a truck
    const r = ctx.run('truck_add_if', { truckId: t.id, ifId: '9002' }, false);
    assert.deepEqual(r.view.truck.status, 'needs_fix');                       // now 516 vs 1008 → short on IF9002
    assert.throws(() => ctx.run('truck_add_if', { truckId: t.id, ifId: '9000' }, false), /not a suggested IF/);
    assert.throws(() => ctx.run('truck_drop_if', { truckId: t.id, ifId: '9002' }, false), /Managers only/);
    assert.equal(ctx.run('truck_drop_if', { truckId: t.id, ifId: '9002' }).view.truck.status, 'needs_fix');
});

test('scans and verify are refused on a departing truck', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const x = ctx.data.getLoad(t.id);
    ctx.data.updateLoad(x, { data: { claim: 'other', workingAt: Date.now() } });
    assert.throws(() => ctx.run('truck_verify', { truckId: t.id }, false), /closed|departing/);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: 'PLT1', mode: 'off' }, false), /closed/);
});

test('a pallet on a ready truck reads other_truck; move here sends both trucks to loading; remove and undo flip ready too', () => {
    const ctx = setup();
    const { t: a, ps } = truckWith(ctx, 42);
    assert.equal(ctx.run('truck_verify', { truckId: a.id }, false).view.truck.status, 'ready');
    const b = ctx.run('truck_start', { ifIds: ['9002'], trailer: tr() }).view.truck;
    const r = ctx.run('truck_scan', { truckId: b.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.otherLabel], ['other_truck', a.label]);
    ctx.run('truck_move_here', { truckId: b.id, palletId: ps[0].id }, false);
    assert.equal(ctx.data.getLoad(a.id).status, 'loading');
    ctx.data.updateLoad(ctx.data.getLoad(a.id), { status: 'ready' });
    ctx.run('truck_remove', { truckId: a.id, palletId: ps[1].id }, false);
    assert.equal(ctx.data.getLoad(a.id).status, 'loading');
    ctx.data.updateLoad(ctx.data.getLoad(a.id), { status: 'ready' });
    ctx.run('truck_undo', { truckId: a.id }, false);
    assert.equal(ctx.data.getLoad(a.id).status, 'loading');
});

test('verify saves the fresh NetSuite IFs; refuses when the truck changed meanwhile; drop_if keeps one IF', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 480 })] }) : f);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');
    assert.equal(ctx.data.getLoad(t.id).data.ifs[0].lines[0].qty, 480);
    const orig = ctx.data.palletsByLoad;
    let n = 0;
    ctx.data.palletsByLoad = (id, st) => { const r = orig(id, st); return ++n === 2 ? r.slice(1) : r; };
    assert.throws(() => ctx.run('truck_verify', { truckId: t.id }, false), /changed while/);
    ctx.data.palletsByLoad = orig;
    assert.throws(() => ctx.run('truck_drop_if', { truckId: t.id, ifId: '9001' }), /at least one IF/);
});

// ── Verify Load review fixes (I1, I2, M4) ──
function noTrailer(ctx, id) { ctx.data.updateLoad(ctx.data.getLoad(id), { data: { trailer: '' } }); }
function goneIf(ctx, ifId) { const real = ctx.ns.plannedIfs; ctx.ns.plannedIfs = () => real().filter(f => f.ifId !== ifId); }

test('I1: a gone IF persists across verifies and a recheck until a manager drops it', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 43);
    ctx.run('truck_add_if', { truckId: t.id, ifId: '9002' });                // manager
    noTrailer(ctx, t.id);                                                    // an old truck: labeled by its IF numbers
    goneIf(ctx, '9002');
    const kinds = r => r.diffs.map(d => d.kind);
    assert.ok(kinds(ctx.run('truck_verify', { truckId: t.id }, false)).includes('if_gone'));
    assert.ok(kinds(ctx.run('truck_verify', { truckId: t.id }, false)).includes('if_gone'));
    ctx.run('trucks_recheck', {}, false);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.ifs.map(f => [f.ifId, !!f.gone]), x.data.verify.diffs.some(d => d.kind === 'if_gone')], ['needs_fix', [['9001', false], ['9002', true]], true]);
    assert.equal(ctx.run('truck_get', { truckId: t.id }).view.truck.label, 'IF9001 + IF9002');
    const r = ctx.run('truck_drop_if', { truckId: t.id, ifId: '9002' });
    assert.deepEqual([r.diffs.some(d => d.kind === 'if_gone'), r.view.truck.label], [false, 'IF9001']);
});

test('I1: a truck whose only IF is gone keeps its label; the manager drops it; then no IFs and no_if for the load', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    noTrailer(ctx, t.id);                                                    // an old truck: labeled by its IF numbers
    goneIf(ctx, '9001');
    const v = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.deepEqual(v.diffs.map(d => d.kind).sort(), ['if_gone', 'no_if', 'no_ifs']);
    assert.equal(v.view.truck.label, 'IF9001');
    assert.equal(v.view.lines.length, 0);                                    // a gone IF expects nothing
    const r = ctx.run('truck_drop_if', { truckId: t.id, ifId: '9001' });
    assert.deepEqual([r.view.truck.label, r.diffs.map(d => d.kind)], ['No IFs: add one', ['no_ifs', 'no_if']]);
    assert.deepEqual(ctx.data.getLoad(t.id).data.ifs, []);
});

test('I1: the last IF can be dropped only when it is gone', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    assert.throws(() => ctx.run('truck_drop_if', { truckId: t.id, ifId: '9001' }), /at least one IF/);
});

test('I2: a recheck with no change writes nothing and keeps verify at/by', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, actor: 'Ana', shortNote: 'short pick' }, false);
    const before = ctx.data.getLoad(t.id).data.verify;
    const n = countCalls(ctx, 'updateLoad');
    const reads = countCalls(ctx, 'palletsByStatus');
    const r = ctx.run('trucks_recheck', { actor: 'Poller' }, false);
    assert.deepEqual([r.nowReady, n.n, reads.n], [[], 0, 1]);
    assert.deepEqual(ctx.data.getLoad(t.id).data.verify, before);
    ctx.run('truck_verify', { truckId: t.id, actor: 'Bo' }, false);          // unchanged: a manual verify keeps at/by too
    assert.equal(ctx.data.getLoad(t.id).data.verify.by, 'Ana');
});

test('I2: recheck reads planned IFs and TO lines once for all trucks', () => {
    const ctx = setup();
    const a = truckWith(ctx, 40).t, b = truckWith(ctx, 40, '9002').t;
    ctx.run('truck_verify', { truckId: a.id, shortNote: 'short pick' }, false); ctx.run('truck_verify', { truckId: b.id, shortNote: 'short pick' }, false);
    const calls = { p: 0, o: 0 }, rp = ctx.ns.plannedIfs, ro = ctx.ns.openToLines;
    ctx.ns.plannedIfs = () => { calls.p++; return rp(); };
    ctx.ns.openToLines = () => { calls.o++; return ro(); };
    ctx.run('trucks_recheck', {}, false);
    assert.deepEqual(calls, { p: 1, o: 1 });
});

test('M4: recheck skips a truck that throws a user error and still returns the others', () => {
    const ctx = setup();
    const a = truckWith(ctx, 40).t, b = truckWith(ctx, 40, '9002').t;
    ctx.run('truck_verify', { truckId: a.id, shortNote: 'short pick' }, false); ctx.run('truck_verify', { truckId: b.id, shortNote: 'short pick' }, false);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 480 })] }));
    const getLoad = ctx.data.getLoad;
    ctx.data.getLoad = id => { const x = getLoad(id); if (x && String(id) === String(a.id)) x.data.claim = 'departing'; return x; };   // a departure claimed A mid-recheck
    const r = ctx.run('trucks_recheck', {}, false);
    ctx.data.getLoad = getLoad;
    assert.deepEqual(r.nowReady.map(x => x.id), [b.id]);
    assert.equal(ctx.data.getLoad(a.id).status, 'needs_fix');
});

test('M4: a manager adds a non-suggested eligible IF; an IF on another truck is refused for floor and manager', () => {
    const ctx = setup();
    const [ifX] = extraIfs(ctx, 1);                                           // TO600: never suggested for a TO500 truck
    const { t } = truckWith(ctx, 43);
    const v = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.ok(!v.suggestions.some(f => f.ifId === ifX));
    assert.throws(() => ctx.run('truck_add_if', { truckId: t.id, ifId: ifX }, false), /not a suggested IF/);
    assert.ok(ctx.run('truck_add_if', { truckId: t.id, ifId: ifX }).view.lines.some(l => l.ifNum === 'IF' + ifX));
    ctx.run('truck_start', { ifIds: ['9002'], trailer: tr() });
    assert.throws(() => ctx.run('truck_add_if', { truckId: t.id, ifId: '9002' }, false), /on another truck/);
    assert.throws(() => ctx.run('truck_add_if', { truckId: t.id, ifId: '9002' }), /on another truck/);
});

test('M4: take-off reads no TO lines', () => {
    const ctx = setup();
    const { t, ps } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.ns.openToLines = () => { throw new Error('openToLines must not be read'); };
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false).result, 'taken_off');
});

// ── Verify Load Task 3: departure only from Ready ──
test('depart only from ready; floor marks, manager confirms; stamp-only plan', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    assert.throws(() => ship(ctx, { truckId: t.id, seal: 'R1' }), /Verify the load first/);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const r = ship(ctx, { truckId: t.id, seal: 'R1' });
    assert.deepEqual([r.departed, r.view.truck.status], [true, 'departed']);
    assert.deepEqual(ctx.data.getLoad(t.id).data.plan.map(o => o.op), ['if_stamp']);
});

test('mark shipped re-verifies: an IF changed in NetSuite after Ready sends the truck to needs_fix', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 456 })] }) : f);
    const r = ship(ctx, { truckId: t.id, seal: 'R2' });
    assert.deepEqual([r.needsFix, r.view.truck.status, r.diffs[0].kind], [true, 'needs_fix', 'if_over']);
    assert.deepEqual([ctx.data.getLoad(t.id).data.claim || '', ctx.data.getLoad(t.id).data.shipReq], ['', undefined]);
});

test('removed: depart_cancel, depart_skip_write, pending', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('depart_cancel', { truckId: '1' }), /Unknown action/);
    assert.throws(() => ctx.run('depart_skip_write', { truckId: '1' }), /Unknown action/);
    assert.equal(ctx.run('approvals').departures, undefined);
});

test('ship_mark re-verifies: a mismatch returns needsFix, sets needs_fix and marks nothing', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.throws(() => ctx.run('ship_mark', { truckId: truckWith(ctx, 1, '9002').t.id, seal: 'P0' }, false), /Verify the load first/);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 516 })] }) : f);
    const r = ctx.run('ship_mark', { truckId: t.id, seal: 'P1' }, false);
    assert.deepEqual([r.needsFix, r.diffs[0].kind, r.view.truck.status, r.view.truck.shipReq], [true, 'if_short', 'needs_fix', null]);
});

test('a pallet taken off right after the claim: re-verified from the claimed state → needs_fix, claim released, nothing departs', () => {
    const ctx = setup();
    const { t, ps } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const realUpd = ctx.data.updateLoad;
    let armed = true;
    ctx.data.updateLoad = (L, patch) => {
        realUpd(L, patch);
        if (armed && patch.status === 'departing') { armed = false; ctx.data.updatePallet(ctx.data.getPallet(ps[0].id), { status: 'labeled', load: '' }); }
    };
    const r = ship(ctx, { truckId: t.id, seal: 'C3' });
    ctx.data.updateLoad = realUpd;
    assert.deepEqual([r.needsFix, r.diffs[0].kind], [true, 'if_short']);
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.workingAt, d.data.phase, d.data.depart, d.data.plan, d.data.shipReq], ['needs_fix', '', 0, '', null, null, null]);
    assert.equal(ctx.data.getPallet(ps[1].id).status, 'loaded');
});

test('a truck with no live IF can never be ready; dropping its gone IF leaves no_ifs', () => {
    const ctx = setup();
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().filter(f => f.ifId !== '9001');
    ctx.run('truck_verify', { truckId: t.id }, false);
    const r = ctx.run('truck_drop_if', { truckId: t.id, ifId: '9001' });
    assert.deepEqual([r.match, r.diffs.map(d => d.kind), r.view.truck.status], [false, ['no_ifs'], 'needs_fix']);
    assert.equal(r.diffs[0].text, 'This truck has no IF → add one');
    assert.throws(() => ship(ctx, { truckId: t.id, seal: 'N1' }), /Verify the load first/);
});

test('approvals retries carry no skip affordance', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 42);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ship(ctx, { truckId: t.id, seal: 'K2' }), /NetSuite write failed/);
    const rt = ctx.run('approvals').retries;
    assert.deepEqual([rt.map(x => x.id), rt[0].errorKey, rt[0].errorOp], [[t.id], undefined, undefined]);
    assert.equal(ctx.data.getLoad(t.id).data.errorKey, undefined);
    assert.equal(ctx.run('depart_retry', { truckId: t.id }).departed, true);
});

test('departData drops requestedBy and pending; the confirming manager is the approver, the floor is markedBy', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    ship(ctx, { truckId: t.id, seal: 'DD1' });
    const d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([d.depart.requestedBy, d.depart.approvedBy, d.depart.markedBy, 'pending' in d], [undefined, { id: '5', name: 'Jack K' }, 'Miguel', false]);
});

// ── Task 3 review follow-ups ──
test('depart_release: a stuck departure with no stamp written goes back to needs_fix and re-verifies', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t, ps } = readyTruck(ctx, 42);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ship(ctx, { truckId: t.id, seal: 'RL1' }), /NetSuite write failed/);
    assert.deepEqual(ctx.run('approvals').retries.map(x => [x.id, x.canRelease]), [[t.id, true]]);
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }, false), /Managers only/);
    const r = ctx.run('depart_release', { truckId: t.id });
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.data.claim, d.data.depart, d.data.plan, d.data.alloc, d.data.bol, d.data.writes, d.data.error], ['', null, null, null, null, null, '']);
    assert.deepEqual([r.match, r.view.truck.status, d.status], [true, 'ready', 'ready']);   // re-verified: the load still matches
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'loaded');
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /Nothing to release/);
    assert.equal(ship(ctx, { truckId: t.id, seal: 'RL1' }).departed, true);   // the seal is free again
});

test('depart_release is refused once a stamp landed, and while the departure is still running', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const ps = printLabels(ctx, 42, 'Jrl', [L975]).concat(printLabels(ctx, 42, 'Jrl2', [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.tx._t.failOn = 'if_stamp:9002';
    assert.throws(() => ship(ctx, { truckId: t.id, seal: 'RL2' }), /NetSuite write failed/);
    assert.deepEqual(ctx.run('approvals').retries.map(x => x.canRelease), [false]);
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /already stamped.*Retry/);
    const c2 = setup();
    const b = readyTruck(c2, 42).t;
    c2.data.updateLoad(c2.data.getLoad(b.id), { status: 'departing', data: { claim: 'live', workingAt: Date.now(), depart: { seal: 'Z' }, writes: {} } });
    assert.throws(() => c2.run('depart_release', { truckId: b.id }), /still running/);
});

test('toNeedsFix (pending) refuses when the IFs changed while ship_confirm checked the marked truck', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    ctx.run('ship_mark', { truckId: t.id, seal: 'TG1' }, false);
    const real = ctx.ns.plannedIfs;
    let armed = true;
    ctx.ns.plannedIfs = () => {
        const out = real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 456 })] }) : f);
        if (armed) { armed = false; const x = ctx.data.getLoad(t.id); ctx.data.updateLoad(x, { data: { ifs: x.data.ifs.concat([real().find(f => f.ifId === '9002')]) } }); }
        return out;
    };
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }), /changed while it was being checked/);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.claim || '', x.data.shipReq.seal], ['ship_pending', '', 'TG1']);
});

test('post-claim match: two identical pallets swapped after the claim → the plan is rewritten and the truck departs', () => {
    const ctx = setup();
    const { t, ps } = readyTruck(ctx, 42);
    const spare = printLabels(ctx, 1, 'Jswap', [L975])[0];
    const realUpd = ctx.data.updateLoad;
    let armed = true;
    ctx.data.updateLoad = (L, patch) => {
        realUpd(L, patch);
        if (armed && patch.status === 'departing') {
            armed = false;
            ctx.data.updatePallet(ctx.data.getPallet(ps[0].id), { status: 'labeled', load: '' });
            ctx.data.updatePallet(ctx.data.getPallet(spare.id), { status: 'loaded', load: t.id });
        }
    };
    const r = ship(ctx, { truckId: t.id, seal: 'SW1' });
    ctx.data.updateLoad = realUpd;
    assert.equal(r.departed, true);
    assert.deepEqual([ctx.data.getPallet(spare.id).status, ctx.data.getPallet(ps[0].id).status], ['in_transit', 'labeled']);
    assert.ok(ctx.data.getLoad(t.id).data.departPallets.split(',').includes(String(spare.id)));
});

test('ship_mark on an unchanged load keeps verify at/by (one write: the mark)', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id, actor: 'Ana' }, false);
    const n = countCalls(ctx, 'updateLoad');
    ctx.run('ship_mark', { truckId: t.id, seal: 'PV1', actor: 'Bo' }, false);
    assert.deepEqual([ctx.data.getLoad(t.id).data.verify.by, n.n, ctx.data.getLoad(t.id).data.shipReq.by], ['Ana', 1, 'Bo']);
});

// ── Correct the IF (manager) ──
test('truck_correct: manager only; qty mode writes if_qty and the truck verifies ready', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false);
    assert.throws(() => ctx.run('truck_correct', { truckId: t.id }, false), /Managers only/);
    const real = ctx.ns.plannedIfs;
    ctx.tx._t.onApply = op => { if (op.op === 'if_qty') ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: op.to })] }) : f); };
    const r = ctx.run('truck_correct', { truckId: t.id });
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.to]), [['if_qty', 480]]);
    assert.deepEqual([r.verify.match, r.view.truck.status], [true, 'ready']);
    assert.equal(ctx.data.getLoad(t.id).data.claim, '');
});

test('truck_correct: off mode is plan-only; on mode creates a Packed add-on IF and attaches it', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jc1', [L975]).concat(printLabels(ctx, 1, 'Jc2', [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }]));
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id });
    const off = ctx.run('truck_correct', { truckId: t.id });
    assert.deepEqual([off.written, off.planOnly], [[], ['if_create:700']]);
    ctx.data.db.settings.writeMode = 'on';
    const on = ctx.run('truck_correct', { truckId: t.id });
    const created = ctx.tx._t.ops.find(o => o.op === 'if_create');
    assert.deepEqual([created.toId, created.ship], ['700', false]);
    assert.deepEqual(on.written, ['if_create:700']);
    // The re-verify reads NetSuite: the snapshot fixture doesn't know the new IF, so it isn't kept on the truck here.
    // Live NetSuite returns it as Packed, so it stays. The 'on'-mode attach is checked in the Stage 2 prod checklist.
});

test('approvals lists needs_fix trucks with instruction text', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false);
    const a = ctx.run('approvals');
    assert.deepEqual([a.fixes[0].truckId, a.trucks[0].truck.id], [t.id, t.id]);
    assert.match(a.fixes[0].text, /IF needs −24/);
});

test('approvals needs_fix entry says who verified and when (name, never an object)', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false);
    const v = ctx.data.getLoad(t.id).data.verify;
    let e = ctx.run('approvals').trucks[0];
    assert.equal(typeof e.verifiedBy, 'string');
    assert.ok(e.verifiedBy);
    assert.deepEqual([e.verifiedBy, e.verifiedAt], [String(v.by), v.at]);
    const L = ctx.data.getLoad(t.id);
    ctx.data.updateLoad(L, { data: { verify: Object.assign({}, L.data.verify, { by: { id: '7', name: 'Ann Mgr' } }) } });
    e = ctx.run('approvals').trucks[0];
    assert.equal(e.verifiedBy, 'Ann Mgr');
});

test('truck_correct: a refused write surfaces correctError, keeps the truck needs_fix and frees the claim', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false);
    assert.throws(() => ctx.run('truck_correct', { truckId: t.id, keys: ['nope'] }), /Nothing the portal can correct/);
    ctx.tx._t.failOn = 'if_qty:9001:975';
    assert.throws(() => ctx.run('truck_correct', { truckId: t.id }), /^Error: Correction refused: .*fix it in NetSuite/);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.claim], ['needs_fix', '']);
    assert.match(x.data.correctError, /IF changed in NetSuite/);
    assert.deepEqual(x.data.corrections.map(k => k.key), ['if_short:9001:975']);
    assert.equal(x.data.corrections[0].by.name, 'Jack K');
    assert.match(ctx.run('approvals').fixes[0].correctError, /IF changed/);
    assert.deepEqual(ctx.run('approvals').fixes[0].corrections.map(k => k.key), ['if_short:9001:975']);
    assert.throws(() => ctx.run('truck_correct', { truckId: ctx.run('truck_start', { ifIds: ['9002'], trailer: tr() }).view.truck.id }), /needs a fix|Verify/);
});

test('truck_correct on mode: the created Packed IF is attached and kept when NetSuite returns it', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const ps = printLabels(ctx, 42, 'Jd1', [L975]).concat(printLabels(ctx, 1, 'Jd2', [LINE201]));
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id });
    const real = ctx.ns.plannedIfs;
    ctx.tx._t.onApply = op => { const id = String(ctx.tx._t.seq + 1); if (op.op === 'if_create') ctx.ns.plannedIfs = () => real().concat([{ ifId: id, ifNum: 'IF' + id, status: 'B', trandate: '2026-10-14', toId: '700', toNum: 'TO700', lines: [{ item: '11', sku: 'YSN201', qty: 120 }] }]); };
    const r = ctx.run('truck_correct', { truckId: t.id });
    assert.deepEqual([r.verify.match, r.view.truck.status], [true, 'ready']);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual(x.data.ifs.map(f => [f.ifId, !!f.gone]), [['901', false], ['9001', false]]);
    assert.equal(Object.values(x.data.correctionWrites).find(w => w.key === 'if_create:700').id, '901');
    assert.equal(ctx.tx._t.ops[0].token, '[mv:' + t.id + ':if_create:700:11x120]');
});

test('truck_correct: a later correction of the same IF item with new numbers is written again', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false);
    ctx.run('truck_correct', { truckId: t.id });                 // 504 → 480; NetSuite still says 504 in the fixture
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.equal(ctx.tx._t.ops.length, 1);
    printLabels(ctx, 1, 'Jmore', [L975]).forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('truck_correct', { truckId: t.id });                 // now 504 → 492: same opKey, new numbers
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.from, o.to]), [[504, 480], [504, 492]]);
});

test('report lists plan-only corrections as IF fix needed until the diff closes', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Je1', [L975]).concat(printLabels(ctx, 1, 'Je2', [LINE201]));
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id });
    ctx.run('truck_correct', { truckId: t.id });
    const rows = ctx.run('report').rows.filter(r => r.check === 'IF fix needed');
    assert.deepEqual(rows.map(r => [r.ifNum, r.portal, r.ok]), [['(new)', 'new IF from TO700: YSN201 ×120', false]]);
    ctx.run('truck_remove', { truckId: t.id, palletId: ps[42].id });
    ctx.run('truck_verify', { truckId: t.id });
    assert.deepEqual(ctx.run('report').rows.filter(r => r.check === 'IF fix needed'), []);
});

test('a dropped add-on IF is not created again: Correct skips it with a reason, approvals and the report show it', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const ps = printLabels(ctx, 42, 'Jf1', [L975]).concat(printLabels(ctx, 1, 'Jf2', [LINE201]));
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id });
    ctx.run('truck_correct', { truckId: t.id });                  // creates IF 901; the fixture doesn't know it, so it reads as gone
    const again = ctx.run('truck_correct', { truckId: t.id });    // drops the gone 901, then must not create another
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_create').length, 1);
    assert.deepEqual(again.written, []);
    assert.equal(again.skipped[0].key, 'if_create:700');
    assert.match(again.skipped[0].reason, /already created as IF 901: add it from the suggestions/);
    assert.match(ctx.run('approvals').trucks[0].orphans[0].text, /already created as IF 901/);
    const row = ctx.run('report').rows.find(r => /Add-on IF 901 was dropped/.test(r.check + ' ' + r.portal));
    assert.ok(row, 'report row');
    assert.equal(row.ok, false);
    assert.match(row.portal, /Add-on IF 901 was dropped: delete or reuse it in NetSuite/);
});

test('verify to ready clears a stale correctError', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false);
    ctx.tx._t.failOn = 'if_qty:9001:975';
    assert.throws(() => ctx.run('truck_correct', { truckId: t.id }), /Correction refused/);
    assert.ok(ctx.data.getLoad(t.id).data.correctError);
    matchIf(ctx, '9001', 480);                                     // the office fixed it in NetSuite
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');
    assert.equal(ctx.data.getLoad(t.id).data.correctError, '');
});

// ── Verify Load final-review fixes ──
test('final1: release puts pallets a dying departure already moved in transit back on the truck, then re-verifies', () => {
    const ctx = setup();
    const { t, ps } = readyTruck(ctx, 42);
    const realUpd = ctx.data.updatePallet;
    let n = 0;
    ctx.data.updatePallet = (p, patch) => { if (patch.status === 'in_transit' && ++n === 3) throw new Error('request died'); return realUpd(p, patch); };
    assert.throws(() => ship(ctx, { truckId: t.id, seal: 'IT1' }), /request died/);
    ctx.data.updatePallet = realUpd;
    assert.equal(ps.filter(p => ctx.data.getPallet(p.id).status === 'in_transit').length, 2);
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { workingAt: 1 } });     // stale: the request is gone
    const r = ctx.run('depart_release', { truckId: t.id });
    assert.deepEqual(ps.map(p => [ctx.data.getPallet(p.id).status, String(ctx.data.getPallet(p.id).loadId)]).filter(x => x[0] !== 'loaded' || x[1] !== String(t.id)), []);
    assert.deepEqual([r.match, ctx.data.getLoad(t.id).status], [true, 'ready']);
    assert.equal(ctx.data.getPallet(ps[0].id).shippedDay || '', '');
});

test('final1: the release write clears the old verify, so a failed re-verify leaves no stale result', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 42);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ship(ctx, { truckId: t.id, seal: 'IT2' }), /NetSuite write failed/);
    ctx.ns.plannedIfs = () => { throw new Error('NetSuite down'); };
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /NetSuite down/);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.claim, x.data.verify], ['needs_fix', '', null]);
});

test('final2: re-pressing Verify on an unchanged truck keeps verify at/by; a change records the new actor', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id, actor: 'Ana' }, false);
    const before = ctx.data.getLoad(t.id).data.verify;
    ctx.run('truck_verify', { truckId: t.id, actor: 'Bo' }, false);
    const after = ctx.data.getLoad(t.id).data.verify;
    assert.deepEqual([after.at, after.by, ctx.data.getLoad(t.id).status], [before.at, before.by, 'ready']);
    printLabels(ctx, 1, 'Jfin2', [L975]).forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id, actor: 'Cy' }, false);
    assert.equal(ctx.data.getLoad(t.id).data.verify.by, 'Cy');
});

test('final2: a poll flip records Auto re-check, not the polling device', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, actor: 'Ana', shortNote: 'short pick' }, false);
    matchIf(ctx, '9001', 480);
    ctx.run('trucks_recheck', { actor: 'Poller' }, false);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.verify.by], ['ready', { id: 0, name: 'Auto re-check' }]);
});

test('final3: every action resets the ns cache; truck_correct resets it again after a write, before the re-verify', () => {
    const ctx = setup();
    let n = 0;
    ctx.ns.resetCache = () => { n++; };
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    n = 0;
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false);
    assert.equal(n, 1);
    n = 0;
    ctx.tx._t.failOn = 'if_qty:9001:975';
    assert.throws(() => ctx.run('truck_correct', { truckId: t.id }), /Correction refused/);
    assert.equal(n, 1);                                                         // nothing written: no extra reset
    n = 0;
    const real = ctx.ns.plannedIfs;
    let atVerify = null;
    ctx.ns.plannedIfs = () => { if (ctx.tx._t.ops.length && atVerify === null) atVerify = n; return real(); };
    ctx.run('truck_correct', { truckId: t.id });
    assert.deepEqual([n, atVerify], [2, 2]);                                    // runAction + after the write, before the re-verify read
});

test('final4: approvals lists every Picked/Packed IF no truck has, for the manager add-any picker', () => {
    const ctx = setup();
    const [ifX] = extraIfs(ctx, 1);
    const { t } = truckWith(ctx, 43);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const a = ctx.run('approvals');
    assert.deepEqual(a.freeIfs.map(f => f.ifId).sort(), ['9002', ifX].sort());
    assert.deepEqual(Object.keys(a.freeIfs[0]).sort(), ['ifId', 'ifNum', 'lines', 'toNum'].sort());
    ctx.run('truck_add_if', { truckId: t.id, ifId: '9002' });                // still needs_fix (short on IF9002)
    assert.deepEqual(ctx.run('approvals').freeIfs.map(f => f.ifId), [ifX]);
});

test('final5: verify while a manager correction holds the claim says it is being corrected', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: 'c1', phase: 'correct', workingAt: Date.now() } });
    assert.throws(() => ctx.run('truck_verify', { truckId: t.id }, false), /being corrected by a manager, try again in a moment/);
});

test('final6: an if_qty correction with the same numbers is written again (the office reverted the IF)', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short pick' }, false);
    ctx.run('truck_correct', { truckId: t.id });                 // 504 → 480; the fixture still says 504 (reverted)
    ctx.run('truck_correct', { truckId: t.id });
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['if_qty', 504, 480], ['if_qty', 504, 480]]);
});

test('trailer: required, unique among open trucks, names the truck', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9001'] }, false), /Enter the trailer/);
    const v = ctx.run('truck_start', { ifIds: ['9001'], trailer: ' 537224 ' }, false).view;
    assert.deepEqual([v.truck.label, v.trailer], ['Trailer 537224', '537224']);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9002'], trailer: '537224' }, false), /already on an open truck/);
    assert.equal(ctx.run('truck_planned', {}, false).open[0].label, 'Trailer 537224');
});

test('short note: required on a manual verify that finds a short; recheck does not need it', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 40, 'Jsn', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'S1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    const r1 = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.equal(r1.needsNote, true);
    assert.equal(ctx.data.getLoad(t.id).status, 'loading');
    const r2 = ctx.run('truck_verify', { truckId: t.id, shortNote: '  trailer full ' }, false);
    assert.deepEqual([r2.view.truck.status, ctx.data.getLoad(t.id).data.shortNote.text], ['needs_fix', 'trailer full']);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).needsNote, undefined);   // note already saved
    assert.doesNotThrow(() => ctx.run('trucks_recheck', {}, false));
});

test('other items: add/remove while open, ignored by verify, ready → loading', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Joi', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'O1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');
    const v = ctx.run('truck_other_add', { truckId: t.id, desc: 'Office desk', qty: 2 }, false).view;
    assert.deepEqual([v.truck.status, v.otherItems.map(o => [o.desc, o.qty])], ['loading', [['Office desk', 2]]]);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');   // other items ignored
    assert.throws(() => ctx.run('truck_other_add', { truckId: t.id, desc: '', qty: 1 }, false), /description/i);
    assert.throws(() => ctx.run('truck_other_add', { truckId: t.id, desc: 'Chair', qty: 0 }, false), /count/i);
    const id = v.otherItems[0].id;
    assert.equal(ctx.run('truck_other_remove', { truckId: t.id, id }, false).view.otherItems.length, 0);
});

test('departure carries other items, clears the short note and frees the trailer; unload ticks them', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jdep', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'D1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    const oid = ctx.run('truck_other_add', { truckId: t.id, desc: 'Office desk', qty: 2 }, false).view.otherItems[0].id;
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'note kept until departure' }, false);
    assert.equal(ctx.data.getLoad(t.id).data.shortNote.by, 'Miguel');
    ship(ctx, { truckId: t.id, seal: '5249340' });       // trailer defaults to the truck's
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.shortNote, x.data.depart.trailer, x.data.depart.otherItems.map(o => o.desc)], ['departed', null, 'D1', ['Office desk']]);
    assert.throws(() => ctx.run('truck_other_add', { truckId: t.id, desc: 'Chair', qty: 1 }, false), /closed/);
    assert.equal(ctx.run('truck_start', { ifIds: ['9002'], trailer: 'd1' }, false).view.trailer, 'd1');   // a departed truck no longer holds it
    const u = ctx.run('unload_other_tick', { truckId: t.id, id: oid, on: true }, false).view;
    assert.deepEqual(u.otherItems.map(o => [o.desc, o.in]), [['Office desk', true]]);
    assert.equal(ctx.run('unload_other_tick', { truckId: t.id, id: oid, on: false }, false).view.otherItems[0].in, false);
    assert.throws(() => ctx.run('unload_other_tick', { truckId: t.id, id: 'nope', on: true }, false), /not on this truck/);
});

// ── Task 1 follow-ups ──
test('manager verify on a short truck needs no note (a note given is still saved)', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    const r = ctx.run('truck_verify', { truckId: t.id });                      // manager Re-check
    assert.deepEqual([r.needsNote, r.view.truck.status, ctx.data.getLoad(t.id).data.shortNote], [undefined, 'needs_fix', undefined]);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'office knows' });
    assert.equal(ctx.data.getLoad(t.id).data.shortNote.text, 'office knows');
});

test('the needsNote path writes nothing: no verify result, no note', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    assert.equal(ctx.run('truck_verify', { truckId: t.id, shortNote: '   ' }, false).needsNote, true);
    const d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([d.verify, d.shortNote], [undefined, undefined]);
});

test('the short note is kept through depart_release and cleared only when the truck departs', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'trailer full' }, false);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ship(ctx, { truckId: t.id, seal: 'RN1' }), /NetSuite write failed/);
    assert.equal(ctx.data.getLoad(t.id).data.shortNote.text, 'trailer full');
    ctx.run('depart_release', { truckId: t.id });
    assert.equal(ctx.data.getLoad(t.id).data.shortNote.text, 'trailer full');
    ctx.tx._t.failOn = '';
    assert.equal(ship(ctx, { truckId: t.id, seal: 'RN1' }).departed, true);
    assert.equal(ctx.data.getLoad(t.id).data.shortNote, null);
});

test('caps: the short note is trimmed to 300 chars; a trailer over 20 chars or blank is refused', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id, shortNote: '  ' + 'x'.repeat(400) + '  ' }, false);
    assert.equal(ctx.data.getLoad(t.id).data.shortNote.text.length, 300);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9002'], trailer: '   ' }, false), /Enter the trailer/);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9002'], trailer: '1'.repeat(21) }, false), /20 characters/);
    assert.equal(ctx.run('truck_start', { ifIds: ['9002'], trailer: ' ' + '1'.repeat(20) + ' ' }, false).view.trailer, '1'.repeat(20));
});

test('a needs_fix truck blocks its trailer; trailer collisions ignore case', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 40, 'Jnf', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'ab12' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'short' }, false);
    assert.equal(ctx.data.getLoad(t.id).status, 'needs_fix');
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9002'], trailer: 'AB12' }, false), /already on an open truck/);
    const extra = extraIfs(ctx, 1)[0];
    ctx.run('truck_start', { ifIds: ['9002'], trailer: 'Zz9' }, false);          // two loading trucks
    assert.throws(() => ctx.run('truck_start', { ifIds: [extra], trailer: ' zZ9 ' }, false), /already on an open truck/);
});

// ── rework Task 2: Shipments ──
test('ship_mark: only from ready; locks the truck; seal reuse refused', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jsm', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'SH1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: '5250001' }, false), /Verify the load first/);
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: '' }, false), /seal/i);
    const v = ctx.run('ship_mark', { truckId: t.id, seal: '5250001' }, false).view;
    assert.deepEqual([v.truck.status, v.truck.shipReq.seal, v.truck.shipReq.trailer], ['ship_pending', '5250001', 'SH1']);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false), /waiting for a manager/);
    assert.throws(() => ctx.run('truck_verify', { truckId: t.id }, false), /waiting for a manager/);
    assert.equal(ctx.run('approvals').shipPending[0].seal, '5250001');
});

test('ship_confirm: manager only; departs with Truck # and the floor mark time; send back returns to loading', () => {
    const ctx = setup();
    const mk = (n, trailer, seal, ifId) => { const ps = printLabels(ctx, n, 'J' + trailer, [L975]); const t = ctx.run('truck_start', { ifIds: [ifId], trailer }, false).view.truck;
        ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false)); ctx.run('truck_verify', { truckId: t.id }, false); ctx.run('ship_mark', { truckId: t.id, seal }, false); return t; };
    const a = mk(42, 'C1', '5250002', '9001');
    assert.throws(() => ctx.run('ship_confirm', { truckId: a.id }, false), /Managers only/);
    const r = ctx.run('ship_confirm', { truckId: a.id });
    const d = ctx.data.getLoad(a.id).data.depart;
    assert.deepEqual([r.view.truck.status, d.seal, d.trailer, d.truckNo, d.at === ctx.data.getLoad(a.id).data.shipReq.at], ['departed', '5250002', 'C1', 1, true]);
    const b = mk(42, 'C2', '5250003', '9002');
    assert.throws(() => ctx.run('ship_sendback', { truckId: b.id, note: '' }), /note/i);
    const sb = ctx.run('ship_sendback', { truckId: b.id, note: 'wrong seal photo' });
    assert.deepEqual([sb.view.truck.status, sb.view.truck.sentBack.note], ['loading', 'wrong seal photo']);
});

test('ship_confirm re-verifies: an IF change after mark sends the truck to needs_fix', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jrv', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'RV1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id, seal: '5250004' }, false);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 456 })] }) : f);
    const r = ctx.run('ship_confirm', { truckId: t.id });
    assert.deepEqual([r.needsFix, ctx.data.getLoad(t.id).status, ctx.data.getLoad(t.id).data.claim], [true, 'needs_fix', '']);
});

test('removed: floor depart_preview / depart_confirm', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('depart_preview', { truckId: '1' }, false), /Unknown action/);
    assert.throws(() => ctx.run('depart_confirm', { truckId: '1' }, false), /Unknown action/);
});

test('ship_pending: holds its seal, is listed as open, refuses edits; a re-mark after send back clears sentBack', () => {
    const ctx = setup();
    const a = readyTruck(ctx, 42).t;
    const b = readyTruck(ctx, 42, '9002').t;
    ctx.run('ship_mark', { truckId: a.id, seal: '5250010' }, false);
    assert.throws(() => ctx.run('ship_mark', { truckId: b.id, seal: '5250010' }, false), new RegExp('Seal 5250010 is already on ' + a.label));
    assert.ok(ctx.run('truck_planned', {}, false).open.some(x => x.id === a.id && x.status === 'ship_pending'));
    assert.throws(() => ctx.run('truck_other_add', { truckId: a.id, desc: 'Desk', qty: 1 }, false), /waiting for a manager/);
    assert.throws(() => ctx.run('truck_correct', { truckId: a.id }), /waiting for a manager/);
    assert.throws(() => ctx.run('ship_mark', { truckId: a.id, seal: '5250011' }, false), /already marked packed/);
    assert.deepEqual(ctx.run('trucks_recheck', {}, false).ready.map(x => x.id), [b.id]);
    const ap = ctx.run('approvals').shipPending[0];
    assert.deepEqual([ap.trailer, ap.pallets, ap.pcs, ap.markedBy, ap.ifs.map(f => f.ifNum)], [ctx.data.getLoad(a.id).data.trailer, 42, 504, 'Miguel', ['IF9001']]);
    ctx.run('ship_sendback', { truckId: a.id, note: 'redo the seal photo' });
    ctx.run('truck_verify', { truckId: a.id }, false);
    const v = ctx.run('ship_mark', { truckId: a.id, seal: '5250010' }, false).view;       // the seal is free again after send back
    assert.deepEqual([v.truck.status, v.truck.sentBack], ['ship_pending', null]);
    assert.equal(ctx.run('ship_confirm', { truckId: a.id }).view.truck.depart.markedBy, 'Miguel');
    assert.throws(() => ctx.run('ship_confirm', { truckId: a.id }), /departed, not waiting/);
});

// ── rework Task 3: approvals split; Task 2 minors ──
test('approvals: fixes per diff (with short note) and trucks per needs_fix truck', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 40, 'Jap', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'AP1' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('truck_verify', { truckId: t.id, shortNote: 'trailer full' }, false);
    const a = ctx.run('approvals');
    assert.equal(a.needsFix, undefined);
    assert.deepEqual([a.fixes.length, a.fixes[0].truckLabel, a.fixes[0].ifNum, a.fixes[0].shortNote.text], [1, 'Trailer AP1', 'IF9001', 'trailer full']);
    assert.match(a.fixes[0].text, /IF needs −24/);
    assert.deepEqual([a.trucks.length, a.trucks[0].trailer, a.trucks[0].ifs.map(f => f.ifNum)], [1, 'AP1', ['IF9001']]);
});

test('approvals: top-level keys; trucks flag empty/gone IFs; fixes skip diffs that are not if_short/if_over/no_if', () => {
    const ctx = setup();
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'], trailer: 'AP2' }).view.truck;
    printLabels(ctx, 42, 'Jap2', [L975]).forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().filter(f => f.ifId !== '9002');
    ctx.run('truck_verify', { truckId: t.id });
    const a = ctx.run('approvals');
    assert.deepEqual(Object.keys(a).sort(), ['fixes', 'flagged', 'freeIfs', 'pickups', 'receipts', 'retries', 'shipPending', 'trucks', 'writeMode']);
    assert.deepEqual(a.trucks[0].ifs.map(f => [f.ifNum, f.gone, f.empty]), [['IF9001', false, false], ['IF9002', true, false]]);
    assert.deepEqual(a.fixes, []);
    ctx.ns.plannedIfs = real;
    ctx.run('truck_drop_if', { truckId: t.id, ifId: '9002' });
    const t2 = ctx.run('truck_start', { ifIds: ['9002'], trailer: 'AP3' }).view.truck;
    ctx.run('truck_verify', { truckId: t2.id });
    assert.deepEqual(ctx.run('approvals').trucks.find(x => x.truck.id === t2.id).ifs.map(f => f.empty), [true]);
});

test('ship_mark refuses a truck with no trailer; shipPending carries ageMin', () => {
    const ctx = setup();
    const a = readyTruck(ctx, 42).t;
    ctx.data.updateLoad(ctx.data.getLoad(a.id), { data: { trailer: '' } });
    assert.throws(() => ctx.run('ship_mark', { truckId: a.id, seal: '5250020' }, false), /Enter the trailer/);
    ctx.data.updateLoad(ctx.data.getLoad(a.id), { data: { trailer: 'AG1' } });
    ctx.run('ship_mark', { truckId: a.id, seal: '5250020' }, false);
    const L = ctx.data.getLoad(a.id);
    ctx.data.updateLoad(L, { data: { shipReq: Object.assign({}, L.data.shipReq, { at: '10/14/2026 1:30:05 pm' }) } });
    assert.equal(ctx.run('approvals').shipPending[0].ageMin, 44);       // now = 2:14:05 pm
});

test('unload scan of a pallet on a ship_pending truck: locked, with its label and reason', () => {
    const ctx = setup();
    const a = readyTruck(ctx, 42);
    ctx.run('ship_mark', { truckId: a.t.id, seal: '5250030' }, false);
    const d = departed(ctx, 42, '5250031', '9002');
    const r = ctx.run('unload_scan', { truckId: d.t.id, raw: a.ps[0].code }, false);
    assert.deepEqual([r.result, r.reason, r.otherLabel], ['locked', 'ship_pending', ctx.data.getLoad(a.t.id).data.trailer ? 'Trailer ' + ctx.data.getLoad(a.t.id).data.trailer : '']);
});

test('trailers: save trims, refuses duplicates and long numbers, and the floor list follows', () => {
    const ctx = setup();
    const r = ctx.run('trailers_save', { trailers: [' 900100 ', '537224', ''] });
    assert.deepEqual(r.trailers, ['900100', '537224']);
    assert.deepEqual(ctx.run('trailers_list').trailers, ['900100', '537224']);
    assert.deepEqual(ctx.run('truck_planned', {}, false).trailers, ['900100', '537224']);
    assert.throws(() => ctx.run('trailers_save', { trailers: ['A', 'a'] }), /listed twice/);
    assert.throws(() => ctx.run('trailers_save', { trailers: [' ', ''] }), /Keep at least one trailer/);
    assert.deepEqual(ctx.run('trailers_list').trailers, ['900100', '537224']);
    assert.throws(() => ctx.run('trailers_save', { trailers: ['X'.repeat(21)] }), /too long/);
    assert.throws(() => ctx.run('trailers_save', { trailers: ['1'] }, false), /Managers only/);
    assert.throws(() => ctx.run('trailers_list', {}, false), /Managers only/);
});

test('trailers: removing a trailer an open truck uses warns but keeps the truck', () => {
    const ctx = setup();
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: '537224' }, false).view.truck;
    assert.deepEqual(ctx.run('trailers_list').busy, ['537224']);
    const r = ctx.run('trailers_save', { trailers: ['900100'] });
    assert.deepEqual(r.removedBusy, ['537224']);
    assert.equal(ctx.data.getLoad(t.id).data.trailer, '537224');
});

test('truck_planned: shippedToday lists today\'s departed trucks; trailers lists the free ones', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jst', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: '537224' }, false).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('truck_verify', { truckId: t.id }, false);
    let r = ctx.run('truck_planned', {}, false);
    assert.deepEqual(r.shippedToday, []);
    assert.equal(r.trailers.indexOf('537224'), -1, 'a trailer on an open truck is not offered');
    assert.equal(r.carrier, 'ArcBest');
    ctx.run('ship_mark', { truckId: t.id, seal: '5250020' }, false);
    ctx.run('ship_confirm', { truckId: t.id });
    r = ctx.run('truck_planned', {}, false);
    assert.deepEqual(r.shippedToday.map(x => [x.id, x.depart.seal, x.depart.trailer, x.pallets]), [[t.id, '5250020', '537224', 42]]);
    assert.ok(!r.open.some(x => x.id === t.id), 'a departed truck is not open');
    const d = ctx.data.getLoad(t.id);
    ctx.data.updateLoad(d, { data: { depart: Object.assign({}, d.data.depart, { day: '2000-01-01' }) } });
    assert.deepEqual(ctx.run('truck_planned', {}, false).shippedToday, []);
});

test('approvals: a needs_fix truck with no correctable diff still says why (otherDiffs)', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jod', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    const v = ctx.run('truck_verify', { truckId: t.id }, false);
    const a = ctx.run('approvals');
    assert.deepEqual([a.fixes.length, a.trucks.length], [0, 1]);
    // if_gone / if_empty show as pills on the IF rows, so they are not repeated in otherDiffs.
    assert.deepEqual(v.diffs.map(d => d.kind), ['if_empty']);
    assert.deepEqual(a.trucks[0].otherDiffs, []);
    assert.deepEqual(a.trucks[0].ifs.map(f => [f.ifId, f.empty]), [['9001', false], ['9002', true]]);
});

test('approvals: otherDiffs keeps a truck-level reason (no_ifs) and drops the gone-IF pill duplicate', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    noTrailer(ctx, t.id);
    goneIf(ctx, '9001');
    const v = ctx.run('truck_verify', { truckId: t.id }, false);
    const a = ctx.run('approvals');
    const tc = a.trucks.find(x => String(x.truck.id) === String(t.id));
    assert.ok(v.diffs.some(d => d.kind === 'if_gone'));
    assert.deepEqual(tc.otherDiffs, v.diffs.filter(d => ['if_gone', 'if_empty', 'if_short', 'if_over', 'no_if'].indexOf(d.kind) === -1).map(d => d.text));
    assert.ok(tc.otherDiffs.length > 0);
    assert.equal(tc.ifs[0].gone, true);
});

// ── final-review fixes ──
test('truck_set_trailer: floor edits the trailer on an open truck; trimmed, 1-20 chars, unique; status kept', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    const b = ctx.run('truck_start', { ifIds: ['9002'], trailer: 'BUSY1' }, false).view.truck;
    assert.throws(() => ctx.run('truck_set_trailer', { truckId: t.id, trailer: '  ' }, false), /Enter the trailer/);
    assert.throws(() => ctx.run('truck_set_trailer', { truckId: t.id, trailer: '1'.repeat(21) }, false), /20 characters/);
    assert.throws(() => ctx.run('truck_set_trailer', { truckId: t.id, trailer: ' busy1 ' }, false), /already on an open truck/);
    const v = ctx.run('truck_set_trailer', { truckId: t.id, trailer: ' 543804 ' }, false).view;
    assert.deepEqual([v.trailer, v.truck.status, v.truck.label], ['543804', 'ready', 'Trailer 543804']);
    assert.equal(ctx.run('truck_set_trailer', { truckId: t.id, trailer: '543804' }, false).view.trailer, '543804');   // its own trailer is fine
    ctx.run('ship_mark', { truckId: t.id, seal: 'STT1' }, false);
    assert.throws(() => ctx.run('truck_set_trailer', { truckId: t.id, trailer: 'X9' }, false), /waiting for a manager|closed/);
    assert.equal(ctx.data.getLoad(b.id).data.trailer, 'BUSY1');
});

test('ship_mark: a truck with no trailer takes one from the mark (validated, unique)', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    noTrailer(ctx, t.id);
    ctx.run('truck_start', { ifIds: ['9002'], trailer: 'TK1' }, false);
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: 'SM1' }, false), /Enter the trailer/);
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: 'SM1', trailer: 'x'.repeat(21) }, false), /20 characters/);
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: 'SM1', trailer: 'tk1' }, false), /already on an open truck/);
    const v = ctx.run('ship_mark', { truckId: t.id, seal: 'SM1', trailer: ' 487491 ' }, false).view;
    assert.deepEqual([v.truck.status, v.truck.shipReq.trailer, ctx.data.getLoad(t.id).data.trailer], ['ship_pending', '487491', '487491']);
});

test('ship_mark: the truck trailer wins over a passed one', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    const own = ctx.data.getLoad(t.id).data.trailer;
    const v = ctx.run('ship_mark', { truckId: t.id, seal: 'SM2', trailer: 'OTHER' }, false).view;
    assert.equal(v.truck.shipReq.trailer, own);
});

test('ship_mark caps: seal 30 chars, carrier 60 chars (trimmed; over is refused and names the field)', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: '9'.repeat(31) }, false), /seal # is too long \(30/i);
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id, seal: 'CP1', carrier: 'c'.repeat(61) }, false), /carrier is too long \(60/i);
    assert.equal(ctx.data.getLoad(t.id).status, 'ready');
    const v = ctx.run('ship_mark', { truckId: t.id, seal: ' ' + '9'.repeat(30) + ' ', carrier: ' ' + 'c'.repeat(60) + ' ' }, false).view;
    assert.deepEqual([v.truck.shipReq.seal, v.truck.shipReq.carrier], ['9'.repeat(30), 'c'.repeat(60)]);
});

test('default trailers: all 7 rotating trailers when the settings have none', () => {
    const ctx = setup();
    const all = ['537224', '416460', '105488', '522051', '211659', '543804', '487491'];
    assert.deepEqual(ctx.run('truck_planned', {}, false).trailers, all);
    const v = ctx.run('truck_start', { ifIds: ['9001'], trailer: '543804' }, false).view;
    assert.deepEqual(v.trailers, all);
    assert.deepEqual(ctx.run('truck_planned', {}, false).trailers, all.filter(t => t !== '543804'));
});

test('a stalled correction on a truck with no Correct card: truck_correct with no keys frees the claim (and drops the empty IF)', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jstk', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'], trailer: tr() }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id }, false);                              // needs_fix: only if_empty (no Correct card)
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: 'c1', phase: 'correct', workingAt: Date.now() - 11 * 60000 } });
    const a = ctx.run('approvals');
    assert.deepEqual([a.fixes.length, a.trucks[0].stuck], [0, true]);
    const r = ctx.run('truck_correct', { truckId: t.id });
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.data.claim, r.verify.match, x.status, x.data.ifs.map(f => f.ifId)], ['', true, 'ready', ['9001']]);
});

// ── 2026-10-06 pm: flagged pallets (spec D1–D3) ──
function strayOn(ctx, t, lines) {                       // a labeled pallet scanned at Tippecanoe that was never loaded
    const s = printLabels(ctx, 1, 'Jstray' + Math.random().toString(36).slice(2, 6), [lines || L975])[0];
    const r = ctx.run('unload_scan', { truckId: t.id, raw: s.code }, false);
    assert.equal(r.result, 'never_loaded');
    return ctx.data.getPallet(s.id);
}

test('pallet_accept (qty mode, SKU on a truck IF): if_qty written, pallet received, alloc grown, receipt includes it', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t, ps } = departed(ctx, 42, '5260001');                        // IF9001 = 504 = 42 × 12
    const stray = strayOn(ctx, t);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }, false), /Managers only/);
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'accepted');
    assert.equal(r.text, '✅ Accepted · IF9001 504 → 516');
    const op = ctx.tx._t.ops.find(o => o.op === 'if_qty' && o.ifId === '9001');
    assert.deepEqual([op.item, op.from, op.to], ['975', 504, 516]);
    const p = ctx.data.getPallet(stray.id), x = ctx.data.getLoad(t.id);
    assert.deepEqual([p.status, p.loadId, p.data.flag, p.data.decision.kind, p.data.decision.ifNum], ['received', t.id, '', 'accepted', 'IF9001']);
    assert.equal(x.data.alloc[0].lines['975'], 516);
    assert.deepEqual(x.data.flagged, []);
    assert.equal(x.data.corrections.filter(k => k.kind === 'pallet_accept').length, 1);
    assert.ok(x.data.correctionWrites['if_qty:9001:975|504>516']);
    assert.deepEqual(x.data.lastStep.kind, 'pallet_accepted');
    assert.deepEqual(ctx.run('receipt_preview', { truckId: t.id }).perIf, [{ ifId: '9001', ifNum: 'IF9001', shipped: 516, received: 516, short: 0 }]);
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }), /not flagged/);
});

test('pallet_accept in off mode is pending: receipt blocked until the IF reads as written, then settled by approvals', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 42, '5260002');
    const stray = strayOn(ctx, t);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'pending');
    assert.equal(r.text, '⏳ Accepted · office sets IF9001 YSN100 to 516 · receipt waits');
    assert.equal(ctx.data.getPallet(stray.id).data.decision.kind, 'accepted_pending');
    assert.equal(ctx.data.getPallet(stray.id).status, 'labeled');
    const b2 = departed(ctx, 42, '5260009', '9002');                       // scanned at another departed truck: stays on the first, not re-flagged there
    assert.equal(ctx.run('unload_scan', { truckId: b2.t.id, raw: stray.code }, false).result, 'never_loaded');
    assert.deepEqual([ctx.data.getPallet(stray.id).data.flaggedTruck, ctx.data.getLoad(b2.t.id).data.flagged || []], [t.id, []]);
    ctx.run('unload_done', { truckId: t.id }, false);
    let ap = ctx.run('approvals');
    assert.deepEqual([ap.flagged.length, ap.receipts[0].pending.length, ap.receipts[0].canApprove, ap.receipts[0].warn], [0, 1, true, '1 flagged pallet still to decide']);
    const realInfo = ctx.ns.ifInfo;                                       // the office edits the IF in NetSuite
    ctx.ns.ifInfo = () => { const o = realInfo(); o['9001'].lines = [{ item: '975', sku: 'YSN100', qty: 516 }]; return o; };
    ap = ctx.run('approvals');
    assert.deepEqual([ap.receipts[0].pending.length, ap.receipts[0].canApprove, ap.receipts[0].decided.length], [0, true, 1]);
    assert.equal(ctx.data.getPallet(stray.id).status, 'received');
    assert.equal(ctx.data.getLoad(t.id).data.alloc[0].lines['975'], 516);
    assert.equal(ctx.run('receipt_approve', { truckId: t.id }).perIf[0].received, 516);
});

test('pallet_reject: note required; pallet back to labeled; scanning it again flags it again', () => {
    const ctx = setup();
    const { t } = departed(ctx, 42, '5260003');
    const stray = strayOn(ctx, t);
    assert.throws(() => ctx.run('pallet_reject', { truckId: t.id, palletId: stray.id, note: '  ' }), /note/i);
    const r = ctx.run('pallet_reject', { truckId: t.id, palletId: stray.id, note: 'belongs to Trailer 537224' });
    assert.equal(r.text, '↩ Rejected · "belongs to Trailer 537224" · back to labeled');
    const p = ctx.data.getPallet(stray.id);
    assert.deepEqual([p.status, p.loadId, p.data.flag, p.data.decision.kind, p.data.decision.note], ['labeled', '', '', 'rejected', 'belongs to Trailer 537224']);
    assert.deepEqual(ctx.data.getLoad(t.id).data.flagged, []);
    assert.equal(ctx.run('unload_get', { truckId: t.id }, false).view.decided[0].text, '↩ Rejected · "belongs to Trailer 537224" · back to labeled');
    assert.equal(ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false).result, 'never_loaded');
    assert.deepEqual(ctx.data.getLoad(t.id).data.flagged, [String(p.id)]);
});

test('approvals.flagged lists undecided pallets across trucks; the receipt card repeats its own and blocks approval', () => {
    const ctx = setup();
    const a = departed(ctx, 42, '5260004'), b = departed(ctx, 42, '5260005', '9002');
    const s1 = strayOn(ctx, a.t), s2 = strayOn(ctx, b.t);
    a.ps.forEach(p => ctx.run('unload_scan', { truckId: a.t.id, raw: p.code }, false));
    ctx.run('unload_done', { truckId: a.t.id }, false);
    const ap = ctx.run('approvals');
    assert.deepEqual(ap.flagged.map(f => [f.palletId, f.truckId, f.sku, f.pcs, f.by]), [[s1.id, a.t.id, 'YSN100', 12, 'Miguel'], [s2.id, b.t.id, 'YSN100', 12, 'Miguel']]);
    const rec = ap.receipts.find(x => x.truck.id === a.t.id);
    assert.deepEqual([rec.flagged.map(f => f.palletId), rec.canApprove, rec.warn], [[s1.id], true, '1 flagged pallet still to decide']);
    assert.equal(ctx.run('receipt_approve', { truckId: a.t.id }).perIf[0].received, 504);   // approves with the stray still undecided
    assert.equal(ctx.run('approvals').receipts.some(x => x.truck.id === b.t.id), true, 'a truck with only a flagged pallet still gets a receipt card');
});

test('lastStep rides on the existing writes: start, scan, verify, mark, confirm, unload scan, done, approve', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jls', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'], trailer: 'LS1' }, false).view.truck;
    const step = () => ctx.data.getLoad(t.id).data.lastStep;
    assert.deepEqual([step().kind, step().by], ['started', 'Miguel']);
    ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code }, false);
    assert.equal(step().kind, 'scanned');
    ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code, mode: 'off' }, false);
    assert.equal(step().kind, 'taken_off');
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.equal(step().kind, 'verified');
    ctx.run('ship_mark', { truckId: t.id, seal: '5260006' }, false);
    assert.equal(step().kind, 'marked_shipped');
    ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(step().kind, 'confirmed');
    ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false);
    assert.equal(step().kind, 'unload_scanned');
    ctx.run('unload_done', { truckId: t.id }, false);
    assert.equal(step().kind, 'unload_done');
    ctx.run('receipt_approve', { truckId: t.id });
    assert.equal(step().kind, 'receipt_approved');
});

test('fix wave 1: a decided pallet cannot be decided again (accept then accept / reject), alloc unchanged', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260010');
    const stray = strayOn(ctx, t);
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }).outcome, 'accepted');
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }), /not flagged|nothing to decide|already accepted/);
    assert.throws(() => ctx.run('pallet_reject', { truckId: t.id, palletId: stray.id, note: 'again' }), /not flagged|nothing to decide|already accepted/);
    assert.equal(ctx.data.getLoad(t.id).data.alloc[0].lines['975'], 516);
    assert.equal(ctx.data.getPallet(stray.id).status, 'received');
});

test('fix wave 1: the pallet is re-checked after the claim; a decision that lands in between is refused and the claim is released', () => {
    ['pallet_accept', 'pallet_reject'].forEach(action => {
        const ctx = setup();
        ctx.data.db.settings.writeMode = 'qty';
        const { t } = departed(ctx, 42, action === 'pallet_accept' ? '5260011' : '5260012');
        const stray = strayOn(ctx, t);
        const realUpdate = ctx.data.updateLoad;
        ctx.data.updateLoad = (cur, patch) => {                            // another manager's decision lands just after our claim
            const r = realUpdate(cur, patch);
            if (patch.data && patch.data.phase && patch.data.claim) { ctx.data.updateLoad = realUpdate; ctx.data.updatePallet(ctx.data.getPallet(stray.id), { data: { flag: '' } }); }
            return r;
        };
        assert.throws(() => ctx.run(action, { truckId: t.id, palletId: stray.id, note: 'n' }), /not flagged/);
        const x = ctx.data.getLoad(t.id);
        assert.deepEqual([x.data.claim, x.data.phase, x.data.alloc[0].lines['975']], ['', '', 504]);
        assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_qty').length, 0);
    });
});

test('fix wave 1: two strays of one SKU accepted in off mode target 516 then 528; the office sets 528 and one approvals call settles both', () => {
    const ctx = setup();
    const { t } = departed(ctx, 42, '5260013');
    const s1 = strayOn(ctx, t), s2 = strayOn(ctx, t);
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: s1.id }).text, '⏳ Accepted · office sets IF9001 YSN100 to 516 · receipt waits');
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: s2.id }).text, '⏳ Accepted · office sets IF9001 YSN100 to 528 · receipt waits');
    ctx.run('unload_done', { truckId: t.id }, false);
    const realInfo = ctx.ns.ifInfo;
    ctx.ns.ifInfo = () => { const o = realInfo(); o['9001'].lines = [{ item: '975', sku: 'YSN100', qty: 528 }]; return o; };
    const ap = ctx.run('approvals');
    assert.deepEqual([ap.receipts[0].pending.length, ap.receipts[0].decided.length, ap.receipts[0].canApprove], [0, 2, true]);
    assert.deepEqual([ctx.data.getPallet(s1.id).status, ctx.data.getPallet(s2.id).status], ['received', 'received']);
    assert.equal(ctx.data.getLoad(t.id).data.alloc[0].lines['975'], 528);
});

test('fix wave 1: a retry after completeAccept failed does not write the IF a second time', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260014');
    const stray = strayOn(ctx, t);
    const realInfo = ctx.ns.ifInfo;
    ctx.tx._t.onApply = op => { if (op.op === 'if_qty') ctx.ns.ifInfo = () => { const o = realInfo(); o['9001'].lines = [{ item: '975', sku: 'YSN100', qty: op.to }]; return o; }; };   // the write lands in NetSuite
    const realUpdate = ctx.data.updatePallet;
    ctx.data.updatePallet = (cur, patch) => {
        if (patch.status === 'received') { ctx.data.updatePallet = realUpdate; throw new Error('boom: record write failed'); }
        return realUpdate(cur, patch);
    };
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }), /boom/);
    ctx.data.updatePallet = realUpdate;
    const p1 = ctx.data.getPallet(stray.id), x1 = ctx.data.getLoad(t.id);
    assert.deepEqual([p1.status, p1.data.flag, p1.data.decision || null, x1.data.claim], ['labeled', 'never_loaded', null, '']);
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'accepted');
    assert.equal(r.text, '✅ Accepted · IF9001 504 → 516');
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_qty').length, 1);
    assert.equal(ctx.data.getPallet(stray.id).status, 'received');
    assert.equal(ctx.data.getLoad(t.id).data.alloc[0].lines['975'], 516);
});

test('fix wave 1: unposted counts a completed accept once; a settled pending entry is not also listed as decided while pending', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 42, '5260015');
    const stray = strayOn(ctx, t);
    ctx.run('unload_scan', { truckId: t.id, raw: ps[0].code }, false);
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { unposted: null } });   // as if the counter was never kept: it is recomputed from the pallets
    ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.deepEqual(ctx.run('unload_get', { truckId: t.id }, false).view.decided, [], 'a pending accept is not decided yet');
    const realInfo = ctx.ns.ifInfo;
    ctx.ns.ifInfo = () => { const o = realInfo(); o['9001'].lines = [{ item: '975', sku: 'YSN100', qty: 516 }]; return o; };
    ctx.run('approvals');
    assert.equal(ctx.data.getLoad(t.id).data.unposted, 2);              // the scanned pallet plus the accepted one, each once
    assert.equal(ctx.run('unload_get', { truckId: t.id }, false).view.decided.length, 1);
});

// ── fix wave 2: the accept target is computed after the claim ──
// Runs `fn` once, right after the next call of obj[name] has read its result (the caller gets that earlier, now stale, result), then restores the hook.
function hookOnce(obj, name, fn) {
    const real = obj[name];
    obj[name] = function () { obj[name] = real; const res = real.apply(this, arguments); fn(); return res; };
}

test('fix wave 2: a concurrent accept of the same SKU lands during the pre-claim phase; the second targets 528, not 516', () => {
    const ctx = setup();
    const { t } = departed(ctx, 42, '5260016');
    const s1 = strayOn(ctx, t), s2 = strayOn(ctx, t);
    let r1;
    hookOnce(ctx.data, 'palletsByIds', () => { r1 = ctx.run('pallet_accept', { truckId: t.id, palletId: s1.id }); });   // s1 completes while s2 is still doing its pre-claim reads (s2 keeps the pre-s1 view)
    const r2 = ctx.run('pallet_accept', { truckId: t.id, palletId: s2.id });
    assert.equal(r1.text, '⏳ Accepted · office sets IF9001 YSN100 to 516 · receipt waits');
    assert.equal(r2.text, '⏳ Accepted · office sets IF9001 YSN100 to 528 · receipt waits');
    assert.equal(ctx.data.getPallet(s2.id).data.decision.op.to, 528);
    ctx.run('unload_done', { truckId: t.id }, false);
    const realInfo = ctx.ns.ifInfo;
    ctx.ns.ifInfo = () => { const o = realInfo(); o['9001'].lines = [{ item: '975', sku: 'YSN100', qty: 528 }]; return o; };
    const ap = ctx.run('approvals');
    assert.deepEqual([ap.receipts[0].pending.length, ap.receipts[0].decided.length, ap.receipts[0].canApprove], [0, 2, true]);
    assert.deepEqual([ctx.data.getPallet(s1.id).status, ctx.data.getPallet(s2.id).status], ['received', 'received']);
    assert.equal(ctx.data.getLoad(t.id).data.alloc[0].lines['975'], 528);
});

test('fix wave 2: the claim keeps the truck status it just read (a floor unload scan that moved departed to receiving is not rolled back)', () => {
    ['pallet_accept', 'pallet_reject'].forEach(action => {
        const ctx = setup();
        const { t } = departed(ctx, 42, action === 'pallet_accept' ? '5260017' : '5260018');
        const stray = strayOn(ctx, t);
        assert.equal(ctx.data.getLoad(t.id).status, 'departed');
        const flip = () => ctx.data.updateLoad(ctx.data.getLoad(t.id), { status: 'receiving' });
        if (action === 'pallet_accept') hookOnce(ctx.ns, 'ifInfo', flip);
        else {
            hookOnce(ctx.data, 'getPallet', flip);                           // reject reads no NetSuite data: flip on its first pallet read
        }
        ctx.run(action, { truckId: t.id, palletId: stray.id, note: 'n' });
        assert.equal(ctx.data.getLoad(t.id).status, 'receiving', action);
    });
});

test('fix wave 2: NetSuite already above the target (the office pre-raised the IF) is not lowered by an accept', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260019');
    const stray = strayOn(ctx, t);
    const realInfo = ctx.ns.ifInfo;
    ctx.ns.ifInfo = () => { const o = realInfo(); o['9001'].lines = [{ item: '975', sku: 'YSN100', qty: 528 }]; return o; };
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'accepted');
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_qty').length, 0);
    assert.equal(ctx.data.getLoad(t.id).data.alloc[0].lines['975'], 516);
});

function officeIf(id, status, lines) {                    // an IF the office created in NetSuite on TO700
    return { ifId: id, ifNum: 'IF' + id, status: status, trandate: '2026-10-14', toId: '700', toNum: 'TO700', lines: lines || [{ item: '11', sku: 'YSN201', qty: 120 }] };
}
function officeIfs(ctx, list) {                           // makes them visible to plannedIfs (A/B only) and ifInfo (any status); calls stack
    const rp = ctx.ns.plannedIfs, ri = ctx.ns.ifInfo;
    ctx.ns.plannedIfs = () => rp().concat(list.filter(f => f.status === 'A' || f.status === 'B'));
    ctx.ns.ifInfo = () => { const o = ri(); list.forEach(f => { o[f.ifId] = { ifNum: f.ifNum, status: f.status, toId: f.toId, lines: f.lines.map(l => Object.assign({}, l)) }; }); return o; };
}
// ── Task 2: accept a SKU on no truck IF (add-on IF), pending completion, loaded-elsewhere ──
test('pallet_accept off-IF (on mode): add-on IF created on the covering TO, stamped, pallet received, alloc has the new IF', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t, ps } = departed(ctx, 42, '5260010');
    const stray = strayOn(ctx, t, LINE201);                              // YSN201: no IF on this truck; TO700 (open) covers it
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'accepted');
    assert.match(r.text, /^✅ Accepted · IF90\d · new IF on TO700$/);
    const ops = ctx.tx._t.ops.filter(o => o.toId === '700' || o.ifNum === 'IF 901');
    assert.deepEqual(ops.map(o => o.op), ['if_create', 'if_stamp']);
    assert.deepEqual([ops[0].lines, ops[0].seal, ops[1].ifId, ops[1].lines], [{ '11': 120 }, '5260010', '901', { '11': 120 }]);
    const x = ctx.data.getLoad(t.id);
    const add = x.data.alloc.find(a => a.addOn);
    assert.deepEqual([add.ifId, add.toId, add.lines['11'], x.data.ifs.length], ['901', '700', 120, 2]);
    assert.equal(ctx.data.getPallet(stray.id).status, 'received');
    assert.equal(ctx.run('receipt_preview', { truckId: t.id }).perIf.length, 2);
});

test('pallet_accept off-IF (qty mode): pending; approvals settles it once a Packed IF with those lines appears on the TO', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t, ps } = departed(ctx, 42, '5260011');
    const stray = strayOn(ctx, t, LINE201);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.deepEqual([r.outcome, r.text], ['pending', '⏳ Accepted · office creates IF for 120 YSN201 on TO700 (memo ' + ctx.data.getPallet(stray.id).data.decision.op.token + ') · receipt waits']);
    ctx.run('unload_done', { truckId: t.id }, false);
    assert.deepEqual([ctx.run('approvals').receipts[0].canApprove, ctx.run('approvals').receipts[0].warn], [true, '1 flagged pallet still to decide']);
    officeIfs(ctx, [officeIf('9100', 'B')]);                              // the office creates the IF in NetSuite
    const ap = ctx.run('approvals');
    assert.equal(ap.receipts[0].canApprove, true);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.data.alloc.find(a => a.addOn).ifId, ctx.data.getPallet(stray.id).status], ['9100', 'received']);
    assert.equal(ctx.run('receipt_approve', { truckId: t.id }).perIf.find(f => f.ifId === '9100').received, 120);
});

test('pallet_accept with no covering TO is refused without a claim and leaves the pallet undecided', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    ctx.data.db.items.push({ item: '77', sku: 'YSN777', desc: 'odd', upc: '' });
    const { t } = departed(ctx, 42, '5260012');
    const stray = strayOn(ctx, t, { item: '77', sku: 'YSN777', cfg: '', pcs: 10 });
    const realUpdate = ctx.data.updateLoad;
    ctx.data.updateLoad = (cur, patch) => { assert.ok(!(patch.data && patch.data.claim), 'a refused accept must not claim the truck'); return realUpdate(cur, patch); };
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    ctx.data.updateLoad = realUpdate;
    assert.deepEqual([r.outcome, r.text], ['refused', '⛔ Can\'t accept · no open TO covers YSN777 · Reject or office adds a TO line']);
    assert.deepEqual([ctx.data.getPallet(stray.id).data.flag, ctx.data.getPallet(stray.id).data.decision], ['never_loaded', undefined]);
    assert.equal(ctx.run('approvals').flagged.length, 1);
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_create').length, 0);
});

test('a pallet loaded on another open truck, accepted here, leaves that truck (its ready reverts to loading)', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t, ps } = departed(ctx, 42, '5260013');
    const other = readyTruck(ctx, 2, '9002');                            // 2 pallets of YSN100 on IF9002 (matched to 24)
    const r0 = ctx.run('unload_scan', { truckId: t.id, raw: other.ps[0].code }, false);
    assert.equal(r0.result, 'never_loaded');
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: other.ps[0].id });
    assert.equal(r.outcome, 'accepted');
    const p = ctx.data.getPallet(other.ps[0].id), o = ctx.data.getLoad(other.t.id);
    assert.deepEqual([p.status, p.loadId, o.status, o.data.lastStep.kind], ['received', t.id, 'loading', 'taken_off']);
    assert.equal(ctx.data.palletsByLoad(other.t.id, ['loaded']).length, 1);
});

test('Task 2: a pending off-IF accept also takes the pallet off the open truck that holds it', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260017');
    const other = readyTruck(ctx, 2, '9002');
    const stray = strayOn(ctx, t, LINE201);
    ctx.data.updatePallet(ctx.data.getPallet(stray.id), { status: 'loaded', load: other.t.id });      // it was scanned onto the other truck at Riverside
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'pending');
    const p = ctx.data.getPallet(stray.id), o = ctx.data.getLoad(other.t.id);
    assert.deepEqual([p.status, p.loadId, p.data.decision.kind, o.status, o.data.lastStep.kind], ['labeled', '', 'accepted_pending', 'loading', 'taken_off']);
});

test('Task 2: a retry after completeAccept failed on an add-on does not create the IF a second time', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = departed(ctx, 42, '5260018');
    const stray = strayOn(ctx, t, LINE201);
    const realUpdate = ctx.data.updatePallet;
    ctx.data.updatePallet = (cur, patch) => {
        if (patch.status === 'received') { ctx.data.updatePallet = realUpdate; throw new Error('boom: record write failed'); }
        return realUpdate(cur, patch);
    };
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }), /boom/);
    ctx.data.updatePallet = realUpdate;
    const p1 = ctx.data.getPallet(stray.id), x1 = ctx.data.getLoad(t.id);
    assert.deepEqual([p1.status, p1.data.flag, x1.data.claim, ctx.tx._t.ops.filter(o => o.op === 'if_create').length], ['labeled', 'never_loaded', '', 1]);
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'accepted');
    assert.equal(r.text, '✅ Accepted · IF901 · new IF on TO700');
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_create').length, 1);
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_stamp' && o.ifId === '901').length, 1);
    assert.equal(ctx.data.getPallet(stray.id).status, 'received');
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual(x.data.alloc.filter(a => a.addOn).map(a => [a.ifId, a.lines['11']]), [['901', 120]]);
});

test('Task 2: an add-on that was created and completed is not reused by a second accept of the same lines', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = departed(ctx, 42, '5260019');
    const s1 = strayOn(ctx, t, LINE201), s2 = strayOn(ctx, t, LINE201);
    ctx.run('pallet_accept', { truckId: t.id, palletId: s1.id });
    const r2 = ctx.run('pallet_accept', { truckId: t.id, palletId: s2.id });    // the snapshot NetSuite does not know IF 901, so this is another off-IF accept
    assert.equal(r2.outcome, 'accepted');
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_create').length, 2);
    assert.deepEqual(ctx.data.getLoad(t.id).data.alloc.filter(a => a.addOn).map(a => a.ifId), ['901', '902']);
});

test('Task 2: two pending add-ons with the same lines settle onto two different IFs, never the same one twice', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260020');
    const s1 = strayOn(ctx, t, LINE201), s2 = strayOn(ctx, t, LINE201);
    ctx.run('pallet_accept', { truckId: t.id, palletId: s1.id });
    ctx.run('pallet_accept', { truckId: t.id, palletId: s2.id });
    officeIfs(ctx, [officeIf('9100', 'B')]);
    ctx.run('approvals');
    assert.deepEqual(ctx.data.getLoad(t.id).data.alloc.filter(a => a.addOn).map(a => a.ifId), ['9100']);
    assert.equal(ctx.data.getPallet(s2.id).status, 'labeled');                  // still waiting for its own IF
    officeIfs(ctx, [officeIf('9101', 'B')]);
    ctx.run('approvals');
    assert.deepEqual(ctx.data.getLoad(t.id).data.alloc.filter(a => a.addOn).map(a => a.ifId), ['9100', '9101']);
});

test('fix wave 1: two trucks with the same pending accept settle onto two different office IFs, never the same one in one approvals call', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const a = departed(ctx, 42, '5260030', '9001'), b = departed(ctx, 2, '5260031', '9002');
    const sa = strayOn(ctx, a.t, LINE201), sb = strayOn(ctx, b.t, LINE201);
    assert.equal(ctx.run('pallet_accept', { truckId: a.t.id, palletId: sa.id }).outcome, 'pending');
    assert.equal(ctx.run('pallet_accept', { truckId: b.t.id, palletId: sb.id }).outcome, 'pending');
    officeIfs(ctx, [officeIf('9100', 'B')]);
    ctx.run('approvals');
    const held = id => ctx.data.getLoad(id).data.alloc.filter(x => x.addOn).map(x => x.ifId);
    assert.deepEqual(held(a.t.id).concat(held(b.t.id)), ['9100']);          // exactly one truck took it
    assert.deepEqual([ctx.data.getPallet(sa.id).status, ctx.data.getPallet(sb.id).status].sort(), ['labeled', 'received']);
    officeIfs(ctx, [officeIf('9101', 'B')]);
    ctx.run('approvals');
    assert.deepEqual([held(a.t.id), held(b.t.id)].map(l => l.length), [1, 1]);
    assert.deepEqual(held(a.t.id).concat(held(b.t.id)).sort(), ['9100', '9101']);
    assert.deepEqual([ctx.data.getPallet(sa.id).status, ctx.data.getPallet(sb.id).status], ['received', 'received']);
});

test('fix wave 1: a pending accept reserves its TO room, so a Riverside truck cannot take it', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260032', '9001');
    const stray = strayOn(ctx, t, LINE201);                                  // pending: 120 of TO700's 1200
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }).outcome, 'pending');
    const lt = truckWith(ctx, 2, '9002').t;                                  // a Riverside truck with no YSN201: it would need an add-on from TO700
    const big = printLabels(ctx, 1, 'Jbig1', [{ item: '11', sku: 'YSN201', cfg: '', pcs: 1100 }])[0];
    const r1 = ctx.run('truck_scan', { truckId: lt.id, raw: big.code }, false);
    assert.equal(r1.result, 'no_to');                                        // 1,100 + the pending 120 is over TO700's 1,200
    assert.equal(ctx.data.getPallet(big.id).status, 'labeled');
    const ok = printLabels(ctx, 1, 'Jbig2', [{ item: '11', sku: 'YSN201', cfg: '', pcs: 1000 }])[0];
    assert.equal(ctx.run('truck_scan', { truckId: lt.id, raw: ok.code }, false).result, 'addon');
});

test('fix wave 1: a pending create reserves its room too (a second accept cannot take what the office needs)', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260033', '9001');
    const s1 = strayOn(ctx, t, LINE201);
    ctx.run('pallet_accept', { truckId: t.id, palletId: s1.id });
    const big = strayOn(ctx, t, { item: '11', sku: 'YSN201', cfg: '', pcs: 1100 });
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: big.id });
    assert.equal(r.outcome, 'refused');
});

test('fix wave 1: the settle matcher sees an add-on IF the office already shipped, preferring shipped over Packed over Picked, then the lowest id', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260034', '9001');
    const stray = strayOn(ctx, t, LINE201);
    ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    officeIfs(ctx, [officeIf('9100', 'A'), officeIf('9101', 'B'), officeIf('9103', 'C'), officeIf('9102', 'C')]);
    ctx.run('approvals');
    assert.deepEqual(ctx.data.getLoad(t.id).data.alloc.filter(a => a.addOn).map(a => a.ifId), ['9102']);
    const t2 = departed(ctx, 2, '5260035', '9002'), s2 = strayOn(ctx, t2.t, LINE201);
    ctx.run('pallet_accept', { truckId: t2.t.id, palletId: s2.id });
    ctx.run('approvals');
    assert.deepEqual(ctx.data.getLoad(t2.t.id).data.alloc.filter(a => a.addOn).map(a => a.ifId), ['9103']);
});

test('fix wave 1: a shipped IF with other lines, or on another TO, is not taken as the add-on', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260036', '9001');
    const stray = strayOn(ctx, t, LINE201);
    ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    officeIfs(ctx, [officeIf('9100', 'C', [{ item: '11', sku: 'YSN201', qty: 121 }]), Object.assign(officeIf('9101', 'C'), { toId: '800', toNum: 'TO800' }), officeIf('9102', 'D')]);
    ctx.run('approvals');
    assert.deepEqual(ctx.data.getLoad(t.id).data.alloc.filter(a => a.addOn).length, 0);
});

test('fix wave 1: a retry does not reuse an IF that another truck holds, it creates a new one', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const a = departed(ctx, 42, '5260037', '9001'), b = departed(ctx, 2, '5260038', '9002');
    const stray = strayOn(ctx, a.t, LINE201);
    const realUpdate = ctx.data.updatePallet;
    ctx.data.updatePallet = (cur, patch) => {
        if (patch.status === 'received') { ctx.data.updatePallet = realUpdate; throw new Error('boom: record write failed'); }
        return realUpdate(cur, patch);
    };
    assert.throws(() => ctx.run('pallet_accept', { truckId: a.t.id, palletId: stray.id }), /boom/);
    ctx.data.updatePallet = realUpdate;
    const xb = ctx.data.getLoad(b.t.id);                                     // meanwhile a manager put IF 901 on the other truck
    ctx.data.updateLoad(xb, { data: { ifs: (xb.data.ifs || []).concat([{ ifId: '901', ifNum: 'IF 901', toId: '700', toNum: 'TO700', lines: [{ item: '11', sku: 'YSN201', qty: 120 }] }]) } });
    const r = ctx.run('pallet_accept', { truckId: a.t.id, palletId: stray.id });
    assert.equal(r.outcome, 'accepted');
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_create').length, 2);
    assert.deepEqual(ctx.data.getLoad(a.t.id).data.alloc.filter(x => x.addOn).map(x => x.ifId), ['902']);
});

test('fix wave 1: the stamp fails after the create landed; the retry stamps the recorded IF and never creates a second one', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = departed(ctx, 42, '5260039', '9001');
    const stray = strayOn(ctx, t, LINE201);
    ctx.tx._t.failOn = 'if_stamp:901';
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }), /Accept refused/);
    const p1 = ctx.data.getPallet(stray.id), x1 = ctx.data.getLoad(t.id);
    assert.deepEqual([p1.status, p1.data.flag, x1.data.claim, ctx.tx._t.ops.filter(o => o.op === 'if_create').length, ctx.tx._t.ops.filter(o => o.op === 'if_stamp' && o.ifId === '901').length], ['labeled', 'never_loaded', '', 1, 0]);
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'accepted');
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_create').length, 1);
    assert.equal(ctx.tx._t.ops.filter(o => o.op === 'if_stamp' && o.ifId === '901').length, 1);
    assert.equal(ctx.data.getPallet(stray.id).status, 'received');
    assert.deepEqual(ctx.data.getLoad(t.id).data.alloc.filter(a => a.addOn).map(a => a.ifId), ['901']);
});

test('fix wave 3: stacked pending accepts on one IF line reserve their room once (24 pcs for two 12-pc strays, not 36)', () => {
    const ctx = setup();
    const orig = ctx.ns.openToLines;
    ctx.ns.openToLines = () => orig().filter(r => r.toId === '500');                 // TO500: 48 left, no other TO for YSN100
    const { t } = departed(ctx, 42, '5260040', '9001');                              // IF9001 = 504
    const s1 = strayOn(ctx, t), s2 = strayOn(ctx, t);
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: s1.id }).outcome, 'pending');
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: s2.id }).outcome, 'pending');
    assert.deepEqual(ctx.data.getPallet(s2.id).data.decision.op, { op: 'if_qty', ifId: '9001', ifNum: 'IF9001', toId: '500', item: '975', from: 504, to: 528 });
    const lt = truckWith(ctx, 42, '9002').t;                                        // IF9002 is full: any more YSN100 needs TO500 room
    const big = (n, job) => printLabels(ctx, 1, job, [{ item: '975', sku: 'YSN100', cfg: '', pcs: n }])[0];
    const over = big(25, 'Jres25'), fits = big(24, 'Jres24');
    assert.equal(ctx.run('truck_scan', { truckId: lt.id, raw: over.code }, false).result, 'no_to');   // 48 - 24 reserved = 24 left (36 reserved would leave 12)
    assert.equal(ctx.data.getPallet(over.id).status, 'labeled');
    const rf = ctx.run('truck_scan', { truckId: lt.id, raw: fits.code }, false);
    assert.equal(rf.result, 'over');                                              // loads as a raise on IF9002 against TO500's remaining 24
    assert.equal(ctx.data.getPallet(fits.id).status, 'loaded');
});

test('fix wave 3: a pending create stops reserving once the office IF exists (NetSuite then counts it)', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260041', '9001');
    const stray = strayOn(ctx, t, LINE201);
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }).outcome, 'pending');   // pending create: 120 of TO700
    const lt = truckWith(ctx, 2, '9002').t;
    const big = (n, job) => printLabels(ctx, 1, job, [{ item: '11', sku: 'YSN201', cfg: '', pcs: n }])[0];
    assert.equal(ctx.run('truck_scan', { truckId: lt.id, raw: big(1100, 'Jc1').code }, false).result, 'no_to');
    officeIfs(ctx, [officeIf('9100', 'B')]);                                                          // the office made it (not settled yet: no approvals call)
    assert.equal(ctx.run('truck_scan', { truckId: lt.id, raw: big(1100, 'Jc2').code }, false).result, 'addon');
});

test('report.history: every truck newest first with who/when per step and correction lines', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const a = departed(ctx, 42, '5260030');
    const s = strayOn(ctx, a.t);
    a.ps.forEach(p => ctx.run('unload_scan', { truckId: a.t.id, raw: p.code }, false));
    ctx.run('pallet_accept', { truckId: a.t.id, palletId: s.id });
    const b = truckWith(ctx, 3, '9002');                                             // still loading
    const h = ctx.run('report').history;
    assert.deepEqual(h.map(r => [r.truckId, r.stage]), [[b.t.id, 'Loading'], [a.t.id, 'Unloading']]);
    const ra = h[1];
    assert.deepEqual([ra.day, ra.truck, ra.truckNo, ra.trailer, ra.seal, ra.ifs, ra.pallets, ra.pcs, ra.startedBy, ra.markedBy, ra.confirmedBy],
        ['2026-10-14', 'Truck 1 · 10/14', 1, ctx.data.getLoad(a.t.id).data.trailer, '5260030', ['IF9001'], 43, 516, 'Miguel', 'Miguel', 'Jack K']);
    assert.deepEqual(ra.corrections, ['+ ' + s.code + ' accepted · IF9001']);
    assert.deepEqual([h[0].seal, h[0].markedAt, h[0].corrections], ['', '', []]);
});

// ── final review fix wave (F1-F5) ──
test('final fix F1: two overlapping approvals settle one pending accept once (alloc 516, received once)', () => {
    const ctx = setup();
    const { t } = departed(ctx, 42, '5260050', '9001');
    const stray = strayOn(ctx, t);
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }).outcome, 'pending');   // off mode: the office edits the IF
    const realInfo = ctx.ns.ifInfo;
    ctx.ns.ifInfo = () => { const o = realInfo(); o['9001'].lines = [{ item: '975', sku: 'YSN100', qty: 516 }]; return o; };
    let receives = 0;
    const realUpd = ctx.data.updatePallet;
    ctx.data.updatePallet = (cur, patch) => { if (patch.status === 'received' && String(cur.id) === String(stray.id)) receives++; return realUpd(cur, patch); };
    hookOnce(ctx.ns, 'ifInfo', () => ctx.run('approvals'));                   // a second request runs while the first is about to settle
    ctx.run('approvals');
    ctx.data.updatePallet = realUpd;
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.data.alloc[0].lines['975'], receives, x.data.unposted, x.data.claim || '', ctx.data.getPallet(stray.id).status], [516, 1, 1, '', 'received']);
    assert.equal(x.data.corrections.filter(k => k.kind === 'pallet_accept').length, 1);
});

test('final fix F1: completeAccept refuses a pallet that is already accepted', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = departed(ctx, 42, '5260051', '9001');
    const stray = strayOn(ctx, t);
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }).outcome, 'accepted');
    assert.equal(ctx.data.getLoad(t.id).data.alloc[0].lines['975'], 516);
    // the same pallet can no longer be decided again (flag cleared), and the alloc stays at 516
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }), /not flagged/);
    assert.equal(ctx.data.getLoad(t.id).data.alloc[0].lines['975'], 516);
});

test('final fix F2: a pending accept can be withdrawn by Reject; the receipt unblocks and the TO room is freed', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t, ps } = departed(ctx, 42, '5260052', '9001');
    const stray = strayOn(ctx, t, LINE201);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }).outcome, 'pending');
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }), /already accepted/);
    ctx.run('unload_done', { truckId: t.id }, false);
    const lt = truckWith(ctx, 2, '9002').t;
    const big = printLabels(ctx, 1, 'Jwd1', [{ item: '11', sku: 'YSN201', cfg: '', pcs: 1100 }])[0];
    assert.equal(ctx.run('truck_scan', { truckId: lt.id, raw: big.code }, false).result, 'no_to');   // 1,100 + the pending 120 is over TO700's 1,200
    assert.equal(ctx.run('approvals').receipts[0].warn, '1 flagged pallet still to decide');
    const r = ctx.run('pallet_reject', { truckId: t.id, palletId: stray.id, note: 'office will not make an IF' });
    assert.equal(r.outcome, 'rejected');
    assert.equal(r.text, '↩ Rejected · "office will not make an IF" · pending accept withdrawn · back to labeled');
    const p = ctx.data.getPallet(stray.id), x = ctx.data.getLoad(t.id);
    assert.deepEqual([p.status, p.loadId, p.data.flag, p.data.decision.kind, p.data.decision.text], ['labeled', '', '', 'rejected', r.text]);
    assert.deepEqual([x.data.flagged, x.data.claim || '', x.data.corrections.filter(k => k.pending).length, x.data.corrections.filter(k => k.kind === 'pallet_reject').length], [[], '', 0, 1]);
    const ap = ctx.run('approvals');
    assert.deepEqual([ap.receipts[0].canApprove, ap.receipts[0].pending.length, ap.receipts[0].warn], [true, 0, '']);
    assert.equal(ctx.run('truck_scan', { truckId: lt.id, raw: big.code }, false).result, 'addon');       // the reservation is gone
});

test('final fix F3: a pallet on a truck marked shipped cannot be accepted or rejected off it', () => {
    ['pallet_accept', 'pallet_reject'].forEach(action => {
        const ctx = setup();
        ctx.data.db.settings.writeMode = 'qty';
        const { t } = departed(ctx, 42, '5260053', '9001');
        const other = readyTruck(ctx, 2, '9002');
        assert.equal(ctx.run('unload_scan', { truckId: t.id, raw: other.ps[0].code }, false).result, 'never_loaded');
        ctx.run('ship_mark', { truckId: other.t.id, seal: '5260054' }, false);
        assert.equal(ctx.data.getLoad(other.t.id).status, 'ship_pending');
        assert.throws(() => ctx.run(action, { truckId: t.id, palletId: other.ps[0].id, note: 'n' }),
            /That pallet is on Trailer [^,]+, which is waiting for ship confirmation: confirm or send back that truck first/, action);
        assert.deepEqual([ctx.data.getPallet(other.ps[0].id).status, ctx.data.getPallet(other.ps[0].id).loadId], ['loaded', other.t.id]);
        assert.equal(ctx.data.getLoad(other.t.id).status, 'ship_pending');
    });
});

test('final fix F4 (2026-10-07): a pallet flagged mid-approve no longer blocks it; the receipt posts what is in and the stray stays flagged', () => {
    const ctx = setup();
    const { t, ps } = departed(ctx, 42, '5260055', '9001');
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('unload_done', { truckId: t.id }, false);
    const s = printLabels(ctx, 1, 'Jfl4', [L975])[0];
    hookOnce(ctx.data, 'palletsByLoad', () => ctx.run('unload_scan', { truckId: t.id, raw: s.code }, false));   // a floor scan flags it mid-request
    assert.equal(ctx.run('receipt_approve', { truckId: t.id }).perIf[0].received, 504);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.claim || '', x.data.flagged], ['received', '', [String(s.id)]]);
});

test('final fix F5: a pending-accepted or flagged pallet is refused at Riverside and not loaded', () => {
    const ctx = setup();
    const { t } = departed(ctx, 42, '5260056', '9001');
    const stray = strayOn(ctx, t);
    const lt = truckWith(ctx, 2, '9002').t;
    let r = ctx.run('truck_scan', { truckId: lt.id, raw: stray.code }, false);               // flagged, undecided
    assert.deepEqual([r.result, r.tone, ctx.data.getPallet(stray.id).status], ['flagged_tippecanoe', 'bad', 'labeled']);
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }).outcome, 'pending');
    r = ctx.run('truck_scan', { truckId: lt.id, raw: stray.code }, false);                   // accepted, pending the office
    assert.deepEqual([r.result, r.tone, r.pallet.id, ctx.data.getPallet(stray.id).status, r.view.totals.pallets], ['flagged_tippecanoe', 'bad', stray.id, 'labeled', 2]);
});

// ── 2026-10-07: shipped IFs are never edited; flagged pallets no longer block the receipt ──
test('2026-10-07: accepting a stray whose SKU is on a Shipped truck IF makes an add-on IF instead of editing the shipped IF', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t, ps } = departed(ctx, 42, '5260071');
    const ri = ctx.ns.ifInfo;                                             // NetSuite: the truck's IF is Shipped (C), as it is at Tippecanoe
    ctx.ns.ifInfo = () => { const o = ri(); if (o['9001']) o['9001'].status = 'C'; return o; };
    const stray = strayOn(ctx, t);                                        // YSN100, same SKU as IF9001
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    const before = ctx.tx._t.ops.length;
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id });
    assert.equal(r.outcome, 'accepted');
    assert.match(r.text, /new IF on /);
    const ops = ctx.tx._t.ops.slice(before);
    assert.deepEqual(ops.map(o => o.op), ['if_create', 'if_stamp'], 'the shipped IF is not edited');
    const x = ctx.data.getLoad(t.id), add = x.data.alloc.find(a => a.addOn);
    assert.deepEqual([add.lines['975'], x.data.alloc.find(a => a.ifId === '9001').lines['975'], ctx.data.getPallet(stray.id).status], [12, 504, 'received']);
});

test('2026-10-07: approve the receipt with a stray undecided and a pallet missing; accept the stray later → a late receipt for it alone', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t, ps } = departed(ctx, 42, '5260072');
    const stray = strayOn(ctx, t);
    ps.slice(0, 41).forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));   // one pallet missing
    ctx.run('unload_done', { truckId: t.id }, false);
    const rec = ctx.run('approvals').receipts[0];
    assert.deepEqual([rec.canApprove, rec.warn, rec.missing.length], [true, '1 flagged pallet still to decide', 1]);
    const a1 = ctx.run('receipt_approve', { truckId: t.id });
    assert.deepEqual(a1.perIf, [{ ifId: '9001', ifNum: 'IF9001', shipped: 504, received: 492, short: 12 }]);
    assert.equal(ctx.data.getPallet(stray.id).data.flag, 'never_loaded');   // still waiting for a decision
    assert.equal(ctx.run('pallet_accept', { truckId: t.id, palletId: stray.id }).outcome, 'accepted');
    const late = ctx.run('approvals').receipts.find(x => x.truck.id === t.id);
    assert.deepEqual([late.lateOnly, late.canApprove, late.warn], [true, true, '']);
    const a2 = ctx.run('receipt_approve', { truckId: t.id });
    assert.deepEqual(ctx.data.getLoad(t.id).data.rplan.map(o => o.lines['975']), [492, 12]);
    assert.equal(a2.perIf[0].received, 504);
});

test('2026-10-07: other items not ticked in at unload show on the receipt card and do not block it', () => {
    const ctx = setup();
    const r0 = truckWith(ctx, 42), t = r0.t, ps = r0.ps;
    ctx.run('truck_other_add', { truckId: t.id, desc: 'Office desk', qty: 2 }, false);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');
    ship(ctx, { truckId: t.id, seal: '5260073' });
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('unload_done', { truckId: t.id }, false);
    const rec = ctx.run('approvals').receipts[0];
    assert.deepEqual([rec.canApprove, rec.otherNotIn.map(o => [o.desc, o.qty])], [true, [['Office desk', 2]]]);
    assert.equal(ctx.run('receipt_approve', { truckId: t.id }).perIf[0].received, 504);
});

test('2026-10-07: IR numbers on the approve result, Active loads, truck history; the pop-up of a shipped truck shows received / shipped and missing', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t, ps } = departed(ctx, 42, '5260074');
    ps.slice(0, 41).forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('unload_done', { truckId: t.id }, false);
    const a = ctx.run('receipt_approve', { truckId: t.id });
    assert.equal(a.irs.length, 1);
    assert.match(a.irs[0].irNum, /^IR\d+$/);
    assert.deepEqual([a.irs[0].pcs, a.irs[0].ifNum], [492, 'IF9001']);
    assert.equal(ctx.data.getLoad(t.id).data.irNums[a.irs[0].irId], a.irs[0].irNum);
    const v = ctx.run('truck_get', { truckId: t.id }).view;
    assert.deepEqual([v.receipt.perIf[0].received, v.receipt.perIf[0].shipped, v.receipt.missing, v.receipt.irs[0].irNum], [492, 504, [ps[41].code], a.irs[0].irNum]);
    const rep = ctx.run('report');
    assert.deepEqual(rep.history.find(h => h.truckId === t.id).irs, [a.irs[0].irNum + ' (492)']);
    const dash = ctx.run('dashboard');
    assert.deepEqual(dash.rows.find(r => r.truckId === t.id).irs, [a.irs[0].irNum]);
});

function scanSetup() {
    const ctx = setup();
    ctx.data.db.settings.officeIfs = false;
    ctx.data.db.items.find(i => i.item === '11').weight = 10;
    ctx.data.db.items.find(i => i.item === '11').wunit = 'lb';
    return ctx;
}
function scanTruck(ctx, n) {
    const ps = printLabels(ctx, n || 2);
    const v = ctx.run('truck_start', { trailer: tr() }, false).view;
    ps.forEach(p => ctx.run('truck_scan', { truckId: v.truck.id, raw: p.code }, false));
    return { id: v.truck.id, ps };
}

test('scan-built: start with only a trailer, load any labeled pallet, see SKU rows with weight and stock', () => {
    const ctx = scanSetup();
    assert.deepEqual(ctx.run('truck_planned', {}, false).planned, []);
    assert.equal(ctx.run('truck_planned', {}, false).officeIfs, false);
    const t = scanTruck(ctx, 2);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.kind, x.data.ifs], ['loading', 'scan', []]);
    const v = ctx.run('truck_get', { truckId: t.id }, false).view;
    assert.deepEqual(v.scan.rows, [{ item: '11', sku: 'YSN201', pallets: 2, pcs: 240, lbs: 2400, avail: 1000, short: false }]);
    assert.deepEqual([v.scan.pallets, v.scan.pcs, v.scan.tare, v.scan.total, v.scan.noWeight, v.scan.short], [2, 240, 90, 2490, 0, false]);
});

test('scan-built: Verify always matches when something is loaded, and refuses an empty truck', () => {
    const ctx = scanSetup();
    const empty = ctx.run('truck_start', { trailer: tr() }, false).view.truck.id;
    assert.throws(() => ctx.run('truck_verify', { truckId: empty }, false), /Nothing is loaded on this truck/);
    const t = scanTruck(ctx, 1);
    const r = ctx.run('truck_verify', { truckId: t.id }, false);
    assert.equal(r.match, true);
    assert.equal(ctx.data.getLoad(t.id).status, 'ready');
});

test('scan-built: a ready scan truck goes back to loading when another pallet is scanned', () => {
    const ctx = scanSetup();
    const t = scanTruck(ctx, 1);
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.equal(ctx.data.getLoad(t.id).status, 'ready');
    const more = printLabels(ctx, 1, 'Jtest2');
    ctx.run('truck_scan', { truckId: t.id, raw: more[0].code }, false);
    assert.equal(ctx.data.getLoad(t.id).status, 'loading');
});

test('scan-built: over Riverside available shows as short (a warning, not a block, on the floor)', () => {
    const ctx = scanSetup();
    ctx.data.db.stock['35']['11'].avail = 100;
    const t = scanTruck(ctx, 1);
    const v = ctx.run('truck_get', { truckId: t.id }, false).view;
    assert.deepEqual([v.scan.rows[0].short, v.scan.short], [true, true]);
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).match, true);
});

test('office IFs on: a truck still needs an IF; off: office-IF actions refuse a scan truck', () => {
    const on = setup();
    assert.throws(() => on.run('truck_start', { trailer: tr() }, false), /Pick at least one IF/);
    const ctx = scanSetup();
    const t = scanTruck(ctx, 1);
    assert.throws(() => ctx.run('truck_add_if', { truckId: t.id, ifId: '1' }), /no IFs/);
});

function shipScan(ctx, n, mode) {
    ctx.data.db.settings.writeMode = mode || 'on';
    const t = scanTruck(ctx, n || 2);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id, seal: 'S' + t.id }, false);
    return t;
}

// Drop trailer (2026-10-17): the floor's Picked up waits for the manager; Confirm shipped writes the stamps. A retry skips the floor step.
function pickUp(ctx, a) {
    if (ctx.data.getLoad(a.truckId).status !== 'pickup_pending') ctx.run('picked_up', a, false);
    return ctx.run('pickup_confirm', { truckId: a.truckId });
}
function docsScan(ctx, n, mode, seal) {
    ctx.data.db.settings.writeMode = mode || 'on';
    const t = scanTruck(ctx, n || 2);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', Object.assign({ truckId: t.id }, seal ? { seal: seal } : {}), false);
    return t;
}

test('drop trailer: Send for docs needs no seal; Approve writes TO (B) + Packed IF and parks the truck at the dock', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 2);
    assert.equal(ctx.data.getLoad(t.id).status, 'ship_pending');
    const r = ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(r.atDock, true);
    const x = ctx.data.getLoad(t.id), d = x.data;
    const [to, f] = ctx.tx._t.ops;
    assert.deepEqual([to.op, to.orderStatus, f.op, f.ship, f.seal], ['to_create', 'B', 'if_create', 'packed', '']);
    assert.deepEqual([x.status, d.depart.seal, d.departPallets], ['at_dock', '', null]);
    assert.deepEqual(d.docLines, { '11': { qty: 240, ifId: d.ifId, ifNum: 'IF' + d.ifId } });
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'loaded'));
});

test('drop trailer (2026-10-17): a seal typed at Send for docs is ignored; the seal goes in at the dock only', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 1, 'on', '5249330');
    assert.equal(ctx.data.getLoad(t.id).data.shipReq.seal, '');
    ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(ctx.tx._t.ops[1].seal, '');
    assert.equal(ctx.data.getLoad(t.id).data.depart.seal, '');
});

test('drop trailer: off mode parks at the dock with a plan only', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 2, 'off');
    const r = ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getLoad(t.id).status, 'at_dock');
    assert.deepEqual(ctx.data.getLoad(t.id).data.docLines, { '11': { qty: 240, ifId: '', ifNum: '' } });
    assert.ok(r.planOnly.length > 0);
});

test('drop trailer: Shipments lists at-dock trucks as open, not shipped; Dashboard stages say Waiting for docs / At dock', () => {
    const ctx = scanSetup();
    const a = docsScan(ctx, 1);
    let pl = ctx.run('truck_planned', {}, false);
    assert.deepEqual(pl.open.map(x => x.status), ['ship_pending']);
    assert.equal(ctx.run('dashboard').rows.find(r => String(r.truckId) === String(a.id)).stage, 'Waiting for docs');
    ctx.run('ship_confirm', { truckId: a.id });
    pl = ctx.run('truck_planned', {}, false);
    assert.deepEqual([pl.open.map(x => x.status), pl.shippedToday.length], [['at_dock'], 0]);
    const rows = ctx.run('dashboard').rows.filter(r => String(r.truckId) === String(a.id));
    assert.deepEqual(rows.map(r => [r.stage, r.pallets, r.pcs]), [['At dock', 1, 120]]);
});

test('scan-built Approve (on): writes TO then Packed IF and parks at the dock', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 2);
    ctx.run('ship_confirm', { truckId: t.id });
    const x = ctx.data.getLoad(t.id), d = x.data;
    const [to, f] = ctx.tx._t.ops;
    assert.deepEqual([to.op, to.orderStatus, to.fromLoc, to.toLoc, to.lines, to.token], ['to_create', 'B', '35', '99', { '11': 240 }, '[MV-' + t.id + ']']);
    assert.deepEqual([f.op, f.ship, f.toId, f.seal, f.trailer, f.lines], ['if_create', 'packed', d.toId, '', d.trailer, { '11': 240 }]);
    assert.deepEqual([x.status, x.to, x.if, d.toNum, d.ifNum], ['at_dock', d.toId, d.ifId, 'TO' + d.toId, 'IF' + d.ifId]);
    assert.deepEqual(d.alloc, [{ ifId: d.ifId, ifNum: 'IF' + d.ifId, toId: d.toId, toNum: 'TO' + d.toId, lines: { '11': 240 }, addOn: false }]);
    pickUp(ctx, { truckId: t.id, seal: 'S' + t.id });
    t.ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const ir = ctx.tx._t.ops.find(o => o.op === 'receipt');
    assert.deepEqual([ir.op, ir.ifId, ir.toId, ir.lines], ['receipt', d.ifId, d.toId, { '11': 240 }]);
});

test('scan-built Approve is blocked on a stock short and writes nothing', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 2);
    ctx.data.db.stock['35']['11'].avail = 100;
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }), /Can't approve: YSN201 on truck 240, available 100/);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getLoad(t.id).status, 'ship_pending');
});

// Jack 10/27: Settings stockOverride (employee ids) may approve a stock short with a typed reason (NetSuite's count is behind SellerCloud).
test('stockOverride: a listed manager approves a short with a reason; it is saved and shown in history; others stay blocked', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 2);
    ctx.data.db.stock['35']['11'].avail = 100;
    let e = null;
    try { ctx.run('ship_confirm', { truckId: t.id, override: 'SC shows 400' }); } catch (x) { e = x; }
    assert.match(e.message, /Can't approve/);
    assert.deepEqual([e.stockShort, e.canOverride, ctx.tx._t.ops.length], [true, false, 0]);
    ctx.data.db.settings.stockOverride = ['5'];
    e = null;
    try { ctx.run('ship_confirm', { truckId: t.id }); } catch (x) { e = x; }
    assert.deepEqual([e.stockShort, e.canOverride, ctx.tx._t.ops.length], [true, true, 0]);   // no reason: still blocked
    ctx.run('ship_confirm', { truckId: t.id, override: '  SC shows 400  ' });
    const x = ctx.data.getLoad(t.id);
    assert.equal(x.status, 'at_dock');
    assert.deepEqual(ctx.tx._t.ops.map(o => o.op), ['to_create', 'if_create']);
    assert.equal(x.data.overrides.length, 1);
    assert.deepEqual([x.data.overrides[0].reason, x.data.overrides[0].byId], ['SC shows 400', '5']);
    assert.match(x.data.overrides[0].short, /YSN201 on truck 240, available 100/);
    const h = ctx.run('report').history.find(r => String(r.truckId) === String(t.id));
    assert.ok(h.corrections.some(s => /Approved short/.test(s) && /SC shows 400/.test(s)));
});

test('stockOverride also covers a re-approve after a Send back', () => {
    const ctx = scanSetup();
    ctx.data.db.settings.stockOverride = ['5'];
    const t = atDock(ctx, 1);
    ctx.run('dock_sendback', { truckId: t.id, note: 'add one' });
    const p = printLabels(ctx, 1, 'Jov2')[0];
    ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id }, false);
    ctx.data.db.stock['35']['11'].avail = 100;
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }), /Can't approve/);
    ctx.run('ship_confirm', { truckId: t.id, override: 'count behind' });
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.docLines['11'].qty, x.data.overrides[0].reason], ['at_dock', 240, 'count behind']);
});

test('scan-built Approve in off / qty: plan only, the truck parks at the dock in the portal, no TO', () => {
    ['off', 'qty'].forEach(m => {
        const ctx = scanSetup();
        const t = shipScan(ctx, 1, m);
        ctx.run('ship_confirm', { truckId: t.id });
        assert.equal(ctx.tx._t.ops.length, 0);
        assert.equal(ctx.data.getLoad(t.id).status, 'at_dock');
    });
});

test('scan-built: TO saved, IF failed → locked; Retry makes only the IF; Release needs the TO closed', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_create';             // the fake sees the resolved op, so match by op, not by key
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }), /A manager can press Retry/);
    let x = ctx.data.getLoad(t.id);
    assert.equal(x.status, 'departing');
    assert.ok(x.data.writes['to_create:' + t.id]);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: 'PLT1' }, false), /closed|waiting/);
    assert.throws(() => ctx.run('ship_sendback', { truckId: t.id, note: 'x' }), /already being processed|not waiting/);
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /Close TO/);
    ctx.run('depart_retry', { truckId: t.id });
    assert.deepEqual(ctx.tx._t.ops.map(o => o.op), ['to_create', 'if_create']);
    assert.equal(ctx.data.getLoad(t.id).status, 'at_dock');
});

test('scan-built: Release after the manager closed the TO puts the truck back on the floor', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_create';
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }));
    const toId = ctx.data.getLoad(t.id).data.writes['to_create:' + t.id];
    ctx.tx._t.closed[toId] = true;
    ctx.run('depart_release', { truckId: t.id });
    const x = ctx.data.getLoad(t.id);
    assert.equal(x.status, 'ready');                     // released, re-verified (scan trucks always match)
    assert.equal(x.data.writes, null);
});

test('scan-built: Reject sends the truck back to the floor with the reason', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_sendback', { truckId: t.id, note: 'take 2 YSN201 off' });
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.sentBack.note], ['loading', 'take 2 YSN201 off']);
});

test('Approvals shows a scan truck as one plain card with lines and weight', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 2);
    const s = ctx.run('approvals').shipPending.find(q => String(q.truck.id) === String(t.id));
    assert.deepEqual([s.scan, s.lines, s.lbs], [true, [{ sku: 'YSN201', pcs: 240 }], 2490]);
});

test('scan-built: after Release a second Approve makes a fresh TO with its own tag and parks at the dock', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_create';
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }));
    const toId = ctx.data.getLoad(t.id).data.writes['to_create:' + t.id];
    ctx.tx._t.closed[toId] = true;
    ctx.run('depart_release', { truckId: t.id });
    ctx.run('ship_mark', { truckId: t.id, seal: 'S' + t.id }, false);
    ctx.run('ship_confirm', { truckId: t.id });
    const x = ctx.data.getLoad(t.id), tos = ctx.tx._t.ops.filter(o => o.op === 'to_create');
    assert.equal(tos.length, 2);
    assert.equal(tos[1].token, '[MV-' + t.id + '-R1]');
    assert.equal(x.status, 'at_dock');
    assert.notEqual(x.data.toId, toId);
    assert.equal(x.data.toId, x.to);
});

test('scan-built: Release is refused while an unrecorded TO with the current tag is still open', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'to_create';
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }));
    ctx.tx._t.tags['[MV-' + t.id + ']'] = '777';
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /Close TO777/);
});

test('scan-built: Release is refused once the IF exists, and the retries row says canRelease false', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    const cur = ctx.data.getLoad(t.id);
    ctx.data.updateLoad(cur, { status: 'departing', data: { error: 'pallet step failed', depart: { day: '2026-10-15' }, workingAt: 0,
        writes: { ['to_create:' + t.id]: '501', ['if_create:new:to:' + t.id]: '502' } } });
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /already in NetSuite/);
    const r = ctx.run('approvals').retries.find(q => String(q.id) === String(t.id));
    assert.deepEqual([r.canRelease, r.toId, r.toNum], [false, '501', 'TO501']);
});

test('scan-built: a late pallet accepted after shipping gets a one-pallet TO + Shipped IF and a late receipt', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_confirm', { truckId: t.id });
    pickUp(ctx, { truckId: t.id, seal: 'S' + t.id });
    const late = printLabels(ctx, 1, 'Jlate')[0];
    ctx.run('unload_scan', { truckId: t.id, raw: late.code }, false);           // never loaded → flagged
    const n0 = ctx.tx._t.ops.length;
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: late.id });
    assert.equal(r.outcome, 'accepted');
    const [to, f] = ctx.tx._t.ops.slice(n0);
    const ref = t.id + '-P' + late.id;
    assert.deepEqual([to.op, to.ref, to.lines, f.op, f.ship, f.seal], ['to_create', ref, { '11': 120 }, 'if_create', true, 'S' + t.id]);
    const x = ctx.data.getLoad(t.id);
    assert.ok(x.data.writes['to_create:' + ref] && x.data.writes['if_create:new:to:' + ref]);
    assert.equal(x.data.alloc.length, 2);
    assert.equal(ctx.data.getPallet(late.id).status, 'received');
    t.ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const irs = ctx.tx._t.ops.filter(o => o.op === 'receipt');
    assert.ok(irs.some(o => o.ifId === x.data.alloc[1].ifId && o.toId === x.data.alloc[1].toId && o.lines['11'] === 120));
});

test('scan-built: a late pallet is refused when Riverside cannot cover it, and nothing is written', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_confirm', { truckId: t.id });
    pickUp(ctx, { truckId: t.id, seal: 'S' + t.id });
    const late = printLabels(ctx, 1, 'Jlate2')[0];
    ctx.run('unload_scan', { truckId: t.id, raw: late.code }, false);
    ctx.data.db.stock['35']['11'].avail = 10;
    const n0 = ctx.tx._t.ops.length;
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: late.id });
    assert.equal(r.outcome, 'refused');
    assert.match(r.text, /YSN201 on truck 120, available 10/);
    assert.equal(ctx.tx._t.ops.length, n0);
});

test('Dashboard lists a loading scan truck as one row with its SKUs', () => {
    const ctx = scanSetup();
    const t = scanTruck(ctx, 2);
    const row = ctx.run('dashboard').rows.find(r => String(r.truckId) === String(t.id));
    assert.deepEqual([row.ifNum, row.toNum, row.skus, row.pallets, row.pcs], ['—', '—', [{ sku: 'YSN201', qty: 240 }], 2, 240]);
});

test('scan-built: a late-pallet Accept retried after a failed IF is not blocked by the stock the TO already took', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_confirm', { truckId: t.id });
    pickUp(ctx, { truckId: t.id, seal: 'S' + t.id });
    const late = printLabels(ctx, 1, 'Jlate3')[0];
    ctx.run('unload_scan', { truckId: t.id, raw: late.code }, false);
    const ref = t.id + '-P' + late.id, n0 = ctx.tx._t.ops.length;
    ctx.tx._t.failOn = op => op.op === 'if_create';
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: late.id }), /Accept refused/);
    ctx.tx._t.failOn = null;
    ctx.data.db.stock['35']['11'].avail = 10;                    // the TO already consumed the stock
    const r = ctx.run('pallet_accept', { truckId: t.id, palletId: late.id });
    assert.equal(r.outcome, 'accepted');
    const ops = ctx.tx._t.ops.slice(n0).filter(o => o.ref === ref || o.op === 'if_create');
    assert.equal(ops.filter(o => o.op === 'to_create').length, 1);
    assert.equal(ops.filter(o => o.op === 'if_create').length, 1);
    assert.equal(ctx.data.getPallet(late.id).status, 'received');
});

test('labels_preview checks rows against NetSuite stock and is managers only', () => {
    const ctx = setup();
    printLabels(ctx, 2);                                   // printed only: never counted; avail 1000
    let r = ctx.run('labels_preview', { rows: [{ sku: 'YSN201', pcs: 120, pallets: 7, odd: 0 }] });
    assert.deepEqual([r.rows[0].status, r.rows[0].total, r.labels], ['ok', 840, 7]);
    r = ctx.run('labels_preview', { rows: [{ sku: 'YSN201', pcs: 120, pallets: 9, odd: 0 }] });
    assert.deepEqual([r.rows[0].status, r.rows[0].msg], ['warn', 'YSN201: 1,080 pcs to print, Riverside has 1,000 not yet on a truck']);
    assert.throws(() => ctx.run('labels_preview', { rows: [] }, false), /Managers only/);
    assert.throws(() => ctx.run('labels_preview', { rows: new Array(501).fill({ sku: 'YSN201', pcs: 1, pallets: 1 }) }), /500 rows/);
});

test('labels_preview drops null sheet entries and keeps sheet row numbers', () => {
    const ctx = setup();
    const r = ctx.run('labels_preview', { rows: [null, { sku: 'YSN201', pcs: 120, pallets: 1, odd: 0 }] });
    assert.deepEqual(r.rows.map(x => [x.n, x.status]), [[3, 'ok']]);
});

// ── final fix wave (2026-10-15) ──────────────────────────────────────────
test('final1: scan Approve says what was written: TO + IF numbers in on, plan-only keys in off', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    const r = ctx.run('ship_confirm', { truckId: t.id });
    const d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([r.atDock, r.toNum, r.ifNum, r.planOnly], [true, 'TO' + d.toId, 'IF' + d.ifId, []]);
    assert.deepEqual(r.written, ['to_create:' + t.id, 'if_create:new:to:' + t.id]);
    assert.deepEqual([r.view.truck.toNum, r.view.truck.ifNum], ['TO' + d.toId, 'IF' + d.ifId]);
    const off = scanSetup();
    const t2 = shipScan(off, 1, 'off');
    const r2 = off.run('ship_confirm', { truckId: t2.id });
    assert.ok(r2.planOnly.length > 0);
    assert.deepEqual([r2.written, r2.toNum, r2.ifNum], [[], undefined, undefined]);
});

test('final2: a loaded scan truck reserves no office TO room (office IFs on)', () => {
    const ctx = scanSetup();
    scanTruck(ctx, 10);                                     // 1,200 YSN201 loaded: all of TO700's room if it were reserved
    ctx.data.db.settings.officeIfs = true;
    const o = truckWith(ctx, 1, '9001');
    const extra = printLabels(ctx, 1, 'Jextra', [LINE201]);  // YSN201 is on none of this truck's IFs: an add-on from TO700
    assert.equal(ctx.run('truck_scan', { truckId: o.t.id, raw: extra[0].code }).result, 'addon');
});

test('final2: a TO a scan truck created is never offered as office room', () => {
    const ctx = scanSetup();
    const s = shipScan(ctx, 1);
    ctx.run('ship_confirm', { truckId: s.id });
    const toId = ctx.data.getLoad(s.id).data.toId;
    ctx.data.db.settings.officeIfs = true;
    const orig = ctx.ns.openToLines;
    ctx.ns.openToLines = () => orig().filter(r => r.item !== '11')
        .concat([{ toId: toId, toNum: 'TO' + toId, trandate: '2026-10-14', toStatus: 'B', item: '11', sku: 'YSN201', qty: 240, remaining: 240 }]);
    const o = truckWith(ctx, 1, '9001');
    const extra = printLabels(ctx, 1, 'Jextra2', [LINE201]);
    assert.equal(ctx.run('truck_scan', { truckId: o.t.id, raw: extra[0].code }).result, 'no_to');
});

test('final3: labels_preview counts loaded-but-unshipped pallets as used stock', () => {
    const ctx = scanSetup();
    ctx.data.db.stock['35']['11'].avail = 300;
    scanTruck(ctx, 2);                                       // 240 loaded, none labeled
    const r = ctx.run('labels_preview', { rows: [{ sku: 'YSN201', pcs: 120, pallets: 1, odd: 0 }] });
    assert.equal(r.rows[0].status, 'warn');
    assert.match(r.rows[0].msg, /Riverside has 60 not yet on a truck/);
    assert.deepEqual(ctx.data.labeledPiecesByItem(), {});    // the print plan still counts labeled only
});

test('final4: Release refuses when a Shipped IF with the tag is on the TO, recorded TO or found by tag', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_create';
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }));
    const toId = ctx.data.getLoad(t.id).data.writes['to_create:' + t.id];
    ctx.tx._t.closed[toId] = true;
    ctx.tx._t.ifTags['[MV-' + t.id + ']|' + toId] = '888';  // the IF saved but was never recorded
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /already in NetSuite \(IF found\)\. Press Retry/);
    assert.equal(ctx.data.getLoad(t.id).status, 'departing');
    const c2 = scanSetup();
    const t2 = shipScan(c2, 1);
    c2.tx._t.failOn = op => op.op === 'to_create';
    assert.throws(() => c2.run('ship_confirm', { truckId: t2.id }));
    c2.tx._t.tags['[MV-' + t2.id + ']'] = '777';
    c2.tx._t.closed['777'] = true;
    c2.tx._t.ifTags['[MV-' + t2.id + ']|777'] = '889';
    assert.throws(() => c2.run('depart_release', { truckId: t2.id }), /IF found/);
    delete c2.tx._t.ifTags['[MV-' + t2.id + ']|777'];
    c2.run('depart_release', { truckId: t2.id });            // closed TO, no IF: released
    assert.equal(c2.data.getLoad(t2.id).status, 'ready');
});

test('final5: Reject refuses a late pallet whose TO was created without its IF, until that TO is closed', () => {
    const ctx = scanSetup();
    const t = shipScan(ctx, 1);
    ctx.run('ship_confirm', { truckId: t.id });
    pickUp(ctx, { truckId: t.id, seal: 'S' + t.id });
    const late = printLabels(ctx, 1, 'Jlate5')[0];
    ctx.run('unload_scan', { truckId: t.id, raw: late.code }, false);
    ctx.tx._t.failOn = op => op.op === 'if_create';
    assert.throws(() => ctx.run('pallet_accept', { truckId: t.id, palletId: late.id }), /Accept refused/);
    const toId = ctx.data.getLoad(t.id).data.writes['to_create:' + t.id + '-P' + late.id];
    assert.ok(toId);
    assert.throws(() => ctx.run('pallet_reject', { truckId: t.id, palletId: late.id, note: 'wrong truck' }),
        new RegExp('TO' + toId + ' was created for this pallet\\. Accept again to finish it, or close TO' + toId + ' in NetSuite first'));
    const still = () => (ctx.data.getLoad(t.id).data.flagged || []).map(String).indexOf(String(late.id)) !== -1;
    assert.equal(still(), true);                               // still waiting for a decision
    assert.equal(ctx.data.getLoad(t.id).data.claim || '', '');
    ctx.tx._t.closed[toId] = true;
    assert.equal(ctx.run('pallet_reject', { truckId: t.id, palletId: late.id, note: 'wrong truck' }).outcome, 'rejected');
    assert.equal(still(), false);
});

test('final6: one scan truck that cannot be read does not break Approvals', () => {
    const ctx = scanSetup();
    const a = shipScan(ctx, 1);
    const ps = printLabels(ctx, 1, 'Jb', [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 60 }]);
    const b = ctx.run('truck_start', { trailer: tr() }, false).view.truck.id;
    ctx.run('truck_scan', { truckId: b, raw: ps[0].code }, false);
    ctx.run('truck_verify', { truckId: b }, false);
    ctx.run('ship_mark', { truckId: b, seal: 'SB' }, false);
    const orig = ctx.data.itemInfo;
    ctx.data.itemInfo = items => { if ((items || []).indexOf('11') !== -1) throw new Error('item read failed'); return orig(items); };
    const sp = ctx.run('approvals').shipPending;
    const ra = sp.find(q => String(q.truck.id) === String(a.id)), rb = sp.find(q => String(q.truck.id) === String(b));
    assert.deepEqual([ra.scan, ra.lines, ra.lbs], [true, [], null]);
    assert.match(ra.error, /item read failed/);
    assert.deepEqual([rb.lines, rb.error], [[{ sku: 'YSN301', pcs: 60 }], undefined]);
});

test('final7: a fresh local beta seeds officeIfs false', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'preview_server.js'), 'utf8');
    const at = src.indexOf('if (!data.db.settings.v3seeded)');
    assert.ok(at !== -1);
    assert.match(src.slice(at, src.indexOf('\n}', at)), /officeIfs: false/);
});

test('printed-only labels never count: the dashboard has no stale-label exception', () => {
    const ctx = setup();
    printLabels(ctx, 3);
    const exc = ctx.run('dashboard').exc;
    assert.equal('stale' in exc, false);
});

// ── drop trailer: editing at the dock (spec 2026-10-16 §4) ──────────────
function atDock(ctx, n) {
    const t = docsScan(ctx, n || 2);
    ctx.run('ship_confirm', { truckId: t.id });
    ctx.tx._t.ops = [];
    return t;
}

// ── drop trailer: seal at the dock + Picked up (spec 2026-10-16 §3) ──────
test('dashboard: a truck at the dock counts as loaded, not shipped, until it is picked up', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    let r = ctx.run('dashboard');
    assert.deepEqual([r.tiles.today, r.tiles.total, r.days[r.days.length - 1].n], [0, 0, 0]);
    pickUp(ctx, { truckId: t.id, seal: '5249331' });
    r = ctx.run('dashboard');
    assert.deepEqual([r.tiles.today, r.tiles.total, r.days[r.days.length - 1].n], [1, 1, 1]);
});

test('picked up: refused without a seal; with one, each IF is stamped Shipped and the truck leaves', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    assert.throws(() => pickUp(ctx, { truckId: t.id }), /Enter the seal/);
    const r = pickUp(ctx, { truckId: t.id, seal: '5249330' });
    const st = ctx.tx._t.ops.find(o => o.op === 'if_stamp'), d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([st.ifId, st.seal, st.trailer, st.lines], [d.ifId, '5249330', d.trailer, { '11': 240 }]);
    assert.deepEqual([ctx.data.getLoad(t.id).status, d.depart.seal, d.depart.pickedUpBy], ['departed', '5249330', 'Miguel']);
    assert.deepEqual(r.written, ['if_stamp:' + d.ifId]);
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'in_transit'));
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code }, false), /closed|left/i);
    t.ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const ir = ctx.tx._t.ops.find(o => o.op === 'receipt');
    assert.deepEqual([ir.ifId, ir.toId, ir.lines], [d.ifId, d.toId, { '11': 240 }]);
});

test('dock seal (2026-10-17): saved on the truck only, no NetSuite write; Picked up then needs no seal', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.run('dock_seal', { truckId: t.id, seal: '777' }, false);
    assert.deepEqual(ctx.tx._t.ops, []);
    assert.equal(ctx.data.getLoad(t.id).data.depart.seal, '777');
    pickUp(ctx, { truckId: t.id });
    assert.equal(ctx.data.getLoad(t.id).status, 'departed');
});

test('dock seal: a truck waiting for docs takes no seal (it goes in at the dock)', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 1);
    assert.throws(() => ctx.run('dock_seal', { truckId: t.id, seal: '888' }, false), /The seal goes in once the trailer is at the dock/);
    assert.equal(ctx.tx._t.ops.length, 0);
});

test('confirm shipped: a stamp failure keeps the truck waiting for the manager with an error; pressing again finishes', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_stamp';
    assert.throws(() => pickUp(ctx, { truckId: t.id, seal: '9' }), /NetSuite/);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, !!x.data.error, x.data.claim], ['pickup_pending', true, '']);
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'loaded'));
    pickUp(ctx, { truckId: t.id, seal: '9' });
    assert.equal(ctx.data.getLoad(t.id).status, 'departed');
    assert.equal(ctx.data.getLoad(t.id).data.error, '');
});

test('picked up: refused while docs are out of sync; a seal used by another truck is refused', () => {
    const ctx = scanSetup();
    const a = atDock(ctx, 1);
    const bp = printLabels(ctx, 1, 'Jpick2')[0];                 // a second truck needs its own labels (atDock reuses the default job)
    const b = { id: ctx.run('truck_start', { trailer: tr() }, false).view.truck.id };
    ctx.run('truck_scan', { truckId: b.id, raw: bp.code }, false);
    ctx.run('truck_verify', { truckId: b.id }, false);
    ctx.run('ship_mark', { truckId: b.id }, false);
    ctx.run('ship_confirm', { truckId: b.id });
    assert.equal(ctx.data.getLoad(b.id).status, 'at_dock');
    pickUp(ctx, { truckId: a.id, seal: '55' });
    assert.throws(() => pickUp(ctx, { truckId: b.id, seal: '55' }), /already on/);
    ctx.data.updateLoad(ctx.data.getLoad(b.id), { data: { docsSync: { error: 'x', pending: [] } } });
    assert.throws(() => pickUp(ctx, { truckId: b.id, seal: '56' }), /out of sync/);
});

test('picked up in off mode: the truck leaves and pallets go in transit with no NetSuite writes', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 2, 'off');
    ctx.run('ship_confirm', { truckId: t.id });
    ctx.tx._t.ops = [];
    const r = pickUp(ctx, { truckId: t.id, seal: 'OFF1' });
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.deepEqual([ctx.data.getLoad(t.id).status, r.written.length, r.planOnly.length], ['departed', 0, 1]);
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'in_transit'));
});

// A second at-dock truck in the same ctx needs its own print job (atDock reuses the default one).
function atDockJob(ctx, job) {
    const p = printLabels(ctx, 1, job)[0];
    const id = ctx.run('truck_start', { trailer: tr() }, false).view.truck.id;
    ctx.run('truck_scan', { truckId: id, raw: p.code }, false);
    ctx.run('truck_verify', { truckId: id }, false);
    ctx.run('ship_mark', { truckId: id }, false);
    ctx.run('ship_confirm', { truckId: id });
    ctx.tx._t.ops = [];
    return { id: id, ps: [p] };
}
// At-dock truck with a main IF (YSN201) and a Picked add-on IF (YSN301).
function atDockWithAddOn(ctx) {
    const t = atDock(ctx, 1);
    const p = printLabels(ctx, 1, 'JaddOn', [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 60 }])[0];
    ctx.tx._t.failOn = op => op.op === 'if_qty' && op.newLine ? (() => { throw new Error('NO_IF_LINE IF has no line'); })() : false;
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: p.code }).result, 'ok');   // at the dock: a manager edit
    ctx.tx._t.failOn = null;
    ctx.tx._t.ops = [];
    assert.equal(ctx.data.getLoad(t.id).data.alloc.length, 2);
    return { id: t.id, ps: t.ps.concat([p]) };
}

test('picked up fix: once a stamp landed the seal is pinned; a different seal is refused, the same one finishes', () => {
    const ctx = scanSetup();
    const t = atDockWithAddOn(ctx), d = ctx.data.getLoad(t.id).data;
    ctx.tx._t.failOn = op => op.op === 'if_stamp' && String(op.ifId) === String(d.alloc[1].ifId);
    assert.throws(() => pickUp(ctx, { truckId: t.id, seal: 'A1' }), /NetSuite/);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.depart.seal, Object.keys(x.data.writes).filter(k => /^if_stamp:/.test(k))], ['pickup_pending', 'A1', ['if_stamp:' + d.ifId]]);
    assert.throws(() => ctx.run('picked_up', { truckId: t.id, seal: 'B2' }, false), /waiting for a manager to confirm/);   // the seal is pinned on the waiting truck
    pickUp(ctx, { truckId: t.id, seal: ' a1 ' });
    assert.equal(ctx.data.getLoad(t.id).status, 'departed');
    const st = ctx.tx._t.ops.filter(o => o.op === 'if_stamp');
    assert.deepEqual(st.map(o => o.ifId).sort(), [d.alloc[0].ifId, d.alloc[1].ifId].map(String).sort());
    assert.ok(st.every(o => o.seal === 'A1'));
});

test('picked up fix: a retry with no seal uses the pinned one, and a half-done pickup protects the seal from other trucks', () => {
    const ctx = scanSetup();
    const t = atDockWithAddOn(ctx), d = ctx.data.getLoad(t.id).data;
    ctx.tx._t.failOn = op => op.op === 'if_stamp' && String(op.ifId) === String(d.alloc[1].ifId);
    assert.throws(() => pickUp(ctx, { truckId: t.id, seal: 'P9' }), /NetSuite/);
    const b = atDockJob(ctx, 'Jpin2');
    assert.throws(() => pickUp(ctx, { truckId: b.id, seal: 'P9' }), /already on/);
    pickUp(ctx, { truckId: t.id });
    assert.ok(ctx.tx._t.ops.filter(o => o.op === 'if_stamp').every(o => o.seal === 'P9'));
    assert.equal(ctx.data.getLoad(t.id).status, 'departed');
});

test('confirm shipped fix: while a confirm is half done, scans, seal and Send back are refused; Confirm shipped again finishes', () => {
    const ctx = scanSetup();
    const t = atDockWithAddOn(ctx), d = ctx.data.getLoad(t.id).data;
    ctx.tx._t.failOn = op => op.op === 'if_stamp' && String(op.ifId) === String(d.alloc[1].ifId);
    assert.throws(() => pickUp(ctx, { truckId: t.id, seal: 'H1' }), /NetSuite/);
    const n0 = ctx.tx._t.ops.length;
    const more = printLabels(ctx, 1, 'Jhalf')[0];
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: more.code }), /closed/);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code, mode: 'off' }), /closed/);
    assert.throws(() => ctx.run('dock_seal', { truckId: t.id, seal: 'H1' }, false), /waiting for a manager to confirm/);
    assert.throws(() => ctx.run('pickup_reject', { truckId: t.id, note: 'n' }), /A stamp already landed/);
    assert.throws(() => ctx.run('dock_sendback', { truckId: t.id, note: 'n' }), /A stamp already landed/);
    assert.equal(ctx.tx._t.ops.length, n0);
    assert.equal(ctx.data.getPallet(more.id).status, 'labeled');
    pickUp(ctx, { truckId: t.id });
    assert.equal(ctx.data.getLoad(t.id).status, 'departed');
});

test('picked up fix: an in-transit pallet alone also marks the pickup half done', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    ctx.data.updatePallet(ctx.data.getPallet(t.ps[0].id), { status: 'in_transit' });
    assert.throws(() => ctx.run('dock_seal', { truckId: t.id, seal: 'IT1' }, false), /Picked up is half done/);
    pickUp(ctx, { truckId: t.id, seal: 'IT1' });
    assert.equal(ctx.data.getLoad(t.id).status, 'departed');
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'in_transit'));
});

test('dock seal fix (2026-10-17): the floor seal never reaches NetSuite, so an IF NetSuite would refuse does not matter', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_seal';
    ctx.run('dock_seal', { truckId: t.id, seal: 'F1' }, false);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.data.claim, x.data.depart.seal, ctx.tx._t.ops.length], ['', 'F1', 0]);
});

test('dock seal fix: a seal another truck holds is refused', () => {
    const ctx = scanSetup();
    const a = atDock(ctx, 1), b = atDockJob(ctx, 'Jseal2');
    ctx.run('dock_seal', { truckId: a.id, seal: '4242' }, false);
    assert.throws(() => ctx.run('dock_seal', { truckId: b.id, seal: '4242' }, false), /Seal 4242 is already on/);
    assert.equal(ctx.data.getLoad(b.id).data.depart.seal, '');
});

test('dock seal fix: a truck waiting for docs that someone is processing is refused (seal goes in at Send for docs)', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 1);
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: 'other', workingAt: Date.now() } });
    assert.throws(() => ctx.run('dock_seal', { truckId: t.id, seal: 'W1' }, false), /The seal goes in once the trailer is at the dock/);   // no ship_pending seal
});

test('at dock: scanning a pallet on raises the TO line then the IF line', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2), d0 = ctx.data.getLoad(t.id).data;
    const p = printLabels(ctx, 1, 'Jdock1')[0];
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code });
    assert.equal(r.result, 'ok');
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['to_line', 240, 360], ['if_qty', 240, 360]]);
    const d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([ctx.data.getPallet(p.id).status, d.docLines['11'].qty, d.alloc[0].lines['11']], ['loaded', 360, 360]);
    assert.equal(d.ifId, d0.ifId);
});

test('at dock: taking a pallet off lowers the IF then the TO', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    const r = ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code, mode: 'off' });
    assert.equal(r.result, 'taken_off');
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['if_qty', 240, 120], ['to_line', 240, 120]]);
    assert.equal(ctx.data.getPallet(t.ps[0].id).status, 'labeled');
});

test('at dock: the last pallet cannot be taken off', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code, mode: 'off' }), /last pallet/i);
    assert.equal(ctx.tx._t.ops.length, 0);
});

test('at dock: a new SKU adds a TO line and an IF line; NO_IF_LINE falls back to a Packed add-on IF', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const p = printLabels(ctx, 1, 'Jdock2', [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 60 }])[0];
    ctx.tx._t.failOn = op => op.op === 'if_qty' && op.newLine ? (() => { throw new Error('NO_IF_LINE IF has no line'); })() : false;
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code });
    assert.equal(r.result, 'ok');
    const ops = ctx.tx._t.ops.map(o => o.op + (o.ship ? ':' + o.ship : ''));
    assert.deepEqual(ops, ['to_line', 'if_create:packed']);
    const d = ctx.data.getLoad(t.id).data;
    assert.equal(d.alloc.length, 2);
    assert.equal(d.alloc[1].addOn, true);
    assert.notEqual(d.docLines['12'].ifId, d.ifId);
});

test('at dock: a stock short refuses the scan and writes nothing', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.data.db.stock['35']['11'].avail = 50;
    const p = printLabels(ctx, 1, 'Jdock3')[0];
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code });
    assert.equal(r.result, 'short');
    assert.match(r.message, /Can't add: YSN201/);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getPallet(p.id).status, 'labeled');
});

test('at dock: IF failure undoes the TO change and refuses the scan', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_qty';
    const p = printLabels(ctx, 1, 'Jdock4')[0];
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code });
    assert.equal(r.result, 'refused');
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['to_line', 120, 240], ['to_line', 240, 120]]);
    assert.equal(ctx.data.getPallet(p.id).status, 'labeled');
    assert.equal(ctx.data.getLoad(t.id).data.docsSync, null);
});

test('at dock: a failed undo leaves Docs out of sync, pauses scans, and Retry finishes the edit', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const orig = ctx.tx.apply;
    let n = 0;
    ctx.tx.apply = op => { n++; if (n === 2 || n === 3) throw new Error('boom ' + n); return orig(op); };   // the IF write fails, then the undo fails too
    const p = printLabels(ctx, 2, 'Jdock5');
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p[0].code });
    assert.equal(r.result, 'out_of_sync');
    const d = ctx.data.getLoad(t.id).data;
    assert.ok(d.docsSync && d.docsSync.pending.length === 1);
    assert.equal(ctx.data.getPallet(p[0].id).status, 'loaded');   // the TO already holds it: the pallet counts on the truck
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: p[1].code }), /out of sync/i);
    assert.throws(() => ctx.run('dock_resync', { truckId: t.id }, false), /Managers only/);
    assert.deepEqual(ctx.run('approvals').outOfSync.map(o => [o.id, o.pending]), [[t.id, 1]]);
    assert.ok(ctx.run('truck_get', { truckId: t.id }, false).view.truck.docsSync);
    ctx.tx.apply = orig;
    ctx.run('dock_resync', { truckId: t.id });
    assert.equal(ctx.data.getLoad(t.id).data.docsSync, null);
    assert.equal(ctx.tx._t.ops[ctx.tx._t.ops.length - 1].op, 'if_qty');
});

test('at dock: other items are portal-only; off mode edits write nothing', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.run('truck_other_add', { truckId: t.id, desc: 'Pallet jack', qty: 1 }, false);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getLoad(t.id).data.otherItems.length, 1);
    assert.equal(ctx.data.getLoad(t.id).status, 'at_dock');
    const off = scanSetup();
    const u = docsScan(off, 1, 'off');
    off.run('ship_confirm', { truckId: u.id });
    const p = printLabels(off, 1, 'Jdock6')[0];
    assert.equal(off.run('truck_scan', { truckId: u.id, raw: p.code }).result, 'ok');   // a manager edit
    assert.equal(off.tx._t.ops.length, 0);
    assert.equal(off.data.getLoad(u.id).data.docLines['11'].qty, 240);
});

test('at dock: a pallet on an at-dock truck cannot be scanned onto another truck', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const other = ctx.run('truck_start', { trailer: tr() }, false).view.truck;
    const r = ctx.run('truck_scan', { truckId: other.id, raw: t.ps[0].code });
    assert.deepEqual([r.result, r.reason], ['locked', 'at_dock']);
});

// ── at dock: fix round 1 (add-on IF failure, add-on last pallet, resync fallback, remove/undo, claim) ──
function newSkuPallet(ctx, job) { return printLabels(ctx, 1, job, [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 60 }])[0]; }
function noIfLine(op) { return op.op === 'if_qty' && op.newLine; }

test('at dock fix: a failed add-on IF create undoes the TO raise and refuses the scan', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const orig = ctx.tx.apply;
    ctx.tx.apply = op => { if (noIfLine(op)) throw new Error('NO_IF_LINE IF has no line'); if (op.op === 'if_create') throw new Error('create boom'); return orig(op); };
    const p = newSkuPallet(ctx, 'Jfix1');
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code });
    assert.equal(r.result, 'refused');
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['to_line', 0, 60], ['to_line', 60, 0]]);
    const d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([ctx.data.getPallet(p.id).status, d.docsSync, d.claim, d.docLines['12']], ['labeled', null, '', undefined]);
});

test('at dock fix: a failed add-on IF create whose undo also fails leaves Docs out of sync', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const orig = ctx.tx.apply;
    ctx.tx.apply = op => {
        if (noIfLine(op)) throw new Error('NO_IF_LINE IF has no line');
        if (op.op === 'if_create') throw new Error('create boom');
        if (op.op === 'to_line' && op.to < op.from) throw new Error('undo boom');
        return orig(op);
    };
    const p = newSkuPallet(ctx, 'Jfix2');
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code });
    assert.equal(r.result, 'out_of_sync');
    const d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([d.claim, d.docsSync.pending.map(o => [o.op, !!o.newLine]), ctx.data.getPallet(p.id).status], ['', [['if_qty', true]], 'loaded']);
});

test('at dock fix: Retry turns a pending new line the IF refuses into a Packed add-on IF', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const orig = ctx.tx.apply;
    let n = 0;
    ctx.tx.apply = op => { n++; if (n === 2 || n === 3) throw new Error('boom ' + n); return orig(op); };
    const p = newSkuPallet(ctx, 'Jfix3');
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: p.code }).result, 'out_of_sync');
    ctx.tx.apply = op => { if (noIfLine(op)) throw new Error('NO_IF_LINE IF has no line'); return orig(op); };
    ctx.run('dock_resync', { truckId: t.id });
    const d = ctx.data.getLoad(t.id).data, last = ctx.tx._t.ops[ctx.tx._t.ops.length - 1];
    assert.deepEqual([last.op, last.ship, d.docsSync, d.addOnSeq], ['if_create', 'packed', null, 1]);
    assert.match(last.token, /-A12-1\]$/);
    assert.notEqual(d.docLines['12'].ifId, d.ifId);
    assert.deepEqual(d.alloc.map(a => a.addOn), [false, true]);
});

test('at dock fix: the last pallet of a SKU on its own add-on IF cannot be taken off; add-on tokens are numbered', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.tx._t.failOn = op => noIfLine(op) ? (() => { throw new Error('NO_IF_LINE IF has no line'); })() : false;
    const p = newSkuPallet(ctx, 'Jfix4');
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: p.code }).result, 'ok');
    const created = ctx.tx._t.ops.find(o => o.op === 'if_create');
    assert.match(created.token, /-A12-1\]$/);
    const ifNum = ctx.data.getLoad(t.id).data.docLines['12'].ifNum;
    ctx.tx._t.ops = [];
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code, mode: 'off' });
    assert.equal(r.result, 'refused');
    assert.equal(r.message, 'YSN301 is on its own add-on IF ' + ifNum + ': ask the office to remove it.');
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.deepEqual([ctx.data.getPallet(p.id).status, ctx.data.getLoad(t.id).data.claim], ['loaded', '']);
});

test('at dock fix: truck_remove routes as a take-off; truck_undo is refused', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    const r = ctx.run('truck_remove', { truckId: t.id, palletId: t.ps[0].id });
    assert.equal(r.result, 'taken_off');
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['if_qty', 240, 120], ['to_line', 240, 120]]);
    assert.equal(ctx.data.getPallet(t.ps[0].id).status, 'labeled');
    assert.throws(() => ctx.run('truck_undo', { truckId: t.id }), /At the dock, take a pallet off by scanning it in Take off mode/);
});

test('at dock fix: the claim is cleared after refused, short and out_of_sync', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.tx._t.failOn = op => op.op === 'if_qty';
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: printLabels(ctx, 1, 'Jfix5')[0].code }).result, 'refused');
    assert.equal(ctx.data.getLoad(t.id).data.claim, '');
    ctx.data.db.stock['35']['11'].avail = 50;
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: printLabels(ctx, 1, 'Jfix6')[0].code }).result, 'short');
    assert.equal(ctx.data.getLoad(t.id).data.claim, '');
    ctx.data.db.stock['35']['11'].avail = 1000;
    const orig = ctx.tx.apply;
    let n = 0;
    ctx.tx.apply = op => { n++; if (n === 2 || n === 3) throw new Error('boom ' + n); return orig(op); };
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: printLabels(ctx, 1, 'Jfix7')[0].code }).result, 'out_of_sync');
    assert.equal(ctx.data.getLoad(t.id).data.claim, '');
});

// ── final review fix wave (2026-10-16) ──────────────────────────────────
// I2(a): a truck with no NetSuite docs (approved in off/qty) stays portal-only at the dock even after writeMode flips to on.
test('final I2a: a no-docs truck stays portal-only after writeMode flips to on: dock scan and Picked up write nothing', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 2, 'off');
    ctx.run('ship_confirm', { truckId: t.id });
    ctx.data.db.settings.writeMode = 'on';
    ctx.tx._t.ops = [];
    const p = printLabels(ctx, 1, 'JnoDocs1')[0];
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code });
    assert.equal(r.result, 'ok');
    assert.equal(ctx.data.getLoad(t.id).data.docLines['11'].qty, 360);
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code, mode: 'off' }).result, 'taken_off');
    ctx.run('dock_seal', { truckId: t.id, seal: 'ND1' }, false);
    assert.equal(ctx.data.getLoad(t.id).data.depart.seal, 'ND1');
    const u = pickUp(ctx, { truckId: t.id });
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.deepEqual([ctx.data.getLoad(t.id).status, u.written.length], ['departed', 0]);
    assert.ok([t.ps[1], p].every(q => ctx.data.getPallet(q.id).status === 'in_transit'));
});

test('final I2a: a new SKU on a truck with no primary IF stays portal-only (no "undefined" IF op)', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 1, 'qty');
    ctx.run('ship_confirm', { truckId: t.id });
    ctx.data.db.settings.writeMode = 'on';
    ctx.tx._t.ops = [];
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: newSkuPallet(ctx, 'JnoDocs2').code }).result, 'ok');
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.deepEqual(ctx.data.getLoad(t.id).data.docLines['12'], { qty: 60, ifId: '', ifNum: '' });
});

// I2(b): manager escape for a trailer stuck at the dock.
test('final I2b: picked_up_force is manager-only and needs a note (300 max)', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    assert.throws(() => ctx.run('picked_up_force', { truckId: t.id, note: 'x' }, false), /Managers only/);
    assert.throws(() => ctx.run('picked_up_force', { truckId: t.id, note: '  ' }), /note/i);
    assert.throws(() => ctx.run('picked_up_force', { truckId: t.id, note: 'x'.repeat(301) }), /300/);
    assert.equal(ctx.data.getLoad(t.id).status, 'at_dock');
    const r = printLabels(ctx, 1, 'JforceR')[0];
    const o = ctx.run('truck_start', { trailer: tr() }, false).view.truck.id;
    ctx.run('truck_scan', { truckId: o, raw: r.code });
    assert.throws(() => ctx.run('picked_up_force', { truckId: o, note: 'n' }), /not at the dock/);
});

test('final I2b: picked_up_force gets an out-of-sync truck out with no NetSuite writes and records who/when/note/seal', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { docsSync: { error: 'x', pending: [{ op: 'if_qty' }] }, error: 'old' } });
    assert.throws(() => pickUp(ctx, { truckId: t.id, seal: 'F7' }), /out of sync/);
    ctx.tx._t.ops = [];
    const r = ctx.run('picked_up_force', { truckId: t.id, note: ' IF edited by hand ', seal: 'F7' });
    assert.equal(ctx.tx._t.ops.length, 0);
    const x = ctx.data.getLoad(t.id), d = x.data;
    assert.deepEqual([x.status, d.claim, d.docsSync, d.error, d.depart.seal, d.depart.shippedDay], ['departed', '', null, '', 'F7', '2026-10-14']);
    assert.deepEqual([d.depart.forced.by, d.depart.forced.note, !!d.depart.forced.at], ['Miguel', 'IF edited by hand', true]);
    assert.equal(d.lastStep.kind, 'picked_up_forced');
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'in_transit'));
    assert.ok(r.view);
});

test('final I2b: picked_up_force gets a half-done pickup out; without a seal it keeps the pinned one', () => {
    const ctx = scanSetup();
    const t = atDockWithAddOn(ctx), d0 = ctx.data.getLoad(t.id).data;
    ctx.tx._t.failOn = op => op.op === 'if_stamp' && String(op.ifId) === String(d0.alloc[1].ifId);
    assert.throws(() => pickUp(ctx, { truckId: t.id, seal: 'HF1' }), /NetSuite/);
    ctx.tx._t.failOn = null;
    ctx.tx._t.ops = [];
    ctx.run('picked_up_force', { truckId: t.id, note: 'add-on IF stuck' });
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.depart.seal, ctx.tx._t.ops.length], ['departed', 'HF1', 0]);
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'in_transit'));
});

// I3: a partial undo puts back the forward ops it reverted, so a straight Retry restores the full forward state.
test('final I3: a mixed pallet whose 2nd-SKU IF write fails and whose undo fails part way: Retry raises both SKUs on the TO and IF', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const p = printLabels(ctx, 1, 'Jmix1', [LINE201, { item: '12', sku: 'YSN301', cfg: 'A', pcs: 60 }])[0];
    const orig = ctx.tx.apply;
    ctx.tx.apply = op => {
        if (op.op === 'if_qty' && op.item === '12' && op.to > op.from) throw new Error('IF boom');     // the 2nd SKU's IF write
        if (op.op === 'if_qty' && op.item === '11' && op.to < op.from) throw new Error('undo boom');   // a later inverse
        return orig(op);
    };
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: p.code }).result, 'out_of_sync');
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.item, o.from, o.to]),
        [['to_line', '11', 120, 240], ['if_qty', '11', 120, 240], ['to_line', '12', 0, 60], ['to_line', '12', 60, 0]]);   // the 1st inverse landed
    assert.deepEqual(ctx.data.getLoad(t.id).data.docsSync.pending.map(o => [o.op, o.item, o.from, o.to]),
        [['to_line', '12', 0, 60], ['if_qty', '12', 0, 60]]);
    ctx.tx.apply = orig;
    ctx.run('dock_resync', { truckId: t.id });
    const last = {};
    ctx.tx._t.ops.forEach(o => { last[o.op + ':' + o.item] = o.to; });
    assert.deepEqual(last, { 'to_line:11': 240, 'if_qty:11': 240, 'to_line:12': 60, 'if_qty:12': 60 });
    const d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([d.docsSync, d.docLines['11'].qty, d.docLines['12'].qty], [null, 240, 60]);
});

// Minor: shippedToday counts a truck by its pickup day (docs written the day before).
test('final minor: a truck whose docs were written yesterday and picked up today shows in shippedToday', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    pickUp(ctx, { truckId: t.id, seal: 'Y1' });
    const x = ctx.data.getLoad(t.id);
    assert.equal(x.data.depart.shippedDay, '2026-10-14');
    ctx.data.updateLoad(x, { data: { depart: Object.assign({}, x.data.depart, { day: '2026-10-13' }) } });
    assert.deepEqual(ctx.run('truck_planned', {}, false).shippedToday.map(s => String(s.id)), [String(t.id)]);
});

// Minor: each IF is stamped at Picked up with its own memo token.
test('final minor: Picked up stamps the main IF with the truck tag and the add-on IF with its own add-on tag', () => {
    const ctx = scanSetup();
    const t = atDockWithAddOn(ctx), d = ctx.data.getLoad(t.id).data;
    assert.match(d.alloc[1].token, /-A12-1\]$/);
    assert.equal(d.docLines['12'].token, d.alloc[1].token);
    pickUp(ctx, { truckId: t.id, seal: 'M1' });
    const st = ctx.tx._t.ops.filter(o => o.op === 'if_stamp'), by = id => st.find(o => String(o.ifId) === String(id));
    const ref = d.approveRef || t.id;
    assert.ok(by(d.alloc[0].ifId).memo.endsWith(' · ' + verify.scanTag(ref)));
    assert.ok(by(d.alloc[1].ifId).memo.endsWith(' · ' + d.alloc[1].token));
});

// Minor: a pallet changed by another request between the read and the claim is refused.
test('final minor: a pallet that changed between the read and the claim is refused, nothing written', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    const p = printLabels(ctx, 1, 'Jrace1')[0];
    const other = ctx.run('truck_start', { trailer: tr() }, false).view.truck.id;
    const orig = ctx.data.getPallet;
    let n = 0;
    ctx.data.getPallet = id => {
        if (String(id) === String(p.id) && ++n === 2) ctx.data.updatePallet(orig(id), { status: 'loaded', load: other });   // another truck took it
        return orig(id);
    };
    const r = ctx.run('truck_scan', { truckId: t.id, raw: p.code });
    ctx.data.getPallet = orig;
    assert.deepEqual([r.result, r.message], ['refused', 'That pallet changed: scan it again.']);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.deepEqual([ctx.data.getLoad(t.id).data.claim, ctx.data.getLoad(t.id).data.docLines['11'].qty], ['', 120]);
});

test('final minor: a take-off of a pallet no longer on this truck is refused after the claim', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    const orig = ctx.data.getPallet, id0 = t.ps[0].id;
    let n = 0;
    ctx.data.getPallet = id => {
        if (String(id) === String(id0) && ++n === 2) ctx.data.updatePallet(orig(id), { status: 'labeled', load: '' });
        return orig(id);
    };
    const r = ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code, mode: 'off' });
    ctx.data.getPallet = orig;
    assert.deepEqual([r.result, r.message], ['refused', 'That pallet changed: scan it again.']);
    assert.equal(ctx.tx._t.ops.length, 0);
});

// Minor: dock_seal only at the dock (no seal before docs, 2026-10-17).
test('final minor: dock_seal refuses a truck that is not at the dock', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 1);
    assert.throws(() => ctx.run('dock_seal', { truckId: t.id, seal: '888' }, false), /The seal goes in once the trailer is at the dock/);
    assert.equal(ctx.data.getLoad(t.id).data.shipReq.seal, '');
});

test('truck_get: a shipped scan truck lists its full load; an at-dock truck is unchanged', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    const dock = ctx.run('truck_get', { truckId: t.id }, false).view;
    assert.equal(dock.truck.status, 'at_dock');
    assert.deepEqual([dock.scan.rows.length, dock.scan.pallets, dock.scan.rows[0].pcs], [1, 2, 240]);
    pickUp(ctx, { truckId: t.id, seal: 'S' + t.id });
    const v = ctx.run('truck_get', { truckId: t.id }, false).view;
    assert.equal(v.truck.status, 'departed');
    assert.deepEqual([v.scan.rows.length, v.scan.rows[0].item, v.scan.rows[0].pcs, v.scan.rows[0].pallets, v.scan.pallets], [1, '11', 240, 2, 2]);
    assert.equal(v.pallets.length, 2);
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'in_transit'));
});

// ── drop trailer, manager-only writes (spec 2026-10-17) ──────────────────
test('2026-10-17: the floor cannot scan on, take off or undo at the dock; a manager can', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2), p = printLabels(ctx, 1, 'Jlock1')[0];
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false), /this load is locked/);
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code, mode: 'off' }, false), /this load is locked/);
    assert.throws(() => ctx.run('truck_remove', { truckId: t.id, palletId: t.ps[0].id }, false), /this load is locked/);
    assert.throws(() => ctx.run('truck_undo', { truckId: t.id }, false), /this load is locked/);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getPallet(p.id).status, 'labeled');
    assert.equal(ctx.run('truck_scan', { truckId: t.id, raw: p.code }).result, 'ok');
});

test('2026-10-17: floor Picked up writes nothing and waits for the manager; Confirm shipped stamps the Packed IF Shipped', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    const r = ctx.run('picked_up', { truckId: t.id, seal: 'Q1' }, false);
    assert.equal(r.pending, true);
    let x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.pickupReq.seal, x.data.pickupReq.by, ctx.tx._t.ops.length], ['pickup_pending', 'Q1', 'Miguel', 0]);
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'loaded'));
    assert.throws(() => ctx.run('pickup_confirm', { truckId: t.id }, false), /Managers only|manager/i);
    const ap = ctx.run('approvals');
    assert.deepEqual(ap.pickups.map(q => [String(q.truck.id), q.seal, q.pallets]), [[String(t.id), 'Q1', 2]]);
    assert.equal(ctx.run('dashboard').rows.find(q => String(q.truckId) === String(t.id)).stage, 'Waiting for ship confirm');
    const dw = ctx.run('dashboard').waiting.find(w => w.queue === 'pick');
    assert.deepEqual([dw.count, dw.first.indexOf('picked up') > 0], [1, true]);
    assert.deepEqual(ctx.run('approvals_ping').items.map(i => i.key.split(':').slice(0, 2).join(':')), ['pick:' + t.id]);
    ctx.run('pickup_confirm', { truckId: t.id });
    assert.equal(ctx.run('approvals_ping').count, 0);
    x = ctx.data.getLoad(t.id);
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.seal]), [['if_stamp', 'Q1']]);
    assert.deepEqual([x.status, x.data.depart.pickedUpBy, x.data.pickupReq], ['departed', 'Miguel', null]);
    assert.ok(t.ps.every(p => ctx.data.getPallet(p.id).status === 'in_transit'));
});

test('2026-10-17: the manager sends a Picked up back to the dock with a note; the floor can press it again', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.run('picked_up', { truckId: t.id, seal: 'Q2' }, false);
    assert.throws(() => ctx.run('pickup_reject', { truckId: t.id, note: ' ' }), /Enter a note/);
    ctx.run('pickup_reject', { truckId: t.id, note: 'carrier not here yet' });
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.pickupReq, x.data.sentBack.note, ctx.tx._t.ops.length], ['at_dock', null, 'carrier not here yet', 0]);
    assert.equal(ctx.run('picked_up', { truckId: t.id }, false).pending, true);   // the saved seal is reused
});

test('2026-10-17: picked_up_force also gets a truck waiting for the ship confirm out', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.run('picked_up', { truckId: t.id, seal: 'Q3' }, false);
    ctx.run('picked_up_force', { truckId: t.id, note: 'office shipped it by hand' });
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.depart.seal, x.data.pickupReq, ctx.tx._t.ops.length], ['departed', 'Q3', null, 0]);
});

test('2026-10-17: Send back from the dock re-opens the load; Approve again lowers the same IF then the TO, no new TO', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2), d0 = ctx.data.getLoad(t.id).data;
    assert.throws(() => ctx.run('dock_sendback', { truckId: t.id }), /Enter a note/);
    ctx.run('dock_sendback', { truckId: t.id, note: 'one pallet stays' });
    let x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.depart, x.data.docsDepart.truckNo, x.data.toId, x.data.sentBack.note], ['loading', null, d0.depart.truckNo, d0.toId, 'one pallet stays']);
    ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code, mode: 'off' }, false);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id }, false);
    assert.equal(ctx.run('approvals').shipPending[0].redo.ifNum, d0.ifNum);
    const r = ctx.run('ship_confirm', { truckId: t.id });
    assert.deepEqual([r.atDock, r.rewritten], [true, true]);
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['if_qty', 240, 120], ['to_line', 240, 120]]);
    x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.toId, x.data.ifId, x.data.docLines['11'].qty, x.data.alloc[0].lines['11'], x.data.depart.truckNo, x.data.docsDepart],
        ['at_dock', d0.toId, d0.ifId, 120, 120, d0.depart.truckNo, null]);
    assert.equal(ctx.data.getPallet(t.ps[0].id).status, 'labeled');
});

test('2026-10-17: Approve again after a Send back raises the TO then the IF; a stock short on the increase refuses and writes nothing', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.run('dock_sendback', { truckId: t.id, note: 'add one' });
    const p = printLabels(ctx, 1, 'Jre2')[0];
    ctx.run('truck_scan', { truckId: t.id, raw: p.code }, false);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id }, false);
    ctx.data.db.stock['35']['11'].avail = 100;
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }), /Can't approve: YSN201 on truck 120, available 100/);
    assert.deepEqual([ctx.tx._t.ops.length, ctx.data.getLoad(t.id).status], [0, 'ship_pending']);
    ctx.data.db.stock['35']['11'].avail = 1000;
    ctx.run('ship_confirm', { truckId: t.id });
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.from, o.to]), [['to_line', 120, 240], ['if_qty', 120, 240]]);
    assert.equal(ctx.data.getLoad(t.id).data.docLines['11'].qty, 240);
});

test('2026-10-17: Approve again with an unchanged load writes nothing; a NetSuite refusal leaves the truck waiting', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    ctx.run('dock_sendback', { truckId: t.id, note: 'check it' });
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id }, false);
    ctx.run('ship_confirm', { truckId: t.id });
    assert.deepEqual([ctx.tx._t.ops.length, ctx.data.getLoad(t.id).status], [0, 'at_dock']);
    ctx.run('dock_sendback', { truckId: t.id, note: 'take one off' });
    ctx.run('truck_scan', { truckId: t.id, raw: t.ps[1].code, mode: 'off' }, false);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id }, false);
    ctx.tx._t.failOn = op => op.op === 'if_qty';
    assert.throws(() => ctx.run('ship_confirm', { truckId: t.id }), /NetSuite refused the change.*NetSuite is unchanged/);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.claim, x.data.docLines['11'].qty], ['ship_pending', '', 240]);
});

test('2026-10-17: Send back from the dock is refused once a stamp landed or while docs are out of sync', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { docsSync: { error: 'x', pending: [] } } });
    assert.throws(() => ctx.run('dock_sendback', { truckId: t.id, note: 'n' }), /out of sync/);
    assert.throws(() => ctx.run('dock_sendback', { truckId: t.id, note: 'n' }, false), /Managers only|manager/i);
});
// ── weights (next version, Task 2) ──
function weightSetup() {
    const ctx = scanSetup();
    delete ctx.data.db.items.find(i => i.item === '11').weight;
    delete ctx.data.db.items.find(i => i.item === '11').wunit;
    delete ctx.data.db.settings.palletTare;   // fall back to the default tare, 35
    return ctx;
}

test('weights: preview counts added/changed/removed and save replaces the table', () => {
    const ctx = weightSetup();
    const sv = ctx.run('weights_save', { rows: [['YSN201', 18, 'CYL'], ['YSN301', 25, '']] });
    assert.equal(sv.count, 2);
    const l = ctx.run('weights_list', {});
    assert.deepEqual(l.rows, [{ sku: 'YSN201', lb: 18, type: 'CYL' }, { sku: 'YSN301', lb: 25, type: 'PCS' }]);
    assert.equal(l.by, 'Miguel');
    const pv = ctx.run('weights_preview', { rows: [['ysn201', '19', 'CYL'], ['YSN100', 70, 'CYL'], ['', '', '']] });
    assert.deepEqual([pv.count, pv.added, pv.changed, pv.removed, pv.errors.length], [2, 1, 1, 1, 0]);
    ctx.run('weights_save', { rows: [['YSN100', 70, 'CYL']] });
    assert.deepEqual(ctx.run('weights_list', {}).rows.map(r => r.sku), ['YSN100']);
});

test('weights: managers only, and an all-bad file saves nothing', () => {
    const ctx = weightSetup();
    ['weights_preview', 'weights_save', 'weights_list'].forEach(n => assert.throws(() => ctx.run(n, { rows: [] }, false), /Managers only/));
    ctx.run('weights_save', { rows: [['YSN201', 18, 'CYL']] });
    assert.throws(() => ctx.run('weights_save', { rows: [['NOPE', 1, '']] }), /Nothing to save/);
    assert.deepEqual(ctx.run('weights_list', {}).rows, [{ sku: 'YSN201', lb: 18, type: 'CYL' }]);
    assert.throws(() => ctx.run('weights_preview', { rows: new Array(2001).fill(['YSN201', 1, '']) }), /2,000 max/);
});

test('weights: Verify uses the uploaded weight, tare 35, and warns over 45,000 lb', () => {
    const ctx = weightSetup();
    ctx.run('weights_save', { rows: [['YSN201', 18, 'CYL']] });
    const t = scanTruck(ctx, 2);
    let s = ctx.run('truck_get', { truckId: t.id }, false).view.scan;
    assert.deepEqual([s.total, s.over, s.atLeast, s.max], [4390, false, false, 45000]);
    ctx.data.db.settings.maxTruckLb = 4000;
    assert.equal(ctx.run('truck_get', { truckId: t.id }, false).view.scan.over, true);
    ctx.data.db.settings.unitWeights = {};
    s = ctx.run('truck_get', { truckId: t.id }, false).view.scan;
    assert.deepEqual([s.atLeast, s.total], [true, 70]);
});

test('weights: item_lookup shows the portal weight and type', () => {
    const ctx = weightSetup();
    ctx.run('weights_save', { rows: [['YSN201', 18, 'CYL']] });
    const it = ctx.run('item_lookup', { q: 'YSN201' }, false).items[0];
    assert.deepEqual([it.lb, it.type], [18, 'CYL']);
    const o = ctx.run('item_lookup', { q: 'YSN301' }, false).items[0];
    assert.deepEqual([o.lb, o.type], [null, '']);
});

test('approvals: a scan truck over the weight limit carries weight.over on its ship card', () => {
    const ctx = scanSetup();
    ctx.data.db.settings.maxTruckLb = 100;
    docsScan(ctx, 2);
    const w = ctx.run('approvals').shipPending[0].weight;
    assert.equal(w.over, true);
    assert.equal(w.max, 100);
});

// ── BOL on the server + ArcBest default carrier (Task 6) ──────
test('bol: data for an at-dock truck', () => {
    const ctx = scanSetup();
    delete ctx.data.db.settings.palletTare;
    ctx.run('weights_save', { rows: [['YSN201', 18, 'CYL']] });
    const t = atDock(ctx, 2), d = ctx.data.getLoad(t.id).data;
    const b = ctx.run('bol_data', { truckId: t.id }).bol;
    assert.deepEqual([b.bolNo, b.planOnly, b.rev, b.carrier, b.seal], [d.toNum, false, 1, 'ArcBest', '']);
    assert.deepEqual(b.ifNums, [d.ifNum]);
    const l = b.plan.lines[0];
    assert.deepEqual([l.sku, l.units, l.pcs, l.type, l.hm, l.lbs], ['YSN201', 2, 240, 'CYL', true, 240 * 18 + 70]);
});
test('bol: Ship To is the Tippecanoe address; a stray trailing comma in the street is dropped', () => {
    const ctx = scanSetup();
    ctx.data.db.locations = { '46': { name: 'CA - Tippecanoe', addr: '752 N Tippecanoe Ave, ', city: 'San Bernardino', state: 'CA', zip: '92410' } };
    ctx.data.db.settings.locTo = '46';
    const t = atDock(ctx, 1);
    const b = ctx.run('bol_data', { truckId: t.id }).bol;
    assert.deepEqual(b.to, { name: 'YSN IMPORTS', addr: '752 N Tippecanoe Ave', csz: 'San Bernardino, CA 92410' });
});
test('bol: refused before Approve docs and for the floor', () => {
    const ctx = scanSetup();
    const t = scanTruck(ctx, 1);
    assert.throws(() => ctx.run('bol_data', { truckId: t.id }), /after Approve docs/);
    const c2 = scanSetup(), t2 = atDock(c2, 1);
    assert.throws(() => c2.run('bol_data', { truckId: t2.id }, false), /Managers only/);
});
test('bol: plan only when writes are off', () => {
    const ctx = scanSetup();
    const t = scanTruck(ctx, 1);
    ctx.data.db.settings.writeMode = 'off';
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id }, false);
    ctx.run('ship_confirm', { truckId: t.id });
    const b = ctx.run('bol_data', { truckId: t.id }).bol;
    assert.deepEqual([b.planOnly, b.bolNo], [true, '—']);
});
test('bol: a re-approve that changes quantities bumps the REV', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2);
    ctx.run('dock_sendback', { truckId: t.id, note: 'one stays' });
    ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code, mode: 'off' }, false);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id }, false);
    const r = ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(r.bolRev, 2);
    assert.equal(r.bolChanged, true);
    assert.equal(ctx.run('bol_data', { truckId: t.id }).bol.rev, 2);
    ctx.run('dock_sendback', { truckId: t.id, note: 'check' });
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id }, false);
    const r2 = ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(r2.bolChanged, false);
    assert.equal(ctx.run('bol_data', { truckId: t.id }).bol.rev, 2);
});
test('bol: the seal shows once saved', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.run('dock_seal', { truckId: t.id, seal: '1846' }, false);
    assert.equal(ctx.run('bol_data', { truckId: t.id }).bol.seal, '1846');
});
test('bol: the PDF route is managers only and renders the BOL xml', () => {
    let seen = null, wrote = null;
    const opts = { render: { xmlToPdf: o => { seen = o.xmlString; return 'PDF'; } }, tpl: { bolXml: b => 'XML ' + b.bolNo } };
    const call = (ctx, id) => { const o = {}; ctx.sl.onRequest({ request: { parameters: { action: 'bol', truckId: id } }, response: { write: x => { o.text = x; }, writeFile: f => { o.file = f; } } }); return o; };
    const ctx = setup(opts);
    ctx.data.db.settings.officeIfs = false;
    const t = atDock(ctx, 1), d = ctx.data.getLoad(t.id).data;
    const o = call(ctx, t.id);
    assert.deepEqual([seen, o.file.file, o.file.isInline], ['XML ' + d.toNum, 'PDF', true]);
    assert.match(call(ctx, 'nope').text || '', /./);
    const fl = setup(Object.assign({ deploymentId: 'customdeploy_move_portal_floor' }, opts));
    assert.equal(call(fl, '1').text, 'Managers only');
});
test('carrier: the default is ArcBest', () => {
    const ctx = scanSetup();
    assert.equal(ctx.run('truck_planned', {}, false).carrier, 'ArcBest');
});

// ── delete a truck (manager; pallets back, record kept, NetSuite cleanup guard) ──
test('delete: a loading truck: pallets back to labeled, hidden from lists, kept in history', () => {
    const ctx = scanSetup();
    const t = scanTruck(ctx, 2), trailer = ctx.data.getLoad(t.id).data.trailer;
    const r = ctx.run('truck_delete', { truckId: t.id, reason: '  wrong trailer  ' });
    assert.deepEqual([r.deleted, r.pallets], [true, 2]);
    t.ps.forEach(p => { const q = ctx.data.getPallet(p.id); assert.deepEqual([q.status, q.loadId], ['labeled', '']); });
    assert.equal(ctx.run('truck_planned', {}, false).open.some(x => String(x.id) === String(t.id)), false);
    assert.doesNotThrow(() => ctx.run('truck_start', { trailer: trailer }, false));            // the trailer is free again
    assert.equal(ctx.run('dashboard').rows.some(x => x.truckId === t.id), false);
    const h = ctx.run('report').history.find(x => x.truckId === t.id);
    assert.deepEqual([h.stage, h.status, h.deleted.reason, h.deleted.by], ['Deleted', 'deleted', 'wrong trailer', ctx.data.getLoad(t.id).data.deleted.by]);
    assert.equal(ctx.run('truck_get', { truckId: t.id }, false).view.deleted.reason, 'wrong trailer');
});

test('delete: reason required and managers only', () => {
    const ctx = scanSetup();
    const t = scanTruck(ctx, 1);
    assert.throws(() => ctx.run('truck_delete', { truckId: t.id, reason: '  ' }), /Enter a reason/);
    assert.throws(() => ctx.run('truck_delete', { truckId: t.id, reason: 'x'.repeat(301) }), /Enter a reason/);
    assert.throws(() => ctx.run('truck_delete', { truckId: t.id, reason: 'x' }, false), /Managers only/);
    assert.equal(ctx.data.getLoad(t.id).status, 'loading');
});

test('delete: refused while docs are writing and after shipping', () => {
    const ctx = scanSetup();
    const a = scanTruck(ctx, 1);
    ctx.data.updateLoad(ctx.data.getLoad(a.id), { status: 'departing', data: { depart: { seal: 'Z' }, error: 'x' } });
    assert.throws(() => ctx.run('truck_delete', { truckId: a.id, reason: 'r' }), /Release it first/);
    const ctx2 = scanSetup();
    const b = atDock(ctx2, 1);
    pickUp(ctx2, { truckId: b.id, seal: '5249331' });
    assert.equal(ctx2.data.getLoad(b.id).status, 'departed');
    assert.throws(() => ctx2.run('truck_delete', { truckId: b.id, reason: 'r' }), /Already shipped/);
});

test('delete: a half-done pickup and a live claim are refused', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 1);
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { writes: Object.assign({}, ctx.data.getLoad(t.id).data.writes, { ['if_stamp:' + ctx.data.getLoad(t.id).data.ifId]: '1' }) } });
    assert.throws(() => ctx.run('truck_delete', { truckId: t.id, reason: 'r' }), /Pickup is half done/);
    const ctx2 = scanSetup();
    const u = scanTruck(ctx2, 1);
    ctx2.data.updateLoad(ctx2.data.getLoad(u.id), { data: { claim: 'live', workingAt: Date.now() } });
    assert.throws(() => ctx2.run('truck_delete', { truckId: u.id, reason: 'r' }), /already being processed/);
});

test('delete: at the dock it waits for the office to delete the IF and close the TO', () => {
    const ctx = scanSetup();
    const t = atDock(ctx, 2), d = ctx.data.getLoad(t.id).data;
    assert.throws(() => ctx.run('truck_delete', { truckId: t.id, reason: 'r' }), /Delete IF.* and close TO.* in NetSuite first/);
    ctx.tx._t.deletedIfs[String(d.ifId)] = true;
    assert.throws(() => ctx.run('truck_delete', { truckId: t.id, reason: 'r' }), /^(?!.*Delete IF).*Close TO.* in NetSuite first/);
    assert.equal(ctx.data.getLoad(t.id).status, 'at_dock');
    assert.equal(ctx.data.getLoad(t.id).data.claim || '', '');
    ctx.tx._t.closed[String(d.toId)] = true;
    const r = ctx.run('truck_delete', { truckId: t.id, reason: 'r' });
    assert.equal(r.pallets, 2);
    assert.equal(ctx.data.getLoad(t.id).data.deleted.toNum, d.toNum);
    assert.deepEqual(ctx.tx._t.ops, []);
});

test('delete: a plan-only at-dock truck (writes off, no TO) deletes at once', () => {
    const ctx = scanSetup();
    ctx.data.db.settings.writeMode = 'off';
    const t = scanTruck(ctx, 1);
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('ship_mark', { truckId: t.id }, false);
    ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(ctx.data.getLoad(t.id).status, 'at_dock');
    assert.equal(ctx.data.getLoad(t.id).data.toId || '', '');
    assert.equal(ctx.run('truck_delete', { truckId: t.id, reason: 'r' }).deleted, true);
});

test('delete: the floor\'s next scan on a deleted truck is refused', () => {
    const ctx = scanSetup();
    const t = scanTruck(ctx, 2);
    ctx.run('truck_delete', { truckId: t.id, reason: 'r' });
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: t.ps[0].code }, false), /This truck was deleted/);
    assert.throws(() => ctx.run('truck_remove', { truckId: t.id, palletId: t.ps[0].id }, false), /This truck was deleted/);
    assert.throws(() => ctx.run('ship_mark', { truckId: t.id }, false), /This truck was deleted/);
});

// Jack 10/19: a manager on Settings noApprove (employee ids) keeps the manager screens but makes no approval decision.
test('noApprove: a listed manager is refused every approval decision; reads and labels still work', () => {
    const ctx = scanSetup();
    const t = docsScan(ctx, 1);
    ctx.data.db.settings.noApprove = ['5'];
    ['ship_confirm', 'ship_sendback', 'pickup_confirm', 'pickup_reject', 'dock_sendback', 'picked_up_force', 'dock_resync', 'truck_correct', 'truck_drop_if',
        'depart_retry', 'depart_release', 'truck_delete', 'pallet_accept', 'pallet_reject', 'receipt_approve'].forEach(act =>
        assert.throws(() => ctx.run(act, { truckId: t.id, note: 'x', reason: 'x' }), /Approvals are turned off for you/, act));
    assert.equal(ctx.data.getLoad(t.id).status, 'ship_pending');
    assert.equal(ctx.run('approvals').ok === undefined, true);
    assert.ok(ctx.run('weights_list'));
    assert.ok(ctx.run('truck_get', { truckId: t.id }).view);
    ctx.data.db.settings.noApprove = ['999'];
    ctx.run('ship_confirm', { truckId: t.id });
    assert.equal(ctx.data.getLoad(t.id).status, 'at_dock');
});
