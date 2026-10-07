/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: NetSuite transactions (Item Fulfillment and Item Receipt writes via apply).
 * Called only from manager actions in sl_move_portal.js. The test double is test/fake_tx.js.
 */
define(['N/record', 'N/search', './move_verify'], function (record, search, verify) {
    'use strict';

    function setLines(rec, lines) {
        const left = Object.assign({}, lines);
        const n = rec.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < n; i++) {
            rec.selectLine({ sublistId: 'item', line: i });
            const it = String(rec.getCurrentSublistValue({ sublistId: 'item', fieldId: 'item' }));
            const q = left[it] || 0;
            rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: q > 0 });
            if (q > 0) { rec.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: q }); left[it] = 0; }
            rec.commitLine({ sublistId: 'item' });
        }
        const miss = Object.keys(left).filter(k => left[k] > 0);
        if (miss.length) throw new Error('Items not found on the transfer order: ' + miss.join(', '));
    }

    function changed(msg) { return new Error('IF changed in NetSuite, review: ' + msg); }
    // The seal and trailer body fields are prod customizations; an account without them (the sandbox) stamps status and memo only.
    function hasField(rec, id) {
        if (typeof rec.getField !== 'function') return true;
        try { return rec.getField({ fieldId: id }) != null; } catch (e) { return false; }
    }
    const TRAILER_FLD = 'custbody_rsm_container_no', SEAL_FLD = 'custbody7';
    function stampOn(rec, op) {
        if (hasField(rec, TRAILER_FLD)) rec.setValue({ fieldId: TRAILER_FLD, value: op.trailer });
        if (hasField(rec, SEAL_FLD)) rec.setValue({ fieldId: SEAL_FLD, value: 'SEAL: ' + op.seal });
        rec.setValue({ fieldId: 'memo', value: op.memo });
    }
    function itemLines(rec, item) {
        const out = [], n = rec.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < n; i++) if (String(rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i })) === String(item)) out.push(i);
        return out;
    }
    function toRemaining(toId, item) {
        const to = record.load({ type: record.Type.TRANSFER_ORDER, id: toId });
        let left = 0;
        itemLines(to, item).forEach(i => {
            left += (Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0) -
                (Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantityfulfilled', line: i })) || 0);
        });
        return left;
    }
    function setIfItemQty(op) {
        const f = record.load({ type: record.Type.ITEM_FULFILLMENT, id: op.ifId, isDynamic: true });
        const st = String(f.getValue({ fieldId: 'shipstatus' }));
        if (st !== 'A' && st !== 'B') throw changed(op.ifNum + ' is no longer Picked/Packed (status ' + st + ')');
        const lines = itemLines(f, op.item);
        const cur = lines.reduce((a, i) => a + (Number(f.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0), 0);
        if (cur === Number(op.to)) return String(op.ifId);   // an earlier write landed but the request died before it was recorded
        if (cur !== Number(op.from)) throw changed(op.ifNum + ' item ' + op.item + ' is ' + cur + ', expected ' + op.from);
        if (Number(op.to) > Number(op.from) && Number(op.to) - Number(op.from) > toRemaining(op.toId, op.item)) throw changed('TO ' + op.toId + ' has no room to raise ' + op.ifNum + ' to ' + op.to);
        if (Number(op.to) <= 0) {
            const others = f.getLineCount({ sublistId: 'item' }) - lines.length;
            const ticked = [];
            for (let i = 0; i < f.getLineCount({ sublistId: 'item' }); i++)
                if (lines.indexOf(i) === -1 && f.getSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i }) !== false) ticked.push(i);
            if (!others || !ticked.length) throw changed(op.ifNum + ' would be emptied by taking item ' + op.item + ' to 0');
        }
        let left = Number(op.to);
        const caps = lines.map(i => Number(f.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0);
        const want = lines.map((i, n) => { const last = n === lines.length - 1; const g = last ? left : Math.min(left, caps[n]); left -= g; return g; });
        for (let n = lines.length - 1; n >= 0; n--) {
            f.selectLine({ sublistId: 'item', line: lines[n] });
            if (want[n] > 0) f.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: want[n] });
            else f.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: false });
            f.commitLine({ sublistId: 'item' });
        }
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    // Per-item qty on the ticked lines only.
    function tickedQty(rec) {
        const out = {}, n = rec.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < n; i++) {
            if (rec.getSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i }) === false) continue;
            const k = String(rec.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i })), q = Number(rec.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
            if (q > 0) out[k] = (out[k] || 0) + q;
        }
        return out;
    }
    function qtyText(m) { return Object.keys(m).sort().map(k => k + '×' + m[k]).join(', ') || 'nothing'; }
    function stampShip(op) {
        const f = record.load({ type: record.Type.ITEM_FULFILLMENT, id: op.ifId, isDynamic: true });
        const st = String(f.getValue({ fieldId: 'shipstatus' }));
        // Already shipped with this trailer and seal: an earlier write landed but the request died before it was recorded.
        // (A field the account lacks cannot disagree.)
        const sealOk = !hasField(f, SEAL_FLD) || verify.sealKey(f.getValue({ fieldId: SEAL_FLD })) === verify.sealKey(op.seal);   // seals compare by digits
        const trailerOk = !hasField(f, TRAILER_FLD) || String(f.getValue({ fieldId: TRAILER_FLD }) || '') === String(op.trailer);
        if (st === 'C' && sealOk && trailerOk) return String(op.ifId);
        if (st !== 'A' && st !== 'B') throw changed(op.ifNum + ' is no longer Picked/Packed (status ' + st + ')');
        if (op.lines) {                               // the qty the portal verified; an office edit since then must not ship unseen
            const want = {}, have = tickedQty(f);
            Object.keys(op.lines).forEach(k => { if (Number(op.lines[k]) > 0) want[String(k)] = Number(op.lines[k]); });
            if (qtyText(want) !== qtyText(have)) throw changed(op.ifNum + ' holds ' + qtyText(have) + ', the load was verified for ' + qtyText(want));
        }
        stampOn(f, op);
        f.setValue({ fieldId: 'shipstatus', value: 'C' });
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    // A Packed add-on IF made by an earlier request that died before it was recorded: found by its memo token, never made twice.
    function findPackedByToken(tok, toId) {
        const r = search.create({ type: search.Type.TRANSACTION,
            filters: [['memo', 'contains', tok], 'AND', ['mainline', 'is', 'T'], 'AND', ['type', 'anyof', 'ItemShip'], 'AND',
                ['createdfrom', 'anyof', String(toId)], 'AND', ['status', 'anyof', ['ItemShip:A', 'ItemShip:B']]],
            columns: ['internalid'] }).run().getRange({ start: 0, end: 1 });
        return r && r[0] ? String(r[0].id) : null;
    }
    function createIf(op) {
        if (op.ship === false && op.token) {
            const found = findPackedByToken(op.token, op.toId);
            if (found) return found;
        }
        const f = record.transform({ fromType: record.Type.TRANSFER_ORDER, fromId: op.toId, toType: record.Type.ITEM_FULFILLMENT, isDynamic: true });
        if (op.ship === false) {                      // a correction add-on: Packed, stamped at departure
            f.setValue({ fieldId: 'shipstatus', value: 'B' });
            if (op.token) f.setValue({ fieldId: 'memo', value: op.token });
        }
        else { f.setValue({ fieldId: 'shipstatus', value: 'C' }); stampOn(f, op); }
        setLines(f, op.lines);
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    function createReceipt(op) {
        const r = record.transform({ fromType: record.Type.TRANSFER_ORDER, fromId: op.toId, toType: record.Type.ITEM_RECEIPT, isDynamic: true,
            defaultValues: { itemfulfillment: op.ifId } });
        stampOn(r, Object.assign({ memo: 'Move receipt · ' + op.ifNum }, op));
        setLines(r, op.lines);
        return String(r.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    // if_qty / if_stamp re-read the IF and refuse if it changed; a Packed if_create is found by its memo token; receipt relies on runOps done-keys
    function apply(op) {
        if (op.op === 'if_qty') return setIfItemQty(op);
        if (op.op === 'if_stamp') return stampShip(op);
        if (op.op === 'if_create') return createIf(op);
        if (op.op === 'receipt') return createReceipt(op);
        throw new Error('Unknown op ' + op.op);
    }

    // Item Receipt numbers (IR14494) for receipt internal ids; an unreadable one is left out (the caller shows the id).
    function tranIds(ids) {
        const out = {};
        (ids || []).forEach(id => {
            try { const v = search.lookupFields({ type: search.Type.ITEM_RECEIPT, id: id, columns: ['tranid'] }).tranid; if (v) out[String(id)] = 'IR' + String(v).replace(/^IR/i, ''); } catch (e) { /* shown as the id */ }
        });
        return out;
    }

    return { apply, tranIds };
});
