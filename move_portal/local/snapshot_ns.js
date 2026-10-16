// move_portal/local/snapshot_ns.js — node only, NOT deployed. A move_ns stand-in that reads a prod snapshot JSON.
const fs = require('fs');

function makeSnapshotNs(verify, rawOrPath) {
    const raw = typeof rawOrPath === 'string' ? JSON.parse(fs.readFileSync(rawOrPath, 'utf8')) : rawOrPath;
    let reads = verify.buildReads(raw);
    const ns = {};
    Object.keys(reads).forEach(k => { ns[k] = function () { return reads[k].apply(null, arguments); }; });
    const today = () => new Date().toISOString().slice(0, 10);
    const skuOf = k => ((raw.items || []).find(i => String(i.item) === String(k)) || {}).sku || String(k);
    const changed = m => new Error('Changed in NetSuite: ' + m);
    // Local stand-in for a NetSuite write (the beta's `qty` / `on` modes): the op changes the snapshot in memory, so the re-check
    // reads NetSuite as it would after the real write. Mirrors move_tx.js closely enough for the beta:
    //  if_qty      sets an IF item's qty (idempotent at op.to; refuses a stale op.from); newLine adds the line (the beta never needs the add-on fallback)
    //  if_create   adds an IF (returns its id): Shipped (C) when op.ship === true, Picked (A) when 'picked' (an IF with op.token on this TO, any
    //              status, is returned instead of a second one), else Packed (B)
    //  to_create   adds an approved TO (returns its id)
    //  to_line     sets a TO item's open qty (idempotent at op.to; refuses a stale op.from); 0 closes the lines; a new item adds a line
    //  if_seal     stores the seal on a Picked/Packed IF
    //  if_stamp    marks a Picked/Packed IF shipped (C), with trailer and seal
    // Other ops are read-neutral.
    ns.applyOp = function (op) {
        if (!op) return;
        const rows = raw.ifLines = raw.ifLines || [];
        const tl = raw.toLines = raw.toLines || [];
        const ifRows = id => rows.filter(r => String(r.ifid) === String(id));
        const liveIf = (id, num) => {
            const f = ifRows(id);
            if (!f.length) throw new Error('IF ' + id + ' is not in the snapshot');
            if (['A', 'B'].indexOf(String(f[0].status)) === -1) throw changed((num || 'IF' + id) + ' is no longer Picked/Packed (status ' + f[0].status + ')');
            return f;
        };
        let created;
        if (op.op === 'if_qty') {
            const mine = rows.filter(r => String(r.ifid) === String(op.ifId) && String(r.item) === String(op.item));
            if (!mine.length) {
                if (Number(op.to) <= 0) return;
                if (!op.newLine) throw new Error('IF ' + op.ifId + ' item ' + op.item + ' is not in the snapshot');
                const head = liveIf(op.ifId, op.ifNum)[0];
                rows.push({ ifid: head.ifid, ifnum: head.ifnum, status: head.status, trandate: head.trandate, toid: head.toid, item: Number(op.item),
                    sku: skuOf(op.item), qty: Number(op.to), memo: head.memo || '', seal: head.seal || '', trailer: head.trailer || '' });
            } else {
                const cur = mine.reduce((a, r) => a + Number(r.qty || 0), 0);
                if (cur === Number(op.to)) return;
                if (op.from != null && cur !== Number(op.from)) throw changed((op.ifNum || 'IF' + op.ifId) + ' item ' + op.item + ' is ' + cur + ', expected ' + op.from);
                mine.forEach((r, i) => { r.qty = i === 0 ? Number(op.to) : 0; });
            }
        } else if (op.op === 'to_create') {
            const id = tl.reduce((m, r) => Math.max(m, Number(r.toid) || 0), 80000) + 1;
            Object.keys(op.lines || {}).forEach(k => tl.push({ toid: id, tonum: 'TO' + id, tostatus: 'B', trandate: today(), item: Number(k),
                sku: skuOf(k), qty: Number(op.lines[k]) }));
            created = String(id);
        } else if (op.op === 'to_line') {
            const all = tl.filter(r => String(r.toid) === String(op.toId));
            if (!all.length) throw new Error('TO ' + op.toId + ' is not in the snapshot');
            const lines = all.filter(r => String(r.item) === String(op.item)), open = lines.filter(r => !r.closed);
            const cur = open.reduce((a, r) => a + Number(r.qty || 0), 0), to = Number(op.to);
            if (cur === to) return;
            if (cur !== Number(op.from)) throw changed('TO ' + op.toId + ' item ' + op.item + ' is ' + cur + ', expected ' + op.from);
            const setLine = (r, q) => { if (q > 0) { r.closed = false; r.qty = q; } else { r.closed = true; r.qty = 0; } };
            if (to <= 0) open.forEach(r => setLine(r, 0));
            else if (lines.length) {
                if (!open.length) setLine(lines[lines.length - 1], to);
                else {                                // fill each open line up to its qty in order; any increase lands on the last
                    let left = to;
                    open.forEach((r, n) => { const g = n === open.length - 1 ? left : Math.min(left, Number(r.qty) || 0); left -= g; setLine(r, g); });
                }
            } else {
                const h = all[0];
                tl.push({ toid: h.toid, tonum: h.tonum, tostatus: h.tostatus, trandate: h.trandate, item: Number(op.item), sku: skuOf(op.item), qty: to });
            }
        } else if (op.op === 'if_create') {
            if (op.ship === 'picked' && op.token) {   // drop trailer: a Picked IF an earlier request saved on this TO (any status)
                const hit = rows.find(r => String(r.toid) === String(op.toId) && String(r.memo || '').indexOf(op.token) !== -1);
                if (hit) return String(hit.ifid);
            }
            const id = rows.reduce((m, r) => Math.max(m, Number(r.ifid) || 0), 90000) + 1;
            const status = op.ship === true ? 'C' : op.ship === 'picked' ? 'A' : 'B';
            Object.keys(op.lines || {}).forEach(k => rows.push({ ifid: id, ifnum: 'IF' + id, status: status, trandate: today(), toid: Number(op.toId), item: Number(k),
                sku: skuOf(k), qty: Number(op.lines[k]), memo: op.memo || op.token || '', seal: op.seal || '', trailer: op.trailer || '' }));
            created = String(id);
        } else if (op.op === 'if_seal') {
            if (!String(op.seal || '').trim()) throw new Error('Seal is blank');
            liveIf(op.ifId, op.ifNum).forEach(r => { r.seal = op.seal; });
        } else if (op.op === 'if_stamp') {
            const f = ifRows(op.ifId);
            if (f.length && String(f[0].status) === 'C') return;
            liveIf(op.ifId, op.ifNum).forEach(r => { r.status = 'C'; if (op.seal) r.seal = op.seal; if (op.trailer) r.trailer = op.trailer; });
        } else return;
        reads = verify.buildReads(raw);
        return created;
    };
    // The snapshot's raw rows (the beta's tests and checks read the TO and IF lines here).
    ns._raw = raw;
    return ns;
}

module.exports = { makeSnapshotNs };
