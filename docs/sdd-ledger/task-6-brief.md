### Task 6: Data layer (`move_data.js`) and its in-memory fake

**Files:**
- Create: `move_portal/move_data.js`
- Create: `move_portal/test/fake_data.js`
- Test: `move_portal/test/fake_data.test.js`

The real module can only run in NetSuite. Its twin, `fake_data.js`, has the **identical API** and is what the Suitelet tests in Tasks 8–11 run against. Any change to one must be made to the other.

**Interfaces:**
- **Object shapes**
  - **pallet:** `{id:Number, code, status, loadId:String, job, receipt, shippedDay, printedDay, arrivedOn:String, damaged, catchup, edited, summary, pieces, lines, data}`
  - **load:** `{id:String, number, status, to:String, if:String, receipts:String[], data}`
  - **req:** `{id:String, status, requester, data}`
- **Settings / users**
  - `resetCache()`
  - `getSettings() → settings (+ _id)`
  - `saveSettings(patch)`
  - `employeeIsPortalManager(uid)`
- **Items / stock**
  - `itemLookup(q) → [{item, sku, desc, upc}]`
  - `itemInfo(ids) → {item: {item, sku, desc, upc}}`
  - `skuMap() → {SKU_UPPER: itemId}`
  - `locationStock(locId, itemIds|null) → {item: {item, sku, desc, upc, onHand, avail}}`. `null` means every item with on-hand > 0.
- **Configs**
  - `configsByItem(batch) → {item: [{code, pcs, isDefault}]}`
  - `countConfigsInBatch(batch)`
  - `createConfig(cfg, batch)`
  - `deleteConfigsNotInBatch(batch, max) → remaining`
- **Pallets**
  - `getPallet(id)`, `palletsByIds(ids)`, `palletsByJob(job)`, `palletsByStatus(statuses)`, `palletsByLoad(loadId, statuses|null)`. All lists are sorted by id ascending.
  - `countByJob(job)`
  - `createPallet(patch) → id`
  - `updatePallet(pallet, patch)`. `patch` keys are pallet field names plus `lines` and a `data` object that is merged into the existing data.
  - `labeledPiecesByItem() → {item: pcs}`
  - `movedByDay() → {iso: count}`
  - `palletCountsByLoad(loadIds) → {loadId: {status: {n, pcs}}}`
  - `findPalletsWhere(q)`, `countPallets(q)`. `q` is `{status?:[], receiptEmpty?, damaged?, catchup?, edited?, shippedSince?:iso, printedBefore?:iso}`.
- **Loads**
  - `getLoad(id)`, `getLoads(ids)`
  - `loadsByStatus(statuses, limit?)`, sorted id descending
  - `recentLoads(limit)`, `loadsByNumber(number)`, `allLoadNumbers()`
  - `createLoad(patch) → id`
  - `updateLoad(load, patch)`. `patch` keys are `number, status, to, if, receipts:[]` plus a merged `data` object.
- **Scans / requests / transactions**
  - `logScan({pallet, load, result, data})`
  - `createReq(patch) → id`, `getReq(id)`
  - `findReqs({requester?, status?, limit})`, sorted id descending
  - `updateReq(req, patch)`
  - `tranids(ids) → {id: tranid}`

- [ ] **Step 1: Write the failing fake test** (it checks the merge semantics the Suitelet relies on)

```js
// move_portal/test/fake_data.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const { makeFakeData } = require('./fake_data');

test('fake data: pallet create/update merges data and exposes lines', () => {
    const d = makeFakeData(core);
    const id = d.createPallet({ status: 'labeled', job: 'J1', summary: 's', pieces: 5, lines: [{ item: '11', sku: 'X', cfg: 'A', pcs: 5 }], data: { source: 'plan' } });
    let p = d.getPallet(id);
    assert.equal(p.code, 'PLT' + id);
    assert.equal(p.loadId, '');
    assert.deepEqual(p.lines, [{ item: '11', sku: 'X', cfg: 'A', pcs: 5 }]);
    d.updatePallet(p, { status: 'loaded', load: '7', data: { loadedBy: 'M' } });
    p = d.getPallet(id);
    assert.equal(p.status, 'loaded');
    assert.equal(p.loadId, '7');
    assert.equal(p.data.source, 'plan');
    assert.equal(p.data.loadedBy, 'M');
    assert.equal(d.palletsByLoad('7', ['loaded']).length, 1);
    assert.equal(d.countPallets({ status: ['loaded'] }), 1);
    assert.equal(d.countByJob('J1'), 1);
});

test('fake data: loads keep string ids and merge data', () => {
    const d = makeFakeData(core);
    const id = d.createLoad({ number: 'MV-001', status: 'loading', data: { door: '4' } });
    assert.equal(typeof id, 'string');
    let L = d.getLoad(id);
    d.updateLoad(L, { status: 'ready', receipts: ['9'], data: { readyBy: 'M' } });
    L = d.getLoad(id);
    assert.deepEqual([L.status, L.receipts, L.data.door, L.data.readyBy], ['ready', ['9'], '4', 'M']);
    assert.deepEqual(d.allLoadNumbers(), ['MV-001']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `Cannot find module './fake_data'`.

- [ ] **Step 3: Write `test/fake_data.js`**

```js
// move_portal/test/fake_data.js
// In-memory stand-in for move_data.js. Keep the API identical to the real module.
function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

