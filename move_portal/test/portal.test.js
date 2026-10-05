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
        'N/render': {}, 'N/url': opts.url || {},
        'N/format': { format: () => '10/14/2026 2:14:05 pm', Type: { DATETIMETZ: 'dtz' }, Timezone: { AMERICA_LOS_ANGELES: 'la' } },
        './move_core': core, './move_data': data, './move_tx': tx, './move_label_template': {}, './move_ui': opts.ui || {}, './move_verify': verify, './move_ns': ns
    });
    const run = (action, a, mgr = true) => sl._runAction(action, Object.assign({ actor: 'Miguel' }, a || {}), mgr);
    return { data, tx, run, ns, sl, rt };
}
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
    ctx.run('pallet_void', { palletId: ps[0].id, reason: 'Sent to customer' }, false);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'void');
    assert.throws(() => ctx.run('pallet_void', { palletId: ps[0].id }, false), /Only labels not on a load/);
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

test('plan subtracts already-labeled stock and lists SKUs with no config', () => {
    const ctx = setup();
    ctx.data.db.items.push({ item: '14', sku: 'NOCFG', desc: '', upc: '' });
    ctx.data.db.stock['35']['14'] = { onHand: 5, avail: 5 };
    printLabels(ctx, 3);
    const r = ctx.run('plan');
    const y201 = r.rows.find(x => x.sku === 'YSN201');
    assert.deepEqual([y201.palletsLeft, y201.labeled, y201.cfg, y201.pcs], [7, 3, 'A', 120]);
    assert.equal(r.rows.find(x => x.sku === 'YSN301').palletsLeft, 10);
    assert.deepEqual(r.noConfig.map(x => x.sku), ['NOCFG']);
    assert.equal(r.labeledPallets, 3);
    assert.equal(r.dayLabel, '2026-10-14');
});

// ── dashboard ──
const L975 = { item: '975', sku: 'YSN100', cfg: 'A', pcs: 12 };
function truckWith(ctx, n, ifId) {
    const ps = printLabels(ctx, n, 'Jt' + n + Math.random().toString(36).slice(2, 6), [L975]);
    const t = ctx.run('truck_start', { ifIds: [ifId || '9001'] }).view.truck;
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

test('dashboard counts moved, remaining, days, in-transit, never-loaded and trucks', () => {
    const ctx = setup();
    ctx.data.db.stock['35']['975'] = { onHand: 1000, avail: 1000 };
    const { t } = readyTruck(ctx, 42);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249330' }, false);
    ctx.data.db.stock['35']['975'].onHand = 496;           // NetSuite drops on-hand when the IF ships
    printLabels(ctx, 1, 'Jlater');
    ctx.data.db.pallets[Object.keys(ctx.data.db.pallets).pop()].printedDay = '2026-10-01';   // stale label
    const stray = printLabels(ctx, 1, 'Jstray', [L975]);
    ctx.run('unload_scan', { truckId: t.id, raw: stray[0].code }, false);   // labeled, never loaded
    const r = ctx.run('dashboard');
    assert.deepEqual([r.m.moved, r.m.remaining, r.m.total, r.m.movedToday], [42, 62, 104, 42]);
    assert.deepEqual([r.inTransit, r.labeled, r.received], [42, 2, 0]);
    assert.deepEqual(r.days[r.days.length - 1], { day: '2026-10-14', n: 42 });
    assert.equal(r.days[0].day, '2026-10-01');
    assert.deepEqual([r.exc.missing, r.exc.stale, r.exc.noConfig, r.exc.neverLoaded], [0, 1, 0, 1]);
    assert.equal(r.bySku[0].sku, 'YSN100');
    assert.equal(r.trucks.length, 1);
    assert.equal(r.trucks[0].status, 'departed');
    assert.equal(r.loads, undefined);
    assert.throws(() => ctx.run('dashboard', {}, false), /Managers only/);
});

// ── v3 trucks ──

test('truck_planned lists A/B IFs not on a truck; truck_start takes one', () => {
    const ctx = setup();
    const r = ctx.run('truck_planned');
    assert.deepEqual(r.planned.map(f => [f.ifNum, f.pcs, f.estPallets]), [['IF9001', 504, 42], ['IF9002', 504, 42]]);
    const v1 = ctx.run('truck_start', { ifIds: ['9001'] }).view;
    assert.deepEqual([v1.truck.status, v1.truck.label, v1.lines[0].expected, v1.lines[0].scanned], ['loading', 'IF9001', 504, 0]);
    assert.deepEqual(ctx.run('truck_planned').planned.map(f => f.ifNum), ['IF9002']);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9001'] }), /already on a truck/);
    assert.throws(() => ctx.run('truck_start', { ifIds: ['9000'] }), /not Picked\/Packed/);
});

test('truck_scan: ok, dup, no_to blocked, undo and remove', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2, 'Jscan', [L975]);
    const bad = printLabels(ctx, 1, 'Jbad', [{ item: '12', sku: 'YSN301', cfg: 'A', pcs: 60 }]);
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
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
    const a = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    const b = ctx.run('truck_start', { ifIds: ['9002'] }).view.truck;
    ctx.run('truck_scan', { truckId: a.id, raw: ps[0].code });
    const r = ctx.run('truck_scan', { truckId: b.id, raw: ps[0].code });
    assert.deepEqual([r.result, r.otherLabel], ['other_truck', 'IF9001']);
    assert.equal(ctx.run('truck_move_here', { truckId: b.id, palletId: ps[0].id }).view.lines[0].scanned, 12);
    assert.equal(ctx.data.getPallet(ps[0].id).loadId, b.id);
});

