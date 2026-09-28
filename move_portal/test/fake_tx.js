// move_portal/test/fake_tx.js
// In-memory stand-in for move_tx.js. Records calls; can simulate failures.
function makeFakeTx() {
    const t = { calls: [], memos: [], shortfalls: [], failNext: null, seq: 900 };
    function save(type, memo, extra) {
        const id = String(++t.seq);
        t.memos.push({ id, type, memo });
        t.calls.push(Object.assign({ type, id }, extra));
        return id;
    }
    function maybeFail(kind, fn) {
        if (t.failNext === kind) { t.failNext = null; throw new Error(kind.toUpperCase() + ' save failed'); }
        const id = fn();
        if (t.failNext === kind + '_after') { t.failNext = null; throw new Error(kind.toUpperCase() + ' crashed after save'); }
        return id;
    }
    return {
        _t: t,
        findByToken: (tok, type) => { const m = t.memos.find(x => x.type === type && x.memo.indexOf(tok) !== -1); return m ? m.id : null; },
        createTransferOrder: o => maybeFail('to', () => save('TrnfrOrd', o.memo, { lines: JSON.parse(JSON.stringify(o.lines)), fromLoc: o.fromLoc, toLoc: o.toLoc })),
        committedShortfalls: () => t.shortfalls,
        fulfillTransferOrder: (toId, lines, memo) => maybeFail('if', () => save('ItemShip', memo, { toId, lines: JSON.parse(JSON.stringify(lines)) })),
        receiveTransferOrder: (toId, lines, memo) => maybeFail('r', () => save('ItemRcpt', memo, { toId, lines: JSON.parse(JSON.stringify(lines)) }))
    };
}

module.exports = { makeFakeTx };
