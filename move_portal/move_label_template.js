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

    // VICS standard straight bill of lading, one letter page (spec 2026-10-18). b = the server's bolData():
    // { date, bolNo, rev, planOnly, from {name, addr, csz}, to {…}, carrier, trailer, seal, ifNums [], plan { lines, units, pcs, lbs, missing } }.
    // Blank seal / weight boxes stay empty for the driver or office to write in.
    // Carrier lines: the commodity description leads with the SKU # (Jack 10/19); no H.M. column for now.
    function commodity(l) { const d = String(l.desc || '').trim(); return !d || d === l.sku ? String(l.sku || '') : l.sku + ' · ' + d; }
    function bolXml(b) {
        const B = 'border:0.6pt solid #000;', bar = t => '<td colspan="2" style="' + B + 'background-color:#000;color:#fff;font-weight:bold;font-size:8pt;padding:1pt 4pt" align="center">' + t + '</td>';
        const kv = (k, v) => '<tr><td style="width:1.05in;font-size:8pt;padding:1pt 3pt">' + k + '</td><td style="font-size:9.5pt;padding:1pt 3pt">' + esc(v) + '</td></tr>';
        const party = (title, p, extra) => '<table width="100%" style="' + B + '"><tr>' + bar(title) + '</tr>' + kv('Name:', p.name) + kv('Address:', p.addr) + kv('City/State/Zip:', p.csz) +
            (extra || '') + '</table>';
        const right = (rows) => '<table width="100%" style="' + B + '">' + rows + '</table>';
        const line = (k, v) => '<tr><td style="font-size:8.5pt;padding:2pt 4pt">' + k + ' <b style="font-size:10pt">' + esc(v) + '</b></td></tr>';
        const bolNo = b.planOnly ? '—' : b.bolNo;
        const p = b.plan || { lines: [], units: 0, pcs: 0, lbs: null };
        const w = n => (n == null ? '' : Number(n).toLocaleString('en-US'));
        const th = (t, x) => '<td style="' + B + 'font-size:7pt;font-weight:bold;padding:1pt 2pt" align="center"' + (x || '') + '>' + t + '</td>';
        const td = (t, x) => '<td style="' + B + 'font-size:9pt;padding:2pt 3pt"' + (x || '') + '>' + t + '</td>';
        const ifs = (b.ifNums || []).filter(Boolean);
        const order = '<table width="100%" style="' + B + 'margin-top:2pt"><tr><td colspan="6" style="' + B + 'background-color:#000;color:#fff;font-weight:bold;font-size:8pt" align="center">CUSTOMER ORDER INFORMATION</td></tr>' +
            '<tr>' + th('CUSTOMER ORDER NUMBER') + th('# PKGS') + th('WEIGHT') + th('PALLET/SLIP', ' colspan="2"') + th('ADDITIONAL SHIPPER INFO') + '</tr>' +
            '<tr>' + td(esc(bolNo)) + td(w(p.units), ' align="right"') + td(w(p.lbs), ' align="right"') + td('<b>Y</b>', ' align="center"') + td('N', ' align="center"') + td(esc(ifs.map(n => '#' + n).join(', '))) + '</tr>' +
            '<tr>' + td('') + td('') + td('') + td('Y', ' align="center"') + td('N', ' align="center"') + td(esc(p.lines.map(l => l.sku).join(', '))) + '</tr>' +
            '<tr>' + td('<b>GRAND TOTAL</b>') + td('<b>' + w(p.units) + '</b>', ' align="right"') + td('<b>' + w(p.lbs) + '</b>', ' align="right"') + td('', ' colspan="3"') + '</tr></table>';
        const carrier = '<table width="100%" style="' + B + 'margin-top:2pt"><tr><td colspan="8" style="' + B + 'background-color:#000;color:#fff;font-weight:bold;font-size:8pt" align="center">CARRIER INFORMATION</td></tr>' +
            '<tr>' + th('HANDLING UNIT', ' colspan="2"') + th('PACKAGE', ' colspan="2"') + th('WEIGHT') + th('COMMODITY DESCRIPTION') + th('NMFC #') + th('CLASS') + '</tr>' +
            '<tr>' + th('QTY') + th('TYPE') + th('QTY') + th('TYPE') + th('') + th('') + th('') + th('') + '</tr>' +
            p.lines.map(l => '<tr>' + td(w(l.units), ' align="right"') + td('PLT') + td(w(l.pcs), ' align="right"') + td(l.type) + td(w(l.lbs), ' align="right"') +
                td(esc(commodity(l))) + td('') + td('') + '</tr>').join('') +
            '<tr>' + td('<b>' + w(p.units) + '</b>', ' align="right"') + td('') + td('<b>' + w(p.pcs) + '</b>', ' align="right"') + td('') + td('<b>' + w(p.lbs) + '</b>', ' align="right"') +
            td('<b>GRAND TOTAL</b>', ' align="center"') + td('', ' colspan="2"') + '</tr></table>';
        const sign = '<table width="100%" style="' + B + 'margin-top:2pt"><tr>' +
            '<td style="' + B + 'font-size:7pt;padding:3pt;width:34%"><b>SHIPPER SIGNATURE / DATE</b><br/>This is to certify that the above named materials are properly classified, described, packaged, marked and labeled, and are in proper condition for transportation according to the applicable regulations of the U.S. DOT.<br/><br/><br/>______________________________</td>' +
            '<td style="' + B + 'font-size:7pt;padding:3pt;width:14%"><b>Trailer Loaded:</b><br/>[ ] By Shipper<br/>[ ] By Driver</td>' +
            '<td style="' + B + 'font-size:7pt;padding:3pt;width:18%"><b>Freight Counted:</b><br/>[ ] By Shipper<br/>[ ] By Driver/pallets said to contain<br/>[ ] By Driver/Pieces</td>' +
            '<td style="' + B + 'font-size:7pt;padding:3pt"><b>CARRIER SIGNATURE / PICKUP DATE</b><br/>Carrier acknowledges receipt of packages and required placards. Carrier certifies emergency response information was made available and/or carrier has the U.S. DOT emergency response guidebook or equivalent documentation in the vehicle.<br/><i>Property described above is received in good order, except as noted.</i><br/><br/>______________________________</td></tr></table>';
        const terms = '<table width="100%" style="' + B + 'margin-top:2pt"><tr><td style="' + B + 'font-size:7pt;padding:3pt;width:55%">Where the rate is dependent on value, shippers are required to state specifically in writing the agreed or declared value of the property as follows: "The agreed or declared value of the property is specifically stated by the shipper to be not exceeding ________ per ________."</td>' +
            '<td style="' + B + 'font-size:8pt;padding:3pt">COD Amount: $ __________<br/>Fee Terms: Collect [ ] Prepaid [ ]<br/>Customer check acceptable [ ]</td></tr>' +
            '<tr><td colspan="2" style="' + B + 'font-size:7pt;padding:3pt"><b>NOTE Liability Limitation for loss or damage in this shipment may be applicable. See 49 U.S.C. 14706(c)(1)(A) and (B).</b><br/>RECEIVED, subject to individually determined rates or contracts that have been agreed upon in writing between the carrier and shipper, if applicable, otherwise to the rates, classifications and rules that have been established by the carrier and are available to the shipper, on request, and to all applicable state and federal regulations. The carrier shall not make delivery of this shipment without payment of freight and all other lawful charges. ________________ Shipper Signature</td></tr></table>';
        const top = '<table width="100%"><tr><td style="font-size:10pt;' + B + 'padding:2pt 4pt;width:30%">Date: <b>' + esc(b.date) + '</b></td>' +
            '<td align="center" style="font-size:16pt;font-weight:bold">BILL OF LADING</td><td align="right" style="font-size:10pt">Page <b>1</b>' + (Number(b.rev) > 1 ? ' · REV ' + esc(b.rev) : '') + '</td></tr></table>' +
            (b.planOnly ? '<p style="font-size:9pt;font-weight:bold;text-align:center">PLAN ONLY: no TO in NetSuite (writes are off)</p>' : '');
        const body = '<table width="100%" style="margin-top:2pt"><tr><td style="width:55%;vertical-align:top">' +
            party('SHIP FROM', b.from || {}, kv('SID#:', '')) + party('SHIP TO', b.to || {}, kv('CID#:', '')) +
            '<table width="100%" style="' + B + '"><tr>' + bar('THIRD PARTY FREIGHT CHARGES BILL TO:') + '</tr>' + kv('Name:', '') + kv('Address:', '') + kv('City/State/Zip:', '') + '</table>' +
            '<table width="100%" style="' + B + '"><tr><td style="font-size:8pt;padding:2pt 3pt;height:0.35in">SPECIAL INSTRUCTIONS: ' + esc(b.notes || '') + '</td></tr></table>' +
            '</td><td style="vertical-align:top">' +
            right(line('Bill of Lading Number:', bolNo) + '<tr><td style="height:0.45in"></td></tr>') +
            right(line('CARRIER NAME:', b.carrier) + line('Trailer number:', b.trailer) + line('Seal number(s):', b.seal) + line('SCAC:', '') + line('Pro number:', '') + '<tr><td style="height:0.3in"></td></tr>') +
            right('<tr><td style="font-size:8pt;padding:2pt 4pt"><b>Freight Charge Terms:</b> <i>(freight charges are prepaid unless marked otherwise)</i><br/>Prepaid <b>_X_</b>   Collect ___   3rd Party ___</td></tr>' +
                '<tr><td style="font-size:8pt;padding:2pt 4pt">[ ] Master Bill of Lading: with attached underlying Bills of Lading</td></tr>') +
            '</td></tr></table>';
        return HEAD + '<pdf><head><style>p { margin: 0; } td { vertical-align: middle; }</style></head>' +
            '<body size="Letter" padding="0.35in" font-family="Helvetica"><p style="font-size:7pt">VICS Standard BOL</p>' + top + body + order + carrier + terms + sign +
            (p.missing && p.missing.length ? '<p style="font-size:7pt;margin-top:3pt">No unit weight for: ' + esc(p.missing.join(', ')) + '</p>' : '') +
            (p.unknownType && p.unknownType.length ? '<p style="font-size:7pt;margin-top:3pt">Type unknown: ' + esc(p.unknownType.join(', ')) + '</p>' : '') + '</body></pdf>';
    }

    return { esc: esc, skuSize: skuSize, labelsXml: labelsXml, bolXml: bolXml };
});
