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

    return { findByToken, createTransferOrder, committedShortfalls, fulfillTransferOrder, receiveTransferOrder };
});
