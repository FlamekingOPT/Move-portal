const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const { makeFakeData } = require('./fake_data');
const { makeFakeTx } = require('./fake_tx');
const verify = loadAmd('move_verify.js');
const { makeSnapshotNs } = require('../local/snapshot_ns');

function setup() {
    const data = makeFakeData(core);
    const tx = makeFakeTx();
    data.db.items.push({ item: '11', sku: 'YSN201', desc: '20# cylinder', upc: '111' }, { item: '12', sku: 'YSN301', desc: '30# cylinder', upc: '112' });
    data.db.stock['35'] = { '11': { onHand: 1200, avail: 1000 }, '12': { onHand: 600, avail: 600 } };
    data.db.configs.push({ item: '11', code: 'A', pcs: 120, isDefault: true, batch: 'B1' }, { item: '12', code: 'A', pcs: 60, isDefault: true, batch: 'B1' });
    const ns = makeSnapshotNs(verify, JSON.parse(JSON.stringify(require('./fixtures/snapshot_sample.json'))));
    data.db.items.push({ item: '975', sku: 'YSN100', desc: '100# cylinder', upc: '0975' });
    data.db.configs.push({ item: '975', code: 'A', pcs: 12, isDefault: true, batch: 'B1' });
    const sl = loadAmd('sl_move_portal.js', {
        'N/runtime': { getCurrentUser: () => ({ id: 5, name: 'Jack K', roleId: 'administrator', role: 3 }), getCurrentScript: () => ({ id: 's', deploymentId: 'd' }) },
        'N/log': { error() {}, debug() {}, audit() {} },
        'N/render': {}, 'N/url': {},
        'N/format': { format: () => '10/14/2026 2:14:05 pm', Type: { DATETIMETZ: 'dtz' }, Timezone: { AMERICA_LOS_ANGELES: 'la' } },
        './move_core': core, './move_data': data, './move_tx': tx, './move_label_template': {}, './move_ui': {}, './move_verify': verify, './move_ns': ns
    });
    const run = (action, a, mgr = true) => sl._runAction(action, Object.assign({ actor: 'Miguel' }, a || {}), mgr);
    return { data, tx, run, ns };
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

test('an orphaned TO from a crash is adopted without re-checking stock, and blocks sendback', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 1);
    ctx.data.db.stock['35']['11'].avail = 120;   // exactly the load qty
    ctx.tx._t.failNext = 'to_after';
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /crashed after save/);
    assert.equal(ctx.data.getLoad(L.id).to, '');
    assert.equal(txCount(ctx, 'TrnfrOrd'), 1);
    assert.throws(() => ctx.run('load_sendback', { loadId: L.id }), /already has a transfer order/);
    ctx.data.db.stock['35']['11'].avail = 0;     // the orphan's own commitment already used it up
    const r = ctx.run('load_approve', { loadId: L.id });
    assert.equal(r.number, 'MV-001');
    assert.deepEqual([txCount(ctx, 'TrnfrOrd'), txCount(ctx, 'ItemShip')], [1, 1]);
});

test('approve & ship refuses when another request claimed the load first', () => {
    const ctx = setup();
    const { ps, L } = loadAndReady(ctx, 1);
    const origUpdate = ctx.data.updateLoad;
    ctx.data.updateLoad = function(Ld, patch) {
        const result = origUpdate.call(this, Ld, patch);
        if (patch.status === 'shipping') {
            origUpdate.call(this, ctx.data.getLoad(Ld.id), { data: { claim: 'someone-else' } });
        }
        return result;
    };
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /already being/);
    assert.equal(txCount(ctx, 'TrnfrOrd'), 0);
    ctx.data.updateLoad = origUpdate;
    ctx.data.updateLoad(ctx.data.getLoad(L.id), { status: 'ready' });
    ctx.run('load_approve', { loadId: L.id });
    assert.equal(txCount(ctx, 'TrnfrOrd'), 1);
});

