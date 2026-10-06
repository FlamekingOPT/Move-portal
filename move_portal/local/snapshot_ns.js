// move_portal/local/snapshot_ns.js — node only, NOT deployed. A move_ns stand-in that reads a prod snapshot JSON.
const fs = require('fs');

function makeSnapshotNs(verify, rawOrPath) {
    const raw = typeof rawOrPath === 'string' ? JSON.parse(fs.readFileSync(rawOrPath, 'utf8')) : rawOrPath;
    let reads = verify.buildReads(raw);
    const ns = {};
    Object.keys(reads).forEach(k => { ns[k] = function () { return reads[k].apply(null, arguments); }; });
    // Local stand-in for a NetSuite write (the beta's `qty` mode): an if_qty op changes the snapshot's IF line in memory, so the
    // re-check after Correct the IF reads the IF as written, the way move_ns would after a real setIfItemQty. Other ops read-neutral.
    ns.applyOp = function (op) {
        if (!op || op.op !== 'if_qty') return;
        const rows = (raw.ifLines || []).filter(r => String(r.ifid) === String(op.ifId) && String(r.item) === String(op.item));
        if (!rows.length) throw new Error('IF ' + op.ifId + ' item ' + op.item + ' is not in the snapshot');
        rows.forEach((r, i) => { r.qty = i === 0 ? Number(op.to) : 0; });
        reads = verify.buildReads(raw);
    };
    return ns;
}

module.exports = { makeSnapshotNs };
