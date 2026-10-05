// move_portal/test/fake_tx.js
// In-memory stand-in for move_tx.js. Records calls; can simulate failures.
const { loadAmd } = require('./amd');
const verify = loadAmd('move_verify.js', {});

function makeFakeTx() {
    const t = { calls: [], memos: [], shortfalls: [], failNext: null, seq: 900, ops: [], failOn: null };
    function save(type, memo, extra) {
        const id = String(++t.seq);
        t.memos.push({ id, type, memo });
        t.calls.push(Object.assign({ type, id }, extra));
        return id;
    }
    // kind + '_after' (e.g. 'to_after', 'if_after', 'r_after') simulates a crash right after the
    // save landed: the call/memo is already recorded, so a retry's findByToken can adopt it.
    function maybeFail(kind, fn) {
        if (t.failNext === kind) { t.failNext = null; throw new Error(kind.toUpperCase() + ' save failed'); }
        const id = fn();
        if (t.failNext === kind + '_after') { t.failNext = null; throw new Error(kind.toUpperCase() + ' crashed after save'); }
        return id;
    }
    return {
        _t: t,
        apply: op => {
            const key = verify.opKey(op);
            if (t.failOn === key) { t.failOn = null; throw new Error('IF changed in NetSuite (fake failure on ' + key + ')'); }
            t.ops.push(JSON.parse(JSON.stringify(op)));
            if (t.onApply) t.onApply(op);
            return op.op === 'if_qty' || op.op === 'if_stamp' ? String(op.ifId) : String(++t.seq);
        },
        findByToken: (tok, type) => { const m = t.memos.find(x => x.type === type && x.memo.indexOf(tok) !== -1); return m ? m.id : null; },
        createTransferOrder: o => maybeFail('to', () => save('TrnfrOrd', o.memo, { lines: JSON.parse(JSON.stringify(o.lines)), fromLoc: o.fromLoc, toLoc: o.toLoc })),
        committedShortfalls: () => t.shortfalls,
        fulfillTransferOrder: (toId, lines, memo) => maybeFail('if', () => save('ItemShip', memo, { toId, lines: JSON.parse(JSON.stringify(lines)) })),
        receiveTransferOrder: (toId, lines, memo) => maybeFail('r', () => save('ItemRcpt', memo, { toId, lines: JSON.parse(JSON.stringify(lines)) }))
    };
}

module.exports = { makeFakeTx };