test('depart: exact match → floor departs, stamps planned only in off mode, pallets in transit, truck # 1', () => {
    const ctx = setup();
    const { t, ps } = readyTruck(ctx, 42);
    const pv = ctx.run('depart_preview', { truckId: t.id, trailer: '537224', seal: '5249330' }, false);
    assert.deepEqual([pv.truckNo, pv.plan.corrections, pv.plan.ops.length], [1, 0, 1]);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249330' }, false);
    assert.equal(r.departed, true);
    assert.deepEqual([r.view.truck.status, r.view.truck.label, r.view.truck.depart.carrier], ['departed', 'Truck 1 · 10/14', 'Armstrong Group']);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'in_transit');
    const t2 = readyTruck(ctx, 1, '9002').t;                                  // IF9001 is taken by the departed truck
    assert.throws(() => ctx.run('depart_confirm', { truckId: t2.id, trailer: '1', seal: '5249330' }), /already used/);
});

test('depart: a failed write leaves the truck departing with an error; a manager retry finishes without rewriting', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 42);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249332' }), /NetSuite write failed/);
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
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'ready');
    ctx.tx._t.failOn = 'if_stamp:9002';
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249340' }), /NetSuite write failed/);
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
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '1', seal: '5249341' }), /NetSuite write failed/);
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
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249342' }), /already being/);
    assert.equal(ctx.tx._t.ops.length, 1);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'loaded');
});

test('an empty IF blocks Ready; dropped by a manager, it goes back to the planned list and the truck departs', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Junp', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    assert.deepEqual(ctx.run('truck_verify', { truckId: t.id }, false).diffs.map(d => d.kind), ['if_empty']);
    assert.equal(ctx.run('truck_drop_if', { truckId: t.id, ifId: '9002' }).view.truck.status, 'ready');
    assert.equal(ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249343' }, true).departed, true);
    assert.deepEqual(ctx.run('truck_planned').planned.map(f => f.ifNum), ['IF9002']);
});

