/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: BFO XML for 4x6 pallet labels, batch header cards and the load sheet.
 * Pure string building (no N/ modules) so it is unit-tested in node.
 */
define([], function () {
    'use strict';
    const HEAD = '<?xml version="1.0"?>\n<!DOCTYPE pdf PUBLIC "-//big.faceless.org//report" "report-1.1.dtd">\n';

    function esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function skuSize(sku) { const n = String(sku || '').length; return n <= 7 ? 48 : n <= 10 ? 38 : n <= 13 ? 30 : 24; }
    function cfgText(l) { return l.cfg ? 'Config ' + l.cfg : 'Custom'; }

    function codeBlock(code, payload, mode) {
        const text = '<p align="center" style="font-family:Courier;font-size:14pt;font-weight:bold">' + esc(code) + '</p>';
        const val = esc(payload).replace(/\t/g, '&#9;');
        const c128 = '<barcode codetype="code128" showtext="false" value="' + val + '" width="3.5in" height="0.9in"/>';
        const qrSize = mode === 'qr' ? '1.5in' : '1.1in';
        const qr = '<barcode codetype="qrcode" value="' + val + '" width="' + qrSize + '" height="' + qrSize + '"/>';
        let rows = '';
        if (mode !== 'qr') rows += '<tr><td align="center">' + c128 + '</td></tr><tr><td align="center">' + text + '</td></tr>';
        if (mode !== 'c128') rows += '<tr><td align="center" style="padding-top:4pt">' + qr + '</td></tr>';
        if (mode === 'qr') rows += '<tr><td align="center">' + text + '</td></tr>';
        return '<table width="100%" style="margin-top:8pt">' + rows + '</table>';
    }

    function labelPage(l, o) {
        const top = '<table width="100%" style="border-bottom:2pt solid #000"><tr>' +
            '<td style="font-size:12pt;font-weight:bold">MOVE</td>' +
            '<td align="right" style="font-size:12pt;font-weight:bold">' + esc(String(o.fromName).toUpperCase()) +
            ' &gt; ' + esc(String(o.toName).toUpperCase()) + '</td></tr></table>';
        let mid;
        if (l.lines.length === 1) {
            const s = l.lines[0];
            mid = '<p style="font-size:' + skuSize(s.sku) + 'pt;font-weight:bold;margin-top:8pt">' + esc(s.sku) + '</p>' +
                '<p style="font-size:18pt;font-weight:bold">' + esc(cfgText(s)) + '</p>' +
                '<p style="font-size:36pt;font-weight:bold;margin-top:4pt">' + esc(s.pcs) + ' pcs</p>' +
                '<p style="font-size:11pt;margin-top:4pt">' + esc(s.desc || '') + '</p>';
        } else {
            mid = '<p style="font-size:40pt;font-weight:bold;margin-top:8pt">MIXED</p><table width="100%" style="margin-top:4pt">' +
                l.lines.map(x => '<tr><td style="font-size:16pt;font-weight:bold;border-bottom:0.5pt solid #999">' + esc(x.sku) +
                    '</td><td align="right" style="font-size:16pt;font-weight:bold;border-bottom:0.5pt solid #999">' + esc(x.pcs) + ' pcs</td></tr>').join('') +
                '<tr><td style="font-size:16pt">Total</td><td align="right" style="font-size:16pt">' + esc(l.pieces) + ' pcs</td></tr></table>';
        }
        const foot = '<table width="100%" style="border-top:0.5pt solid #000;margin-top:6pt"><tr>' +
            '<td style="font-size:9pt">printed ' + esc(l.printedDay) + (l.by ? ' · ' + esc(l.by) : '') + '</td>' +
            '<td align="right" style="font-size:12pt;font-weight:bold">' + (l.edited ? 'EDITED' : '') + '</td></tr></table>';
        return top + mid + codeBlock(l.code, [l.code].concat(...l.lines.map(x => [x.sku, x.pcs])).join('\t'), o.codeMode || 'both') + foot;
    }

    function headerPage(first, last, n) {
        const s = first.lines[0] || {};
        const single = first.lines.length === 1;
        const title = single ? s.sku : 'MIXED';
        const sub = single ? cfgText(s) + ' · ' + s.pcs + ' pcs' : first.summary;
        return '<p align="center" style="font-size:14pt;margin-top:0.8in">BATCH HEADER</p>' +
            '<p align="center" style="font-size:' + skuSize(title) + 'pt;font-weight:bold;margin-top:8pt">' + esc(title) + '</p>' +
            '<p align="center" style="font-size:18pt;font-weight:bold">' + esc(sub) + '</p>' +
            '<p align="center" style="font-size:32pt;font-weight:bold;margin-top:14pt">' + n + ' labels</p>' +
            '<p align="center" style="font-size:11pt;margin-top:8pt">' + esc(first.code) + ' - ' + esc(last.code) + '</p>';
    }

    function labelsXml(labels, o) {
        const pages = [];
        let i = 0;
        while (i < labels.length) {
            let j = i;
            while (j + 1 < labels.length && labels[j + 1].summary === labels[i].summary) j++;
            if (o.header) pages.push(headerPage(labels[i], labels[j], j - i + 1));
            for (let k = i; k <= j; k++) pages.push(labelPage(labels[k], o));
            i = j + 1;
        }
        return HEAD + '<pdf><head><style>p { margin: 0; }</style></head>' +
            '<body width="4in" height="6in" padding="0.15in" font-family="Helvetica">' + pages.join('<pbr/>') + '</body></pdf>';
    }

    return { esc: esc, skuSize: skuSize, labelsXml: labelsXml };
});