function makeFakeData(core) {
    const db = {
        settings: { locFrom: '35', locTo: '99', fromName: 'Riverside', toName: 'Tippecanoe', target: '2026-11-15', start: '2026-10-01',
            skip: [], labelCode: 'both', roster: ['Miguel'], maxPrint: 250, staleDays: 5, toStatus: 'B', activeBatch: 'B1' },
        items: [], stock: {}, configs: [], pallets: {}, loads: {}, scans: [], reqs: {}, tranids: {}, seq: 100
    };
    const nextId = () => ++db.seq;
    const PKEYS = ['status', 'load', 'job', 'receipt', 'shippedDay', 'printedDay', 'arrivedOn', 'damaged', 'catchup', 'edited', 'summary', 'pieces'];

    function toPallet(r) {
        const p = clone(r);
        p.code = core.palletCode(p.id);
        p.loadId = String(p.load || '');
        p.arrivedOn = String(p.arrivedOn || '');
        p.lines = p.data.lines || [];
        delete p.load;
        return p;
    }
    function applyPallet(r, patch, base) {
        PKEYS.forEach(k => { if (k in patch) r[k] = patch[k] == null ? '' : clone(patch[k]); });
        if (patch.data || patch.lines) {
            r.data = Object.assign({}, base ? clone(base.data) : {}, clone(patch.data || {}));
            if (patch.lines) r.data.lines = clone(patch.lines);
        }
    }
    function toLoad(r) { return clone(r); }
    function applyLoad(r, patch, base) {
        ['number', 'status', 'to', 'if'].forEach(k => { if (k in patch) r[k] = patch[k] == null ? '' : String(patch[k]); });
        if (patch.receipts) r.receipts = patch.receipts.map(String);
        if (patch.data) r.data = Object.assign({}, base ? clone(base.data) : {}, clone(patch.data));
    }
    function matchQ(p, q) {
        if (q.status && q.status.indexOf(p.status) === -1) return false;
        if (q.receiptEmpty && p.receipt) return false;
        if (q.damaged && !p.damaged) return false;
        if (q.catchup && !p.catchup) return false;
        if (q.edited && !p.edited) return false;
        if (q.shippedSince && !(p.shippedDay && p.shippedDay >= q.shippedSince)) return false;
        if (q.printedBefore && !(p.printedDay && p.printedDay < q.printedBefore)) return false;
        return true;
    }
    const pallets = () => Object.values(db.pallets).sort((a, b) => a.id - b.id);
    const loadsDesc = () => Object.values(db.loads).sort((a, b) => Number(b.id) - Number(a.id));

    return {
        db,
        resetCache() {},
        getSettings: () => Object.assign(clone(db.settings), { _id: '1' }),
        saveSettings: patch => { Object.assign(db.settings, clone(patch)); },
        employeeIsPortalManager: () => false,

        itemLookup: q => db.items.filter(i => i.sku.toUpperCase().indexOf(q.toUpperCase()) !== -1 || i.upc === q).map(clone),
        itemInfo: ids => { const o = {}; ids.map(String).forEach(id => { const i = db.items.find(x => x.item === id); if (i) o[id] = clone(i); }); return o; },
        skuMap: () => { const o = {}; db.items.forEach(i => { o[i.sku.toUpperCase()] = i.item; }); return o; },
        locationStock: (loc, ids) => {
            const s = db.stock[loc] || {}, o = {};
            Object.keys(s).forEach(k => {
                if (ids ? ids.map(String).indexOf(k) === -1 : !(s[k].onHand > 0)) return;
                const i = db.items.find(x => x.item === k) || { item: k, sku: k, desc: '', upc: '' };
                o[k] = Object.assign(clone(i), { onHand: s[k].onHand, avail: s[k].avail });
            });
            return o;
        },

        configsByItem: batch => {
            const o = {};
            db.configs.filter(c => c.batch === batch).forEach(c => { (o[c.item] = o[c.item] || []).push({ code: c.code, pcs: c.pcs, isDefault: c.isDefault }); });
            return o;
        },
        countConfigsInBatch: b => db.configs.filter(c => c.batch === b).length,
        createConfig: (c, b) => { db.configs.push(Object.assign({ id: nextId(), batch: b }, clone(c))); },
        deleteConfigsNotInBatch: (b, max) => {
            let n = 0;
            db.configs = db.configs.filter(c => { if (c.batch !== b && n < max) { n++; return false; } return true; });
            return db.configs.filter(c => c.batch !== b).length;
        },

        getPallet: id => (db.pallets[Number(id)] ? toPallet(db.pallets[Number(id)]) : null),
        palletsByIds: ids => pallets().filter(p => ids.map(Number).indexOf(p.id) !== -1).map(toPallet),
        palletsByJob: job => pallets().filter(p => p.job === job).map(toPallet),
        palletsByStatus: st => pallets().filter(p => st.indexOf(p.status) !== -1).map(toPallet),
        palletsByLoad: (loadId, st) => pallets().filter(p => String(p.load) === String(loadId) && (!st || st.indexOf(p.status) !== -1)).map(toPallet),
        countByJob: job => pallets().filter(p => p.job === job).length,
        createPallet: patch => {
            const id = nextId();
            const r = { id, data: {}, load: '', arrivedOn: '', receipt: '', job: '', shippedDay: '', printedDay: '', damaged: false, catchup: false, edited: false, summary: '', pieces: 0, status: '' };
            applyPallet(r, patch, null);
            db.pallets[id] = r;
            return id;
        },
        updatePallet: (p, patch) => { applyPallet(db.pallets[p.id], patch, p); },
        labeledPiecesByItem: () => {
            const o = {};
            pallets().filter(p => p.status === 'labeled').forEach(p => (p.data.lines || []).forEach(l => { o[l.item] = (o[l.item] || 0) + l.pcs; }));
            return o;
        },
        movedByDay: () => { const o = {}; pallets().filter(p => p.shippedDay).forEach(p => { o[p.shippedDay] = (o[p.shippedDay] || 0) + 1; }); return o; },
        palletCountsByLoad: ids => {
            const o = {}, want = ids.map(String);
            pallets().filter(p => want.indexOf(String(p.load)) !== -1).forEach(p => {
                const l = o[p.load] = o[p.load] || {};
                const s = l[p.status] = l[p.status] || { n: 0, pcs: 0 };
                s.n++; s.pcs += p.pieces;
            });
            return o;
        },
        findPalletsWhere: q => pallets().filter(p => matchQ(p, q)).map(toPallet),
        countPallets: q => pallets().filter(p => matchQ(p, q)).length,

        getLoad: id => (db.loads[String(id)] ? toLoad(db.loads[String(id)]) : null),
        getLoads: ids => ids.map(String).filter(id => db.loads[id]).map(id => toLoad(db.loads[id])),
        loadsByStatus: (st, limit) => loadsDesc().filter(l => st.indexOf(l.status) !== -1).slice(0, limit || 1e9).map(toLoad),
        recentLoads: limit => loadsDesc().slice(0, limit).map(toLoad),
        loadsByNumber: n => loadsDesc().filter(l => l.number === n).map(toLoad),
        allLoadNumbers: () => Object.values(db.loads).map(l => l.number),
        createLoad: patch => {
            const id = String(nextId());
            const r = { id, number: '', status: '', to: '', if: '', receipts: [], data: {} };
            applyLoad(r, patch, null);
            db.loads[id] = r;
            return id;
        },
        updateLoad: (L, patch) => { applyLoad(db.loads[L.id], patch, L); },

        logScan: s => { db.scans.push(clone(s)); },
        createReq: patch => { const id = String(nextId()); db.reqs[id] = Object.assign({ id, data: {} }, clone(patch)); return id; },
        getReq: id => (db.reqs[String(id)] ? clone(db.reqs[String(id)]) : null),
        findReqs: q => Object.values(db.reqs)
            .filter(r => (!q.requester || r.requester === q.requester) && (!q.status || r.status === q.status))
            .sort((a, b) => Number(b.id) - Number(a.id)).slice(0, q.limit || 100).map(clone),
        updateReq: (r, patch) => {
            const s = db.reqs[r.id];
            if ('status' in patch) s.status = patch.status;
            if (patch.data) s.data = Object.assign({}, clone(r.data), clone(patch.data));
        },
        tranids: ids => { const o = {}; ids.filter(Boolean).forEach(id => { o[id] = db.tranids[id] || ('#' + id); }); return o; }
    };
}

