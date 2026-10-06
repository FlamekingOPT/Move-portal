// move_portal/test/fake_tx.js
// In-memory stand-in for move_tx.js. Records calls; can simulate failures.
const { loadAmd } = require('./amd');
const verify = loadAmd('move_verify.js', {});

function makeFakeTx() {
    const t = { seq: 900, ops: [], failOn: null };
    return {
        _t: t,
        apply: op => {
            const key = verify.opKey(op);
            if (t.failOn === key) { t.failOn = null; throw new Error('IF changed in NetSuite (fake failure on ' + key + ')'); }
            t.ops.push(JSON.parse(JSON.stringify(op)));
            const hooked = t.onApply ? t.onApply(op) : undefined;
            if (hooked != null && hooked !== '') return String(hooked);
            return op.op === 'if_qty' || op.op === 'if_stamp' ? String(op.ifId) : String(++t.seq);
        }
    };
}

module.exports = { makeFakeTx };
