const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const { makeFakeData } = require('./fake_data');
const { makeFakeTx } = require('./fake_tx');

function setup() {
    const data = makeFakeData(core);
    const tx = makeFakeTx();
    data.db.items.push({ item: '11', sku: 'YSN201', desc: '20# cylinder', upc: '111' }, { item: '12', sku: 'YSN301', desc: '30# cylinder', upc: '112' });
    data.db.stock['35'] = { '11': { onHand: 1200, avail: 1000 }, '12': { onHand: 600, avail: 600 } };
    data.db.configs.push({ item: '11', code: 'A', pcs: 120, isDefault: true, batch: 'B1' }, { item: '12', code: 'A', pcs: 60, isDefault: true, batch: 'B1' });
    const sl = loadAmd('sl_move_portal.js', {
        'N/runtime': { getCurrentUser: () => ({ id: 5, name: 'Jack K', roleId: 'administrator', role: 3 }), getCurrentScript: () => ({ id: 's', deploymentId: 'd' }) },
        'N/log': { error() {}, debug() {}, audit() {} },
        'N/render': {}, 'N/url': {},
        'N/format': { format: () => '10/14/2026 2:14:05 pm', Type: { DATETIMETZ: 'dtz' }, Timezone: { AMERICA_LOS_ANGELES: 'la' } },
        './move_core': core, './move_data': data, './move_tx': tx, './move_label_template': {}, './move_ui': {}
    });
    const run = (action, a, mgr = true) => sl._runAction(action, Object.assign({ actor: 'Miguel' }, a || {}), mgr);
    return { data, tx, run };
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

// ── Task 9 ──
function openLoad(ctx) { return ctx.run('load_create', { door: '4', carrier: 'Estes', trailer: '53', seal: '9' }, false).load; }
function loadAndReady(ctx, n, job) {
    const ps = printLabels(ctx, n, job || 'Jship');
    const L = openLoad(ctx);
    ps.forEach(p => ctx.run('scan_load', { loadId: L.id, raw: p.code }, false));
    ctx.run('load_ready', { loadId: L.id }, false);
    return { ps, L };
}
const txCount = (ctx, type) => ctx.tx._t.calls.filter(c => c.type === type).length;

test('load scanning: ok, dup, unknown, void, other open load, move here', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 3);
    const L1 = openLoad(ctx), L2 = openLoad(ctx);
    assert.deepEqual([L1.number, L2.number, L1.door], ['MV-001', 'MV-002', '4']);
    let r = ctx.run('scan_load', { loadId: L1.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.tone, r.view.totals.pallets, r.view.totals.pieces, r.pallet.status], ['ok', 'ok', 1, 120, 'loaded']);
    assert.equal(ctx.run('scan_load', { loadId: L1.id, raw: ps[0].code }, false).result, 'dup');
    assert.equal(ctx.run('scan_load', { loadId: L1.id, raw: '0714528803' }, false).result, 'unknown');
    ctx.run('pallet_void', { palletId: ps[2].id, reason: 'Damaged' }, false);
    assert.equal(ctx.run('scan_load', { loadId: L1.id, raw: ps[2].code }, false).result, 'void');
    ctx.run('scan_load', { loadId: L2.id, raw: ps[1].code }, false);
    r = ctx.run('scan_load', { loadId: L1.id, raw: ps[1].code }, false);
    assert.deepEqual([r.result, r.otherNumber], ['other_load', 'MV-002']);
    r = ctx.run('load_move_here', { loadId: L1.id, palletId: ps[1].id }, false);
    assert.equal(r.view.totals.pallets, 2);
    assert.equal(ctx.run('load_get', { loadId: L2.id }, false).totals.pallets, 0);
    assert.equal(ctx.data.db.scans.length, 6);
    assert.equal(ctx.run('load_list', {}, false).loads.length, 2);
});

