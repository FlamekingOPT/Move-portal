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

    // ── CSV config import ─────────────────────────────────────────────────
    function parseCsv(text) {
        const s = String(text || '').replace(/\r\n?/g, '\n');
        const rows = [];
        let row = [], f = '', q = false;
        for (let i = 0; i < s.length; i++) {
            const c = s[i];
            if (q) {
                if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; }
                else f += c;
            } else if (c === '"') q = true;
            else if (c === ',') { row.push(f); f = ''; }
            else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
            else f += c;
        }
        if (f !== '' || row.length) { row.push(f); rows.push(row); }
        return rows.map(r => r.map(x => x.trim())).filter(r => r.some(x => x !== ''));
    }

    function buildConfigImport(rows, skuToItem) {
        const out = { configs: [], errors: [], unknownSkus: [] };
        const start = rows.length && /sku/i.test(rows[0][0] || '') ? 1 : 0;
        const bySku = {}, order = [];
        for (let i = start; i < rows.length; i++) {
            const r = rows[i], rn = i + 1;
            const sku = String(r[0] || '').toUpperCase();
            if (!sku) { out.errors.push({ row: rn, msg: 'Missing SKU' }); continue; }
            const item = skuToItem[sku];
            if (!item) { if (out.unknownSkus.indexOf(sku) === -1) out.unknownSkus.push(sku); continue; }
            const code = String(r[1] || '').toUpperCase();
            if (!code) { out.errors.push({ row: rn, msg: sku + ': missing config code' }); continue; }
            const pcs = Number(r[2]);
            if (!(pcs > 0) || Math.floor(pcs) !== pcs) { out.errors.push({ row: rn, msg: sku + ' ' + code + ': pieces must be a whole number above 0' }); continue; }
            if (!bySku[sku]) { bySku[sku] = []; order.push(sku); }
            if (bySku[sku].some(x => x.code === code)) { out.errors.push({ row: rn, msg: sku + ' ' + code + ': duplicate config' }); continue; }
            bySku[sku].push({ item: String(item), sku, code, pcs, isDefault: /^(y|yes|true|1)$/i.test(String(r[3] || '')) });
        }
        order.forEach(sku => {
            const list = bySku[sku];
            const defs = list.filter(x => x.isDefault);
            if (defs.length > 1) {
                out.errors.push({ row: 0, msg: sku + ': more than one default, using ' + defs[0].code });
                list.forEach(x => { x.isDefault = x === defs[0]; });
            }
            if (!defs.length) list[0].isDefault = true;
            list.forEach(x => out.configs.push(x));
        });
        return out;
    }

    // ── calendar (ISO YYYY-MM-DD strings, computed in UTC to avoid DST) ──
    const DAY_MS = 86400000;
    function pad2(n) { return String(n).padStart(2, '0'); }
    function isoToUtc(iso) { const p = String(iso).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
    function utcToIso(t) { return new Date(t).toISOString().slice(0, 10); }
    function isoAddDays(iso, n) { return utcToIso(isoToUtc(iso) + n * DAY_MS); }
    function isMoveDay(iso, skipSet) { return new Date(isoToUtc(iso)).getUTCDay() !== 0 && !skipSet[iso]; }
    function skipSetOf(skip) { const s = {}; (skip || []).forEach(d => { s[d] = true; }); return s; }

    function moveDays(fromIso, toIso, skip) {
        const out = [], sk = skipSetOf(skip);
        for (let t = isoToUtc(fromIso), end = isoToUtc(toIso); t <= end; t += DAY_MS) {
            const iso = utcToIso(t);
            if (isMoveDay(iso, sk)) out.push(iso);
        }
        return out;
    }

    function nthMoveDayFrom(fromIso, n, skip) {
        const sk = skipSetOf(skip);
        let iso = fromIso, count = 0;
        for (let guard = 0; guard < 5000; guard++) {
            if (isMoveDay(iso, sk)) { count++; if (count >= n) return iso; }
            iso = isoAddDays(iso, 1);
        }
        return null;
    }

    // NetSuite DATETIMETZ text in M/D/YYYY format, e.g. "10/14/2026 2:14:05 pm"
    function parseNsStamp(s) {
        const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?/i.exec(String(s || ''));
        if (!m) return null;
        let h = Number(m[4]);
        if (m[6]) { const pm = /pm/i.test(m[6]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
        return { dayIso: m[3] + '-' + pad2(m[1]) + '-' + pad2(m[2]), hour: h };
    }

    // ── tracker ───────────────────────────────────────────────────────────
    function estimateRemaining(onHand, defPcs) {
        const byItem = {}, unknownItems = [];
        let pallets = 0;
        Object.keys(onHand || {}).forEach(k => {
            const q = Number(onHand[k]) || 0;
            if (q <= 0) return;
            const pcs = Number(defPcs && defPcs[k]) || 0;
            if (!pcs) { unknownItems.push(k); return; }
            byItem[k] = Math.ceil(q / pcs);
            pallets += byItem[k];
        });
        return { pallets, byItem, unknownItems };
    }

    function trackerMetrics(o) {
        const skip = o.skipDates || [];
        const moved = o.movedByDay || {};
        const movedTotal = Object.keys(moved).reduce((a, k) => a + (Number(moved[k]) || 0), 0);
        const fromIso = o.todayDone ? nthMoveDayFrom(isoAddDays(o.todayIso, 1), 1, skip) : o.todayIso;
        const daysLeft = fromIso > o.targetIso ? 0 : moveDays(fromIso, o.targetIso, skip).length;
        const done = moveDays(o.startIso, o.todayIso, skip).filter(d => d < o.todayIso || o.todayDone);
        const sumOf = ds => ds.reduce((a, d) => a + (Number(moved[d]) || 0), 0);
        const last7 = done.slice(-7);
        const avg7 = last7.length ? sumOf(last7) / last7.length : 0;
        const avgAll = done.length ? sumOf(done) / done.length : 0;
        const remaining = Math.max(0, Number(o.remaining) || 0);
        const needed = daysLeft ? Math.ceil(remaining / daysLeft) : (remaining > 0 ? Infinity : 0);
        let projected = null;
        if (remaining === 0) projected = o.todayIso;
        else if (avg7 > 0) projected = nthMoveDayFrom(fromIso, Math.ceil(remaining / avg7), skip);
        return {
            moved: movedTotal, remaining, total: movedTotal + remaining, movedToday: Number(moved[o.todayIso]) || 0,
            daysLeft, neededPerDay: needed, avg7: Math.round(avg7 * 10) / 10, avgAll: Math.round(avgAll * 10) / 10,
            projectedFinish: projected, onTrack: !!projected && projected <= o.targetIso
        };
    }

    // Split `total` labels across SKUs in proportion to pallets left (largest remainder).
    function suggestPlan(rows, total) {
        const out = {};
        const sum = rows.reduce((a, r) => a + r.palletsLeft, 0);
        const want = Math.min(Math.max(0, Math.floor(Number(total) || 0)), sum);
        if (!want) { rows.forEach(r => { out[r.item] = 0; }); return out; }
        const parts = rows.map(r => {
            const raw = want * r.palletsLeft / sum;
            return { item: r.item, base: Math.floor(raw), frac: raw - Math.floor(raw), cap: r.palletsLeft };
        });
        let left = want - parts.reduce((a, p) => a + p.base, 0);
        parts.slice().sort((a, b) => b.frac - a.frac).forEach(p => { if (left > 0 && p.base < p.cap) { p.base++; left--; } });
        parts.forEach(p => { out[p.item] = Math.min(p.base, p.cap); });
        return out;
    }

    return {
        PALLET, LOAD, palletCode, parseScan, totalPieces, summarize, headline,
        isEdited, validateLines, pcsMap, defaultPcs, loadScanRule, receiveScanRule, toneFor,
        aggregate, shortages, nextLoadNumber, catchupNumber, txToken, parseCsv, buildConfigImport,
        isoAddDays, moveDays, nthMoveDayFrom, parseNsStamp, estimateRemaining, trackerMetrics, suggestPlan
    };
});