test('off mode saves the would-write plan and allocation', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249344' }, false);
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
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '1', seal: '5249351' }), /already departing/);
    ctx.data.getLoad = realGet;
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.depart.seal, d.data.writes], ['departing', 'first', '5249350', { 'if_create:500': '777' }]);
    assert.equal(ctx.tx._t.ops.length, 0);
});

test('a finished departure clears claim, workingAt and phase', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249352' });
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.workingAt, d.data.phase], ['departed', '', 0, '']);
});

// ── v3 unload and receipt approval ──
function departed(ctx, n, seal, ifId) {
    const { t, ps } = readyTruck(ctx, n, ifId);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: seal || '5249340' }, true);
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
    const t = ctx.run('truck_start', { ifIds: ['9001', '9901'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'S9' }, true);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const rc = ctx.tx._t.ops.filter(o => o.op === 'receipt');
    assert.deepEqual(rc.map(o => [o.ifId, o.toId, JSON.stringify(o.lines)]), [['9001', '500', '{"975":504}'], ['9901', '700', '{"11":240}']]);
});

function mixedOnTruck(ctx, seal) {
    ifOn700(ctx);
    const ps = printLabels(ctx, 2, 'Jm' + seal, [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }]).concat(printLabels(ctx, 42, 'Jn' + seal, [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001', '9901'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: seal }, true);
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
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '1', seal: 'S1' }), /NetSuite write failed/);
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
    ['truck_planned', 'dashboard', 'report'].forEach(a => { const b = byLoad.n; ctx.run(a); assert.equal(byLoad.n, b, a + ' searched pallets per truck'); });
    assert.equal(grouped.n, 5);
});

test('fix3: a truck scan re-checks the truck right before loading the pallet', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2, 'Jrc', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    const orig = ctx.ns.openToLines;
    ctx.ns.openToLines = () => { ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: 'X' } }); return orig(); };
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: ps[0].code }), /Scanning is closed/);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'labeled');
    ctx.ns.openToLines = orig;
    ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: '' } });
    const b = ctx.run('truck_start', { ifIds: ['9002'] }).view.truck;
    ctx.run('truck_scan', { truckId: t.id, raw: ps[1].code });
    ctx.ns.openToLines = () => { ctx.data.updateLoad(ctx.data.getLoad(b.id), { status: 'departing', data: { claim: 'c1' } }); return orig(); };
    assert.throws(() => ctx.run('truck_move_here', { truckId: b.id, palletId: ps[1].id }), /Scanning is closed/);
    assert.equal(ctx.data.getPallet(ps[1].id).loadId, t.id);
});

test('fix3: the scan stack is not written over a truck that closed meanwhile; undo too', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2, 'Jst', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
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
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'C4' }, false);
    ctx.data.updateLoad = realUpd;
    assert.ok(seen.claim && seen.depart && seen.plan && seen.alloc && seen.writes);
    assert.equal(seen.depart.seal, 'C4');
});

test('fix4: an IF the office shipped after Ready stops the departure (if_gone) until a manager drops it', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Jif', [L975]).concat(printLabels(ctx, 42, 'Jif2', [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id }, false);
    const orig = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => orig().filter(f => f.ifId !== '9001');
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'I2' });
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
    ctx.run('depart_confirm', { truckId: a.t.id, trailer: '537224', seal: 'R5' });
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
    const pg = setup({ deploymentId: FLOOR, ui: { buildPage: o => { seen.page = o; return 'html'; } }, url: { resolveScript: o => { seen.url = o; return 'https://ext/x'; } } });
    pg.sl.onRequest({ request: { parameters: {} }, response: { write() {} } });
    assert.deepEqual([seen.page.mode, seen.page.url, seen.url.returnExternalUrl, seen.url.deploymentId], ['floor', 'https://ext/x', true, FLOOR]);
    const mg = setup({ ui: { buildPage: o => { seen.page = o; return 'html'; } }, url: { resolveScript: o => { seen.url = o; return '/int'; } } });
    mg.sl.onRequest({ request: { parameters: {} }, response: { write() {} } });
    assert.deepEqual([seen.page.mode, !!seen.url.returnExternalUrl], ['manager', false]);
});

