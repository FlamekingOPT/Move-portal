/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * move_ns: the NetSuite read layer for the Move Portal. Runs the SuiteQL text in
 * move_verify.SQL() through N/query and hands the rows to move_verify.buildReads(),
 * the same builder the local beta feeds from a snapshot file. One pull per action
 * (the Suitelet calls resetCache() at the start of every request).
 */
define(['N/query', './move_data', './move_verify'], function (query, data, verify) {
    'use strict';

    const IN_CHUNK = 500;          // SuiteQL IN (...) lists stay well under the 1000-value limit
    let cache = null;

    function rows(sql) { return query.runSuiteQL({ query: sql }).asMappedResults(); }
    function distinct(list, key) {
        const seen = {}, out = [];
        (list || []).forEach(r => { const v = r[key]; if (v != null && v !== '' && !seen[v]) { seen[v] = true; out.push(String(v)); } });
        return out;
    }
    // {IDS} queries run in chunks; an empty id list runs nothing.
    function withIds(sql, ids) {
        let out = [];
        for (let i = 0; i < ids.length; i += IN_CHUNK) out = out.concat(rows(sql.replace('{IDS}', ids.slice(i, i + IN_CHUNK).join(','))));
        return out;
    }

    function pull() {
        const S = data.getSettings();
        const q = verify.SQL(S.locFrom, S.locTo);
        const toLines = rows(q.toLines), ifLines = rows(q.ifLines);
        const links = withIds(q.links, distinct(ifLines, 'ifid'));
        const receipts = withIds(q.receipts, distinct(links, 'rcptid'));
        const onHand = rows(q.onHand);
        const items = withIds(q.items, distinct(toLines.concat(onHand), 'item'));
        return { pulledAt: new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', locFrom: String(S.locFrom), locTo: String(S.locTo),
            toLines: toLines, ifLines: ifLines, links: links, receipts: receipts, onHand: onHand, items: items };
    }
    function reads() { if (!cache) cache = verify.buildReads(pull()); return cache; }

    const api = {};
    ['plannedIfs', 'openToLines', 'ifInfo', 'ifsByTo', 'receiptsByIf', 'items', 'onHand', 'pulledAt'].forEach(k => {
        api[k] = function () { return reads()[k].apply(null, arguments); };
    });
    api.resetCache = function () { cache = null; };
    return api;
});
