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
