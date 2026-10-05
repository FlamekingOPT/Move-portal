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
    const PKEYS = ['status', 'load', 'job', 'receipt', 'shippedDay', 'printedDay', 'damaged', 'edited', 'summary', 'pieces'];

    function toPallet(r) {
        const p = clone(r);
        p.code = core.palletCode(p.id);
        p.loadId = String(p.load || '');
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
            const r = { id, data: {}, load: '', receipt: '', job: '', shippedDay: '', printedDay: '', damaged: false, edited: false, summary: '', pieces: 0, status: '' };
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
        findPalletsWhere: q => pallets().filter(p => matchQ(p, q)).map(toPallet),
        countPallets: q => pallets().filter(p => matchQ(p, q)).length,

        getLoad: id => (db.loads[String(id)] ? toLoad(db.loads[String(id)]) : null),
        getLoads: ids => ids.map(String).filter(id => db.loads[id]).map(id => toLoad(db.loads[id])),
        loadsByStatus: (st, limit) => loadsDesc().filter(l => st.indexOf(l.status) !== -1).slice(0, limit || 1e9).map(toLoad),
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
