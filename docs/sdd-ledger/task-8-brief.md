### Task 8: Suitelet shell and label actions (configs, printing, requests, pallet tools, plan)

**Files:**
- Create: `move_portal/sl_move_portal.js`
- Test: `move_portal/test/portal.test.js`

**Interfaces:**
- Consumes:
  - `move_core` (Tasks 1–4)
  - `move_data` and `move_tx` APIs (Tasks 6–7)
  - `tpl.labelsXml` / `tpl.loadSheetXml` (Task 5)
  - `ui.buildPage(boot)` (Task 12)
- Produces:
  - `onRequest(ctx)`
  - `_runAction(action, body, isManager) → result object`. Test hook; the JSON response is `{ok:true, ...result}`.
  - Actions in this task:
    - config: `item_lookup`, `cfg_list`, `cfg_preview`, `cfg_commit_chunk`, `cfg_activate`, `cfg_cleanup`
    - printing and requests: `print_chunk`, `req_create`, `req_list`, `req_print`, `req_cancel`
    - pallet tools and plan: `pallet_get`, `pallet_void`, `pallet_reprint`, `pallet_relabel`, `plan`
  - PDF: GET `action=pdf&job=<job>[&header=1]` or `action=pdf&ids=<id,id>` (manager only).
- Internal helpers later tasks reuse:
  - `userErr(msg)`, `pubPallet(p, extra)`, `pubLoad(L, counts)`, `countsFromPallets(pallets)`
  - `mustLoad(id)`, `mustPallet(id)`, `stale(L)`
  - `normalizeLines(lines, S)`, `lineFields(lines, S)`, `createPalletsForJob(job, lines, upTo, source, c)`
  - `stockModel(c)`, `tracker(c, est)`, and `act(name, managerOnly, fn(a, c))`
  - `c` is `{mgr, S:settings, actor, now:{stamp, dayIso, hour}}`.

- [ ] **Step 1: Write the failing tests**

```js
// move_portal/test/portal.test.js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `ENOENT ... sl_move_portal.js`.

- [ ] **Step 3: Write `sl_move_portal.js`.** Tasks 9–11 add more `act(...)` blocks at the marked spot.

```js
/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Move Portal (Riverside -> Tippecanoe warehouse move). A separate app from the
 * picker portal; shares no code with it.
 * Spec: docs/superpowers/specs/2026-09-27-move-portal-design.md
 */