test('a claim stolen right before the TO create is caught, not just at the initial flip', () => {
    const ctx = setup();
    const { L } = loadAndReady(ctx, 1);
    const origGetLoad = ctx.data.getLoad;
    let shippingReads = 0;
    ctx.data.getLoad = function (id) {
        const r = origGetLoad.call(this, id);
        if (r && String(r.id) === String(L.id) && r.status === 'shipping') {
            shippingReads++;
            if (shippingReads === 2) return Object.assign({}, r, { data: Object.assign({}, r.data, { claim: 'someone-else' }) });
        }
        return r;
    };
    assert.throws(() => ctx.run('load_approve', { loadId: L.id }), /already being/);
    assert.equal(txCount(ctx, 'TrnfrOrd'), 0);
    ctx.data.getLoad = origGetLoad;
});

// ── Task 10 ──
function shippedLoad(ctx, n, job) {
    const o = loadAndReady(ctx, n, job);
    ctx.run('load_approve', { loadId: o.L.id });
    return o;
}

test('receiving: missing pallets stay in transit; a late arrival gets a second receipt', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 3);
    let r = ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    assert.deepEqual([r.result, r.view.receivedCount, r.view.total, ctx.data.getLoad(L.id).status], ['ok', 1, 3, 'receiving']);
    assert.equal(ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false).result, 'dup');
    ctx.run('scan_recv', { loadId: L.id, raw: ps[1].code }, false);
    ctx.run('recv_damaged', { palletId: ps[1].id, loadId: L.id }, false);
    ctx.run('recv_ready', { loadId: L.id }, false);
    assert.throws(() => ctx.run('recv_approve', { loadId: L.id }, false), /Managers only/);
    const tr = ctx.run('toreceive_list');
    assert.deepEqual([tr.loads.length, tr.loads[0].scanned, tr.loads[0].expected, tr.loads[0].unpostedPieces, tr.loads[0].damaged.length], [1, 2, 3, 240, 1]);
    r = ctx.run('recv_approve', { loadId: L.id });
    assert.deepEqual([r.missing, r.pieces], [1, 240]);
    const receipts = ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt');
    assert.equal(receipts.length, 1);
    assert.deepEqual(receipts[0].lines, { '11': 240 });
    assert.equal(ctx.data.getPallet(ps[2].id).status, 'missing');
    assert.equal(ctx.data.getPallet(ps[0].id).receipt, receipts[0].id);
    assert.equal(ctx.data.getLoad(L.id).status, 'received_short');
    assert.equal(ctx.run('toreceive_list').loads.length, 0);
    r = ctx.run('scan_recv', { loadId: L.id, raw: ps[2].code }, false);
    assert.equal(r.result, 'late');
    const late = ctx.run('toreceive_list').loads;
    assert.deepEqual([late.length, late[0].late, late[0].unpostedPieces], [1, true, 120]);
    ctx.run('recv_approve', { loadId: L.id });
    assert.equal(ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt').length, 2);
    assert.deepEqual(ctx.data.getLoad(L.id).receipts.length, 2);
    assert.equal(ctx.data.getLoad(L.id).status, 'received');
    assert.equal(ctx.data.getPallet(ps[1].id).damaged, true);
});

test('recv_approve on a load with nothing left to receive fails without flipping it to error', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 3);
    ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    ctx.run('scan_recv', { loadId: L.id, raw: ps[1].code }, false);
    ctx.run('recv_ready', { loadId: L.id }, false);
    ctx.run('recv_approve', { loadId: L.id });
    assert.equal(ctx.data.getLoad(L.id).status, 'received_short');
    assert.throws(() => ctx.run('recv_approve', { loadId: L.id }), /Nothing scanned in/);
    assert.equal(ctx.data.getLoad(L.id).status, 'received_short');
});

test('undo returns a scanned pallet; recv_ready needs a scan', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 1);
    assert.throws(() => ctx.run('recv_ready', { loadId: L.id }, false), /nothing scanned in/);
    ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    const r = ctx.run('recv_undo', { palletId: ps[0].id, loadId: L.id }, false);
    assert.equal(r.view.receivedCount, 0);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'shipped');
});

