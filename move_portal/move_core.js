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

    // ── (Task 2) scan rules, aggregation, numbering ──────────────────────

    // ── (Task 3) CSV config import ────────────────────────────────────────

    // ── (Task 4) calendar, tracker, plan ─────────────────────────────────

    return {
        PALLET, LOAD, palletCode, parseScan, totalPieces, summarize, headline,
        isEdited, validateLines, pcsMap, defaultPcs
    };
});
