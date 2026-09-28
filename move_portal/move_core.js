/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: pure logic (no N/ modules), unit-tested in node.
 * Spec: docs/superpowers/specs/2026-09-27-move-portal-design.md
 */
define([], function () {
    'use strict';

    const PALLET = {
        LABELED: 'labeled', LOADED: 'loaded', SHIPPED: 'shipped', RECEIVED: 'received',
        MISSING: 'missing', ARRIVED_UNSHIPPED: 'arrived_unshipped', VOID: 'void'
    };
    const LOAD = {
        LOADING: 'loading', READY: 'ready', SHIPPING: 'shipping', SHIPPED: 'shipped',
        RECEIVING: 'receiving', RECV_READY: 'recv_ready', RECEIVING_TX: 'receiving_tx',
        RECEIVED: 'received', RECEIVED_SHORT: 'received_short', ERROR: 'error'
    };

    // ── labels and pallet lines ──────────────────────────────────────────
    function palletCode(id) { return 'PLT' + String(id); }

    function parseScan(raw) {
        const s = String(raw == null ? '' : raw).trim().toUpperCase();
        const m = /^PLT(\d+)$/.exec(s);
        const id = m ? Number(m[1]) : 0;
        return { raw: s, palletId: id > 0 ? id : null };
    }

    function totalPieces(lines) {
        return (lines || []).reduce((a, l) => a + (Number(l.pcs) || 0), 0);
    }

    function summarize(lines) {
        if (!lines || !lines.length) return '';
        if (lines.length === 1) {
            const l = lines[0];
            return l.sku + ' · ' + (l.cfg || 'custom') + ' · ' + l.pcs;
        }
        return 'MIXED · ' + lines.map(l => l.sku + ' ×' + l.pcs).join(', ');
    }

    function headline(lines) {
        if (!lines || !lines.length) return '';
        if (lines.length === 1) return lines[0].sku + ' · ' + (lines[0].cfg ? 'Config ' + lines[0].cfg : 'Custom');
        return 'MIXED · ' + lines.length + ' SKUs';
    }

    // pcs: { itemId: { A: 120, B: 60 } }
    function isEdited(lines, pcs) {
        if (!lines || lines.length !== 1) return false;
        const l = lines[0];
        const m = pcs && pcs[String(l.item)];
        if (!l.cfg || !m || m[l.cfg] == null) return false;
        return Number(l.pcs) !== Number(m[l.cfg]);
    }

    function validateLines(lines) {
        if (!Array.isArray(lines) || !lines.length) return 'At least one SKU is required';
        if (lines.length > 5) return 'A mixed pallet can have at most 5 SKUs';
        const seen = {};
        for (const l of lines) {
            if (!l || !l.item) return 'Unknown SKU';
            const n = Number(l.pcs);
            if (!(n > 0) || Math.floor(n) !== n) return 'Pieces must be a whole number above 0 for ' + (l.sku || 'SKU');
            if (seen[String(l.item)]) return (l.sku || 'SKU') + ' appears twice on one pallet';
            seen[String(l.item)] = true;
        }
        return '';
    }

    // cfgByItem: { itemId: [{ code, pcs, isDefault }] }
    function pcsMap(cfgByItem) {
        const out = {};
        Object.keys(cfgByItem || {}).forEach(k => {
            out[k] = {};
            cfgByItem[k].forEach(c => { out[k][c.code] = c.pcs; });
        });
        return out;
    }

    function defaultPcs(cfgByItem) {
        const out = {};
        Object.keys(cfgByItem || {}).forEach(k => {
            const d = cfgByItem[k].find(c => c.isDefault) || cfgByItem[k][0];
            if (d) out[k] = d.pcs;
        });
        return out;
    }

    // ── scan rules ────────────────────────────────────────────────────────
    // pallet: { status, loadId } | null   loads: { [loadId]: { status, number } }
    function loadScanRule(pallet, loadId, loads) {
        if (!pallet) return { result: 'unknown' };
        const me = String(loadId);
        const pl = pallet.loadId ? String(pallet.loadId) : '';
        const other = (loads && loads[pl]) || {};
        switch (pallet.status) {
            case PALLET.LABELED:
                return { result: 'ok', set: { status: PALLET.LOADED, loadId: me } };
            case PALLET.LOADED:
                if (pl === me) return { result: 'dup' };
                if (other.status === LOAD.LOADING) return { result: 'other_load', otherLoadId: pl, otherNumber: other.number || '' };
                return { result: 'locked_load', otherLoadId: pl, otherNumber: other.number || '' };
            case PALLET.VOID:
                return { result: 'void' };
            default:
                return { result: 'shipped', otherLoadId: pl, otherNumber: other.number || '' };
        }
    }

    function receiveScanRule(pallet, loadId, loads) {
        if (!pallet) return { result: 'unknown' };
        const me = String(loadId);
        const pl = pallet.loadId ? String(pallet.loadId) : '';
        const other = (loads && loads[pl]) || {};
        const elsewhere = { otherLoadId: pl, otherNumber: other.number || '' };
        switch (pallet.status) {
            case PALLET.SHIPPED:
                return pl === me ? { result: 'ok', set: { status: PALLET.RECEIVED } } : Object.assign({ result: 'other_load' }, elsewhere);
            case PALLET.MISSING:
                return pl === me ? { result: 'late', set: { status: PALLET.RECEIVED } } : Object.assign({ result: 'other_load' }, elsewhere);
            case PALLET.RECEIVED:
                return pl === me ? { result: 'dup' } : Object.assign({ result: 'dup_other' }, elsewhere);
            case PALLET.LABELED:
                return { result: 'arrived_unshipped', set: { status: PALLET.ARRIVED_UNSHIPPED, loadId: '' }, fromLoadNumber: '' };
            case PALLET.LOADED:
                if (other.status === LOAD.LOADING) {
                    return { result: 'arrived_unshipped', set: { status: PALLET.ARRIVED_UNSHIPPED, loadId: '' }, fromLoadNumber: other.number || '' };
                }
                return Object.assign({ result: 'other_load_pending' }, elsewhere);
            case PALLET.ARRIVED_UNSHIPPED:
                return { result: 'dup_catchup' };
            case PALLET.VOID:
                return { result: 'void' };
            default:
                return { result: 'unknown' };
        }
    }

    const TONE = { ok: 'ok', late: 'ok', dup: 'warn', other_load: 'warn', dup_other: 'warn', dup_catchup: 'warn', arrived_unshipped: 'warn' };
    function toneFor(result) { return TONE[result] || 'bad'; }

    // ── aggregation and numbering ────────────────────────────────────────
    function aggregate(pallets) {
        const out = {};
        (pallets || []).forEach(p => (p.lines || []).forEach(l => {
            const k = String(l.item);
            out[k] = (out[k] || 0) + (Number(l.pcs) || 0);
        }));
        return out;
    }

    function shortages(agg, avail) {
        return Object.keys(agg)
            .filter(k => (Number(avail && avail[k]) || 0) < agg[k])
            .map(k => ({ item: k, need: agg[k], avail: Number(avail && avail[k]) || 0 }));
    }

    function nextLoadNumber(numbers) {
        let max = 0;
        (numbers || []).forEach(n => { const m = /^MV-(\d+)$/.exec(String(n)); if (m) max = Math.max(max, Number(m[1])); });
        return 'MV-' + String(max + 1).padStart(3, '0');
    }

    function catchupNumber(parent, numbers) {
        const re = new RegExp('^' + String(parent).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + '-C(\\d+)$');
        let max = 0;
        (numbers || []).forEach(n => { const m = re.exec(String(n)); if (m) max = Math.max(max, Number(m[1])); });
        return parent + '-C' + (max + 1);
    }

    function txToken(loadId, kind) { return '[mv:' + loadId + ':' + kind + ']'; }

    // ── (Task 3) CSV config import ────────────────────────────────────────

    // ── (Task 4) calendar, tracker, plan ─────────────────────────────────

    return {
        PALLET, LOAD, palletCode, parseScan, totalPieces, summarize, headline,
        isEdited, validateLines, pcsMap, defaultPcs, loadScanRule, receiveScanRule, toneFor,
        aggregate, shortages, nextLoadNumber, catchupNumber, txToken
    };
});