test('a pallet from another shipped load can be received on that load', () => {
    const ctx = setup();
    const a = shippedLoad(ctx, 1, 'Ja');
    const b = shippedLoad(ctx, 1, 'Jb');
    const r = ctx.run('scan_recv', { loadId: a.L.id, raw: b.ps[0].code }, false);
    assert.deepEqual([r.result, r.otherNumber, r.otherLoadId], ['other_load', b.L.number, b.L.id]);
    const o = ctx.run('recv_other', { palletId: b.ps[0].id, otherLoadId: b.L.id, loadId: a.L.id }, false);
    assert.equal(o.result, 'ok');
    assert.equal(o.view.load.id, a.L.id);
    assert.equal(ctx.data.getPallet(b.ps[0].id).status, 'received');
    assert.equal(ctx.data.getLoad(b.L.id).status, 'receiving');
});

test('a receipt crash right after save is retried without a second receipt', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 1);
    ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    ctx.run('recv_ready', { loadId: L.id }, false);
    ctx.tx._t.failNext = 'r_after';
    assert.throws(() => ctx.run('recv_approve', { loadId: L.id }), /crashed after save/);
    assert.equal(ctx.data.getLoad(L.id).status, 'error');
    assert.equal(ctx.run('ship_list').loads.length, 0);
    assert.equal(ctx.run('toreceive_list').loads.length, 1);
    ctx.run('recv_approve', { loadId: L.id });
    assert.equal(ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt').length, 1);
    assert.equal(ctx.data.getLoad(L.id).status, 'received');
});

test('a pallet loaded without an outbound scan is caught up with its own TO, IF and receipt', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1);
    const stray = printLabels(ctx, 1, 'Jstray')[0];
    const r = ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false);
    assert.equal(r.result, 'arrived_unshipped');
    assert.deepEqual([ctx.data.getPallet(stray.id).status, ctx.data.getPallet(stray.id).arrivedOn], ['arrived_unshipped', L.id]);
    assert.equal(ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false).result, 'dup_catchup');
    const list = ctx.run('catchup_list');
    assert.deepEqual([list.pallets.length, list.pallets[0].ok, list.pallets[0].arrivedOnNumber], [1, true, 'MV-001']);
    assert.throws(() => ctx.run('catchup_approve', { palletId: stray.id }, false), /Managers only/);
    const done = ctx.run('catchup_approve', { palletId: stray.id });
    assert.equal(done.number, 'MV-001-C1');
    const p = ctx.data.getPallet(stray.id);
    assert.deepEqual([p.status, p.catchup, !!p.receipt], ['received', true, true]);
    assert.deepEqual([txCount(ctx, 'TrnfrOrd'), txCount(ctx, 'ItemShip'), txCount(ctx, 'ItemRcpt')], [2, 2, 1]);
    assert.equal(ctx.run('catchup_list').pallets.length, 0);
});

test('catchup_approve on an already-finished catch-up is a no-op', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1);
    const stray = printLabels(ctx, 1, 'Jstray')[0];
    ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false);
    ctx.run('catchup_approve', { palletId: stray.id });
    const before = txCount(ctx, 'ItemRcpt');
    const r = ctx.run('catchup_approve', { palletId: stray.id });
    assert.equal(r.receiptNumber, '');
    assert.equal(txCount(ctx, 'ItemRcpt'), before);
});

test('a catch-up that fails to ship stays retryable and never leaks into outbound screens', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1);
    const stray = printLabels(ctx, 1, 'Jstray')[0];
    ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false);
    ctx.data.db.stock['35']['11'].avail = 0;
    assert.throws(() => ctx.run('catchup_approve', { palletId: stray.id }), /Not enough available/);
    const clId = ctx.data.getPallet(stray.id).loadId;
    const list = ctx.run('catchup_list');
    const retryRow = list.pallets.find(x => x.retry);
    assert.ok(retryRow);
    assert.equal(retryRow.ok, true);
    assert.equal(ctx.run('ship_list').loads.some(l => l.id === clId), false);
    assert.throws(() => ctx.run('load_sendback', { loadId: clId }), /Catch-up loads/);
});