test('fix7: approvers are the NetSuite user; the roster name is kept separately', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 40);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'A7', actor: 'Boss' }), /NetSuite write failed/);
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
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    assert.deepEqual(ctx.run('truck_verify', { truckId: t.id }, false).diffs.map(d => d.kind), ['if_empty']);
    const a = { truckId: t.id, trailer: '537224', seal: 'E10' };
    assert.throws(() => ctx.run('depart_preview', a, false), /Verify the load first/);
    assert.throws(() => ctx.run('depart_confirm', a, false), /Verify the load first/);
    assert.throws(() => ctx.run('depart_confirm', a, true), /Verify the load first/);
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
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'E11' });
    ctx.data.updateLoad = realUpd;
    assert.deepEqual([r.needsFix, r.diffs.map(x => x.kind)], [true, ['if_empty']]);
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.depart], ['needs_fix', '', null]);
});

test('fix11: a load scan that is not a labeled pallet reads no TO lines and no truck list', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 3, 'Jcls', [L975]);
    const a = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    const b = ctx.run('truck_start', { ifIds: ['9002'] }).view.truck;
    ctx.run('truck_scan', { truckId: a.id, raw: ps[0].code });
    ctx.run('pallet_void', { palletId: ps[1].id }, false);
    const to = { n: 0 }, origTo = ctx.ns.openToLines;
    ctx.ns.openToLines = () => { to.n++; return origTo(); };
    const lists = countCalls(ctx, 'loadsByStatus');
    const res = raw => ctx.run('truck_scan', { truckId: a.id, raw: raw });
    assert.equal(res(ps[0].code).result, 'dup');
    assert.equal(res(ps[1].code).result, 'void');
    assert.equal(res('PLT99999').result, 'unknown');
    const o = ctx.run('truck_scan', { truckId: b.id, raw: ps[0].code });
    assert.deepEqual([o.result, o.otherLabel], ['other_truck', 'IF9001']);
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
    assert.equal(ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'LD1' }).departed, true);
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
    assert.equal(ctx.run('truck_verify', { truckId: t.id }, false).view.truck.status, 'needs_fix');
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 480 })] }) : f);
    const r = ctx.run('trucks_recheck', {}, false);
    assert.deepEqual(r.nowReady.map(x => x.id), [t.id]);
    assert.equal(ctx.data.getLoad(t.id).status, 'ready');
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
    const b = ctx.run('truck_start', { ifIds: ['9002'] }).view.truck;
    const r = ctx.run('truck_scan', { truckId: b.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.otherLabel], ['other_truck', 'IF9001']);
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
function goneIf(ctx, ifId) { const real = ctx.ns.plannedIfs; ctx.ns.plannedIfs = () => real().filter(f => f.ifId !== ifId); }

test('I1: a gone IF persists across verifies and a recheck until a manager drops it', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 43);
    ctx.run('truck_add_if', { truckId: t.id, ifId: '9002' });                // manager
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
    ctx.run('truck_verify', { truckId: t.id, actor: 'Ana' }, false);
    const before = ctx.data.getLoad(t.id).data.verify;
    const n = countCalls(ctx, 'updateLoad');
    const reads = countCalls(ctx, 'palletsByStatus');
    const r = ctx.run('trucks_recheck', { actor: 'Poller' }, false);
    assert.deepEqual([r.nowReady, n.n, reads.n], [[], 0, 1]);
    assert.deepEqual(ctx.data.getLoad(t.id).data.verify, before);
    ctx.run('truck_verify', { truckId: t.id, actor: 'Bo' }, false);          // a manual verify always records
    assert.equal(ctx.data.getLoad(t.id).data.verify.by, 'Bo');
});

