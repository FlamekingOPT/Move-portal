// move_portal/local/snapshot_ns.js — node only, NOT deployed. A move_ns stand-in that reads a prod snapshot JSON.
const fs = require('fs');

function makeSnapshotNs(verify, rawOrPath) {
    const raw = typeof rawOrPath === 'string' ? JSON.parse(fs.readFileSync(rawOrPath, 'utf8')) : rawOrPath;
    let reads = verify.buildReads(raw);
    const ns = {};
    Object.keys(reads).forEach(k => { ns[k] = function () { return reads[k].apply(null, arguments); }; });
    // Local stand-in for a NetSuite write (the beta's `qty` / `on` modes): the op changes the snapshot in memory, so the re-check
    // reads NetSuite as it would after the real write. if_qty rewrites an IF line; if_create adds a Packed IF (returns its id);
    // if_stamp marks the IF shipped (C). Other ops are read-neutral.
    ns.applyOp = function (op) {
        if (!op) return;
        const rows = raw.ifLines = raw.ifLines || [];
        let created;
        if (op.op === 'if_qty') {
            const mine = rows.filter(r => String(r.ifid) === String(op.ifId) && String(r.item) === String(op.item));
            if (!mine.length) throw new Error('IF ' + op.ifId + ' item ' + op.item + ' is not in the snapshot');
            mine.forEach((r, i) => { r.qty = i === 0 ? Number(op.to) : 0; });
        } else if (op.op === 'if_create') {
            const id = rows.reduce((m, r) => Math.max(m, Number(r.ifid) || 0), 90000) + 1, items = (raw.items || []);
            Object.keys(op.lines || {}).forEach(k => rows.push({ ifid: id, ifnum: 'IF' + id, status: 'B', trandate: new Date().toISOString().slice(0, 10), toid: Number(op.toId), item: Number(k),
                sku: (items.find(i => String(i.item) === String(k)) || {}).sku || String(k), qty: Number(op.lines[k]), memo: op.memo || '' }));
            created = String(id);
        } else if (op.op === 'if_stamp') {
            rows.filter(r => String(r.ifid) === String(op.ifId)).forEach(r => { r.status = 'C'; });
        } else return;
        reads = verify.buildReads(raw);
        return created;
    };
    return ns;
}

module.exports = { makeSnapshotNs };