test('after restoring stock, a retried catch-up succeeds and does not create a second catch-up load', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1);
    const stray = printLabels(ctx, 1, 'Jstray')[0];
    ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false);
    ctx.data.db.stock['35']['11'].avail = 0;
    assert.throws(() => ctx.run('catchup_approve', { palletId: stray.id }), /Not enough available/);
    ctx.data.db.stock['35']['11'].avail = 1000;
    const done = ctx.run('catchup_approve', { palletId: stray.id });
    assert.equal(done.number, 'MV-001-C1');
    const catchupLoads = Object.values(ctx.data.db.loads).filter(l => l.data.catchupFor);
    assert.equal(catchupLoads.length, 1);
});

test('catch-up is blocked when NetSuite has the stock reserved; reject returns the label', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1);
    const stray = printLabels(ctx, 1, 'Jstray')[0];
    ctx.run('scan_recv', { loadId: L.id, raw: stray.code }, false);
    ctx.data.db.stock['35']['11'].avail = 0;
    assert.equal(ctx.run('catchup_list').pallets[0].ok, false);
    ctx.run('catchup_reject', { palletId: stray.id });
    const p = ctx.data.getPallet(stray.id);
    assert.deepEqual([p.status, p.loadId, p.arrivedOn], ['labeled', '', '']);
});

test('a pallet on a load that was never approved is refused at receiving', () => {
    const ctx = setup();
    const { L } = shippedLoad(ctx, 1, 'Ja');
    const pending = loadAndReady(ctx, 1, 'Jb');
    const r = ctx.run('scan_recv', { loadId: L.id, raw: pending.ps[0].code }, false);
    assert.deepEqual([r.result, r.otherNumber], ['other_load_pending', pending.L.number]);
    assert.equal(ctx.data.getPallet(pending.ps[0].id).status, 'loaded');
});

test('approve receipt refuses when another request claimed the load first', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 1);
    ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    ctx.run('recv_ready', { loadId: L.id }, false);
    const origUpdate = ctx.data.updateLoad;
    ctx.data.updateLoad = function(Ld, patch) {
        const result = origUpdate.call(this, Ld, patch);
        if (patch.status === 'receiving_tx') {
            origUpdate.call(this, ctx.data.getLoad(Ld.id), { data: { claim: 'someone-else' } });
        }
        return result;
    };
    assert.throws(() => ctx.run('recv_approve', { loadId: L.id }), /already being/);
    assert.equal(ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt').length, 0);
    ctx.data.updateLoad = origUpdate;
    ctx.data.updateLoad(ctx.data.getLoad(L.id), { status: 'recv_ready' });
    ctx.run('recv_approve', { loadId: L.id });
    assert.equal(ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt').length, 1);
});

test('undo is refused while the pallet is pinned to a receipt in progress', () => {
    const ctx = setup();
    const { ps, L } = shippedLoad(ctx, 1);
    ctx.run('scan_recv', { loadId: L.id, raw: ps[0].code }, false);
    ctx.run('recv_ready', { loadId: L.id }, false);
    ctx.tx._t.failNext = 'r';
    assert.throws(() => ctx.run('recv_approve', { loadId: L.id }), /R save failed/);
    assert.equal(ctx.data.getLoad(L.id).status, 'error');
    assert.throws(() => ctx.run('recv_undo', { palletId: ps[0].id, loadId: L.id }, false), /can no longer be undone/);
    ctx.tx._t.failNext = null;
    ctx.run('recv_approve', { loadId: L.id });
    assert.equal(ctx.tx._t.calls.filter(x => x.type === 'ItemRcpt').length, 1);
});