test('I2: recheck reads planned IFs and TO lines once for all trucks', () => {
    const ctx = setup();
    const a = truckWith(ctx, 40).t, b = truckWith(ctx, 40, '9002').t;
    ctx.run('truck_verify', { truckId: a.id }, false); ctx.run('truck_verify', { truckId: b.id }, false);
    const calls = { p: 0, o: 0 }, rp = ctx.ns.plannedIfs, ro = ctx.ns.openToLines;
    ctx.ns.plannedIfs = () => { calls.p++; return rp(); };
    ctx.ns.openToLines = () => { calls.o++; return ro(); };
    ctx.run('trucks_recheck', {}, false);
    assert.deepEqual(calls, { p: 1, o: 1 });
});

test('M4: recheck skips a truck that throws a user error and still returns the others', () => {
    const ctx = setup();
    const a = truckWith(ctx, 40).t, b = truckWith(ctx, 40, '9002').t;
    ctx.run('truck_verify', { truckId: a.id }, false); ctx.run('truck_verify', { truckId: b.id }, false);
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
    assert.ok(ctx.run('truck_add_if', { truckId: t.id, ifId: ifX }).view.truck.label.includes('IF' + ifX));
    ctx.run('truck_start', { ifIds: ['9002'] });
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
test('depart only from ready; floor confirms; stamp-only plan', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'R1' }, false), /Verify the load first/);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const pv = ctx.run('depart_preview', { truckId: t.id, trailer: '537224', seal: 'R1' }, false);
    assert.deepEqual(pv.plan.ops.map(o => o.op), ['if_stamp']);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'R1' }, false);
    assert.deepEqual([r.departed, r.view.truck.status], [true, 'departed']);
});

test('confirm re-verifies: an IF changed in NetSuite after Ready sends the truck to needs_fix', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 456 })] }) : f);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'R2' }, false);
    assert.deepEqual([r.needsFix, r.view.truck.status, r.diffs[0].kind], [true, 'needs_fix', 'if_over']);
    assert.equal(ctx.data.getLoad(t.id).data.claim, '');
});

test('removed: depart_cancel, depart_skip_write, pending', () => {
    const ctx = setup();
    assert.throws(() => ctx.run('depart_cancel', { truckId: '1' }), /Unknown action/);
    assert.throws(() => ctx.run('depart_skip_write', { truckId: '1' }), /Unknown action/);
    assert.equal(ctx.run('approvals').departures, undefined);
});

test('preview re-verifies too: a mismatch returns needsFix and sets needs_fix', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.throws(() => ctx.run('depart_preview', { truckId: truckWith(ctx, 1, '9002').t.id, trailer: '1', seal: 'P0' }, false), /Verify the load first/);
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 516 })] }) : f);
    const r = ctx.run('depart_preview', { truckId: t.id, trailer: '537224', seal: 'P1' }, false);
    assert.deepEqual([r.needsFix, r.diffs[0].kind, r.view.truck.status, r.plan], [true, 'if_short', 'needs_fix', undefined]);
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
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'C3' }, false);
    ctx.data.updateLoad = realUpd;
    assert.deepEqual([r.needsFix, r.diffs[0].kind], [true, 'if_short']);
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.workingAt, d.data.phase, d.data.depart, d.data.plan], ['needs_fix', '', 0, '', null, null]);
    assert.equal(ctx.data.getPallet(ps[1].id).status, 'loaded');
});

test('a truck with no live IF can never be ready; dropping its gone IF leaves no_ifs', () => {
    const ctx = setup();
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    const real = ctx.ns.plannedIfs;
    ctx.ns.plannedIfs = () => real().filter(f => f.ifId !== '9001');
    ctx.run('truck_verify', { truckId: t.id }, false);
    const r = ctx.run('truck_drop_if', { truckId: t.id, ifId: '9001' });
    assert.deepEqual([r.match, r.diffs.map(d => d.kind), r.view.truck.status], [false, ['no_ifs'], 'needs_fix']);
    assert.equal(r.diffs[0].text, 'This truck has no IF → add one');
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'N1' }), /Verify the load first/);
});