define(['N/runtime', 'N/log', 'N/render', 'N/url', 'N/format',
        './move_core', './move_data', './move_tx', './move_label_template', './move_ui'],
function (runtime, log, render, url, format, core, data, tx, tpl, ui) {
    'use strict';

    const P = core.PALLET, L = core.LOAD;
    const MANAGER_ROLE_SCRIPT_IDS = ['customrole_warehouse_manager', 'customrole1009', 'customrole2522', 'customrole_warehouse_portal_manager'];
    const PRINT_CHUNK_MAX = 80;
    const CFG_CHUNK_MAX = 100;
    const STALE_MS = 2 * 60 * 1000;

    // ── shared helpers ───────────────────────────────────────────────────
    function userErr(msg) { const e = new Error(msg); e.user = true; return e; }

    function isManager() {
        const u = runtime.getCurrentUser();
        const role = String(u.roleId || '').toLowerCase();
        if (role === 'administrator' || Number(u.role) === 3 || MANAGER_ROLE_SCRIPT_IDS.indexOf(role) !== -1) return true;
        return data.employeeIsPortalManager(u.id);
    }

    function nowInfo() {
        const stamp = format.format({ value: new Date(), type: format.Type.DATETIMETZ, timezone: format.Timezone.AMERICA_LOS_ANGELES });
        const p = core.parseNsStamp(stamp);
        return { stamp: stamp, dayIso: p ? p.dayIso : new Date().toISOString().slice(0, 10), hour: p ? p.hour : 12 };
    }

    function settings() {
        const S = data.getSettings();
        if (!S.locFrom || !S.locTo) throw userErr('Move settings are missing locFrom/locTo. Ask an admin to fill in the Move Settings record.');
        return S;
    }

    function pubPallet(p, extra) {
        return Object.assign({ id: p.id, code: p.code, status: p.status, summary: p.summary, headline: core.headline(p.lines),
            pieces: p.pieces, edited: p.edited, damaged: p.damaged, catchup: p.catchup, lines: p.lines, loadId: p.loadId,
            printedAt: p.data.printedAt || '', receipt: p.receipt }, extra || {});
    }

    function countsFromPallets(ps) {
        const out = {};
        ps.forEach(p => { const o = out[p.status] = out[p.status] || { n: 0, pcs: 0 }; o.n++; o.pcs += p.pieces; });
        return out;
    }

    function pubLoad(Ld, counts) {
        const d = Ld.data || {}, cs = counts || {};
        const n = st => (cs[st] ? cs[st].n : 0);
        const pcs = st => (cs[st] ? cs[st].pcs : 0);
        const onTruck = [P.LOADED, P.SHIPPED, P.RECEIVED, P.MISSING];
        return { id: Ld.id, number: Ld.number, status: Ld.status, door: d.door || '', carrier: d.carrier || '', trailer: d.trailer || '',
            seal: d.seal || '', to: Ld.to, if: Ld.if, error: d.error || '', readyBy: d.readyBy || '', readyAt: d.readyAt || '',
            approvedAt: d.approvedAt || '', approvedBy: d.approvedBy || '', catchupFor: d.catchupFor || '',
            pallets: onTruck.reduce((a, s) => a + n(s), 0), pieces: onTruck.reduce((a, s) => a + pcs(s), 0), received: n(P.RECEIVED) };
    }

    function mustLoad(id) { const Ld = data.getLoad(id); if (!Ld) throw userErr('Load not found'); return Ld; }
    function mustPallet(id) { const p = data.getPallet(id); if (!p) throw userErr('Label not found'); return p; }
    function stale(Ld) { return Date.now() - (Number(Ld.data.workingAt) || 0) > STALE_MS; }

    // Client lines are only trusted for item, cfg and pcs; SKU and description come from NetSuite.
    function normalizeLines(lines, S) {
        const err = core.validateLines(lines);
        if (err) throw userErr(err);
        const info = data.itemInfo(lines.map(l => l.item));
        const cfg = data.configsByItem(S.activeBatch);
        return lines.map(l => {
            const i = info[String(l.item)];
            if (!i) throw userErr('Unknown item ' + (l.sku || l.item));
            const cs = cfg[String(l.item)] || [];
            return { item: String(l.item), sku: i.sku, desc: i.desc, cfg: cs.some(x => x.code === l.cfg) ? l.cfg : '', pcs: Math.floor(Number(l.pcs)) };
        });
    }

    function lineFields(lines, S) {
        return { summary: core.summarize(lines), pieces: core.totalPieces(lines),
            edited: core.isEdited(lines, core.pcsMap(data.configsByItem(S.activeBatch))) };
    }

    // Idempotent: creates only the labels still missing to reach `upTo` for this job.
    function createPalletsForJob(job, lines, upTo, source, c) {
        const target = Math.floor(Number(upTo)) || 0;
        const existing = data.countByJob(job);
        const n = target - existing;
        if (n > PRINT_CHUNK_MAX) throw userErr('Too many labels in one request (max ' + PRINT_CHUNK_MAX + ')');
        const f = lineFields(lines, c.S);
        for (let i = 0; i < n; i++) {
            data.createPallet(Object.assign({ status: P.LABELED, job: job, printedDay: c.now.dayIso }, f,
                { lines: lines, data: { source: source, printedAt: c.now.stamp, printedBy: c.actor, printCount: 1 } }));
        }
        return Math.max(existing, target);
    }

    function stockModel(c) {
        const stock = data.locationStock(c.S.locFrom, null);
        const cfg = data.configsByItem(c.S.activeBatch);
        const onHand = {};
        Object.keys(stock).forEach(k => { onHand[k] = stock[k].onHand; });
        return { stock: stock, cfg: cfg, est: core.estimateRemaining(onHand, core.defaultPcs(cfg)) };
    }

    function tracker(c, est) {
        const moved = data.movedByDay();
        const todayDone = (moved[c.now.dayIso] || 0) > 0 && c.now.hour >= 15;
        return core.trackerMetrics({ todayIso: c.now.dayIso, targetIso: c.S.target, startIso: c.S.start, skipDates: c.S.skip || [],
            remaining: est.pallets, movedByDay: moved, todayDone: todayDone });
    }

    // ── actions ──────────────────────────────────────────────────────────
    const A = {};
    function act(name, managerOnly, fn) { A[name] = { m: managerOnly, fn: fn }; }

    // items and configs
    act('item_lookup', false, (a, c) => {
        const q = String(a.q || '').trim();
        if (!q) return { items: [] };
        const items = data.itemLookup(q);
        const stock = data.locationStock(c.S.locFrom, items.map(i => i.item));
        const cfg = data.configsByItem(c.S.activeBatch);
        const exact = i => (i.sku.toUpperCase() === q.toUpperCase() || i.upc === q ? 0 : 1);
        items.sort((x, y) => exact(x) - exact(y));
        return { items: items.map(i => Object.assign({}, i, { onHand: stock[i.item] ? stock[i.item].onHand : 0, cfgs: cfg[i.item] || [] })) };
    });

    act('cfg_list', true, (a, c) => {
        const cfg = data.configsByItem(c.S.activeBatch);
        const stock = data.locationStock(c.S.locFrom, null);
        const info = data.itemInfo(Object.keys(cfg));
        const rows = Object.keys(cfg).map(item => {
            const def = cfg[item].find(x => x.isDefault) || cfg[item][0];
            const onHand = stock[item] ? stock[item].onHand : 0;
            return { item: item, sku: info[item] ? info[item].sku : item, desc: info[item] ? info[item].desc : '', cfgs: cfg[item],
                onHand: onHand, estPallets: def && onHand > 0 ? Math.ceil(onHand / def.pcs) : 0 };
        }).sort((x, y) => y.onHand - x.onHand);
        const noConfig = Object.keys(stock).filter(k => !cfg[k] && stock[k].onHand > 0).map(k => ({ item: k, sku: stock[k].sku }));
        return { rows: rows, noConfig: noConfig, activeBatch: c.S.activeBatch };
    });

    act('cfg_preview', true, (a, c) => {
        const rows = core.parseCsv(a.csv);
        if (!rows.length) throw userErr('The CSV is empty');
        const imp = core.buildConfigImport(rows, data.skuMap());
        const stock = data.locationStock(c.S.locFrom, null);
        const has = {}, skus = {};
        imp.configs.forEach(x => { has[x.item] = 1; skus[x.sku] = 1; });
        return { configs: imp.configs, errors: imp.errors, unknownSkus: imp.unknownSkus, skuCount: Object.keys(skus).length,
            noConfigWithStock: Object.keys(stock).filter(k => !has[k] && stock[k].onHand > 0).map(k => stock[k].sku) };
    });

    act('cfg_commit_chunk', true, (a, c) => {
        const batch = String(a.batch || '');
        const list = Array.isArray(a.configs) ? a.configs : [];
        if (!/^B\d+$/.test(batch)) throw userErr('Bad batch id');
        if (list.length > CFG_CHUNK_MAX) throw userErr('Too many configs in one request');
        const start = Math.floor(Number(a.upTo)) - list.length;
        const skip = Math.max(0, data.countConfigsInBatch(batch) - start);
        list.slice(skip).forEach(x => {
            const pcs = Math.floor(Number(x.pcs));
            if (!x.item || !x.code || !(pcs > 0)) throw userErr('Bad config row for ' + (x.sku || x.item));
            data.createConfig({ item: String(x.item), code: String(x.code).toUpperCase(), pcs: pcs, isDefault: !!x.isDefault }, batch);
        });
        return { written: data.countConfigsInBatch(batch) };
    });

    act('cfg_activate', true, (a) => {
        const batch = String(a.batch || '');
        if (!data.countConfigsInBatch(batch)) throw userErr('That import batch has no configs');
        data.saveSettings({ activeBatch: batch });
        return {};
    });

    act('cfg_cleanup', true, (a, c) => {
        if (!c.S.activeBatch || String(a.batch) !== c.S.activeBatch) throw userErr('Activate the batch before cleanup');
        return { remaining: data.deleteConfigsNotInBatch(c.S.activeBatch, 150) };
    });

    // printing and label requests
    act('print_chunk', true, (a, c) => {
        const job = String(a.job || '');
        if (!/^J[a-z0-9]+$/i.test(job)) throw userErr('Bad print job id');
        const lines = normalizeLines(a.lines, c.S);
        const src = a.source === 'plan' ? 'plan' : 'office';
        return { created: createPalletsForJob(job, lines, a.upTo, src, c) };
    });

    function pubReq(q) {
        const d = q.data || {};
        return { id: q.id, status: q.status, requester: q.requester, summary: core.summarize(d.lines || []), count: d.count || 1,
            note: d.note || '', via: d.via || 'phone', at: d.at || '', job: d.job || '' };
    }

    act('req_create', false, (a, c) => {
        const lines = normalizeLines(a.lines, c.S);
        const count = Math.floor(Number(a.count) || 1);
        if (count < 1 || count > 50) throw userErr('Request 1 to 50 labels');
        const radio = c.mgr && a.via === 'radio';
        const requester = radio ? String(a.requester || '').trim().slice(0, 60) : c.actor;
        if (!requester) throw userErr('Enter who called it in');
        const id = data.createReq({ status: 'queued', requester: requester,
            data: { lines: lines, count: count, note: String(a.note || '').slice(0, 200), via: radio ? 'radio' : 'phone', at: c.now.stamp } });
        return { id: id };
    });

    act('req_list', false, (a, c) => {
        if (!a.mine && !c.mgr) throw userErr('Managers only');
        const q = a.mine ? { requester: c.actor, limit: 20 } : { status: a.status === 'queued' ? 'queued' : null, limit: 100 };
        return { reqs: data.findReqs(q).map(pubReq) };
    });

    act('req_print', true, (a, c) => {
        const q = data.getReq(a.reqId);
        if (!q) throw userErr('Request not found');
        if (q.status === 'cancelled') throw userErr('That request was cancelled');
        const job = 'R' + q.id;
        createPalletsForJob(job, q.data.lines, q.data.count || 1, 'request:' + q.id, c);
        if (q.status !== 'printed') data.updateReq(q, { status: 'printed', data: { job: job, printedAt: c.now.stamp, printedBy: c.actor } });
        return { job: job };
    });

    act('req_cancel', false, (a, c) => {
        const q = data.getReq(a.reqId);
        if (!q) throw userErr('Request not found');
        if (!c.mgr && q.requester !== c.actor) throw userErr('Only the requester or a manager can cancel');
        if (q.status !== 'queued') throw userErr('Only queued requests can be cancelled');
        data.updateReq(q, { status: 'cancelled' });
        return {};
    });

    // pallet tools
    act('pallet_get', false, (a, c) => {
        const sc = core.parseScan(a.code);
        if (!sc.palletId) throw userErr('Not a move label: ' + sc.raw);
        const p = mustPallet(sc.palletId);
        const Ld = p.loadId ? data.getLoad(p.loadId) : null;
        const cfg = data.configsByItem(c.S.activeBatch);
        const edLines = p.lines.map(l => ({ item: l.item, sku: l.sku, desc: l.desc || '', onHand: null, cfgs: cfg[l.item] || [], cfg: l.cfg, pcs: l.pcs }));
        return { pallet: pubPallet(p, { loadNumber: Ld ? Ld.number : '', edLines: edLines }) };
    });

    act('pallet_void', false, (a, c) => {
        const p = mustPallet(a.palletId);
        if (p.status !== P.LABELED) throw userErr(p.code + ' is ' + p.status + '. Only labels not on a load can be voided.');
        data.updatePallet(p, { status: P.VOID, data: { voidReason: String(a.reason || '').slice(0, 60), voidedBy: c.actor, voidedAt: c.now.stamp } });
        return {};
    });

    act('pallet_reprint', true, (a) => {
        const p = mustPallet(a.palletId);
        if (p.status === P.VOID) throw userErr(p.code + ' is voided');
        data.updatePallet(p, { data: { printCount: (Number(p.data.printCount) || 1) + 1 } });
        return { ids: [p.id] };
    });

    act('pallet_relabel', true, (a, c) => {
        const p = mustPallet(a.palletId);
        const job = 'RL' + p.id;
        let np = data.palletsByJob(job)[0];
        if (!np) {
            if (p.status !== P.LABELED) throw userErr(p.code + ' is ' + p.status + '. Fix loaded pallets with Edit on the Load screen.');
            createPalletsForJob(job, normalizeLines(a.lines, c.S), 1, 'relabel:' + p.id, c);
            np = data.palletsByJob(job)[0];
        }
        if (p.status !== P.VOID) {
            data.updatePallet(p, { status: P.VOID, data: { voidReason: 'relabeled', replacedBy: np.id, voidedBy: c.actor, voidedAt: c.now.stamp } });
        }
        return { job: job, code: np.code };
    });

    act('plan', true, (a, c) => {
        const sm = stockModel(c);
        const m = tracker(c, sm.est);
        const labeled = data.labeledPiecesByItem();
        const rows = [], noConfig = [];
        Object.keys(sm.stock).forEach(item => {
            const st = sm.stock[item];
            if (st.onHand <= 0) return;
            const cs = sm.cfg[item];
            const def = cs && (cs.find(x => x.isDefault) || cs[0]);
            if (!def) { noConfig.push({ item: item, sku: st.sku }); return; }
            const lab = labeled[item] || 0;
            rows.push({ item: item, sku: st.sku, desc: st.desc, cfg: def.code, pcs: def.pcs,
                palletsLeft: Math.ceil(Math.max(0, st.onHand - lab) / def.pcs), labeled: Math.ceil(lab / def.pcs) });
        });
        const labeledPallets = rows.reduce((x, r) => x + r.labeled, 0);
        const need = isFinite(m.neededPerDay) ? m.neededPerDay : m.remaining;
        const sugg = core.suggestPlan(rows.filter(r => r.palletsLeft > 0), Math.max(0, need - labeledPallets));
        rows.forEach(r => { r.suggest = sugg[r.item] || 0; });
        rows.sort((x, y) => y.palletsLeft - x.palletsLeft);
        return { dayLabel: c.now.dayIso, neededPerDay: isFinite(m.neededPerDay) ? m.neededPerDay : null, labeledPallets: labeledPallets,
            rows: rows.filter(r => r.palletsLeft > 0 || r.labeled > 0), noConfig: noConfig };
    });

    // ── (Tasks 9–11 add more act(...) blocks here) ──

    // ── entry points ─────────────────────────────────────────────────────
    function runAction(action, a, mgr) {
        const def = A[action];
        if (!def) throw userErr('Unknown action: ' + action);
        if (def.m && !mgr) throw userErr('Managers only');
        data.resetCache();
        const body = a || {};
        const c = { mgr: !!mgr, S: settings(), now: nowInfo(),
            actor: String(body.actor || '').trim().slice(0, 60) || runtime.getCurrentUser().name };
        return def.fn(body, c) || {};
    }

    function onRequest(ctx) {
        const q = ctx.request.parameters;
        if (!q.action) return page(ctx);
        if (q.action === 'pdf') return pdf(ctx);
        let out;
        try {
            let a = {};
            try { a = JSON.parse(ctx.request.body || '{}') || {}; } catch (e) { a = {}; }
            out = Object.assign({ ok: true }, runAction(q.action, a, isManager()));
        } catch (e) {
            if (!e.user) log.error({ title: 'move ' + q.action, details: (e && e.stack) || String(e) });
            out = { ok: false, error: e.user ? e.message : 'Error: ' + (e.message || e.name || String(e)) };
        }
        ctx.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        ctx.response.write(JSON.stringify(out));
    }

    function page(ctx) {
        const S = data.getSettings();
        const script = runtime.getCurrentScript();
        ctx.response.write(ui.buildPage({
            url: url.resolveScript({ scriptId: script.id, deploymentId: script.deploymentId }),
            mode: isManager() ? 'manager' : 'floor', me: runtime.getCurrentUser().name, roster: S.roster || [],
            fromName: S.fromName, toName: S.toName, maxPrint: Number(S.maxPrint) || 250
        }));
    }

    function loadSheetModel(Ld, S) {
        const ps = data.palletsByLoad(Ld.id, [P.LOADED, P.SHIPPED, P.RECEIVED, P.MISSING]);
        const t = data.tranids([Ld.to, Ld.if].filter(Boolean));
        const tot = {}, sku = {};
        ps.forEach(p => p.lines.forEach(l => { tot[l.item] = (tot[l.item] || 0) + l.pcs; sku[l.item] = l.sku; }));
        const d = Ld.data || {};
        return { number: Ld.number, fromName: S.fromName, toName: S.toName, toNumber: t[Ld.to] || '', ifNumber: t[Ld.if] || '',
            door: d.door || '', carrier: d.carrier || '', trailer: d.trailer || '', seal: d.seal || '',
            approvedAt: d.approvedAt || '', approvedBy: d.approvedBy || '',
            pallets: ps.map(p => ({ code: p.code, summary: p.summary, pieces: p.pieces })),
            totals: Object.keys(tot).map(k => ({ sku: sku[k], qty: tot[k] })).sort((x, y) => (x.sku < y.sku ? -1 : 1)) };
    }

    function pdf(ctx) {
        const q = ctx.request.parameters;
        if (!isManager()) { ctx.response.write('Managers only'); return; }
        const S = data.getSettings();
        let xml;
        if (q.type === 'loadsheet') {
            const Ld = data.getLoad(q.loadId);
            if (!Ld) { ctx.response.write('Load not found'); return; }
            xml = tpl.loadSheetXml(loadSheetModel(Ld, S));
        } else {
            const ps = q.job ? data.palletsByJob(String(q.job)).filter(p => p.status !== P.VOID) : data.palletsByIds(String(q.ids || '').split(','));
            if (!ps.length) { ctx.response.write('No labels to print'); return; }
            xml = tpl.labelsXml(ps.map(p => ({ code: p.code, lines: p.lines, pieces: p.pieces, edited: p.edited, printedDay: p.printedDay,
                by: p.data.printedBy || '', summary: p.summary })), { codeMode: S.labelCode, header: q.header === '1', fromName: S.fromName, toName: S.toName });
        }
        ctx.response.writeFile({ file: render.xmlToPdf({ xmlString: xml }), isInline: true });
    }

    return { onRequest: onRequest, _runAction: runAction };
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 33 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/sl_move_portal.js move_portal/test/portal.test.js
git commit -m "feat(move): suitelet shell with configs, printing, requests, pallet tools, plan"
```

---

