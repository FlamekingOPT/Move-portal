/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: NetSuite transactions (Transfer Order -> Item Fulfillment -> Item Receipt).
 * Called only from manager actions in sl_move_portal.js. The test double is test/fake_tx.js.
 */
define(['N/record', 'N/search'], function (record, search) {
    'use strict';

    // Find a transaction created earlier by the portal, by the token in its memo.
    function findByToken(tok, typeCode) {
        const r = search.create({ type: search.Type.TRANSACTION,
            filters: [['memo', 'contains', tok], 'AND', ['mainline', 'is', 'T'], 'AND', ['type', 'anyof', typeCode]],
            columns: ['internalid'] }).run().getRange({ start: 0, end: 1 });
        return r && r[0] ? String(r[0].id) : null;
    }

    function locationSubsidiary(locId) {
        const f = search.lookupFields({ type: search.Type.LOCATION, id: locId, columns: ['subsidiary'] });
        const s = f && f.subsidiary;
        return Array.isArray(s) && s.length ? s[0].value : null;
    }

    function createTransferOrder(o) {
        const to = record.create({ type: record.Type.TRANSFER_ORDER, isDynamic: true });
        const sub = locationSubsidiary(o.fromLoc);
        if (sub) to.setValue({ fieldId: 'subsidiary', value: sub });
        to.setValue({ fieldId: 'location', value: o.fromLoc });
        to.setValue({ fieldId: 'transferlocation', value: o.toLoc });
        to.setValue({ fieldId: 'memo', value: o.memo });
        if (o.orderStatus) to.setValue({ fieldId: 'orderstatus', value: o.orderStatus });
        Object.keys(o.lines).forEach(item => {
            to.selectNewLine({ sublistId: 'item' });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: item });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: o.lines[item] });
            to.commitLine({ sublistId: 'item' });
        });
        return String(to.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }

    function committedShortfalls(toId, lines) {
        const to = record.load({ type: record.Type.TRANSFER_ORDER, id: toId });
        const got = {};
        const n = to.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < n; i++) {
            const it = String(to.getSublistValue({ sublistId: 'item', fieldId: 'item', line: i }));
            got[it] = (got[it] || 0) + (Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantitycommitted', line: i })) || 0);
        }
        return Object.keys(lines).filter(k => (got[k] || 0) < lines[k]).map(k => ({ item: k, need: lines[k], committed: got[k] || 0 }));
    }

    // Tick exactly the load's items at the load's quantities; untick everything else.
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

    function fulfillTransferOrder(toId, lines, memo) {
        const f = record.transform({ fromType: record.Type.TRANSFER_ORDER, fromId: toId, toType: record.Type.ITEM_FULFILLMENT, isDynamic: true });
        f.setValue({ fieldId: 'shipstatus', value: 'C' });
        f.setValue({ fieldId: 'memo', value: memo });
        setLines(f, lines);
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }

    function receiveTransferOrder(toId, lines, memo) {
        const r = record.transform({ fromType: record.Type.TRANSFER_ORDER, fromId: toId, toType: record.Type.ITEM_RECEIPT, isDynamic: true });
        r.setValue({ fieldId: 'memo', value: memo });
        setLines(r, lines);
        return String(r.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }

    // v3 write ops (spec 6). if_qty and if_stamp re-read NetSuite and refuse if the IF changed since the plan; if_create and receipt transform the TO.
    function changed(msg) { return new Error('IF changed in NetSuite, review: ' + msg); }
    function stampOn(rec, op) {
        rec.setValue({ fieldId: 'custbody_rsm_container_no', value: op.trailer });
        rec.setValue({ fieldId: 'custbody7', value: 'SEAL: ' + op.seal });
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
    function stampShip(op) {
        const f = record.load({ type: record.Type.ITEM_FULFILLMENT, id: op.ifId, isDynamic: true });
        const st = String(f.getValue({ fieldId: 'shipstatus' }));
        if (st !== 'A' && st !== 'B') throw changed(op.ifNum + ' is no longer Picked/Packed (status ' + st + ')');
        stampOn(f, op);
        f.setValue({ fieldId: 'shipstatus', value: 'C' });
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    function createIf(op) {
        const f = record.transform({ fromType: record.Type.TRANSFER_ORDER, fromId: op.toId, toType: record.Type.ITEM_FULFILLMENT, isDynamic: true });
        f.setValue({ fieldId: 'shipstatus', value: 'C' });
        stampOn(f, op);
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
    function apply(op) {
        if (op.op === 'if_qty') return setIfItemQty(op);
        if (op.op === 'if_stamp') return stampShip(op);
        if (op.op === 'if_create') return createIf(op);
        if (op.op === 'receipt') return createReceipt(op);
        throw new Error('Unknown op ' + op.op);
    }

    return { apply, findByToken, createTransferOrder, committedShortfalls, fulfillTransferOrder, receiveTransferOrder };
});
