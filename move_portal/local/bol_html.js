// move_portal/local/bol_html.js — printable Letter HTML of the VICS BOL for the local beta (mirrors move_label_template.bolXml). Node only.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const w = n => (n == null ? '' : Number(n).toLocaleString('en-US'));

function bolHtml(b) {
    const p = b.plan || { lines: [], units: 0, pcs: 0, lbs: null };
    const bolNo = b.planOnly ? '—' : b.bolNo;
    const ifs = (b.ifNums || []).filter(Boolean);
    const bar = (t, n) => '<tr><th class="bar" colspan="' + (n || 2) + '">' + t + '</th></tr>';
    const kv = (k, v) => '<tr><td class="k">' + k + '</td><td>' + esc(v) + '</td></tr>';
    const party = (title, x, extra) => '<table>' + bar(title) + kv('Name:', x.name) + kv('Address:', x.addr) + kv('City/State/Zip:', x.csz) + (extra || '') + '</table>';
    const line = (k, v) => '<tr><td colspan="2">' + k + ' <b>' + esc(v) + '</b></td></tr>';
    const td = (t, a) => '<td' + (a || '') + '>' + t + '</td>';
    const R = ' class="r"', C = ' class="c"';
    const order = '<table>' + bar('CUSTOMER ORDER INFORMATION', 6) +
        '<tr><th>CUSTOMER ORDER NUMBER</th><th># PKGS</th><th>WEIGHT</th><th colspan="2">PALLET/SLIP</th><th>ADDITIONAL SHIPPER INFO</th></tr>' +
        '<tr>' + td(esc(bolNo)) + td(w(p.units), R) + td(w(p.lbs), R) + td('<b>Y</b>', C) + td('N', C) + td(esc(ifs.map(n => '#' + n).join(', '))) + '</tr>' +
        '<tr>' + td('') + td('') + td('') + td('Y', C) + td('N', C) + td(esc(p.lines.map(l => l.sku).join(', '))) + '</tr>' +
        '<tr>' + td('<b>GRAND TOTAL</b>') + td('<b>' + w(p.units) + '</b>', R) + td('<b>' + w(p.lbs) + '</b>', R) + td('', ' colspan="3"') + '</tr></table>';
    const commodity = l => { const d = String(l.desc || '').trim(); return !d || d === l.sku ? String(l.sku || '') : l.sku + ' · ' + d; };
    const carrier = '<table>' + bar('CARRIER INFORMATION', 8) +
        '<tr><th colspan="2">HANDLING UNIT</th><th colspan="2">PACKAGE</th><th>WEIGHT</th><th>COMMODITY DESCRIPTION</th><th>NMFC #</th><th>CLASS</th></tr>' +
        '<tr><th>QTY</th><th>TYPE</th><th>QTY</th><th>TYPE</th><th></th><th></th><th></th><th></th></tr>' +
        p.lines.map(l => '<tr>' + td(w(l.units), R) + td('PLT') + td(w(l.pcs), R) + td(esc(l.type)) + td(w(l.lbs), R) + td(esc(commodity(l))) + td('') + td('') + '</tr>').join('') +
        '<tr>' + td('<b>' + w(p.units) + '</b>', R) + td('') + td('<b>' + w(p.pcs) + '</b>', R) + td('') + td('<b>' + w(p.lbs) + '</b>', R) + td('<b>GRAND TOTAL</b>', C) + td('', ' colspan="2"') + '</tr></table>';
    const sign = '<table><tr><td class="sm"><b>SHIPPER SIGNATURE / DATE</b><br>This is to certify that the above named materials are properly classified, described, packaged, marked and labeled, and are in proper condition for transportation according to the applicable regulations of the U.S. DOT.<br><br>______________________________</td>' +
        '<td class="sm"><b>Trailer Loaded:</b><br>[ ] By Shipper<br>[ ] By Driver</td>' +
        '<td class="sm"><b>Freight Counted:</b><br>[ ] By Shipper<br>[ ] By Driver/pallets said to contain<br>[ ] By Driver/Pieces</td>' +
        '<td class="sm"><b>CARRIER SIGNATURE / PICKUP DATE</b><br>Carrier acknowledges receipt of packages and required placards. <i>Property described above is received in good order, except as noted.</i><br><br>______________________________</td></tr></table>';
    const terms = '<table><tr><td class="sm">Where the rate is dependent on value, shippers are required to state specifically in writing the agreed or declared value of the property as follows: "The agreed or declared value of the property is specifically stated by the shipper to be not exceeding ________ per ________."</td>' +
        '<td>COD Amount: $ __________<br>Fee Terms: Collect [ ] Prepaid [ ]<br>Customer check acceptable [ ]</td></tr>' +
        '<tr><td colspan="2" class="sm"><b>NOTE Liability Limitation for loss or damage in this shipment may be applicable. See 49 U.S.C. 14706(c)(1)(A) and (B).</b> RECEIVED, subject to individually determined rates or contracts that have been agreed upon in writing between the carrier and shipper, if applicable, otherwise to the rates, classifications and rules that have been established by the carrier. ________________ Shipper Signature</td></tr></table>';
    const left = party('SHIP FROM', b.from || {}, kv('SID#:', '')) + party('SHIP TO', b.to || {}, kv('CID#:', '')) +
        '<table>' + bar('THIRD PARTY FREIGHT CHARGES BILL TO:') + kv('Name:', '') + kv('Address:', '') + kv('City/State/Zip:', '') + '</table>' +
        '<table><tr><td style="height:.35in">SPECIAL INSTRUCTIONS: ' + esc(b.notes || '') + '</td></tr></table>';
    const right = '<table>' + line('Bill of Lading Number:', bolNo) + '<tr><td style="height:.45in"></td></tr></table>' +
        '<table>' + line('CARRIER NAME:', b.carrier) + line('Trailer number:', b.trailer) + line('Seal number(s):', b.seal) + line('SCAC:', '') + line('Pro number:', '') + '</table>' +
        '<table><tr><td class="sm"><b>Freight Charge Terms:</b> <i>(prepaid unless marked otherwise)</i><br>Prepaid <b>_X_</b> Collect ___ 3rd Party ___</td></tr><tr><td class="sm">[ ] Master Bill of Lading: with attached underlying Bills of Lading</td></tr></table>';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>BOL ' + esc(bolNo) + '</title><style>' +
        '@page{size:Letter;margin:.35in}body{font-family:Helvetica,Arial,sans-serif;font-size:9.5pt;margin:0}' +
        'table{width:100%;border-collapse:collapse;margin-top:2pt}td,th{border:.6pt solid #000;padding:2pt 4pt;vertical-align:middle}' +
        'th{font-size:7pt}th.bar{background:#000;color:#fff;font-size:8pt}td.k{width:1.05in;font-size:8pt}td.sm{font-size:7pt;vertical-align:top}.r{text-align:right}.c{text-align:center}' +
        '.top{display:flex;justify-content:space-between;align-items:center}.top h1{font-size:16pt;margin:0}.cols{display:flex;gap:4pt}.cols>div{flex:1}.cols>div:first-child{flex:1.2}' +
        '</style></head><body><div style="font-size:7pt">VICS Standard BOL</div>' +
        '<div class="top"><div>Date: <b>' + esc(b.date) + '</b></div><h1>BILL OF LADING</h1><div>Page <b>1</b>' + (Number(b.rev) > 1 ? ' · REV ' + esc(b.rev) : '') + '</div></div>' +
        (b.planOnly ? '<p style="font-size:9pt;font-weight:bold;text-align:center">PLAN ONLY: no TO in NetSuite (writes are off)</p>' : '') +
        '<div class="cols"><div>' + left + '</div><div>' + right + '</div></div>' + order + carrier + terms + sign +
        (p.missing && p.missing.length ? '<p style="font-size:7pt">No unit weight for: ' + esc(p.missing.join(', ')) + '</p>' : '') +
        (p.unknownType && p.unknownType.length ? '<p style="font-size:7pt">Type unknown: ' + esc(p.unknownType.join(', ')) + '</p>' : '') +
        '</body></html>';
}

module.exports = { bolHtml };
