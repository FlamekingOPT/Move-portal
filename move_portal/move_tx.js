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
        if (hasField(rec, SEAL_FLD) && String(op.seal || '').trim()) rec.setValue({ fieldId: SEAL_FLD, value: 'SEAL: ' + op.seal });
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
        const all = itemLines(f, op.item);
        if (!all.length && op.newLine && Number(op.to) > 0) throw new Error('NO_IF_LINE ' + op.ifNum + ' has no line for item ' + op.item);
        // Only ticked lines ship (the same rule as tickedQty): an unticked line's quantity is not on the IF.
        const isTicked = i => f.getSublistValue({ sublistId: 'item', fieldId: 'itemreceive', line: i }) !== false;
        let lines = all.filter(isTicked);
        const cur = lines.reduce((a, i) => a + (Number(f.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0), 0);
        if (cur === Number(op.to)) return String(op.ifId);   // an earlier write landed but the request died before it was recorded
        if (cur !== Number(op.from)) throw changed(op.ifNum + ' item ' + op.item + ' is ' + cur + ', expected ' + op.from);
        if (Number(op.to) > Number(op.from) && Number(op.to) - Number(op.from) > toRemaining(op.toId, op.item)) throw changed('TO ' + op.toId + ' has no room to raise ' + op.ifNum + ' to ' + op.to);
        if (Number(op.to) <= 0) {
            let others = 0;
            for (let i = 0; i < f.getLineCount({ sublistId: 'item' }); i++) if (all.indexOf(i) === -1 && isTicked(i)) others++;
            if (!others) throw changed(op.ifNum + ' would be emptied by taking item ' + op.item + ' to 0');
        }
        if (!lines.length && Number(op.to) > 0) {    // the item's only lines are unticked (taken to 0 earlier): re-tick the last one
            const i = all[all.length - 1];
            f.selectLine({ sublistId: 'item', line: i });
            f.setCurrentSublistValue({ sublistId: 'item', fieldId: 'itemreceive', value: true });
            f.commitLine({ sublistId: 'item' });
            lines = [i];
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
    // A transaction the portal made earlier, found by the [MV-<ref>] tag in its memo (a request that died after the save, before it was recorded).
    function findByToken(tok, typeCode, more) {
        const r = search.create({ type: search.Type.TRANSACTION,
            filters: [['memo', 'contains', tok], 'AND', ['mainline', 'is', 'T'], 'AND', ['type', 'anyof', typeCode]].concat(more || []),
            columns: ['internalid'] }).run().getRange({ start: 0, end: 1 });
        return r && r[0] ? String(r[0].id) : null;
    }
    function locationSubsidiary(locId) {
        const f = search.lookupFields({ type: search.Type.LOCATION, id: locId, columns: ['subsidiary'] });
        const s = f && f.subsidiary;
        return Array.isArray(s) && s.length ? s[0].value : null;
    }
    // Scan-built truck (spec 2026-10-14 §3.1): an approved TO from Riverside to Tippecanoe, one line per item.
    function createTransferOrder(op) {
        const found = findByToken(op.token, 'TrnfrOrd');
        if (found) return found;
        const to = record.create({ type: record.Type.TRANSFER_ORDER, isDynamic: true });
        const sub = locationSubsidiary(op.fromLoc);
        if (sub) to.setValue({ fieldId: 'subsidiary', value: sub });
        to.setValue({ fieldId: 'location', value: op.fromLoc });
        to.setValue({ fieldId: 'transferlocation', value: op.toLoc });
        to.setValue({ fieldId: 'orderstatus', value: op.orderStatus || 'B' });
        to.setValue({ fieldId: 'memo', value: op.memo });
        Object.keys(op.lines).forEach(item => {
            to.selectNewLine({ sublistId: 'item' });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: item });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: op.lines[item] });
            to.commitLine({ sublistId: 'item' });
        });
        return String(to.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    // Release check: a TO the manager closed (or deleted) in NetSuite. "no rec" is the test fake's not-found message.
    function toClosed(toId) {
        let to;
        try { to = record.load({ type: record.Type.TRANSFER_ORDER, id: toId }); }
        catch (e) { const m = String((e && (e.name || '')) + ' ' + (e && e.message || '')); if (/RCRD_DSNT_EXIST|no rec/.test(m)) return true; throw e; }
        if (String(to.getValue({ fieldId: 'orderstatus' }) || '') === 'H') return true;
        const n = to.getLineCount({ sublistId: 'item' });
        for (let i = 0; i < n; i++) if (to.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i }) !== true) return false;
        return n > 0;
    }
    // Delete-truck guard: is the IF still in NetSuite? A deleted IF is not found. "no rec" is the test fake's not-found message.
    function ifExists(ifId) {
        try { record.load({ type: record.Type.ITEM_FULFILLMENT, id: ifId }); return true; }
        catch (e) { const m = String((e && (e.name || '')) + ' ' + (e && e.message || '')); if (/RCRD_DSNT_EXIST|no rec/.test(m)) return false; throw e; }
    }
    // Drop trailer at the dock (spec 2026-10-16 4): one TO line to an exact qty. 0 closes the line (no removeLine on a TO with an IF).
    function setToLine(op) {
        const to = record.load({ type: record.Type.TRANSFER_ORDER, id: op.toId, isDynamic: true });
        const lines = itemLines(to, op.item);
        const open = lines.filter(i => to.getSublistValue({ sublistId: 'item', fieldId: 'isclosed', line: i }) !== true);
        const cur = open.reduce((a, i) => a + (Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0), 0);
        if (cur === Number(op.to)) return String(op.toId);
        if (cur !== Number(op.from)) throw changed('TO ' + op.toId + ' item ' + op.item + ' is ' + cur + ', expected ' + op.from);
        const fulfilled = lines.reduce((a, i) => a + (Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantityfulfilled', line: i })) || 0), 0);
        if (Number(op.to) < fulfilled) throw changed('TO ' + op.toId + ' item ' + op.item + ' already has ' + fulfilled + ' fulfilled, cannot set to ' + op.to);
        const setLine = (i, q) => {
            to.selectLine({ sublistId: 'item', line: i });
            if (q > 0) { to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'isclosed', value: false }); to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: q }); }
            else to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'isclosed', value: true });
            to.commitLine({ sublistId: 'item' });
        };
        if (Number(op.to) <= 0) {
            open.forEach(i => setLine(i, 0));
        } else if (lines.length) {
            if (!open.length) setLine(lines[lines.length - 1], Number(op.to));
            else {                                    // fill each open line up to its quantity in order; any increase lands on the last
                let left = Number(op.to);
                open.forEach((i, n) => {
                    const cap = Number(to.getSublistValue({ sublistId: 'item', fieldId: 'quantity', line: i })) || 0;
                    const g = n === open.length - 1 ? left : Math.min(left, cap);
                    left -= g;
                    setLine(i, g);
                });
            }
        } else {
            to.selectNewLine({ sublistId: 'item' });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: op.item });
            to.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: Number(op.to) });
            to.commitLine({ sublistId: 'item' });
        }
        return String(to.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    function stampSeal(op) {
        const f = record.load({ type: record.Type.ITEM_FULFILLMENT, id: op.ifId, isDynamic: true });
        const st = String(f.getValue({ fieldId: 'shipstatus' }));
        if (st !== 'A' && st !== 'B') throw changed(op.ifNum + ' is no longer Picked/Packed (status ' + st + ')');
        if (!String(op.seal || '').trim()) throw new Error('Seal is blank');
        if (!hasField(f, SEAL_FLD)) return String(op.ifId);
        if (verify.sealKey(f.getValue({ fieldId: SEAL_FLD })) === verify.sealKey(op.seal)) return String(op.ifId);   // already holds it
        f.setValue({ fieldId: SEAL_FLD, value: 'SEAL: ' + op.seal });
        return String(f.save({ enableSourcing: true, ignoreMandatoryFields: true }));
    }
    function createIf(op) {
        if ((op.ship === 'packed' || op.ship === 'picked') && op.token) {   // drop trailer: a Packed (Picked before 2026-10-17) IF an earlier request saved on this TO (any status)
            const found = findIf(op.token, op.toId, ['ItemShip:A', 'ItemShip:B', 'ItemShip:C']);
            if (found) return found;
        }
        if (op.ship === true && op.token) {           // scan-built: a Shipped IF an earlier request saved on this TO
            const found = findIf(op.token, op.toId);
            if (found) return found;
        }
        if (op.ship === false && op.token) {
            const found = findPackedByToken(op.token, op.toId);
            if (found) return found;
        }
        const f = record.transform({ fromType: record.Type.TRANSFER_ORDER, fromId: op.toId, toType: record.Type.ITEM_FULFILLMENT, isDynamic: true });
        if (op.ship === false) {                      // a correction add-on: Packed, stamped at departure
            f.setValue({ fieldId: 'shipstatus', value: 'B' });
            if (op.token) f.setValue({ fieldId: 'memo', value: op.token });
        }
        else if (op.ship === 'packed') { f.setValue({ fieldId: 'shipstatus', value: 'B' }); stampOn(f, op); }   // drop trailer docs: Shipped at the manager's ship confirm
        else if (op.ship === 'picked') { f.setValue({ fieldId: 'shipstatus', value: 'A' }); stampOn(f, op); }
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
        if (op.op === 'to_create') return createTransferOrder(op);
        if (op.op === 'if_qty') return setIfItemQty(op);
        if (op.op === 'if_stamp') return stampShip(op);
        if (op.op === 'if_create') return createIf(op);
        if (op.op === 'receipt') return createReceipt(op);
        if (op.op === 'to_line') return setToLine(op);
        if (op.op === 'if_seal') return stampSeal(op);
        throw new Error('Unknown op ' + op.op);
    }

    // Transaction numbers for internal ids: receipts (IR14494) by default, kind 'if' for fulfillments (IF53837).
    // An unreadable one is left out (the caller shows the id).
    function tranIds(ids, kind) {
        const out = {}, isIf = kind === 'if', isTo = kind === 'to';
        const type = isTo ? search.Type.TRANSFER_ORDER : isIf ? search.Type.ITEM_FULFILLMENT : search.Type.ITEM_RECEIPT, pre = isTo ? 'TO' : isIf ? 'IF' : 'IR';
        (ids || []).forEach(id => {
            try { const v = search.lookupFields({ type: type, id: id, columns: ['tranid'] }).tranid; if (v) out[String(id)] = pre + String(v).replace(/^(I[FR]|TO)/i, ''); } catch (e) { /* shown as the id */ }
        });
        return out;
    }

    function findTo(token) { const f = findByToken(token, 'TrnfrOrd'); return f ? String(f) : null; }
    // A Shipped IF on this TO tagged with the token (a scan-built truck's or late pallet's).
    function findIf(token, toId, statuses) { return findByToken(token, 'ItemShip', ['AND', ['createdfrom', 'anyof', String(toId)], 'AND', ['status', 'anyof', statuses || ['ItemShip:C']]]); }
    return { apply, tranIds, toClosed, ifExists, findTo, findIf };
});