// ── Task 11 ──
test('dashboard counts moved, remaining, days and exceptions', () => {
    const ctx = setup();
    shippedLoad(ctx, 2);
    ctx.data.db.stock['35']['11'].onHand = 960;           // NetSuite drops on-hand when the IF ships
    printLabels(ctx, 1, 'Jlater');
    ctx.data.db.pallets[Object.keys(ctx.data.db.pallets).pop()].printedDay = '2026-10-01';   // stale label
    const r = ctx.run('dashboard');
    assert.deepEqual([r.m.moved, r.m.remaining, r.m.total, r.m.movedToday], [2, 18, 20, 2]);
    assert.deepEqual([r.inTransit, r.labeled, r.received], [2, 1, 0]);
    assert.deepEqual(r.days[r.days.length - 1], { day: '2026-10-14', n: 2 });
    assert.equal(r.days[0].day, '2026-10-01');
    assert.deepEqual([r.exc.missing, r.exc.stale, r.exc.noConfig], [0, 1, 0]);
    assert.equal(r.bySku[0].sku, 'YSN301');
    assert.equal(r.loads.length, 1);
    assert.throws(() => ctx.run('dashboard', {}, false), /Managers only/);
});

// ── v3 trucks ──
const L975 = { item: '975', sku: 'YSN100', cfg: 'A', pcs: 12 };
function truckWith(ctx, n, ifId) {
    const ps = printLabels(ctx, n, 'Jt' + n + Math.random().toString(36).slice(2, 6), [L975]);
    const t = ctx.run('truck_start', { ifIds: [ifId || '9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    return { t, ps };
}

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
    const { t, ps } = truckWith(ctx, 42);
    const pv = ctx.run('depart_preview', { truckId: t.id, trailer: '537224', seal: '5249330' }, false);
    assert.deepEqual([pv.truckNo, pv.plan.needsManager, pv.plan.ops.length], [1, false, 1]);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249330' }, false);
    assert.equal(r.departed, true);
    assert.deepEqual([r.view.truck.status, r.view.truck.label, r.view.truck.depart.carrier], ['departed', 'Truck 1 · 10/14', 'Armstrong Group']);
    assert.equal(ctx.tx._t.ops.length, 0);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'in_transit');
    const t2 = truckWith(ctx, 1, '9002').t;                                   // IF9001 is taken by the departed truck
    assert.throws(() => ctx.run('depart_confirm', { truckId: t2.id, trailer: '1', seal: '5249330' }), /already used/);
});

test('depart: short needs a manager; floor request waits; manager approval writes only if_qty in qty mode', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'qty';
    const { t } = truckWith(ctx, 40);
    const w = ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249331' }, false);
    assert.equal(w.waiting, true);
    assert.equal(w.view.truck.pending.seal, '5249331');
    assert.throws(() => ctx.run('truck_scan', { truckId: t.id, raw: 'PLT1' }), /Scanning is closed/);
    const r = ctx.run('depart_confirm', { truckId: t.id }, true);
    assert.equal(r.departed, true);
    assert.deepEqual(ctx.tx._t.ops.map(o => [o.op, o.to]), [['if_qty', 480]]);
    assert.deepEqual(ctx.data.getLoad(t.id).data.writes, { 'if_qty:9001:975': '9001' });
    assert.equal(r.view.truck.bol.changed, true);
});

test('depart: a failed write leaves the truck departing with an error; a manager retry finishes without rewriting', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = truckWith(ctx, 42);
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
    const { t, ps } = truckWith(ctx, 40);
    ctx.tx._t.failOn = 'if_stamp:9001';
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249340' }), /NetSuite write failed/);
    const ld = ctx.data.getLoad(t.id);
    assert.ok(ld.data.error);
    assert.deepEqual(Object.keys(ld.data.writes), ['if_qty:9001:975']);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'loaded');
    assert.equal(ctx.run('depart_retry', { truckId: t.id }).departed, true);
    assert.deepEqual(ctx.tx._t.ops.map(o => o.op), ['if_qty', 'if_stamp']);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'in_transit');
    assert.equal(ctx.data.getLoad(t.id).data.error, '');
});