test('approvals retries carry no skip affordance', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = readyTruck(ctx, 42);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'K2' }), /NetSuite write failed/);
    const rt = ctx.run('approvals').retries;
    assert.deepEqual([rt.map(x => x.id), rt[0].errorKey, rt[0].errorOp], [[t.id], undefined, undefined]);
    assert.equal(ctx.data.getLoad(t.id).data.errorKey, undefined);
    assert.equal(ctx.run('depart_retry', { truckId: t.id }).departed, true);
});

test('departData drops requestedBy and pending; the floor departs with no approver', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'DD1' }, false);
    const d = ctx.data.getLoad(t.id).data;
    assert.deepEqual([d.depart.requestedBy, d.depart.approvedBy, 'pending' in d], [undefined, '', false]);
});

// ── Task 3 review follow-ups ──
test('depart_release: a stuck departure with no stamp written goes back to needs_fix and re-verifies', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t, ps } = readyTruck(ctx, 42);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'RL1' }), /NetSuite write failed/);
    assert.deepEqual(ctx.run('approvals').retries.map(x => [x.id, x.canRelease]), [[t.id, true]]);
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }, false), /Managers only/);
    const r = ctx.run('depart_release', { truckId: t.id });
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.data.claim, d.data.depart, d.data.plan, d.data.alloc, d.data.bol, d.data.writes, d.data.error], ['', null, null, null, null, null, '']);
    assert.deepEqual([r.match, r.view.truck.status, d.status], [true, 'ready', 'ready']);   // re-verified: the load still matches
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'loaded');
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /Nothing to release/);
    assert.equal(ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'RL1' }).departed, true);   // the seal is free again
});

test('depart_release is refused once a stamp landed, and while the departure is still running', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const ps = printLabels(ctx, 42, 'Jrl', [L975]).concat(printLabels(ctx, 42, 'Jrl2', [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id }, false);
    ctx.tx._t.failOn = 'if_stamp:9002';
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'RL2' }), /NetSuite write failed/);
    assert.deepEqual(ctx.run('approvals').retries.map(x => x.canRelease), [false]);
    assert.throws(() => ctx.run('depart_release', { truckId: t.id }), /already stamped.*Retry/);
    const c2 = setup();
    const b = readyTruck(c2, 42).t;
    c2.data.updateLoad(c2.data.getLoad(b.id), { status: 'departing', data: { claim: 'live', workingAt: Date.now(), depart: { seal: 'Z' }, writes: {} } });
    assert.throws(() => c2.run('depart_release', { truckId: b.id }), /still running/);
});

test('toNeedsFix refuses when the IFs changed while the departure check ran', () => {
    const ctx = setup();
    const { t } = readyTruck(ctx, 42);
    const real = ctx.ns.plannedIfs;
    let armed = true;
    ctx.ns.plannedIfs = () => {
        const out = real().map(f => f.ifId === '9001' ? Object.assign({}, f, { lines: [Object.assign({}, f.lines[0], { qty: 456 })] }) : f);
        if (armed) { armed = false; const x = ctx.data.getLoad(t.id); ctx.data.updateLoad(x, { data: { ifs: x.data.ifs.concat([real().find(f => f.ifId === '9002')]) } }); }
        return out;
    };
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'TG1' }, false), /changed while it was being checked/);
    assert.equal(ctx.data.getLoad(t.id).status, 'ready');
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
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'SW1' }, false);
    ctx.data.updateLoad = realUpd;
    assert.equal(r.departed, true);
    assert.deepEqual([ctx.data.getPallet(spare.id).status, ctx.data.getPallet(ps[0].id).status], ['in_transit', 'labeled']);
    assert.ok(ctx.data.getLoad(t.id).data.departPallets.split(',').includes(String(spare.id)));
});

