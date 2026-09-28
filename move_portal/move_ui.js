/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 *
 * Move Portal: page HTML + the whole browser app. clientMain runs in the browser;
 * it is serialized with toString(), so it must be self-contained.
 */
define([], function () {
    'use strict';

    const CSS = `
:root{--bg:#f1f5f9;--ink:#1f2937;--muted:#6b7280;--line:#e5e7eb;--blue:#2563eb;--blue-soft:#dbeafe;--green:#16a34a;--green-soft:#dcfce7;--amber:#d97706;--amber-soft:#fef3c7;--orange:#ea580c;--red:#dc2626;--red-soft:#fee2e2;--navy:#1e293b;--teal:#0d9488}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.4 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
.top{background:var(--navy);color:#fff;padding:10px 12px;position:sticky;top:0;z-index:5}
.ttl{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#cbd5e1}.ttl b{color:#fff;font-size:16px}
.who{margin-top:6px;font-size:13px;color:#cbd5e1}.who select,.who input{margin-left:6px;padding:7px;border-radius:8px;border:0;font-size:15px}
.toggle{display:flex;margin-top:8px;background:#334155;border-radius:10px;padding:3px}
.toggle button{flex:1;border:0;background:transparent;color:#cbd5e1;padding:12px 4px;border-radius:8px;font-weight:700;font-size:14px}
.toggle button.on.out{background:var(--blue);color:#fff}.toggle button.on.in{background:var(--teal);color:#fff}
.subnav{display:flex;flex-wrap:wrap;background:#fff;border-bottom:1px solid var(--line)}
.subnav div{flex:1 0 auto;text-align:center;padding:13px 10px;font-size:13px;font-weight:700;color:var(--muted);border-bottom:3px solid transparent;cursor:pointer}
.subnav div.on{color:var(--ink);border-color:var(--blue)}
main{padding:12px;max-width:1180px;margin:0 auto}
.btn{display:block;width:100%;border:0;border-radius:12px;padding:15px;font-size:16px;font-weight:700;cursor:pointer;margin:10px 0}
.btn.pri{background:var(--blue);color:#fff}.btn.go{background:var(--green);color:#fff}.btn.teal{background:var(--teal);color:#fff}
.btn.ghost{background:#fff;border:1px solid var(--line);color:var(--ink);font-weight:600}.btn.sm{padding:10px;font-size:14px;border-radius:9px}
.btn:disabled,.dbtn:disabled{opacity:.45}
.dbtn{border:0;border-radius:8px;padding:10px 14px;font-weight:700;font-size:13px;cursor:pointer}
.dbtn.pri{background:var(--blue);color:#fff}.dbtn.go{background:var(--green);color:#fff}.dbtn.gh{background:#fff;border:1px solid var(--line)}
.row2{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
label.f{display:block;font-size:12px;font-weight:700;color:var(--muted);margin:12px 0 5px}
.inp{width:100%;padding:13px;border:1px solid #cbd5e1;border-radius:10px;font-size:16px;background:#fff;margin-bottom:6px}
.num{width:76px;padding:9px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{border:2px solid var(--line);background:#fff;border-radius:10px;padding:10px 12px;cursor:pointer;flex:1;min-width:30%;text-align:center;font-weight:600}
.chip small{display:block;color:var(--muted);font-size:11px;font-weight:400}.chip.on{border-color:var(--blue);background:var(--blue-soft)}
.stepper{display:flex;align-items:center;gap:8px}.stepper button{width:54px;height:54px;flex:0 0 54px;border-radius:12px;border:1px solid #cbd5e1;background:#fff;font-size:24px}
.stepper .inp{text-align:center;font-size:22px;font-weight:700;margin:0}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px;margin-bottom:10px}
.card h4{margin:0 0 4px;font-size:15px}.card.bl{border-color:var(--blue)}.card.bt{border-color:var(--teal)}.card.bo{border-color:var(--orange)}.card.warnc{border-color:var(--red)}
[data-act="openload"],[data-act="openrecv"]{cursor:pointer}
.muted{color:var(--muted);font-size:13px}.warn{color:var(--red)!important}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;vertical-align:middle}
.p-blue{background:var(--blue-soft);color:var(--blue)}.p-green{background:var(--green-soft);color:var(--green)}.p-amber{background:var(--amber-soft);color:var(--amber)}.p-red{background:var(--red-soft);color:var(--red)}.p-gray{background:#f1f5f9;color:#475569}
.scanbox{display:flex;gap:8px;align-items:center;background:#fff;border:2px dashed #94a3b8;border-radius:12px;padding:10px 12px;margin:10px 0}
.scanbox span{font-size:22px}.scanbox input{border:0;flex:1;font-size:18px;outline:none;min-width:0}.scanbox button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 10px}
.flash{border-radius:14px;padding:16px;margin:10px 0;color:#fff}
.flash .big{font-size:24px;font-weight:800;line-height:1.15}.flash .mid{font-size:18px;font-weight:700;margin-top:4px}.flash .sm{font-size:14px;margin-top:6px}
.f-green{background:var(--green)}.f-amber{background:var(--amber)}.f-orange{background:var(--orange)}.f-red{background:var(--red)}
.flash .acts{display:flex;gap:8px;margin-top:10px}.flash .acts button{flex:1;border:0;border-radius:9px;padding:12px;font-weight:700;background:rgba(255,255,255,.25);color:#fff;font-size:15px}
.totals{display:flex;gap:8px;margin-bottom:10px}.totals div{flex:1;background:#fff;border:1px solid var(--line);border-radius:10px;padding:8px;text-align:center}
.totals b{display:block;font-size:20px}.totals small{color:var(--muted);font-size:11px}
.plist .it{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid var(--line)}
.plist .it:last-child{border:0}.plist .ac{flex:0 0 auto}.plist .ac button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:9px 11px;font-size:13px;margin-left:4px}
.results div{padding:11px;border-bottom:1px solid var(--line);cursor:pointer;background:#fff}
.prog{margin:8px 0 4px;font-weight:700}.progress{height:12px;background:#e2e8f0;border-radius:999px;overflow:hidden}.progress div{height:100%;background:var(--teal);width:0}
.warnrow{display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px}.warnrow:last-child{border:0}
.tbl{width:100%;border-collapse:collapse;font-size:13px;background:#fff}.tbl th{text-align:left;color:var(--muted);font-weight:600;padding:7px 6px;border-bottom:1px solid var(--line)}.tbl td{padding:7px 6px;border-bottom:1px solid var(--line);vertical-align:top}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px}.kpi small{color:var(--muted);font-size:12px}.kpi b{display:block;font-size:26px;margin-top:2px}.kpi span{font-size:12px;color:var(--muted)}
.kpi.good{border-color:#86efac;background:#f0fdf4}.kpi.bad{border-color:#fca5a5;background:#fef2f2}
textarea.inp{font-family:monospace;font-size:13px}
h3{font-size:15px;margin:16px 0 8px}
@media (max-width:900px){.grid4{grid-template-columns:repeat(2,1fr)}.grid3{grid-template-columns:1fr}}
`;

    function clientMain(B) {
        'use strict';
        const isMgr = B.mode === 'manager';
        const S = { side: get('mv_side') === 'in' ? 'in' : 'out', tab: null, who: get('mv_who') || '', poll: null,
            ed: null, edRender: null, loadId: null, lv: null, recvId: null, rv: null, plan: null, pt: null, cfgRows: [], cfgImport: null, items: [] };

        function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
        function put(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
        function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
        function $(id) { return document.getElementById(id); }
        function main(html) { $('main').innerHTML = html; }
        function busy(el, on) { if (el) el.disabled = on; }
        function pdfUrl(q) { return B.url + '&action=pdf&' + q; }
        function num(n) { return Number(n || 0).toLocaleString(); }

        async function api(action, body) {
            try {
                const r = await fetch(B.url + '&action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(Object.assign({ actor: S.who || B.me }, body || {})) });
                const t = await r.text();
                try { return JSON.parse(t); } catch (e) { return { ok: false, error: 'Unexpected response (' + r.status + ')' }; }
            } catch (e) { return { ok: false, error: 'No connection. Scan again or retry.' }; }
        }

        let actx = null;
        function tone(kind) {
            try {
                actx = actx || new (window.AudioContext || window.webkitAudioContext)();
                const seq = kind === 'ok' ? [[880, 0.08], [1320, 0.1]] : kind === 'warn' ? [[660, 0.09], [0, 0.05], [660, 0.09]] : [[180, 0.35]];
                let t = actx.currentTime;
                seq.forEach(([f, d]) => {
                    if (f) {
                        const o = actx.createOscillator(), g = actx.createGain();
                        o.frequency.value = f; o.type = kind === 'bad' ? 'square' : 'sine'; g.gain.value = 0.15;
                        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + d);
                    }
                    t += d;
                });
            } catch (e) { /* no audio */ }
        }

        function flash(kind, big, mid, sm, acts) {
            return '<div class="flash f-' + kind + '"><div class="big">' + big + '</div>' + (mid ? '<div class="mid">' + mid + '</div>' : '') +
                (sm ? '<div class="sm">' + sm + '</div>' : '') + (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div>';
        }
        function errBox(msg) { return flash('red', '❌ ' + esc(msg)); }

        const PILL = { loading: ['Loading', 'p-blue'], ready: ['⏳ Waiting for approval', 'p-amber'], shipping: ['Shipping…', 'p-amber'],
            shipped: ['In transit', 'p-blue'], receiving: ['Unloading', 'p-blue'], recv_ready: ['⏳ Receipt approval', 'p-amber'],
            receiving_tx: ['Receiving…', 'p-amber'], received: ['Received', 'p-green'], received_short: ['Received · short', 'p-red'], error: ['Needs attention', 'p-red'] };
        function statusPill(s) { const p = PILL[s] || [s, 'p-gray']; return '<span class="pill ' + p[1] + '">' + esc(p[0]) + '</span>'; }
        function loadSub(L) { return [L.carrier, L.trailer && 'Trailer ' + L.trailer, L.seal && 'Seal ' + L.seal].filter(Boolean).join(' · '); }

        function needWho() {
            if (S.who) return false;
            alert('Pick your name in "I am" first.');
            return true;
        }

        // ── shell ────────────────────────────────────────────────────────
        const TABS = {
            out: [['req', 'Request label'], ['load', 'Load'], ['void', 'Void']].concat(isMgr ? [['ship', 'To ship'], ['queue', 'Print queue'],
                ['plan', 'Print plan'], ['sku', 'Print a SKU'], ['configs', 'SKU configs'], ['reprint', 'Reprint'], ['dash', 'Dashboard']] : []),
            in: [['recv', 'Receive']].concat(isMgr ? [['toreceive', 'To receive'], ['catchup', 'Catch-ups'], ['dash', 'Dashboard']] : [])
        };

        function shell() {
            const whoCtl = B.roster.length
                ? '<select id="who"><option value="">— pick —</option>' + B.roster.map(n => '<option' + (n === S.who ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>'
                : '<input id="who" value="' + esc(S.who) + '" placeholder="your name">';
            document.body.innerHTML = '<div class="top"><div class="ttl"><b>Move Portal</b><span>' + esc(B.me) + (isMgr ? ' · manager' : '') + '</span></div>' +
                '<div class="who">I am ' + whoCtl + '</div>' +
                '<div class="toggle"><button data-act="side" data-v="out" class="' + (S.side === 'out' ? 'on out' : '') + '">📤 Outbound · ' + esc(B.fromName) + '</button>' +
                '<button data-act="side" data-v="in" class="' + (S.side === 'in' ? 'on in' : '') + '">📥 Inbound · ' + esc(B.toName) + '</button></div></div>' +
                '<div class="subnav" id="subnav"></div><main id="main"></main>';
            const w = $('who');
            w.onchange = w.oninput = () => { S.who = w.value.trim(); put('mv_who', S.who); };
            renderNav();
        }

        function renderNav() {
            const tabs = TABS[S.side];
            if (!tabs.some(t => t[0] === S.tab)) S.tab = tabs[0][0];
            $('subnav').innerHTML = tabs.map(t => '<div data-act="tab" data-v="' + t[0] + '" class="' + (t[0] === S.tab ? 'on' : '') + '">' + esc(t[1]) + '</div>').join('');
            clearInterval(S.poll);
            S.poll = null;
            SCREENS[S.tab]();
        }

        const ACT = {};
        const SCREENS = {};
        document.addEventListener('click', e => {
            const el = e.target.closest('[data-act]');
            if (el && ACT[el.dataset.act]) { e.preventDefault(); ACT[el.dataset.act](el); }
            setTimeout(refocusScan, 60);
        });
        function refocusScan() {
            const i = $('scan') || $('rscan');
            const a = document.activeElement;
            if (i && !(a && a.matches && a.matches('input,select,textarea'))) i.focus();
        }
        ACT.side = el => { S.side = el.dataset.v; put('mv_side', S.side); shell(); };
        ACT.tab = el => { S.tab = el.dataset.v; S.loadId = null; S.recvId = null; renderNav(); };
        ACT.clearres = () => { const r = $('scanres'); if (r) r.innerHTML = ''; };
        ACT.typecode = el => { const i = $(el.dataset.v); if (i) { i.setAttribute('inputmode', 'text'); i.focus(); } };

        // Scan input: queue every Enter so nothing is lost while a request runs.
        function wireScan(id, fn) {
            const i = $(id);
            if (!i) return;
            i.focus();
            const q = [];
            let running = false;
            async function pump() {
                if (running) return;
                running = true;
                while (q.length) { await fn(q.shift()); }
                running = false;
                refocusScan();
            }
            i.onkeydown = e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const v = i.value.trim();
                i.value = '';
                if (v) { q.push(v); pump(); }
            };
        }
        function scanBox(id) {
            return '<div class="scanbox"><span>📷</span><input id="' + id + '" inputmode="none" placeholder="Scan pallet label…" autocomplete="off" autocapitalize="characters">' +
                '<button data-act="typecode" data-v="' + id + '">⌨ Type</button></div>';
        }

        // ── shared line editor (request, print a SKU, relabel) ───────────
        function newLine() { return { item: '', sku: '', desc: '', onHand: null, cfgs: [], cfg: '', pcs: '' }; }
        function newEd() { return { lines: [newLine()], count: 1, note: '' }; }
        function editedNote(l) {
            const c = l.cfgs.find(x => x.code === l.cfg);
            return c && Number(l.pcs) !== c.pcs ? '<div class="muted warn">⚠ Differs from Config ' + esc(c.code) + ' (' + c.pcs + '). The label will show EDITED.</div>' : '';
        }
        function edHtml(o) {
            const ed = S.ed;
            return ed.lines.map((l, i) => '<div class="card">' +
                '<label class="f">SKU' + (ed.lines.length > 1 ? ' ' + (i + 1) : '') + ' (type or scan the product barcode)</label>' +
                '<input class="inp" data-sku="' + i + '" value="' + esc(l.sku) + '" placeholder="e.g. YSN201" autocomplete="off">' +
                '<div id="skures' + i + '"></div>' +
                (l.item ? '<div class="muted">' + esc(l.desc) + (l.onHand != null ? ' · ' + num(l.onHand) + ' on hand at ' + esc(B.fromName) : '') + '</div>' +
                    '<label class="f">Pallet config</label><div class="chips">' +
                    l.cfgs.map(c => '<div class="chip' + (l.cfg === c.code ? ' on' : '') + '" data-act="cfg" data-i="' + i + '" data-v="' + esc(c.code) + '">Config ' + esc(c.code) +
                        '<small>' + c.pcs + ' / pallet' + (c.isDefault ? ' · default' : '') + '</small></div>').join('') +
                    '<div class="chip' + (!l.cfg ? ' on' : '') + '" data-act="cfg" data-i="' + i + '" data-v="">Custom<small>type pcs</small></div></div>' +
                    '<label class="f">Pieces on this pallet</label><div class="stepper"><button data-act="pcs" data-i="' + i + '" data-v="-1">−</button>' +
                    '<input class="inp" data-pcs="' + i + '" inputmode="numeric" value="' + esc(l.pcs) + '"><button data-act="pcs" data-i="' + i + '" data-v="1">+</button></div>' +
                    editedNote(l) : '') +
                (ed.lines.length > 1 ? '<button class="btn ghost sm" data-act="rmline" data-i="' + i + '">Remove this SKU</button>' : '') + '</div>').join('') +
                '<button class="btn ghost sm" data-act="addline">+ Mixed pallet (add another SKU)</button>' +
                (o.count ? '<label class="f">How many labels</label><div class="stepper"><button data-act="cnt" data-v="-1">−</button>' +
                    '<input class="inp" id="edcount" inputmode="numeric" value="' + esc(ed.count) + '"><button data-act="cnt" data-v="1">+</button></div>' : '') +
                (o.note ? '<label class="f">Note for the runner (optional)</label><input class="inp" id="ednote" value="' + esc(ed.note) + '" placeholder="e.g. aisle 12, top rack">' : '');
        }
        function mountEd(o, extraHtml) {
            S.edRender = () => {
                $('edbox').innerHTML = edHtml(o) + (extraHtml || '');
                document.querySelectorAll('[data-sku]').forEach(inp => {
                    let t;
                    inp.oninput = () => { clearTimeout(t); t = setTimeout(() => skuSearch(+inp.dataset.sku, inp.value, false), 300); };
                    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); skuSearch(+inp.dataset.sku, inp.value, true); } };
                });
                document.querySelectorAll('[data-pcs]').forEach(inp => {
                    inp.oninput = () => { S.ed.lines[+inp.dataset.pcs].pcs = inp.value; };
                    inp.onchange = () => S.edRender();
                });
                const c = $('edcount'); if (c) c.oninput = () => { S.ed.count = c.value; };
                const n = $('ednote'); if (n) n.oninput = () => { S.ed.note = n.value; };
            };
            S.edRender();
        }
        async function skuSearch(i, q, exact) {
            q = String(q || '').trim();
            const box = $('skures' + i);
            if (!box) return;
            if (!q) { box.innerHTML = ''; return; }
            const r = await api('item_lookup', { q: q });
            if (!r.ok) { box.innerHTML = errBox(r.error); return; }
            const hit = r.items.find(x => x.sku.toUpperCase() === q.toUpperCase() || x.upc === q);
            if (exact && (hit || r.items.length === 1)) return pickItem(i, hit || r.items[0]);
            S.items = r.items;
            box.innerHTML = r.items.length ? '<div class="results">' + r.items.map((x, k) => '<div data-act="pick" data-i="' + i + '" data-k="' + k + '"><b>' + esc(x.sku) +
                '</b> <span class="muted">' + esc(x.desc) + '</span></div>').join('') + '</div>' : '<div class="muted">No match</div>';
        }
        function pickItem(i, x) {
            const l = S.ed.lines[i];
            Object.assign(l, { item: x.item, sku: x.sku, desc: x.desc, onHand: x.onHand, cfgs: x.cfgs || [] });
            const d = l.cfgs.find(c => c.isDefault) || l.cfgs[0];
            l.cfg = d ? d.code : '';
            l.pcs = d ? d.pcs : '';
            S.edRender();
        }
        ACT.pick = el => pickItem(+el.dataset.i, S.items[+el.dataset.k]);
        ACT.cfg = el => { const l = S.ed.lines[+el.dataset.i]; l.cfg = el.dataset.v; const c = l.cfgs.find(x => x.code === l.cfg); if (c) l.pcs = c.pcs; S.edRender(); };
        ACT.pcs = el => { const l = S.ed.lines[+el.dataset.i]; l.pcs = Math.max(1, (Number(l.pcs) || 0) + Number(el.dataset.v)); S.edRender(); };
        ACT.cnt = el => { S.ed.count = Math.max(1, (Number(S.ed.count) || 0) + Number(el.dataset.v)); S.edRender(); };
        ACT.addline = () => { if (S.ed.lines.length >= 5) return alert('A mixed pallet can have at most 5 SKUs'); S.ed.lines.push(newLine()); S.edRender(); };
        ACT.rmline = el => { S.ed.lines.splice(+el.dataset.i, 1); S.edRender(); };
        function edPayload() { return S.ed.lines.map(l => ({ item: l.item, sku: l.sku, cfg: l.cfg, pcs: Number(l.pcs) })); }
        function edInvalid() {
            for (const l of S.ed.lines) {
                if (!l.item) return 'Pick a SKU for every line';
                if (!(Number(l.pcs) > 0)) return 'Pieces must be above 0 for ' + l.sku;
            }
            return '';
        }

        // Print: one job id per click; chunks are retry-safe because the server counts per job.
        async function printMany(specs, source, msgEl) {
            const total = specs.reduce((a, s) => a + s.n, 0);
            if (!total) return false;
            if (total > B.maxPrint) { alert('That is ' + total + ' labels. Max ' + B.maxPrint + ' per print job; print in parts.'); return false; }
            const w = window.open('about:blank');
            const job = 'J' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            let upTo = 0;
            for (const s of specs) {
                const end = upTo + s.n;
                while (upTo < end) {
                    const next = Math.min(end, upTo + 80);
                    if (msgEl) msgEl.innerHTML = flash('amber', 'Creating labels… ' + upTo + ' / ' + total);
                    let r;
                    for (let t = 0; t < 3; t++) { r = await api('print_chunk', { job: job, lines: s.lines, upTo: next, source: source }); if (r.ok) break; }
                    if (!r.ok) { if (w) w.close(); if (msgEl) msgEl.innerHTML = errBox(r.error + ' (labels already created are kept; press Print again)'); return false; }
                    upTo = next;
                }
            }
            if (w) w.location = pdfUrl('job=' + encodeURIComponent(job) + '&header=1');
            if (msgEl) msgEl.innerHTML = flash('green', '✅ ' + total + ' labels sent to print');
            return true;
        }

        // ── Outbound: request label ──────────────────────────────────────
        SCREENS.req = () => {
            S.ed = newEd();
            main('<div id="edbox"></div><div id="edmsg"></div><button class="btn pri" data-act="reqsend">Send to office printer</button>' +
                '<label class="f">My recent requests</label><div id="myreqs"><div class="muted">Loading…</div></div>');
            mountEd({ count: true, note: true });
            loadMyReqs();
        };
        function reqCard(q, acts) {
            const pill = { queued: 'p-amber', printed: 'p-green', cancelled: 'p-gray' }[q.status] || 'p-gray';
            return '<div class="card"><h4>' + esc(q.summary) + ' ×' + q.count + ' <span class="pill ' + pill + '">' +
                esc(q.status === 'printed' ? 'Printed · on its way' : q.status) + '</span></h4><div class="muted">' + esc(q.at) + ' · ' + esc(q.requester) +
                (q.via === 'radio' ? ' (radio)' : '') + (q.note ? ' · ' + esc(q.note) : '') + '</div>' +
                (acts && q.status === 'queued' ? '<div class="row2"><button class="dbtn pri" data-act="reqprint" data-id="' + q.id + '">Print</button>' +
                    '<button class="dbtn gh" data-act="reqcancel" data-id="' + q.id + '">Cancel</button></div>' : '') + '</div>';
        }
        async function loadMyReqs() {
            const r = await api('req_list', { mine: true });
            const box = $('myreqs');
            if (box) box.innerHTML = !r.ok ? errBox(r.error) : (r.reqs.map(q => reqCard(q, false)).join('') || '<div class="muted">None yet</div>');
        }
        ACT.reqsend = async el => {
            if (needWho()) return;
            const bad = edInvalid();
            if (bad) { $('edmsg').innerHTML = errBox(bad); return; }
            busy(el, true);
            const r = await api('req_create', { lines: edPayload(), count: Number(S.ed.count) || 1, note: S.ed.note, via: 'phone' });
            busy(el, false);
            if (!r.ok) { $('edmsg').innerHTML = errBox(r.error); return; }
            tone('ok');
            $('edmsg').innerHTML = flash('green', '✅ Sent to the office');
            S.ed = newEd();
            S.edRender();
            loadMyReqs();
        };

        // ── Outbound: void (floor) and reprint (manager) ─────────────────
        SCREENS.void = () => palletTool(false);
        SCREENS.reprint = () => palletTool(true);
        function palletTool(mgr) {
            main('<label class="f">Scan or type a label</label><input class="inp" id="ptcode" placeholder="PLT…" autocomplete="off"><div id="ptres"></div><div id="ptmsg"></div><div id="edbox"></div>');
            const i = $('ptcode');
            i.focus();
            i.onkeydown = async e => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const r = await api('pallet_get', { code: i.value });
                i.select();
                $('ptmsg').innerHTML = '';
                $('edbox').innerHTML = '';
                if (!r.ok) { $('ptres').innerHTML = errBox(r.error); return; }
                S.pt = r.pallet;
                renderPt(mgr);
            };
        }
        function renderPt(mgr) {
            const p = S.pt, canVoid = p.status === 'labeled';
            $('ptres').innerHTML = '<div class="card"><h4>' + esc(p.code) + ' · ' + esc(p.summary) + ' <span class="pill p-gray">' + esc(p.status) + '</span></h4>' +
                '<div class="muted">' + (p.loadNumber ? 'Load ' + esc(p.loadNumber) + ' · ' : '') + 'printed ' + esc(p.printedAt) + (p.edited ? ' · EDITED' : '') + '</div>' +
                (mgr ? '<div class="row2"><button class="dbtn pri" data-act="ptreprint">Reprint (same code)</button>' +
                    '<button class="dbtn gh" data-act="ptrelabel"' + (canVoid ? '' : ' disabled') + '>Edit + reprint</button></div>' : '') +
                (canVoid ? '<label class="f">Void reason</label><select class="inp" id="ptreason"><option>Broken up for stock</option><option>Sent to customer</option>' +
                    '<option>Damaged</option><option>Other</option></select><button class="btn ghost sm warn" data-act="ptvoid">Void this label</button>'
                    : '<div class="muted">Only labels not yet on a load can be voided' + (p.status === 'loaded' ? ' (remove it from its load first)' : '') + '.</div>') + '</div>';
        }
        ACT.ptvoid = async () => {
            if (!confirm('Void ' + S.pt.code + '?')) return;
            const r = await api('pallet_void', { palletId: S.pt.id, reason: $('ptreason').value });
            $('ptmsg').innerHTML = r.ok ? flash('green', '✅ ' + esc(S.pt.code) + ' voided') : errBox(r.error);
            if (r.ok) tone('ok');
        };
        ACT.ptreprint = async () => {
            const w = window.open('about:blank');
            const r = await api('pallet_reprint', { palletId: S.pt.id });
            if (!r.ok) { if (w) w.close(); $('ptmsg').innerHTML = errBox(r.error); return; }
            if (w) w.location = pdfUrl('ids=' + S.pt.id);
        };
        ACT.ptrelabel = () => {
            S.ed = { lines: S.pt.edLines.map(l => Object.assign({}, l)), count: 1, note: '' };
            mountEd({}, '<button class="btn pri" data-act="ptrelabelgo">Print new label (voids ' + esc(S.pt.code) + ')</button>');
        };
        ACT.ptrelabelgo = async el => {
            const bad = edInvalid();
            if (bad) { $('ptmsg').innerHTML = errBox(bad); return; }
            const w = window.open('about:blank');
            busy(el, true);
            const r = await api('pallet_relabel', { palletId: S.pt.id, lines: edPayload() });
            busy(el, false);
            if (!r.ok) { if (w) w.close(); $('ptmsg').innerHTML = errBox(r.error); return; }
            if (w) w.location = pdfUrl('job=' + encodeURIComponent(r.job));
            $('edbox').innerHTML = '';
            $('ptmsg').innerHTML = flash('green', '✅ New label ' + esc(r.code) + ' printing; ' + esc(S.pt.code) + ' voided');
        };

        // ── Outbound: load ───────────────────────────────────────────────
        SCREENS.load = () => (S.loadId ? loadDetail() : loadList());
        async function loadList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('load_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main(r.loads.map(L => '<div class="card' + (L.status === 'loading' ? ' bl' : '') + '" data-act="openload" data-id="' + L.id + '"><h4>' + esc(L.number) +
                (L.door ? ' · Door ' + esc(L.door) : '') + ' ' + statusPill(L.status) + '</h4><div class="muted">' + esc(loadSub(L)) + ' · ' + L.pallets + ' pallets</div></div>').join('') ||
                '<div class="muted">No open loads</div>') ;
            $('main').insertAdjacentHTML('beforeend', '<div class="card"><h4>New load</h4><input class="inp" id="nl_door" placeholder="Door"><input class="inp" id="nl_carrier" placeholder="Carrier">' +
                '<input class="inp" id="nl_trailer" placeholder="Trailer #"><input class="inp" id="nl_seal" placeholder="Seal #"><div id="nlmsg"></div>' +
                '<button class="btn pri" data-act="newload">Open load</button></div>');
        }
        ACT.newload = async el => {
            if (needWho()) return;
            busy(el, true);
            const r = await api('load_create', { door: $('nl_door').value, carrier: $('nl_carrier').value, trailer: $('nl_trailer').value, seal: $('nl_seal').value });
            busy(el, false);
            if (!r.ok) { $('nlmsg').innerHTML = errBox(r.error); return; }
            S.loadId = r.load.id;
            loadDetail();
        };
        ACT.openload = el => { S.loadId = el.dataset.id; loadDetail(); };
        ACT.backload = () => { S.loadId = null; loadList(); };
        async function loadDetail() {
            main('<div class="muted">Loading…</div>');
            const r = await api('load_get', { loadId: S.loadId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backload">← All loads</button><div class="card bl"><h4 id="lhead"></h4><div class="muted" id="lsub"></div></div>' +
                '<div id="lscan"></div><div id="scanres"></div><div class="totals" id="ltot"></div><div class="card plist" id="plist"></div><div id="lfoot"></div>');
            paintLoad(r, true);
        }
        function paintLoad(r, first) {
            S.lv = r;
            const L = r.load, open = L.status === 'loading';
            $('lhead').innerHTML = esc(L.number) + (L.door ? ' · Door ' + esc(L.door) : '') + ' ' + statusPill(L.status);
            $('lsub').textContent = loadSub(L);
            if (first) {
                $('lscan').innerHTML = open ? scanBox('scan') : '<div class="muted">' + (L.status === 'ready' ? '⏳ Waiting for manager approval. Scanning is closed.' : 'Scanning is closed (' + esc(L.status) + ').') + '</div>';
                if (open) wireScan('scan', doLoadScan);
            }
            $('ltot').innerHTML = '<div><b>' + r.totals.pallets + '</b><small>pallets</small></div><div><b>' + num(r.totals.pieces) + '</b><small>pieces</small></div><div><b>' + r.totals.skus + '</b><small>SKUs</small></div>';
            $('plist').innerHTML = r.pallets.map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + (p.edited ? ' <span class="pill p-amber">EDITED</span>' : '') + '</div>' +
                (open ? '<div class="ac"><button data-act="pedit" data-id="' + p.id + '">Edit</button><button data-act="premove" data-id="' + p.id + '">✕</button></div>' : '') + '</div>').join('') ||
                '<div class="muted">No pallets yet</div>';
            $('lfoot').innerHTML = open ? '<button class="btn go" data-act="loadready">Load done: send for approval</button>' : '';
        }
        function loadResultHtml(r) {
            const p = r.pallet, line = p ? esc(p.code + ' · ' + p.summary) : '';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), esc(p.pieces + ' pcs · ' + p.code), 'Added to ' + esc(r.loadNumber) + ' · ' + r.view.totals.pallets + ' pallets',
                    '<button data-act="pedit" data-id="' + p.id + '">Edit count</button><button data-act="premove" data-id="' + p.id + '">Remove</button>');
                case 'dup': return flash('amber', '🟡 Already on this load', line, 'No change.');
                case 'other_load': return flash('amber', '🟡 On load ' + esc(r.otherNumber), line, '',
                    '<button data-act="movehere" data-id="' + p.id + '">Move it to ' + esc(r.loadNumber) + '</button><button data-act="clearres">Leave it</button>');
                case 'locked_load': return flash('red', '❌ On ' + esc(r.otherNumber) + ', awaiting approval', line, 'That load is closed for scanning. Check with the supervisor.');
                case 'void': return flash('red', '❌ Label cancelled', line, "Don't load it. Request a new label for this pallet.");
                case 'shipped': return flash('red', '❌ Already shipped', esc(p.code + (r.otherNumber ? ' · on ' + r.otherNumber : '')), 'This pallet already left. Check with the supervisor.');
                default: return flash('red', '❌ Unknown label', esc('"' + r.raw + '"'), 'Not a move label. Maybe a product barcode?');
            }
        }
        async function doLoadScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('scan_load', { loadId: S.loadId, raw: v });
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            $('scanres').innerHTML = loadResultHtml(r);
            if (r.view) paintLoad(r.view, false);
        }
        function findPallet(id) {
            const all = (S.lv ? S.lv.pallets : []);
            return all.find(x => String(x.id) === String(id));
        }
        ACT.pedit = async el => {
            const p = findPallet(el.dataset.id);
            if (!p) return;
            const lines = [];
            for (const l of p.lines) {
                const v = prompt(l.sku + ': pieces on this pallet', l.pcs);
                if (v === null) return;
                const n = Math.floor(Number(v));
                if (!(n > 0)) { alert('Pieces must be above 0'); return; }
                lines.push({ item: l.item, pcs: n });
            }
            const r = await api('pallet_edit', { palletId: p.id, loadId: S.loadId, lines: lines });
            if (!r.ok) { alert(r.error); return; }
            paintLoad(r.view, false);
            $('scanres').innerHTML = flash('amber', '✏️ ' + esc(p.code) + ' updated', esc(r.pallet.summary), 'Flagged EDITED');
        };
        ACT.premove = async el => {
            const p = findPallet(el.dataset.id);
            if (!p || !confirm('Take ' + p.code + ' off this load?')) return;
            const r = await api('pallet_remove', { palletId: p.id, loadId: S.loadId });
            if (!r.ok) { alert(r.error); return; }
            paintLoad(r.view, false);
            $('scanres').innerHTML = flash('amber', '↩ ' + esc(p.code) + ' removed');
        };
        ACT.movehere = async el => {
            const r = await api('load_move_here', { palletId: el.dataset.id, loadId: S.loadId });
            if (!r.ok) { alert(r.error); return; }
            tone('ok');
            paintLoad(r.view, false);
            $('scanres').innerHTML = flash('green', '✅ Moved to this load', esc(r.pallet.code + ' · ' + r.pallet.summary));
        };
        ACT.loadready = async el => {
            if (!confirm('Done loading? A manager will approve and ship it.')) return;
            busy(el, true);
            const r = await api('load_ready', { loadId: S.loadId });
            busy(el, false);
            if (!r.ok) { alert(r.error); return; }
            loadDetail();
        };

        // ── Outbound: manager "To ship" ──────────────────────────────────
        SCREENS.ship = async (msg) => {
            main('<div class="muted">Loading…</div>');
            const r = await api('ship_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<div id="shipmsg">' + (msg || '') + '</div>' + (r.loads.map(shipCard).join('') || '<div class="muted">Nothing waiting for approval</div>') +
                '<h3>Recently shipped</h3>' + (r.recent.map(L => '<div class="card"><h4>' + esc(L.number) + ' ' + statusPill(L.status) + '</h4><div class="muted">' + L.pallets + ' pallets · ' +
                    esc(L.toNumber) + ' · ' + esc(L.ifNumber) + ' · ' + esc(L.approvedAt) + '</div><button class="dbtn gh" data-act="sheet" data-id="' + L.id + '">Reprint load sheet</button></div>').join('') ||
                    '<div class="muted">None yet</div>'));
        };
        function shipCard(L) {
            const bad = L.rows.filter(x => !x.ok);
            const retry = L.status === 'error' || L.status === 'shipping';
            return '<div class="card' + (L.status === 'error' ? ' warnc' : '') + '"><h4>' + esc(L.number) + (L.door ? ' · Door ' + esc(L.door) : '') + ' ' + statusPill(L.status) + '</h4>' +
                '<div class="muted">' + L.pallets + ' pallets · ' + num(L.pieces) + ' pcs · loaded by ' + esc(L.readyBy) + ' ' + esc(L.readyAt) + '</div>' +
                '<table class="tbl"><tr><th>SKU</th><th>On truck</th><th>Available</th><th></th></tr>' + L.rows.map(x => '<tr><td>' + esc(x.sku) + '</td><td>' + num(x.qty) + '</td><td>' +
                    num(x.avail) + '</td><td>' + (x.ok ? '✅' : '❌') + '</td></tr>').join('') + '</table>' +
                (bad.length ? '<div class="muted warn">⚠ ' + bad.map(x => esc(x.sku) + ': truck has ' + x.qty + ', only ' + x.avail + ' available').join('; ') +
                    '. Remove a pallet or check the count.</div>' : '') +
                (L.error ? '<div class="muted warn">Last error: ' + esc(L.error) + '</div>' : '') +
                '<div class="row2">' + (L.canSendBack ? '<button class="dbtn gh" data-act="sendback" data-id="' + L.id + '">Send back</button>' : '') +
                '<button class="dbtn go" data-act="approveship" data-id="' + L.id + '"' + (bad.length && !L.to ? ' disabled' : '') + '>' + (retry ? 'Retry' : 'Approve & Ship') + '</button></div></div>';
        }
        ACT.approveship = async el => {
            if (!confirm('Create the transfer order and ship this load? ' + B.fromName + ' inventory goes down now.')) return;
            const w = window.open('about:blank');
            busy(el, true);
            const r = await api('load_approve', { loadId: el.dataset.id });
            busy(el, false);
            if (!r.ok) { if (w) w.close(); tone('bad'); SCREENS.ship(errBox(r.error)); return; }
            if (w) w.location = pdfUrl('type=loadsheet&loadId=' + el.dataset.id);
            tone('ok');
            SCREENS.ship(flash('green', '✅ ' + esc(r.number) + ' shipped', esc(r.toNumber + ' · ' + r.ifNumber), 'Load sheet opened in a new tab.'));
        };
        ACT.sendback = async el => {
            if (!confirm('Send this load back to the dock for changes?')) return;
            const r = await api('load_sendback', { loadId: el.dataset.id });
            SCREENS.ship(r.ok ? flash('amber', 'Sent back to the dock') : errBox(r.error));
        };
        ACT.sheet = el => { window.open(pdfUrl('type=loadsheet&loadId=' + el.dataset.id)); };

        // ── Outbound: manager print queue / plan / print a SKU ────────────
        SCREENS.queue = () => {
            S.ed = newEd();
            main('<div class="card"><h4>Add a request (radio)</h4><input class="inp" id="radiowho" placeholder="Who called it in"><div id="edbox"></div><div id="edmsg"></div>' +
                '<button class="btn pri sm" data-act="radiosend">Add to queue</button></div><h3>Queued</h3><div id="qlist"><div class="muted">Loading…</div></div><div id="qmsg"></div>');
            mountEd({ count: true, note: true });
            loadQueue();
            S.poll = setInterval(loadQueue, 15000);
        };
        async function loadQueue() {
            const r = await api('req_list', { status: 'queued' });
            const box = $('qlist');
            if (box) box.innerHTML = !r.ok ? errBox(r.error) : (r.reqs.map(q => reqCard(q, true)).join('') || '<div class="muted">The queue is empty</div>');
        }
        ACT.radiosend = async el => {
            const who = $('radiowho').value.trim();
            if (!who) { $('edmsg').innerHTML = errBox('Enter who called it in'); return; }
            const bad = edInvalid();
            if (bad) { $('edmsg').innerHTML = errBox(bad); return; }
            busy(el, true);
            const r = await api('req_create', { lines: edPayload(), count: Number(S.ed.count) || 1, note: S.ed.note, via: 'radio', requester: who });
            busy(el, false);
            if (!r.ok) { $('edmsg').innerHTML = errBox(r.error); return; }
            S.ed = newEd();
            S.edRender();
            $('edmsg').innerHTML = '';
            $('radiowho').value = '';
            loadQueue();
        };
        ACT.reqprint = async el => {
            const w = window.open('about:blank');
            busy(el, true);
            const r = await api('req_print', { reqId: el.dataset.id });
            if (!r.ok) { if (w) w.close(); busy(el, false); $('qmsg').innerHTML = errBox(r.error); return; }
            if (w) w.location = pdfUrl('job=' + encodeURIComponent(r.job));
            loadQueue();
        };
        ACT.reqcancel = async el => {
            if (!confirm('Cancel this request?')) return;
            const r = await api('req_cancel', { reqId: el.dataset.id });
            if (!r.ok) $('qmsg').innerHTML = errBox(r.error);
            loadQueue();
        };

        SCREENS.plan = async () => {
            main('<div class="muted">Loading plan…</div>');
            const r = await api('plan');
            if (!r.ok) { main(errBox(r.error)); return; }
            S.plan = r;
            main('<div class="card"><h4>Print plan · ' + esc(r.dayLabel) + ' <span class="muted">needed ' + (r.neededPerDay == null ? '—' : r.neededPerDay) + ' pallets/day · ' +
                r.labeledPallets + ' already labeled</span></h4><div class="muted">Suggested counts split today\'s need across SKUs by pallets left. Change any count.</div></div>' +
                '<div id="planmsg"></div><table class="tbl"><tr><th>SKU</th><th>Config</th><th>Pallets left</th><th>Labeled</th><th>Print</th><th></th></tr>' +
                r.rows.map((x, k) => '<tr><td><b>' + esc(x.sku) + '</b><div class="muted">' + esc(x.desc) + '</div></td><td>' + esc(x.cfg) + ' · ' + x.pcs + '</td><td>' + x.palletsLeft +
                    '</td><td>' + x.labeled + '</td><td><input class="num" data-plan="' + k + '" inputmode="numeric" value="' + x.suggest + '"></td><td><button class="dbtn pri" data-act="planrow" data-k="' + k +
                    '">Print</button></td></tr>').join('') + '</table><button class="btn go" data-act="planall">Print all</button>' +
                (r.noConfig.length ? '<div class="card warnc"><h4>' + r.noConfig.length + ' SKUs with stock but no config</h4><div class="muted">' + r.noConfig.map(x => esc(x.sku)).join(', ') +
                    '</div></div>' : ''));
        };
        function planCount(k) { const i = document.querySelector('[data-plan="' + k + '"]'); return Math.max(0, Math.floor(Number(i && i.value) || 0)); }
        function planLines(x) { return [{ item: x.item, sku: x.sku, cfg: x.cfg, pcs: x.pcs }]; }
        ACT.planrow = async el => {
            const k = +el.dataset.k, n = planCount(k);
            if (!n) return;
            busy(el, true);
            await printMany([{ lines: planLines(S.plan.rows[k]), n: n }], 'plan', $('planmsg'));
            busy(el, false);
        };
        ACT.planall = async el => {
            const specs = S.plan.rows.map((x, k) => ({ lines: planLines(x), n: planCount(k) })).filter(s => s.n > 0);
            const total = specs.reduce((a, s) => a + s.n, 0);
            if (!total || !confirm('Print ' + total + ' labels?')) return;
            busy(el, true);
            await printMany(specs, 'plan', $('planmsg'));
            busy(el, false);
        };

        SCREENS.sku = () => {
            S.ed = newEd();
            main('<div id="edbox"></div><div id="edmsg"></div><button class="btn pri" data-act="skuprint">Print labels</button>');
            mountEd({ count: true });
        };
        ACT.skuprint = async el => {
            const bad = edInvalid();
            if (bad) { $('edmsg').innerHTML = errBox(bad); return; }
            const n = Math.floor(Number(S.ed.count) || 0);
            if (n < 1) return;
            busy(el, true);
            await printMany([{ lines: edPayload(), n: n }], 'office', $('edmsg'));
            busy(el, false);
        };

        // ── Outbound: manager SKU configs ────────────────────────────────
        SCREENS.configs = async () => {
            main('<div class="card"><h4>Import configs from the sheet (CSV)</h4><div class="muted">Columns: SKU, Config, Pcs per pallet, Default (Y/N). The import replaces all configs.</div>' +
                '<input type="file" id="cfgfile" accept=".csv,text/csv"><textarea id="cfgcsv" class="inp" rows="5" placeholder="…or paste CSV here"></textarea>' +
                '<button class="dbtn pri" data-act="cfgpreview">Preview import</button><div id="cfgmsg"></div></div><div id="cfglist"><div class="muted">Loading…</div></div>');
            $('cfgfile').onchange = e => {
                const f = e.target.files[0];
                if (!f) return;
                const rd = new FileReader();
                rd.onload = () => { $('cfgcsv').value = rd.result; };
                rd.readAsText(f);
            };
            const r = await api('cfg_list');
            if (!r.ok) { $('cfglist').innerHTML = errBox(r.error); return; }
            S.cfgRows = r.rows;
            $('cfglist').innerHTML = '<div class="card"><h4>' + r.rows.length + ' SKUs with configs <button class="dbtn gh" data-act="cfgdownload">Download CSV</button></h4>' +
                (r.noConfig.length ? '<div class="muted warn">' + r.noConfig.length + ' SKUs have ' + esc(B.fromName) + ' stock but no config: ' + r.noConfig.map(x => esc(x.sku)).join(', ') + '</div>' : '') +
                '<table class="tbl"><tr><th>SKU</th><th>Configs</th><th>' + esc(B.fromName) + ' on hand</th><th>Est. pallets</th></tr>' +
                r.rows.map(x => '<tr><td><b>' + esc(x.sku) + '</b><div class="muted">' + esc(x.desc) + '</div></td><td>' + x.cfgs.map(c => esc(c.code) + ' · ' + c.pcs + (c.isDefault ? ' ✓' : '')).join('<br>') +
                    '</td><td>' + num(x.onHand) + '</td><td>' + (x.estPallets || '—') + '</td></tr>').join('') + '</table></div>';
        };
        ACT.cfgdownload = () => {
            const q = v => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
            const lines = ['SKU,Config,Pcs per pallet,Default'];
            S.cfgRows.forEach(x => x.cfgs.forEach(c => lines.push([x.sku, c.code, c.pcs, c.isDefault ? 'Y' : 'N'].map(q).join(','))));
            const a = document.createElement('a');
            a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
            a.download = 'move_pallet_configs.csv';
            a.click();
        };
        ACT.cfgpreview = async el => {
            busy(el, true);
            const r = await api('cfg_preview', { csv: $('cfgcsv').value });
            busy(el, false);
            if (!r.ok) { $('cfgmsg').innerHTML = errBox(r.error); return; }
            S.cfgImport = r;
            $('cfgmsg').innerHTML = '<div class="card"><h4>' + r.configs.length + ' configs for ' + r.skuCount + ' SKUs</h4>' +
                (r.unknownSkus.length ? '<div class="muted warn">Not found in NetSuite (skipped): ' + r.unknownSkus.map(esc).join(', ') + '</div>' : '') +
                (r.errors.length ? '<div class="muted warn">' + r.errors.map(e => (e.row ? 'Row ' + e.row + ': ' : '') + esc(e.msg)).join('<br>') + '</div>' : '') +
                (r.noConfigWithStock.length ? '<div class="muted warn">Still no config (have stock): ' + r.noConfigWithStock.map(esc).join(', ') + '</div>' : '') +
                '<button class="dbtn go" data-act="cfgcommit"' + (r.configs.length ? '' : ' disabled') + '>Replace configs with these ' + r.configs.length + '</button></div>';
        };
        ACT.cfgcommit = async el => {
            if (!confirm('Replace all pallet configs?')) return;
            busy(el, true);
            const all = S.cfgImport.configs, batch = 'B' + Date.now();
            const fail = msg => { busy(el, false); $('cfgmsg').innerHTML = errBox(msg); };
            for (let i = 0; i < all.length; i += 100) {
                let r;
                for (let t = 0; t < 3; t++) { r = await api('cfg_commit_chunk', { batch: batch, configs: all.slice(i, i + 100), upTo: Math.min(all.length, i + 100) }); if (r.ok) break; }
                if (!r.ok) return fail(r.error + '. The old configs are still active; try again.');
            }
            const act = await api('cfg_activate', { batch: batch });
            if (!act.ok) return fail(act.error);
            let rem = 1;
            while (rem > 0) {
                const r = await api('cfg_cleanup', { batch: batch });
                if (!r.ok) return fail(r.error + ' (new configs are active; old rows can be cleaned up later)');
                rem = r.remaining;
            }
            await SCREENS.configs();
            $('cfgmsg').innerHTML = flash('green', '✅ Imported ' + all.length + ' configs');
        };

        // ── Inbound: receive ─────────────────────────────────────────────
        SCREENS.recv = () => (S.recvId ? recvDetail() : recvList());
        async function recvList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('inbound_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main(r.loads.map(L => '<div class="card bt" data-act="openrecv" data-id="' + L.id + '"><h4>' + esc(L.number) + ' from ' + esc(B.fromName) + ' ' + statusPill(L.status) + '</h4>' +
                '<div class="muted">' + (L.approvedAt ? 'Shipped ' + esc(L.approvedAt) + ' · ' : '') + L.received + ' of ' + L.pallets + ' in</div></div>').join('') ||
                '<div class="muted">No trucks in transit</div>');
        }
        ACT.openrecv = el => { S.recvId = el.dataset.id; recvDetail(); };
        ACT.backrecv = () => { S.recvId = null; recvList(); };
        async function recvDetail() {
            main('<div class="muted">Loading…</div>');
            const r = await api('recv_get', { loadId: S.recvId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backrecv">← Inbound loads</button><div class="card bt"><h4>' + esc(r.load.number) + ' from ' + esc(B.fromName) +
                ' <span id="rstat"></span></h4><div class="muted">' + esc(loadSub(r.load)) + '</div><div class="prog" id="rcount"></div><div class="progress"><div id="rbar"></div></div></div>' +
                scanBox('rscan') + '<div id="scanres"></div><div class="card plist"><div class="muted"><b>Still expected</b></div><div id="rexp"></div></div><div id="rdone"></div>');
            paintRecv(r);
            wireScan('rscan', doRecvScan);
        }
        function paintRecv(r) {
            S.rv = r;
            $('rstat').innerHTML = statusPill(r.load.status);
            $('rcount').textContent = r.receivedCount + ' of ' + r.total + ' in';
            $('rbar').style.width = (r.total ? Math.round(r.receivedCount / r.total * 100) : 0) + '%';
            $('rexp').innerHTML = r.expected.map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + '</div>' +
                (p.status === 'missing' ? '<span class="pill p-red">missing</span>' : '') + '</div>').join('') || '<div class="muted">All pallets scanned in ✅</div>';
            $('rdone').innerHTML = r.load.status === 'receiving' ? '<button class="btn teal" data-act="recvready">Unloading done: send for approval</button>'
                : (r.load.status === 'recv_ready' ? '<div class="muted">⏳ Waiting for a manager to approve the receipt.</div>' : '');
        }
        function recvResultHtml(r) {
            const p = r.pallet, id = p ? p.id : '', line = p ? esc(p.code + ' · ' + p.summary) : '';
            const acts = '<button data-act="rdamaged" data-id="' + id + '">Mark damaged</button><button data-act="rundo" data-id="' + id + '">Undo</button>';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), esc(p.pieces + ' pcs · ' + p.code), esc(r.view.receivedCount + ' of ' + r.view.total + ' in'), acts);
                case 'late': return flash('green', '✅ Late arrival for ' + esc(r.loadNumber), line, 'A manager approves a second receipt for it.', acts);
                case 'dup': return flash('amber', '🟡 Already scanned in', line, 'No change.');
                case 'dup_other': return flash('amber', '🟡 Already received on ' + esc(r.otherNumber), line, 'No change.');
                case 'other_load': return flash('amber', '🟡 Belongs to ' + esc(r.otherNumber), line, '',
                    '<button data-act="recvother" data-id="' + id + '" data-load="' + esc(r.otherLoadId) + '">Receive on ' + esc(r.otherNumber) + '</button><button data-act="clearres">Set aside</button>');
                case 'other_load_pending': return flash('red', '❌ ' + esc(r.otherNumber) + ' not approved yet', line, 'A manager must Approve & Ship ' + esc(r.otherNumber) + ' first. Set the pallet aside.');
                case 'arrived_unshipped': return flash('orange', '🟠 Loaded without scan', line, 'It was never on a shipped load, so NetSuite still counts it at ' + esc(B.fromName) + '. Flagged for a manager catch-up.');
                case 'dup_catchup': return flash('amber', '🟡 Already flagged for catch-up', line);
                case 'void': return flash('red', '❌ Label cancelled', line, 'Set it aside and call the supervisor.');
                default: return flash('red', '❌ Unknown label', esc('"' + r.raw + '"'), 'Not a move label.');
            }
        }
        async function doRecvScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('scan_recv', { loadId: S.recvId, raw: v });
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            $('scanres').innerHTML = recvResultHtml(r);
            if (r.view) paintRecv(r.view);
        }
        ACT.rdamaged = async el => {
            const r = await api('recv_damaged', { palletId: el.dataset.id, loadId: S.recvId });
            if (!r.ok) { alert(r.error); return; }
            $('scanres').innerHTML = flash('amber', '🟡 Damaged: ' + esc(r.pallet.code), esc(r.pallet.summary), 'Still received (it is here), flagged for review.');
            if (r.view) paintRecv(r.view);
        };
        ACT.rundo = async el => {
            const r = await api('recv_undo', { palletId: el.dataset.id, loadId: S.recvId });
            if (!r.ok) { alert(r.error); return; }
            $('scanres').innerHTML = flash('amber', '↩ Scan undone');
            paintRecv(r.view);
        };
        ACT.recvother = async el => {
            const r = await api('recv_other', { palletId: el.dataset.id, otherLoadId: el.dataset.load, loadId: S.recvId });
            if (!r.ok) { alert(r.error); return; }
            tone(r.tone);
            $('scanres').innerHTML = flash('green', '✅ Received on ' + esc(r.loadNumber), esc(r.pallet.code + ' · ' + r.pallet.summary));
            paintRecv(r.view);
        };
        ACT.recvready = async el => {
            if (!confirm('Done unloading? A manager will approve the receipt.')) return;
            busy(el, true);
            const r = await api('recv_ready', { loadId: S.recvId });
            busy(el, false);
            if (!r.ok) { alert(r.error); return; }
            recvDetail();
        };

        // ── Inbound: manager "To receive" and catch-ups ──────────────────
        SCREENS.toreceive = async (msg) => {
            main('<div class="muted">Loading…</div>');
            const r = await api('toreceive_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<div id="rmsg">' + (msg || '') + '</div>' + (r.loads.map(L => {
                const retry = L.status === 'error' || L.status === 'receiving_tx';
                return '<div class="card bt"><h4>' + esc(L.number) + ' ' + (L.late ? '<span class="pill p-amber">late arrival</span>' : statusPill(L.status)) + '</h4>' +
                    '<div class="muted">' + L.scanned + ' of ' + L.expected + ' scanned in' + (L.damaged.length ? ' · ' + L.damaged.length + ' damaged' : '') + '</div>' +
                    (L.missing.length ? '<div class="warnrow"><span>' + (L.late ? 'Still missing' : 'Missing (will stay in transit)') + ': ' + L.missing.map(x => esc(x.code)).join(', ') + '</span></div>' : '') +
                    (L.damaged.length ? '<div class="warnrow"><span>Damaged: ' + L.damaged.map(x => esc(x.code + ' ' + x.summary)).join(', ') + '</span></div>' : '') +
                    (L.error ? '<div class="muted warn">Last error: ' + esc(L.error) + '</div>' : '') +
                    '<button class="btn teal sm" data-act="recvapprove" data-id="' + L.id + '">' + (retry ? 'Retry receipt' : (L.late ? 'Approve late receipt' : 'Approve Receipt')) +
                    ' (' + num(L.unpostedPieces) + ' pcs)</button></div>';
            }).join('') || '<div class="muted">Nothing waiting for a receipt</div>') +
                '<h3>In transit</h3>' + (r.transit.map(L => '<div class="card"><h4>' + esc(L.number) + ' ' + statusPill(L.status) + '</h4><div class="muted">' + L.pallets + ' pallets · ' +
                    esc(L.approvedAt) + '</div></div>').join('') || '<div class="muted">None</div>'));
        };
        ACT.recvapprove = async el => {
            if (!confirm('Create the item receipt? ' + B.toName + ' inventory goes up now.')) return;
            busy(el, true);
            const r = await api('recv_approve', { loadId: el.dataset.id });
            busy(el, false);
            if (!r.ok) { tone('bad'); SCREENS.toreceive(errBox(r.error)); return; }
            tone('ok');
            SCREENS.toreceive(flash('green', '✅ ' + esc(r.number) + ' received · ' + esc(r.receiptNumber), esc(num(r.pieces) + ' pcs'), r.missing ? r.missing + ' pallets still missing' : ''));
        };

        SCREENS.catchup = async (msg) => {
            main('<div class="muted">Loading…</div>');
            const r = await api('catchup_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<div id="cmsg">' + (msg || '') + '</div>' + (r.pallets.map(p => '<div class="card bo"><h4>' + esc(p.code) + ' · ' + esc(p.summary) + '</h4>' +
                '<div class="muted">Arrived on ' + esc(p.arrivedOnNumber || '?') + ' without an outbound scan · ' + esc(p.arrivedAt) + '</div>' +
                '<div class="muted">Approving creates a small transfer order, ships it and receives it at once: ' + esc(B.fromName) + ' −' + p.pieces + ', ' + esc(B.toName) + ' +' + p.pieces + '.</div>' +
                (p.ok ? '' : '<div class="muted warn">⚠ Not enough available at ' + esc(B.fromName) + ': ' + esc(p.short) + '. NetSuite has that stock reserved for customer orders; check with the office.</div>') +
                '<div class="row2"><button class="dbtn gh" data-act="cureject" data-id="' + p.id + '">Reject</button><button class="dbtn go" data-act="cuapprove" data-id="' + p.id + '"' +
                (p.ok ? '' : ' disabled') + '>Approve catch-up</button></div></div>').join('') || '<div class="muted">No catch-ups waiting</div>'));
        };
        ACT.cuapprove = async el => {
            if (!confirm('Create the catch-up transfer and receipt?')) return;
            busy(el, true);
            const r = await api('catchup_approve', { palletId: el.dataset.id });
            busy(el, false);
            if (!r.ok) { tone('bad'); SCREENS.catchup(errBox(r.error)); return; }
            tone('ok');
            SCREENS.catchup(flash('green', '✅ Catch-up ' + esc(r.number) + ' done', esc(r.receiptNumber)));
        };
        ACT.cureject = async el => {
            if (!confirm('Reject? The label goes back to "labeled" and the office investigates.')) return;
            const r = await api('catchup_reject', { palletId: el.dataset.id });
            SCREENS.catchup(r.ok ? flash('amber', 'Rejected') : errBox(r.error));
        };

        // ── Dashboard ────────────────────────────────────────────────────
        function barChart(days, needed) {
            if (!days.length) return '<div class="muted">No move days yet</div>';
            const W = 900, H = 190, x0 = 40, base = 160, top = 20;
            const max = Math.max(needed || 0, 1, ...days.map(d => d.n)) * 1.15;
            const w = (W - x0 - 10) / days.length;
            const y = v => base - v / max * (base - top);
            let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Pallets moved per day">';
            days.forEach((d, i) => {
                const bx = x0 + i * w + w * 0.15, bw = w * 0.7, by = y(d.n);
                s += '<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + (base - by) + '" rx="3" fill="' + (needed && d.n >= needed ? '#0d9488' : '#94a3b8') + '"/>';
                if (days.length <= 45) s += '<text x="' + (bx + bw / 2) + '" y="' + (by - 4) + '" font-size="10" text-anchor="middle" fill="#374151">' + d.n + '</text>' +
                    '<text x="' + (bx + bw / 2) + '" y="176" font-size="9" text-anchor="middle" fill="#6b7280">' + d.day.slice(5) + '</text>';
            });
            if (needed) s += '<line x1="' + x0 + '" x2="' + (W - 10) + '" y1="' + y(needed) + '" y2="' + y(needed) + '" stroke="#dc2626" stroke-dasharray="6 5"/>' +
                '<text x="' + (x0 + 4) + '" y="' + (y(needed) - 5) + '" font-size="11" fill="#dc2626">' + needed + ' needed</text>';
            return s + '<line x1="' + x0 + '" x2="' + (W - 10) + '" y1="' + base + '" y2="' + base + '" stroke="#cbd5e1"/></svg>';
        }
        SCREENS.dash = async () => {
            main('<div class="muted">Loading…</div>');
            const r = await api('dashboard');
            if (!r.ok) { main(errBox(r.error)); return; }
            const m = r.m, fin = m.projectedFinish;
            const k = (label, big, sub, cls) => '<div class="kpi ' + (cls || '') + '"><small>' + esc(label) + '</small><b>' + big + '</b><span>' + sub + '</span></div>';
            main('<div class="grid4">' +
                k('Total pallets to move (est.)', num(m.total), num(r.labeled) + ' labeled, not shipped') +
                k('Pallets moved (shipped)', num(m.moved), num(r.received) + ' received at ' + esc(B.toName)) +
                k('Pallets remaining', num(m.remaining), m.total ? Math.round(m.remaining / m.total * 100) + '% left' : '') +
                k('Move days left', m.daysLeft, 'Mon–Sat through ' + esc(r.target)) +
                k('Needed per day', m.neededPerDay == null ? '—' : m.neededPerDay, 'remaining ÷ days left', m.neededPerDay == null && m.remaining ? 'bad' : '') +
                k('Moved today · 7-day avg', m.movedToday + ' · ' + m.avg7, 'all-time avg ' + m.avgAll) +
                k('Projected finish', fin || '—', fin ? (m.onTrack ? '✅ on track for ' + esc(r.target) : '⚠ after ' + esc(r.target)) : 'needs a few days of data', fin ? (m.onTrack ? 'good' : 'bad') : '') +
                k('In transit', num(r.inTransit), r.exc.missing + ' missing') + '</div>' +
                '<div class="card"><h4>Pallets moved per day</h4>' + barChart(r.days, m.neededPerDay) + '</div><div class="grid3">' +
                '<div class="card"><h4>Recent loads</h4>' + (r.loads.map(L => '<div class="warnrow"><span>' + esc(L.number) + ' · ' + L.pallets + ' plt</span>' + statusPill(L.status) + '</div>').join('') ||
                    '<div class="muted">None</div>') + '</div>' +
                '<div class="card"><h4>Exceptions</h4>' + [['Missing pallets (in transit)', r.exc.missing], ['Waiting for catch-up', r.exc.arrivedUnshipped], ['Catch-ups last 7 days', r.exc.catchups7],
                    ['Damaged, flagged', r.exc.damaged], ['Edited at dock', r.exc.edited], ['Labeled, never loaded (stale)', r.exc.stale], ['SKUs with stock but no config', r.exc.noConfig]]
                    .map(x => '<div class="warnrow"><span>' + esc(x[0]) + '</span><b>' + x[1] + '</b></div>').join('') +
                    (r.noConfigSkus.length ? '<div class="muted">' + r.noConfigSkus.map(esc).join(', ') + '</div>' : '') + '</div>' +
                '<div class="card"><h4>Remaining by SKU</h4>' + r.bySku.map(x => '<div class="warnrow"><span>' + esc(x.sku) + '</span><b>' + x.palletsLeft + '</b></div>').join('') + '</div></div>');
        };

        shell();
    }

    function buildPage(boot) {
        const json = JSON.stringify(boot).replace(/</g, '\\u003c');
        return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
            '<title>Move Portal</title><style>' + CSS + '</style></head><body><div class="muted" style="padding:20px">Loading…</div>' +
            '<script>(' + clientMain.toString() + ')(' + json + ');</script></body></html>';
    }

    return { buildPage: buildPage, _clientMain: clientMain };
});
