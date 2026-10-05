// move_portal/local/label_html.js — node-only. Printable 4x6 HTML labels for the local beta (mirrors move_label_template.js).
'use strict';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const skuSize = sku => { const n = String(sku || '').length; return n <= 7 ? 48 : n <= 10 ? 38 : n <= 13 ? 30 : 24; };
const cfgText = l => l.cfg ? 'Config ' + l.cfg : 'Custom';
// attribute-safe: escape, and keep TABs as numeric references so nothing normalises them away
const attr = s => esc(s).replace(/\t/g, '&#9;');

const CSS = '*{box-sizing:border-box}body{margin:0;background:#e5e7eb;font-family:Arial,Helvetica,sans-serif}' +
    '.tip{background:#1e293b;color:#fff;padding:10px 14px;font-size:14px}' +
    '.label{width:4in;height:6in;background:#fff;color:#000;padding:.15in;display:flex;flex-direction:column;overflow:hidden;margin:10px auto;border:1px solid #999;page-break-after:always;break-after:page}' +
    '.l-top{display:flex;justify-content:space-between;font-weight:800;font-size:12pt;border-bottom:2pt solid #000;padding-bottom:4pt}' +
    '.l-sku{font-weight:900;line-height:1;margin-top:8pt;white-space:nowrap}.l-cfg{font-size:18pt;font-weight:700;margin-top:2pt}' +
    '.l-pcs{font-size:36pt;font-weight:900;margin-top:4pt}.l-desc{font-size:11pt;margin-top:4pt}' +
    '.l-mixed{width:100%;margin-top:4pt;border-collapse:collapse}.l-mixed td{font-size:16pt;font-weight:700;border-bottom:.5pt solid #999;padding:2pt 0}' +
    '.l-codes{margin-top:auto;display:flex;flex-direction:column;align-items:center;gap:6pt}.l-qr svg{width:1.5in;height:1.5in;display:block}' +
    '.l-text{font:700 14pt "Courier New",monospace}' +
    '.l-foot{display:flex;justify-content:space-between;border-top:.5pt solid #000;margin-top:6pt;padding-top:3pt;font-size:9pt}.l-foot b{font-size:12pt}' +
    '.hdr{align-items:center;text-align:center;justify-content:center}' +
    '@media print{@page{size:4in 6in;margin:0}body{background:#fff}.tip{display:none!important}.label{border:0;margin:0}.label:last-child{page-break-after:auto;break-after:auto}}';

function labelDiv(p, core, code) {
    const lines = p.lines || [];
    let mid;
    if (lines.length === 1) {
        const s = lines[0];
        mid = '<div class="l-sku" style="font-size:' + skuSize(s.sku) + 'pt">' + esc(s.sku) + '</div><div class="l-cfg">' + esc(cfgText(s)) + '</div>' +
            '<div class="l-pcs">' + esc(s.pcs) + ' pcs</div><div class="l-desc">' + esc(s.desc || '') + '</div>';
    } else {
        mid = '<div class="l-sku" style="font-size:40pt">MIXED</div><table class="l-mixed">' +
            lines.slice(0, 5).map(x => '<tr><td>' + esc(x.sku) + '</td><td style="text-align:right">' + esc(x.pcs) + ' pcs</td></tr>').join('') +
            '<tr><td style="font-weight:400">Total</td><td style="text-align:right;font-weight:400">' + esc(p.pieces) + ' pcs</td></tr></table>';
    }
    const payload = core.barcodePayload(p.code, lines);
    return '<div class="label"><div class="l-top"><span>MOVE</span><span>' + esc(code.from) + ' &gt; ' + esc(code.to) + '</span></div>' + mid +
        '<div class="l-codes"><div class="l-qr" data-payload="' + attr(payload) + '"></div><div class="l-text">' + esc(p.code) + '</div></div>' +
        '<div class="l-foot"><span>printed ' + esc(p.printedDay) + (p.by ? ' · ' + esc(p.by) : '') + '</span><b>' + (p.edited ? 'EDITED' : '') + '</b></div></div>';
}

function headerDiv(first, last, n) {
    const l = first.lines || [], s = l[0] || {}, single = l.length === 1;
    const title = single ? s.sku : 'MIXED';
    const sub = single ? cfgText(s) + ' · ' + s.pcs + ' pcs' : first.summary;
    return '<div class="label hdr"><div style="font-size:14pt">BATCH HEADER</div><div style="font-size:' + skuSize(title) + 'pt;font-weight:900;margin-top:8pt">' + esc(title) + '</div>' +
        '<div style="font-size:18pt;font-weight:700">' + esc(sub) + '</div><div style="font-size:32pt;font-weight:900;margin-top:14pt">' + n + ' labels</div>' +
        '<div style="font-size:11pt;margin-top:8pt">' + esc(first.code) + ' - ' + esc(last.code) + '</div></div>';
}

// pallets: [{code, lines, pieces, edited, printedDay, by, summary}]; like the BFO template, one header per run of equal summaries.
function labelsHtml(pallets, o) {
    o = o || {};
    const names = { from: String(o.fromName || '').toUpperCase(), to: String(o.toName || '').toUpperCase() };
    const pages = [];
    let i = 0;
    while (i < pallets.length) {
        let j = i;
        while (j + 1 < pallets.length && pallets[j + 1].summary === pallets[i].summary) j++;
        if (o.header) pages.push(headerDiv(pallets[i], pallets[j], j - i + 1));
        for (let k = i; k <= j; k++) pages.push(labelDiv(pallets[k], o.core, names));
        i = j + 1;
    }
    const script = 'function go(){document.querySelectorAll(".l-qr").forEach(function(e){var q=qrcode(0,"M");q.addData(e.getAttribute("data-payload"));q.make();' +
        'e.innerHTML=q.createSvgTag({cellSize:4,margin:2,scalable:true});});setTimeout(function(){window.print();},300);}' +
        'if(window.qrcode)go();else document.body.insertAdjacentHTML("afterbegin","<p style=\\"color:#dc2626;font-weight:700\\">QR library did not load (no internet?)</p>");';
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Move labels</title>' +
        '<script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"></script><style>' + CSS + '</style></head><body>' +
        '<div class="tip">Print: Scale Default · Headers and footers off · Paper 4×6 · Margins None</div>' + pages.join('') +
        '<script>' + script + '</script></body></html>';
}

module.exports = { labelsHtml, esc };