test('edit and remove only while loading; ready closes scanning', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 2);
    const L = openLoad(ctx);
    assert.throws(() => ctx.run('load_ready', { loadId: L.id }, false), /at least one/);
    ctx.run('scan_load', { loadId: L.id, raw: ps[0].code }, false);
    const e = ctx.run('pallet_edit', { loadId: L.id, palletId: ps[0].id, lines: [{ item: '11', pcs: 100 }] }, false);
    assert.deepEqual([e.pallet.pieces, e.pallet.edited, e.pallet.summary, e.view.totals.pieces], [100, true, 'YSN201 · A · 100', 100]);
    assert.throws(() => ctx.run('pallet_edit', { loadId: L.id, palletId: ps[0].id, lines: [{ item: '12', pcs: 1 }] }, false), /only change piece counts/);
    ctx.run('pallet_remove', { loadId: L.id, palletId: ps[0].id }, false);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'labeled');
    ctx.run('scan_load', { loadId: L.id, raw: ps[1].code }, false);
    ctx.run('load_ready', { loadId: L.id }, false);
    assert.throws(() => ctx.run('scan_load', { loadId: L.id, raw: ps[0].code }, false), /closed for scanning/);
    assert.throws(() => ctx.run('pallet_remove', { loadId: L.id, palletId: ps[1].id }, false), /open load/);
    assert.throws(() => ctx.run('load_sendback', { loadId: L.id }, false), /Managers only/);
    ctx.run('load_sendback', { loadId: L.id });
    assert.equal(ctx.data.getLoad(L.id).status, 'loading');
});

test('approve & ship creates one TO and one IF and ships the pallets', () => {
    const ctx = setup();
    const { ps, L } = loadAndReady(ctx, 2);
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }, false), /Managers only/);
    const list = ctx.run('ship_list');
    assert.deepEqual(list.loads[0].rows, [{ item: '11', sku: 'YSN201', qty: 240, avail: 1000, ok: true }]);
    const r = ctx.run('load_approve', { loadId: L.id });
    assert.equal(r.number, 'MV-001');
    assert.deepEqual(ctx.tx._t.calls.map(c => c.type), ['TrnfrOrd', 'ItemShip']);
    assert.deepEqual(ctx.tx._t.calls[0].lines, { '11': 240 });
    assert.deepEqual([ctx.tx._t.calls[0].fromLoc, ctx.tx._t.calls[0].toLoc], ['35', '99']);
    assert.match(ctx.tx._t.memos[0].memo, /\[mv:\d+:to\]/);
    const Ld = ctx.data.getLoad(L.id);
    assert.deepEqual([Ld.status, Ld.data.approvedBy, Ld.data.phase], ['shipped', 'Miguel', '']);
    ps.forEach(p => { const x = ctx.data.getPallet(p.id); assert.deepEqual([x.status, x.shippedDay], ['shipped', '2026-10-14']); });
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /not ready to ship/);
    assert.equal(ctx.run('ship_list').loads.length, 0);
    assert.equal(ctx.run('ship_list').recent[0].number, 'MV-001');
});

test('stock shortage blocks approval and leaves the load ready', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 2);
    ctx.data.db.stock['35']['11'].avail = 100;
    assert.equal(ctx.run('ship_list').loads[0].rows[0].ok, false);
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /YSN201 needs 240, available 100/);
    assert.equal(ctx.data.getLoad(L.id).status, 'ready');
    assert.equal(ctx.tx._t.calls.length, 0);
});

test('an IF failure is retried without a second TO; a crash after the IF saved does not duplicate it', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 1);
    ctx.tx._t.failNext = 'if';
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /IF save failed/);
    let Ld = ctx.data.getLoad(L.id);
    assert.deepEqual([Ld.status, Ld.data.error, txCount(ctx, 'TrnfrOrd')], ['error', 'IF save failed', 1]);
    assert.equal(ctx.run('ship_list').loads[0].canSendBack, false);
    ctx.tx._t.failNext = 'if_after';
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /crashed after save/);
    ctx.run('load_approve', { loadId: L.id });
    assert.deepEqual([txCount(ctx, 'TrnfrOrd'), txCount(ctx, 'ItemShip'), ctx.data.getLoad(L.id).status], [1, 1, 'shipped']);
});

test('committed shortfall on the TO stops before the IF', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 1);
    ctx.tx._t.shortfalls = [{ item: '11', need: 120, committed: 60 }];
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /YSN201 reserved 60 of 120/);
    assert.equal(txCount(ctx, 'ItemShip'), 0);
    ctx.tx._t.shortfalls = [];
    ctx.run('load_approve', { loadId: L.id });
    assert.equal(txCount(ctx, 'ItemShip'), 1);
});
