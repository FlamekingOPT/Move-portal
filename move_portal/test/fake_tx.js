// move_portal/test/fake_tx.js
// In-memory stand-in for move_tx.js. Records calls; can simulate failures.
const { loadAmd } = require('./amd');
const verify = loadAmd('move_verify.js', {});

function makeFakeTx() {
    const t = { seq: 900, ops: [], failOn: null, closed: {}, deletedIfs: {}, tags: {}, ifTags: {} };
    return {
        _t: t,
        apply: op => {
            const key = verify.opKey(op);
            if (t.failOn && (typeof t.failOn === 'function' ? t.failOn(op) : t.failOn === key)) { t.failOn = null; throw new Error('IF changed in NetSuite (fake failure on ' + key + ')'); }
            t.ops.push(JSON.parse(JSON.stringify(op)));
            const hooked = t.onApply ? t.onApply(op) : undefined;
            if (hooked != null && hooked !== '') return String(hooked);
            return op.op === 'if_qty' || op.op === 'if_stamp' || op.op === 'if_seal' ? String(op.ifId) : op.op === 'to_line' ? String(op.toId) : String(++t.seq);
        },
        findTo: tok => t.tags[tok] || null,
        findIf: (tok, toId, statuses) => t.ifTags[tok + '|' + toId] || null,
        ifExists: id => !t.deletedIfs[String(id)],
        toClosed: id => !!t.closed[String(id)],
        tranIds: (ids, kind) => { const o = {}; (ids || []).forEach(id => { o[String(id)] = (kind === 'to' ? 'TO' : kind === 'if' ? 'IF' : 'IR') + id; }); return o; }
    };
}

module.exports = { makeFakeTx };