test('retry is refused while the departure is still running, and on a loading truck', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = truckWith(ctx, 42);
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
    const { t, ps } = truckWith(ctx, 40);
    ctx.tx._t.onApply = () => { ctx.data.updateLoad(ctx.data.getLoad(t.id), { data: { claim: 'stolen' } }); };
    assert.throws(() => ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249342' }), /already being/);
    assert.equal(ctx.tx._t.ops.length, 1);
    assert.equal(ctx.data.getPallet(ps[0].id).status, 'loaded');
});

test('unplanned IF on a departed truck is released back to the planned list', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 42, 'Junp', [L975]);
    const t = ctx.run('truck_start', { ifIds: ['9001', '9002'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    assert.equal(ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249343' }, true).departed, true);
    assert.deepEqual(ctx.run('truck_planned').planned.map(f => f.ifNum), ['IF9002']);
});

test('off mode saves the would-write plan and allocation', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 42);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249344' }, false);
    const d = ctx.data.getLoad(t.id).data;
    assert.ok(d.plan.some(o => o.op === 'if_stamp'));
    assert.equal(d.alloc.find(a => a.ifId === '9001').lines['975'], 504);
});

test('manager approval can override the trailer; the requester is kept', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249345', actor: 'Floor Guy' }, false);
    const r = ctx.run('depart_confirm', { truckId: t.id, trailer: '416460', actor: 'Boss' }, true);
    assert.deepEqual([r.view.truck.depart.trailer, r.view.truck.depart.requestedBy, r.view.truck.depart.approvedBy], ['416460', 'Floor Guy', 'Boss']);
});

test('depart_cancel reopens scanning; move_here is refused from a pending truck', () => {
    const ctx = setup();
    const ps = printLabels(ctx, 3, 'Jcan', [L975]);
    const a = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    const b = ctx.run('truck_start', { ifIds: ['9002'] }).view.truck;
    ctx.run('truck_scan', { truckId: a.id, raw: ps[0].code });
    ctx.run('depart_confirm', { truckId: a.id, trailer: '1', seal: '5249346' }, false);
    assert.throws(() => ctx.run('truck_scan', { truckId: a.id, raw: ps[1].code }), /Scanning is closed/);
    assert.throws(() => ctx.run('truck_move_here', { truckId: b.id, palletId: ps[0].id }), /can no longer be moved/);
    ctx.run('depart_cancel', { truckId: a.id });
    assert.equal(ctx.run('truck_scan', { truckId: a.id, raw: ps[1].code }).result, 'ok');
});

// ── v3 trucks: review round 2 ──
test('double-tap confirm: a second confirm that sees a departed record is refused and changes nothing', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = truckWith(ctx, 42);
    const realGet = ctx.data.getLoad;
    let armed = true;
    // After the confirm's first read, the "other request" has already claimed and saved its plan.
    ctx.data.getLoad = id => {
        const r = realGet(id);
        if (armed && String(id) === String(t.id) && r.status === 'loading') {
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
    const { t } = truckWith(ctx, 42);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: '5249352' });
    const d = ctx.data.getLoad(t.id);
    assert.deepEqual([d.status, d.data.claim, d.data.workingAt, d.data.phase], ['departed', '', 0, '']);
});

// ── v3 unload and receipt approval ──
function departed(ctx, n, seal, ifId) {
    const { t, ps } = truckWith(ctx, n, ifId);
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

test('receipt_approve in on mode writes one receipt per IF with the add-on IF id resolved', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const ps = printLabels(ctx, 2, 'Jon', [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }]).concat(printLabels(ctx, 42, 'Jon2', [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'S9' }, true);
    ps.forEach(p => ctx.run('unload_scan', { truckId: t.id, raw: p.code }, false));
    ctx.run('receipt_approve', { truckId: t.id });
    const rc = ctx.tx._t.ops.filter(o => o.op === 'receipt');
    assert.deepEqual(rc.map(o => [o.ifId, o.toId, JSON.stringify(o.lines)]), [['9001', '500', '{"975":504}'], ['901', '700', '{"11":240}']]);
});