test('depart_preview on an unchanged load keeps verify at/by', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('truck_verify', { truckId: t.id, actor: 'Ana' }, false);
    const n = countCalls(ctx, 'updateLoad');
    ctx.run('depart_preview', { truckId: t.id, trailer: '537224', seal: 'PV1', actor: 'Bo' }, false);
    assert.deepEqual([ctx.data.getLoad(t.id).data.verify.by, n.n], ['Ana', 0]);
});

// ── Correct the IF (manager) ──
test('truck_correct: manager only; qty mode writes if_qty and the truck verifies ready', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id }, false);
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
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
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
    ctx.run('truck_verify', { truckId: t.id }, false);
    const a = ctx.run('approvals');
    assert.equal(a.needsFix[0].truck.id, t.id);
    assert.match(a.needsFix[0].diffs[0].text, /IF needs −24/);
});

test('truck_correct: a refused write surfaces correctError, keeps the truck needs_fix and frees the claim', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id }, false);
    assert.throws(() => ctx.run('truck_correct', { truckId: t.id, keys: ['nope'] }), /Nothing the portal can correct/);
    ctx.tx._t.failOn = 'if_qty:9001:975';
    assert.throws(() => ctx.run('truck_correct', { truckId: t.id }), /^Error: Correction refused: .*fix it in NetSuite/);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual([x.status, x.data.claim], ['needs_fix', '']);
    assert.match(x.data.correctError, /IF changed in NetSuite/);
    assert.deepEqual(x.data.corrections.map(k => k.key), ['if_short:9001:975']);
    assert.equal(x.data.corrections[0].by.name, 'Jack K');
    assert.match(ctx.run('approvals').needsFix[0].correctError, /IF changed/);
    assert.throws(() => ctx.run('truck_correct', { truckId: ctx.run('truck_start', { ifIds: ['9002'] }).view.truck.id }), /needs a fix|Verify/);
});

test('truck_correct on mode: the created Packed IF is attached and kept when NetSuite returns it', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const ps = printLabels(ctx, 42, 'Jd1', [L975]).concat(printLabels(ctx, 1, 'Jd2', [LINE201]));
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id });
    const real = ctx.ns.plannedIfs;
    ctx.tx._t.onApply = op => { const id = String(ctx.tx._t.seq + 1); if (op.op === 'if_create') ctx.ns.plannedIfs = () => real().concat([{ ifId: id, ifNum: 'IF' + id, status: 'B', trandate: '2026-10-14', toId: '700', toNum: 'TO700', lines: [{ item: '11', sku: 'YSN201', qty: 120 }] }]); };
    const r = ctx.run('truck_correct', { truckId: t.id });
    assert.deepEqual([r.verify.match, r.view.truck.status], [true, 'ready']);
    const x = ctx.data.getLoad(t.id);
    assert.deepEqual(x.data.ifs.map(f => [f.ifId, !!f.gone]), [['901', false], ['9001', false]]);
    assert.equal(x.data.correctionWrites['if_create:700'].id, '901');
});

test('truck_correct: a later correction of the same IF item with new numbers is written again', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    ctx.run('truck_verify', { truckId: t.id }, false);
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
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('truck_verify', { truckId: t.id });
    ctx.run('truck_correct', { truckId: t.id });
    const rows = ctx.run('report').rows.filter(r => r.check === 'IF fix needed');
    assert.deepEqual(rows.map(r => [r.ifNum, r.portal, r.ok]), [['(new)', 'new IF from TO700: YSN201 ×120', false]]);
    ctx.run('truck_remove', { truckId: t.id, palletId: ps[42].id });
    ctx.run('truck_verify', { truckId: t.id });
    assert.deepEqual(ctx.run('report').rows.filter(r => r.check === 'IF fix needed'), []);
});