module.exports = { makeFakeData };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 26 tests.

- [ ] **Step 5: Write the real `move_data.js`**

```js
/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: custom-record and item reads/writes. The in-memory test double is
 * test/fake_data.js. Keep the two APIs identical.
 */
define(['N/search', 'N/record', './move_core'], function (search, record, core) {
    'use strict';

    const REC = { SETTINGS: 'customrecord_mv_settings', CONFIG: 'customrecord_mv_config', PALLET: 'customrecord_mv_pallet',
        LOAD: 'customrecord_mv_load', SCAN: 'customrecord_mv_scan', REQ: 'customrecord_mv_label_req' };
    const SETTINGS_FIELD = 'custrecord_mvs_data';
    const CF = { item: 'custrecord_mvc_item', code: 'custrecord_mvc_code', pcs: 'custrecord_mvc_pcs', isDefault: 'custrecord_mvc_default', batch: 'custrecord_mvc_batch' };
    const PF = { status: 'custrecord_mvp_status', load: 'custrecord_mvp_load', job: 'custrecord_mvp_job', receipt: 'custrecord_mvp_receipt',
        shippedDay: 'custrecord_mvp_shipped_day', printedDay: 'custrecord_mvp_printed_day', arrivedOn: 'custrecord_mvp_arrived_on',
        damaged: 'custrecord_mvp_damaged', catchup: 'custrecord_mvp_catchup', edited: 'custrecord_mvp_edited',
        summary: 'custrecord_mvp_summary', pieces: 'custrecord_mvp_pieces', data: 'custrecord_mvp_data' };
    const LF = { number: 'custrecord_mvl_number', status: 'custrecord_mvl_status', to: 'custrecord_mvl_to', if: 'custrecord_mvl_if',
        receipts: 'custrecord_mvl_receipts', data: 'custrecord_mvl_data' };
    const SF = { pallet: 'custrecord_mvsc_pallet', load: 'custrecord_mvsc_load', result: 'custrecord_mvsc_result', data: 'custrecord_mvsc_data' };
    const RF = { status: 'custrecord_mvr_status', requester: 'custrecord_mvr_requester', data: 'custrecord_mvr_data' };
    const DEFAULTS = { locFrom: '', locTo: '', fromName: 'Riverside', toName: 'Tippecanoe', target: '2026-11-15', start: '2026-10-01',
        skip: [], labelCode: 'both', roster: [], maxPrint: 250, staleDays: 5, toStatus: 'B', activeBatch: '' };
    const ITEM_TYPES = ['InvtPart', 'Assembly'];
    let cfgCache = {};

    // ── helpers ──────────────────────────────────────────────────────────
    function all(s) {
        const out = [];
        const pd = s.runPaged({ pageSize: 1000 });
        pd.pageRanges.forEach(r => { pd.fetch({ index: r.index }).data.forEach(x => out.push(x)); });
        return out;
    }
    function firstRow(s) { const r = s.run().getRange({ start: 0, end: 1 }); return r && r[0] ? r[0] : null; }
    function bool(v) { return v === true || v === 'T'; }
    function json(v, d) { try { return v ? JSON.parse(v) : d; } catch (e) { return d; } }
    function cols(map) { return Object.keys(map).map(k => search.createColumn({ name: map[k] })); }
    function anyText(field, values) { const ex = []; values.forEach((v, i) => { if (i) ex.push('OR'); ex.push([field, 'is', v]); }); return ex; }
    function uniq(ids) { return [...new Set((ids || []).map(String).filter(x => Number(x) > 0))]; }
    function isoOk(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) throw new Error('Bad date ' + s); return s; }
    function countOf(type, filters) {
        const r = firstRow(search.create({ type, filters, columns: [search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })] }));
        return r ? Number(r.getValue({ name: 'internalid', summary: search.Summary.COUNT })) || 0 : 0;
    }
    function createWith(type, values) {
        const r = record.create({ type });
        Object.keys(values).forEach(f => { if (values[f] !== '' && values[f] != null) r.setValue({ fieldId: f, value: values[f] }); });
        return r.save();
    }
    function resetCache() { cfgCache = {}; }

    // ── settings / users ─────────────────────────────────────────────────
    function getSettings() {
        const r = firstRow(search.create({ type: REC.SETTINGS, columns: [SETTINGS_FIELD] }));
        if (!r) throw new Error('Move settings record is missing (customrecord_mv_settings)');
        const s = Object.assign({}, DEFAULTS, json(r.getValue(SETTINGS_FIELD), {}));
        s._id = String(r.id);
        return s;
    }
    function saveSettings(patch) {
        const s = getSettings();
        const id = s._id;
        delete s._id;
        record.submitFields({ type: REC.SETTINGS, id, values: { [SETTINGS_FIELD]: JSON.stringify(Object.assign(s, patch)) } });
    }
    function employeeIsPortalManager(uid) {
        try {
            if (!(Number(uid) > 0)) return false;
            const f = search.lookupFields({ type: search.Type.EMPLOYEE, id: uid, columns: ['custentity_portal_manager'] });
            return f.custentity_portal_manager === true;
        } catch (e) { return false; }
    }

    // ── items / stock ────────────────────────────────────────────────────
    function skuOfName(n) { const s = String(n || ''); const i = s.lastIndexOf(' : '); return i >= 0 ? s.slice(i + 3) : s; }
    function itemCols() { return ['itemid', 'salesdescription', 'displayname', 'upccode'].map(n => search.createColumn({ name: n })); }
    function itemRow(r) {
        return { item: String(r.id), sku: skuOfName(r.getValue('itemid')),
            desc: r.getValue('salesdescription') || r.getValue('displayname') || '', upc: r.getValue('upccode') || '' };
    }
    function itemLookup(q) {
        if (!q) return [];
        return search.create({ type: search.Type.ITEM,
            filters: [['isinactive', 'is', 'F'], 'AND', ['type', 'anyof', ITEM_TYPES], 'AND', [['itemid', 'contains', q], 'OR', ['upccode', 'is', q]]],
            columns: itemCols() }).run().getRange({ start: 0, end: 15 }).map(itemRow);
    }
    function itemInfo(ids) {
        const out = {}, u = uniq(ids);
        if (!u.length) return out;
        all(search.create({ type: search.Type.ITEM, filters: [['internalid', 'anyof', u]], columns: itemCols() }))
            .forEach(r => { const i = itemRow(r); out[i.item] = i; });
        return out;
    }
    function skuMap() {
        const out = {};
        all(search.create({ type: search.Type.ITEM, filters: [['isinactive', 'is', 'F'], 'AND', ['type', 'anyof', ITEM_TYPES]],
            columns: [search.createColumn({ name: 'itemid' })] }))
            .forEach(r => { out[skuOfName(r.getValue('itemid')).toUpperCase()] = String(r.id); });
        return out;
    }
    function locationStock(locId, itemIds) {
        const f = [['inventorylocation', 'anyof', String(locId)], 'AND', ['type', 'anyof', ITEM_TYPES]];
        if (itemIds) {
            const u = uniq(itemIds);
            if (!u.length) return {};
            f.push('AND', ['internalid', 'anyof', u]);
        } else {
            f.push('AND', ['locationquantityonhand', 'greaterthan', 0]);
        }
        const out = {};
        all(search.create({ type: search.Type.ITEM, filters: f,
            columns: itemCols().concat([search.createColumn({ name: 'locationquantityonhand' }), search.createColumn({ name: 'locationquantityavailable' })]) }))
            .forEach(r => {
                const i = itemRow(r);
                i.onHand = Number(r.getValue('locationquantityonhand')) || 0;
                i.avail = Number(r.getValue('locationquantityavailable')) || 0;
                out[i.item] = i;
            });
        return out;
    }

    // ── configs ──────────────────────────────────────────────────────────
    function configsByItem(batch) {
        const key = String(batch || '');
        if (cfgCache[key]) return cfgCache[key];
        const out = {};
        if (key) {
            all(search.create({ type: REC.CONFIG, filters: [[CF.batch, 'is', key]], columns: cols(CF) })).forEach(r => {
                const it = String(r.getValue(CF.item));
                (out[it] = out[it] || []).push({ code: r.getValue(CF.code), pcs: Number(r.getValue(CF.pcs)), isDefault: bool(r.getValue(CF.isDefault)) });
            });
            Object.keys(out).forEach(k => out[k].sort((a, b) => (a.code < b.code ? -1 : 1)));
        }
        cfgCache[key] = out;
        return out;
    }
    function countConfigsInBatch(batch) { return countOf(REC.CONFIG, [[CF.batch, 'is', String(batch)]]); }
    function createConfig(c, batch) {
        return createWith(REC.CONFIG, { [CF.item]: c.item, [CF.code]: c.code, [CF.pcs]: c.pcs, [CF.isDefault]: !!c.isDefault, [CF.batch]: batch });
    }
    function deleteConfigsNotInBatch(batch, max) {
        search.create({ type: REC.CONFIG, filters: [[CF.batch, 'isnot', String(batch)]], columns: ['internalid'] })
            .run().getRange({ start: 0, end: max }).forEach(r => record.delete({ type: REC.CONFIG, id: r.id }));
        return countOf(REC.CONFIG, [[CF.batch, 'isnot', String(batch)]]);
    }

    // ── pallets ──────────────────────────────────────────────────────────
    function rowToPallet(r) {
        const g = f => r.getValue(f);
        const d = json(g(PF.data), {});
        return { id: Number(r.id), code: core.palletCode(r.id), status: g(PF.status) || '', loadId: String(g(PF.load) || ''),
            job: g(PF.job) || '', receipt: g(PF.receipt) || '', shippedDay: g(PF.shippedDay) || '', printedDay: g(PF.printedDay) || '',
            arrivedOn: String(g(PF.arrivedOn) || ''), damaged: bool(g(PF.damaged)), catchup: bool(g(PF.catchup)), edited: bool(g(PF.edited)),
            summary: g(PF.summary) || '', pieces: Number(g(PF.pieces)) || 0, lines: d.lines || [], data: d };
    }
    function findPallets(filters) {
        return all(search.create({ type: REC.PALLET, filters,
            columns: cols(PF).concat([search.createColumn({ name: 'internalid', sort: search.Sort.ASC })]) })).map(rowToPallet);
    }
    function getPallet(id) { return Number(id) > 0 ? findPallets([['internalid', 'anyof', String(id)]])[0] || null : null; }
    function palletsByIds(ids) { const u = uniq(ids); return u.length ? findPallets([['internalid', 'anyof', u]]) : []; }
    function palletsByJob(job) { return findPallets([[PF.job, 'is', String(job)]]); }
    function palletsByStatus(statuses) { return findPallets(anyText(PF.status, statuses)); }
    function palletsByLoad(loadId, statuses) {
        const f = [[PF.load, 'anyof', String(loadId)]];
        if (statuses && statuses.length) f.push('AND', anyText(PF.status, statuses));
        return findPallets(f);
    }
    function countByJob(job) { return countOf(REC.PALLET, [[PF.job, 'is', String(job)]]); }
    function palletValues(patch, base) {
        const v = {};
        Object.keys(patch).forEach(k => {
            if (k === 'data' || k === 'lines') return;
            if (!PF[k]) throw new Error('Unknown pallet field ' + k);
            const x = patch[k];
            v[PF[k]] = typeof x === 'boolean' ? x : (x == null ? '' : x);
        });
        if (patch.data || patch.lines) {
            const d = Object.assign({}, base ? base.data : {}, patch.data || {});
            if (patch.lines) d.lines = patch.lines;
            v[PF.data] = JSON.stringify(d);
        }
        return v;
    }
    function createPallet(patch) { return Number(createWith(REC.PALLET, palletValues(patch, null))); }
    function updatePallet(p, patch) { record.submitFields({ type: REC.PALLET, id: p.id, values: palletValues(patch, p) }); }
    function labeledPiecesByItem() {
        const out = {};
        palletsByStatus([core.PALLET.LABELED]).forEach(p => p.lines.forEach(l => { out[l.item] = (out[l.item] || 0) + (Number(l.pcs) || 0); }));
        return out;
    }
    function movedByDay() {
        const out = {};
        search.create({ type: REC.PALLET, filters: [[PF.shippedDay, 'isnotempty', '']],
            columns: [search.createColumn({ name: PF.shippedDay, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT })] })
            .run().each(r => {
                out[r.getValue({ name: PF.shippedDay, summary: search.Summary.GROUP })] = Number(r.getValue({ name: 'internalid', summary: search.Summary.COUNT }));
                return true;
            });
        return out;
    }
    function palletCountsByLoad(loadIds) {
        const out = {}, u = uniq(loadIds);
        if (!u.length) return out;
        search.create({ type: REC.PALLET, filters: [[PF.load, 'anyof', u]],
            columns: [search.createColumn({ name: PF.load, summary: search.Summary.GROUP }),
                search.createColumn({ name: PF.status, summary: search.Summary.GROUP }),
                search.createColumn({ name: 'internalid', summary: search.Summary.COUNT }),
                search.createColumn({ name: PF.pieces, summary: search.Summary.SUM })] })
            .run().each(r => {
                const l = String(r.getValue({ name: PF.load, summary: search.Summary.GROUP }));
                const st = r.getValue({ name: PF.status, summary: search.Summary.GROUP });
                (out[l] = out[l] || {})[st] = { n: Number(r.getValue({ name: 'internalid', summary: search.Summary.COUNT })) || 0,
                    pcs: Number(r.getValue({ name: PF.pieces, summary: search.Summary.SUM })) || 0 };
                return true;
            });
        return out;
    }
    function whereFilters(q) {
        const f = [];
        const add = x => { if (f.length) f.push('AND'); f.push(x); };
        if (q.status && q.status.length) add(anyText(PF.status, q.status));
        if (q.receiptEmpty) add([PF.receipt, 'isempty', '']);
        if (q.damaged) add([PF.damaged, 'is', 'T']);
        if (q.catchup) add([PF.catchup, 'is', 'T']);
        if (q.edited) add([PF.edited, 'is', 'T']);
        if (q.shippedSince) add(["formulanumeric: CASE WHEN {" + PF.shippedDay + "} >= '" + isoOk(q.shippedSince) + "' THEN 1 ELSE 0 END", 'equalto', '1']);
        if (q.printedBefore) add(["formulanumeric: CASE WHEN {" + PF.printedDay + "} < '" + isoOk(q.printedBefore) + "' THEN 1 ELSE 0 END", 'equalto', '1']);
        return f;
    }
    function findPalletsWhere(q) { return findPallets(whereFilters(q)); }
    function countPallets(q) { return countOf(REC.PALLET, whereFilters(q)); }

    // ── loads ────────────────────────────────────────────────────────────
    function rowToLoad(r) {
        const g = f => r.getValue(f);
        return { id: String(r.id), number: g(LF.number) || '', status: g(LF.status) || '', to: String(g(LF.to) || ''), if: String(g(LF.if) || ''),
            receipts: String(g(LF.receipts) || '').split(',').filter(Boolean), data: json(g(LF.data), {}) };
    }
    function findLoads(filters, limit) {
        const s = search.create({ type: REC.LOAD, filters: filters || [],
            columns: cols(LF).concat([search.createColumn({ name: 'internalid', sort: search.Sort.DESC })]) });
        return (limit ? s.run().getRange({ start: 0, end: limit }) : all(s)).map(rowToLoad);
    }
    function getLoad(id) { return Number(id) > 0 ? findLoads([['internalid', 'anyof', String(id)]])[0] || null : null; }
    function getLoads(ids) { const u = uniq(ids); return u.length ? findLoads([['internalid', 'anyof', u]]) : []; }
    function loadsByStatus(statuses, limit) { return findLoads(anyText(LF.status, statuses), limit); }
    function recentLoads(limit) { return findLoads([], limit); }
    function loadsByNumber(n) { return findLoads([[LF.number, 'is', String(n)]]); }
    function allLoadNumbers() { return all(search.create({ type: REC.LOAD, columns: [search.createColumn({ name: LF.number })] })).map(r => r.getValue(LF.number)); }
    function loadValues(patch, base) {
        const v = {};
        Object.keys(patch).forEach(k => {
            if (k === 'data') return;
            if (k === 'receipts') { v[LF.receipts] = patch.receipts.join(','); return; }
            if (!LF[k]) throw new Error('Unknown load field ' + k);
            v[LF[k]] = patch[k] == null ? '' : patch[k];
        });
        if (patch.data) v[LF.data] = JSON.stringify(Object.assign({}, base ? base.data : {}, patch.data));
        return v;
    }
    function createLoad(patch) { return String(createWith(REC.LOAD, loadValues(patch, null))); }
    function updateLoad(L, patch) { record.submitFields({ type: REC.LOAD, id: L.id, values: loadValues(patch, L) }); }

    // ── scans / requests / transactions ──────────────────────────────────
    function logScan(s) {
        createWith(REC.SCAN, { [SF.pallet]: s.pallet || '', [SF.load]: s.load || '', [SF.result]: s.result, [SF.data]: JSON.stringify(s.data || {}) });
    }
    function rowToReq(r) { return { id: String(r.id), status: r.getValue(RF.status) || '', requester: r.getValue(RF.requester) || '', data: json(r.getValue(RF.data), {}) }; }
    function createReq(p) { return String(createWith(REC.REQ, { [RF.status]: p.status, [RF.requester]: p.requester, [RF.data]: JSON.stringify(p.data || {}) })); }
    function getReq(id) {
        if (!(Number(id) > 0)) return null;
        const r = firstRow(search.create({ type: REC.REQ, filters: [['internalid', 'anyof', String(id)]], columns: cols(RF) }));
        return r ? rowToReq(r) : null;
    }
    function findReqs(q) {
        const f = [];
        if (q.requester) f.push([RF.requester, 'is', q.requester]);
        if (q.status) { if (f.length) f.push('AND'); f.push([RF.status, 'is', q.status]); }
        return search.create({ type: REC.REQ, filters: f, columns: cols(RF).concat([search.createColumn({ name: 'internalid', sort: search.Sort.DESC })]) })
            .run().getRange({ start: 0, end: q.limit || 100 }).map(rowToReq);
    }
    function updateReq(r, patch) {
        const v = {};
        if ('status' in patch) v[RF.status] = patch.status;
        if (patch.data) v[RF.data] = JSON.stringify(Object.assign({}, r.data, patch.data));
        record.submitFields({ type: REC.REQ, id: r.id, values: v });
    }
    function tranids(ids) {
        const out = {}, u = uniq(ids);
        if (!u.length) return out;
        all(search.create({ type: search.Type.TRANSACTION, filters: [['internalid', 'anyof', u], 'AND', ['mainline', 'is', 'T']], columns: ['tranid'] }))
            .forEach(r => { out[String(r.id)] = r.getValue('tranid'); });
        return out;
    }

    return {
        resetCache, getSettings, saveSettings, employeeIsPortalManager,
        itemLookup, itemInfo, skuMap, locationStock,
        configsByItem, countConfigsInBatch, createConfig, deleteConfigsNotInBatch,
        getPallet, palletsByIds, palletsByJob, palletsByStatus, palletsByLoad, countByJob, createPallet, updatePallet,
        labeledPiecesByItem, movedByDay, palletCountsByLoad, findPalletsWhere, countPallets,
        getLoad, getLoads, loadsByStatus, recentLoads, loadsByNumber, allLoadNumbers, createLoad, updateLoad,
        logScan, createReq, getReq, findReqs, updateReq, tranids
    };
});
```

- [ ] **Step 6: Syntax check the real module and confirm both files export the same names**

Run: `node --check move_portal/move_data.js`
Expected: no output (OK).

Run:
```bash
node -e "const {loadAmd}=require('./move_portal/test/amd');const core=loadAmd('move_core.js');const stub=new Proxy({},{get:()=>()=>({})});const real=Object.keys(loadAmd('move_data.js',{'N/search':stub,'N/record':stub,'./move_core':core})).sort();const fake=Object.keys(require('./move_portal/test/fake_data').makeFakeData(core)).filter(k=>k!=='db').sort();console.log(JSON.stringify(real)===JSON.stringify(fake)?'API MATCH':'MISMATCH '+real.filter(k=>fake.indexOf(k)<0)+' | '+fake.filter(k=>real.indexOf(k)<0));"
```
Expected: `API MATCH`.

- [ ] **Step 7: Commit**

```bash
git add move_portal/move_data.js move_portal/test/fake_data.js move_portal/test/fake_data.test.js
git commit -m "feat(move): data layer for move custom records plus in-memory fake"
```

---