function mixedOnTruck(ctx, seal) {
    const ps = printLabels(ctx, 2, 'Jm' + seal, [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }]).concat(printLabels(ctx, 42, 'Jn' + seal, [L975]));
    const t = ctx.run('truck_start', { ifIds: ['9001'] }).view.truck;
    ps.forEach(p => ctx.run('truck_scan', { truckId: t.id, raw: p.code }));
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
    ctx.tx._t.failOn = 'receipt:901:1';
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }), /Receipt write failed/);
    let x = ctx.data.getLoad(t.id);
    assert.equal(x.status, 'receiving');
    assert.match(x.data.error, /fake failure on receipt:901:1/);
    assert.ok(x.data.writes['receipt:9001:1'] && !x.data.writes['receipt:901:1']);
    assert.equal(x.data.recvSeq, undefined);
    const before = ctx.tx._t.ops.filter(o => o.op === 'receipt').length;
    assert.equal(before, 1);
    ctx.run('receipt_approve', { truckId: t.id });
    const rc = ctx.tx._t.ops.filter(o => o.op === 'receipt');
    assert.deepEqual(rc.map(o => o.ifId), ['9001', '901']);   // 9001 was not repeated
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
    ctx.tx._t.failOn = 'receipt:901:1';
    assert.throws(() => ctx.run('receipt_approve', { truckId: t.id }), /Receipt write failed/);
    assert.equal((ctx.data.getLoad(t.id).data.rplan || []).length, 0);
    ctx.run('receipt_approve', { truckId: t.id });
    assert.deepEqual(ctx.data.getLoad(t.id).data.rplan.map(o => o.ifId + ':' + o.seq), ['9001:1', 'new:700:1']);
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
test('approvals lists pending departures, failed departures and receipts waiting', () => {
    const ctx = setup();
    const { t } = truckWith(ctx, 40);
    ctx.run('depart_confirm', { truckId: t.id, trailer: '537224', seal: 'P1' }, false);
    const d = departed(ctx, 1, 'P2', '9002');
    ctx.run('unload_scan', { truckId: d.t.id, raw: d.ps[0].code }, false);
    ctx.run('unload_done', { truckId: d.t.id }, false);
    const r = ctx.run('approvals');
    assert.deepEqual(r.departures.map(x => [x.truck.id, x.pending.seal, x.plan.corrections]), [[t.id, 'P1', 1]]);
    assert.deepEqual(r.receipts.map(x => [x.truck.id, x.perIf[0].received]), [[d.t.id, 12]]);
    assert.throws(() => ctx.run('approvals', {}, false), /Managers only/);
});

test('approvals surfaces stuck departing trucks (error or stale) and stuck approving trucks', () => {
    const ctx = setup();
    ctx.data.db.settings.writeMode = 'on';
    const { t } = truckWith(ctx, 42);
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

test('approvals: one truck whose plan throws shows an error and does not fail the list', () => {
    const ctx = setup();
    const a = truckWith(ctx, 2, '9001'), b = truckWith(ctx, 2, '9002');
    ctx.run('depart_confirm', { truckId: a.t.id, trailer: '1', seal: 'E1' }, false);
    ctx.run('depart_confirm', { truckId: b.t.id, trailer: '2', seal: 'E2' }, false);
    const orig = ctx.ns.openToLines;
    let n = 0;
    ctx.ns.openToLines = () => { if (++n === 1) throw new Error('snapshot broke'); return orig(); };
    const r = ctx.run('approvals');
    assert.equal(r.departures.length, 2);
    const bad = r.departures.filter(x => x.error), good = r.departures.filter(x => !x.error);
    assert.deepEqual([bad.length, bad[0].error, bad[0].plan, good.length], [1, 'snapshot broke', null, 1]);
    assert.ok(good[0].plan);
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
