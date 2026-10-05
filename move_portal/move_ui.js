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
[data-act="opentruck"],[data-act="openunload"]{cursor:pointer}
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
.tbl tr.okrow{background:#ecfdf5}.tbl tr.warnrow{display:table-row;background:#fffbeb}
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
            ed: null, edRender: null, truckId: null, tv: null, unloadId: null, lastIn: null, plan: null, pt: null, cfgRows: [], cfgImport: null, items: [] };

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

        const PILL = { loading: ['Loading', 'p-blue'], departing: ['Departing…', 'p-amber'], departed: ['In transit', 'p-blue'],
            receiving: ['Unloading', 'p-blue'], approving: ['Receiving…', 'p-amber'], received: ['Received', 'p-green'], waiting: ['⏳ Waiting for manager', 'p-amber'], error: ['Needs attention', 'p-red'] };
        function statusPill(s) { const p = PILL[s] || [s, 'p-gray']; return '<span class="pill ' + p[1] + '">' + esc(p[0]) + '</span>'; }

        function needWho() {
            if (S.who) return false;
            alert('Pick your name in "I am" first.');
            return true;
        }

        // ── shell ────────────────────────────────────────────────────────
        const TABS = {
            out: [['req', 'Request label'], ['trucks', 'Load out'], ['void', 'Void']].concat(isMgr ? [['approve', 'Approvals'], ['queue', 'Print queue'],
                ['plan', 'Print plan'], ['sku', 'Print a SKU'], ['configs', 'SKU configs'], ['reprint', 'Reprint'], ['report', 'Report'], ['dash', 'Dashboard']] : []),
            in: [['unload', 'Unload']].concat(isMgr ? [['approve', 'Approvals'], ['report', 'Report'], ['dash', 'Dashboard']] : [])
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
        ACT.tab = el => { S.tab = el.dataset.v; S.truckId = null; S.unloadId = null; renderNav(); };
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
                if (e.key === 'Tab') { e.preventDefault(); i.value += '\t'; return; }
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
                if (e.key === 'Tab') { e.preventDefault(); i.value += '\t'; return; }
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

        // ── Outbound: load out (v3) ──────────────────────────────────────
        SCREENS.trucks = () => (S.truckId ? truckDetail() : truckList());
        function ifRow(f, pick) {
            return '<label class="it"><div>' + (pick ? '<input type="checkbox" data-if="' + esc(f.ifId) + '"> ' : '') + '<b>' + esc(f.ifNum) + '</b> · ' + esc(f.toNum) +
                ' · ' + esc(f.lines.map(l => l.sku + ' ' + num(l.qty)).join(', ')) + '</div><div class="muted">' + (f.estPallets ? '≈ ' + f.estPallets + ' pallets' : '') + '</div></label>';
        }
        async function truckList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('truck_planned');
            if (!r.ok) { main(errBox(r.error)); return; }
            main((r.open.length ? '<h3>Trucks loading</h3>' + r.open.map(t => '<div class="card bl" data-act="opentruck" data-id="' + t.id + '"><h4>' + esc(t.label) + ' ' +
                statusPill(t.pending ? 'waiting' : t.status) + '</h4><div class="muted">' + t.pallets + ' pallets</div></div>').join('') : '') +
                '<h3>Planned trucks · Picked/Packed IFs</h3><div class="card plist">' + (r.planned.map(f => ifRow(f, true)).join('') || '<div class="muted">No planned IFs. The office creates them in NetSuite.</div>') + '</div>' +
                '<div id="tmsg"></div><button class="btn pri" data-act="starttruck">Start truck with selected IFs</button>' +
                (r.pulledAt ? '<div class="muted sm">Data from ' + esc(r.pulledAt) + '</div>' : ''));
        }
        ACT.starttruck = async el => {
            if (needWho()) return;
            const ids = Array.from(document.querySelectorAll('[data-if]:checked')).map(x => x.dataset.if);
            if (!ids.length) { $('tmsg').innerHTML = errBox('Tick at least one IF'); return; }
            busy(el, true);
            const r = await api('truck_start', { ifIds: ids });
            busy(el, false);
            if (!r.ok) { $('tmsg').innerHTML = errBox(r.error); return; }
            S.truckId = r.view.truck.id;
            truckDetail(r);
        };
        ACT.opentruck = el => { S.truckId = el.dataset.id; truckDetail(); };
        ACT.backtruck = () => { S.truckId = null; truckList(); };
        async function truckDetail(pre) {
            const r = pre || await api('truck_get', { truckId: S.truckId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backtruck">← All trucks</button><div class="card bl"><h4 id="thead"></h4><div class="muted" id="tsub"></div></div>' +
                '<div id="tscan"></div><div id="scanres"></div><div class="card" id="tlines"></div><div class="card plist" id="plist"></div><div id="tfoot"></div>');
            paintTruck(r.view, true);
        }
        function paintTruck(v, first) {
            S.tv = v;
            const t = v.truck, open = t.status === 'loading' && !t.pending;
            $('thead').innerHTML = esc(t.label) + ' ' + statusPill(t.pending ? 'waiting' : t.status);
            $('tsub').textContent = t.depart ? [t.depart.carrier, 'Trailer ' + t.depart.trailer, 'Seal ' + t.depart.seal].join(' · ') : v.totals.pallets + ' pallets · ' + num(v.totals.pieces) + ' pcs';
            if (first) {
                $('tscan').innerHTML = open ? scanBox('scan') : '';
                if (open) wireScan('scan', doTruckScan);
            }
            $('tlines').innerHTML = '<table class="tbl"><tr><th>IF</th><th>SKU</th><th>Scanned / expected</th></tr>' +
                v.lines.map(l => '<tr class="' + (l.scanned === l.expected ? 'okrow' : l.scanned > l.expected ? 'warnrow' : '') + '"><td>' + esc(l.ifNum) + '</td><td>' + esc(l.sku) +
                    '</td><td><b>' + num(l.scanned) + '</b> / ' + num(l.expected) + (l.estPallets ? ' <span class="muted">(' + l.estPallets + ' plt)</span>' : '') + '</td></tr>').join('') +
                v.extras.map(x => '<tr class="warnrow"><td>add-on</td><td>' + esc(x.sku) + '</td><td><b>' + num(x.scanned) + '</b> extra</td></tr>').join('') + '</table>';
            $('plist').innerHTML = v.pallets.slice().reverse().map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + '</div>' +
                (open ? '<div class="ac"><button data-act="tremove" data-id="' + p.id + '">✕</button></div>' : '') + '</div>').join('') || '<div class="muted">No pallets yet</div>';
            $('tfoot').innerHTML = (t.error ? errBox(t.error) : '') + (t.pending ? flash('amber', '⏳ Waiting for manager approval', esc('Trailer ' + t.pending.trailer + ' · Seal ' + t.pending.seal), 'Requested by ' + esc(t.pending.by), '<button data-act="dcancel">Cancel request, keep loading</button>')
                : open ? '<button class="btn ghost sm" data-act="tundo">↶ Undo last scan</button><div class="card"><h4>Departure</h4>' +
                    '<select class="inp" id="d_trailer"><option value="">Trailer #</option>' + v.trailers.map(x => '<option>' + esc(x) + '</option>').join('') + '<option value="__other">Other…</option></select>' +
                    '<input class="inp" id="d_trailer2" placeholder="Other trailer #" style="display:none"><input class="inp" id="d_seal" placeholder="Seal #">' +
                    '<input class="inp" id="d_carrier" value="' + esc(v.carrier) + '"><div id="dmsg"></div><button class="btn pri" data-act="dpreview">Review departure</button></div>'
                : t.depart ? flash('green', '🚚 ' + esc(t.label) + ' left', esc('Seal ' + t.depart.seal), t.bol && t.bol.changed ? '<b>Reprint BOL REV 2</b> · BOL # ' + esc(t.bol.number) + ' · IFs ' + esc(t.bol.ifNums.join(', ')) : 'BOL unchanged') : '');
            const sel = $('d_trailer');
            if (sel) sel.onchange = () => { $('d_trailer2').style.display = sel.value === '__other' ? '' : 'none'; };
        }
        function departBody() {
            const sel = $('d_trailer').value;
            return { truckId: S.truckId, trailer: sel === '__other' ? $('d_trailer2').value : sel, seal: $('d_seal').value, carrier: $('d_carrier').value };
        }
        function planHtml(p) {
            const line = o => o.op === 'if_qty' ? (o.to < o.from ? '⬇ Lower ' : '⬆ Raise ') + esc(o.ifNum + ' ' + o.sku + ' ' + num(o.from) + ' → ' + num(o.to))
                : o.op === 'if_create' ? '➕ Add-on IF from ' + esc(o.toNum + ': ' + o.skus.join(', ')) : '🔖 Stamp ' + esc(o.ifNum) + ' · Shipped';
            return '<div class="card"><h4>Plan</h4>' + p.ops.map(o => '<div>' + line(o) + '</div>').join('') +
                p.unplanned.map(u => '<div>↩ ' + esc(u.ifNum) + ' has nothing scanned: back to planned</div>').join('') +
                (p.bol.changed ? '<div><b>BOL REV 2</b> · BOL # ' + esc(p.bol.number) + ' · IFs ' + esc(p.bol.ifNums.join(', ')) + '</div>' : '') + '</div>';
        }
        ACT.dpreview = async el => {
            if (needWho()) return;
            busy(el, true);
            const r = await api('depart_preview', departBody());
            busy(el, false);
            if (!r.ok) { $('dmsg').innerHTML = errBox(r.error); return; }
            $('dmsg').innerHTML = flash(r.plan.needsManager ? 'amber' : 'green', 'Truck ' + r.truckNo + ' of the day', r.plan.needsManager ? r.plan.corrections + ' correction(s): a manager must approve' : 'Matches the IFs') +
                planHtml(r.plan) + '<button class="btn go" data-act="dconfirm">' + (r.plan.needsManager && !isMgr ? 'Send to manager' : 'Confirm departure') + '</button>';
        };
        ACT.dconfirm = async el => {
            busy(el, true);
            const r = await api('depart_confirm', departBody());
            busy(el, false);
            if (!r.ok) { tone('bad'); $('dmsg').innerHTML = errBox(r.error); return; }
            tone('ok');
            paintTruck(r.view, true);
        };
        ACT.dcancel = async () => { const r = await api('depart_cancel', { truckId: S.truckId }); if (r.ok) paintTruck(r.view, true); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tundo = async () => { const r = await api('truck_undo', { truckId: S.truckId }); if (r.ok) paintTruck(r.view, false); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tremove = async el => { const r = await api('truck_remove', { truckId: S.truckId, palletId: el.dataset.id }); if (r.ok) paintTruck(r.view, false); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tmovehere = async el => { const r = await api('truck_move_here', { truckId: S.truckId, palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('green', '✅ Moved here') : errBox(r.error); if (r.ok) paintTruck(r.view, false); };
        function truckResultHtml(r) {
            const p = r.pallet, line = p ? esc(p.code + ' · ' + p.summary) : '';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), esc(p.pieces + ' pcs · ' + p.code), r.view.totals.pallets + ' pallets on the truck');
                case 'over': return flash('amber', '🟡 Over the IF qty', line, 'The IF will be raised at departure (manager OK).');
                case 'addon': return flash('amber', '🟡 Add-on IF', line, 'Not on this truck\'s IFs. An add-on IF from ' + esc(r.addonTo ? r.addonTo.toNum : 'an office TO') + ' will be made (manager OK).');
                case 'no_to': return flash('red', '❌ No open TO for ' + esc(r.sku), line, 'Set it aside and call the office.');
                case 'dup': return flash('amber', '🟡 Already on this truck', line, 'No change.');
                case 'other_truck': return flash('amber', '🟡 On ' + esc(r.otherLabel), line, '', '<button data-act="tmovehere" data-id="' + p.id + '">Move here</button><button data-act="clearres">Leave it</button>');
                case 'locked': return flash('red', '❌ On ' + esc(r.otherLabel) + ', departing', line, 'Check with the supervisor.');
                case 'shipped': return flash('red', '❌ Already left', line, 'This pallet is on a truck that departed.');
                case 'void': return flash('red', '❌ Label cancelled', line, 'Request a new label.');
                default: return flash('red', '❌ Unknown label', esc('"' + String(r.raw).replace(/\t/g, ' ⇥ ') + '"'), 'Not a move label. Maybe a product barcode?');
            }
        }
        async function doTruckScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('truck_scan', { truckId: S.truckId, raw: v });
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            $('scanres').innerHTML = truckResultHtml(r);
            if (r.view) paintTruck(r.view, false);
        }

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

        // ── Inbound: unload (v3) ─────────────────────────────────────────
        SCREENS.unload = () => (S.unloadId ? unloadDetail() : unloadList());
        async function unloadList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('unload_list');
            if (!r.ok) { main(errBox(r.error)); return; }
            main(r.trucks.map(t => '<div class="card bt" data-act="openunload" data-id="' + t.id + '"><h4>' + esc(t.label) + ' ' + statusPill(t.status) + '</h4><div class="muted">' +
                esc(t.depart ? 'Seal ' + t.depart.seal + ' · Trailer ' + t.depart.trailer : '') + ' · ' + t.received + ' of ' + t.pallets + ' in' + (t.missing ? ' · ' + t.missing + ' missing' : '') + '</div></div>').join('') ||
                '<div class="muted">No trucks in transit</div>');
        }
        ACT.openunload = el => { S.unloadId = el.dataset.id; unloadDetail(); };
        ACT.backunload = () => { S.unloadId = null; unloadList(); };
        async function unloadDetail() {
            const r = await api('unload_get', { truckId: S.unloadId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backunload">← All trucks</button><div class="card bt"><h4 id="uhead"></h4><div class="muted" id="usub"></div></div>' +
                scanBox('rscan') + '<div id="scanres"></div><div class="card" id="uifs"></div><div class="card plist" id="uexp"></div><div id="ufoot"></div>');
            wireScan('rscan', doUnloadScan);
            paintUnload(r.view);
        }
        function paintUnload(v) {
            const t = v.truck;
            $('uhead').innerHTML = esc(t.label) + ' ' + statusPill(t.status);
            $('usub').textContent = (t.depart ? 'Seal ' + t.depart.seal + ' · Trailer ' + t.depart.trailer + ' · ' : '') + v.counts.in + ' of ' + v.counts.of + ' pallets in';
            $('uifs').innerHTML = '<table class="tbl"><tr><th>IF</th><th>Received / shipped</th></tr>' + v.perIf.map(f => '<tr class="' + (f.short ? '' : 'okrow') + '"><td>' + esc(f.ifNum) +
                '</td><td><b>' + num(f.received) + '</b> / ' + num(f.shipped) + '</td></tr>').join('') + '</table>' +
                (v.flagged.length ? flash('amber', '🟠 ' + v.flagged.length + ' never-loaded pallet(s) flagged', esc(v.flagged.map(p => p.code).join(', ')), 'The office will sort these out.') : '');
            $('uexp').innerHTML = '<h4>Still expected</h4>' + (v.expected.map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + '</div></div>').join('') || '<div class="muted">All in ✅</div>');
            $('ufoot').innerHTML = (t.error ? errBox(t.error) : '') + '<button class="btn ghost sm" data-act="uundo">↶ Undo last scan</button>' + (S.lastIn ? '<button class="btn ghost sm" data-act="udamaged" data-id="' + S.lastIn + '">Mark last pallet damaged</button>' : '') +
                '<button class="btn go" data-act="udone">Unloading done: send to manager</button>';
        }
        function unloadResultHtml(r) {
            const p = r.pallet, line = p ? esc(p.code + ' · ' + p.summary) : '';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), line, r.view.counts.in + ' of ' + r.view.counts.of + ' in');
                case 'late': return flash('green', '✅ Late arrival', line, 'It goes on a second receipt for this IF (manager OK).');
                case 'dup': return flash('amber', '🟡 Already scanned in', line, 'No change.');
                case 'dup_other': return flash('amber', '🟡 Already received on ' + esc(r.otherLabel), line, '');
                case 'other_truck': return flash('amber', '🟡 Belongs to ' + esc(r.otherLabel), line, '', '<button data-act="uother" data-id="' + p.id + '">Receive it there</button><button data-act="clearres">Set aside</button>');
                case 'never_loaded': return flash('amber', '🟠 Never loaded on a truck', line, 'Flagged for the office. Set it aside.');
                case 'locked': return flash('red', '❌ Its truck is still departing', line, 'Wait a minute and scan again.');
                case 'void': return flash('red', '❌ Label cancelled', line, 'Set aside and call the supervisor.');
                default: return flash('red', '❌ Unknown label', esc('"' + String(r.raw).replace(/\t/g, ' ⇥ ') + '"'), '');
            }
        }
        async function doUnloadScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('unload_scan', { truckId: S.unloadId, raw: v });
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            if (r.result === 'ok' || r.result === 'late') S.lastIn = r.pallet.id;
            $('scanres').innerHTML = unloadResultHtml(r);
            if (r.view) paintUnload(r.view);
        }
        ACT.uother = async el => { const r = await api('unload_other', { palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('green', '✅ Received on its own truck') : errBox(r.error); };
        ACT.udamaged = async el => { const r = await api('unload_damaged', { palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('amber', 'Marked damaged') : errBox(r.error); };
        ACT.uundo = async () => { const r = await api('unload_undo', { truckId: S.unloadId }); if (r.ok) paintUnload(r.view); else $('scanres').innerHTML = errBox(r.error); };
        ACT.udone = async () => { const r = await api('unload_done', { truckId: S.unloadId }); $('scanres').innerHTML = r.ok ? flash('green', 'Sent to the manager for receipt approval') : errBox(r.error); };

        // ── Manager: approvals (v3) ──────────────────────────────────────
        SCREENS.approve = async (msg) => {
            main((msg || '') + '<div class="muted">Loading…</div>');
            const r = await api('approvals');
            if (!r.ok) { main(errBox(r.error)); return; }
            const dep = r.departures.map(d => '<div class="card"><h4>🚚 ' + esc(d.truck.label) + ' · departure</h4><div class="muted">' + esc('Trailer ' + d.pending.trailer + ' · Seal ' + d.pending.seal + ' · by ' + d.pending.by) + '</div>' +
                (d.plan ? planHtml(d.plan) + '<button class="btn go" data-act="apdepart" data-id="' + d.truck.id + '">Approve departure</button>' : errBox(d.error)) + '</div>').join('');
            const ret = r.retries.map(t => '<div class="card"><h4>⚠ ' + esc(t.label) + '</h4>' + errBox(t.error || 'Departure stalled, press Retry') + '<button class="btn pri" data-act="apretry" data-id="' + t.id + '">Retry</button></div>').join('');
            const rec = r.receipts.map(x => {
                const head = '<h4>📥 ' + esc(x.truck.label) + (x.lateOnly ? ' · late arrivals' : ' · receipt') + '</h4>';
                if (!x.perIf) return '<div class="card warnc">' + head + errBox(x.error || 'Could not build the receipt') + '</div>';
                const missing = x.missing || [];
                return '<div class="card">' + head + (x.stuck ? '<div class="muted warn">⚠ Stuck, re-approve</div>' : '') + (x.error ? errBox(x.error) : '') +
                    '<table class="tbl"><tr><th>IF</th><th>Received / shipped</th></tr>' +
                    x.perIf.map(f => '<tr class="' + (f.short ? 'warnrow' : 'okrow') + '"><td>' + esc(f.ifNum) + '</td><td>' + num(f.received) + ' / ' + num(f.shipped) + '</td></tr>').join('') + '</table>' +
                    (missing.length ? '<div class="muted">Missing: ' + esc(missing.join(', ')) + '</div>' : '') +
                    '<button class="btn go" data-act="aprecv" data-id="' + x.truck.id + '">' + (x.stuck ? 'Re-approve receipt' : missing.length ? 'Approve short receipt' : 'Approve receipt') + '</button></div>';
            }).join('');
            main((msg || '') + (dep + ret + rec || '<div class="muted">Nothing waiting for approval</div>'));
        };
        ACT.apdepart = async el => { busy(el, true); const r = await api('depart_confirm', { truckId: el.dataset.id }); tone(r.ok ? 'ok' : 'bad'); SCREENS.approve(r.ok ? flash('green', '✅ Departed') : errBox(r.error)); };
        ACT.apretry = async el => { busy(el, true); const r = await api('depart_retry', { truckId: el.dataset.id }); tone(r.ok ? 'ok' : 'bad'); SCREENS.approve(r.ok ? flash('green', '✅ Departed') : errBox(r.error)); };
        ACT.aprecv = async el => {
            busy(el, true);
            const r = await api('receipt_approve', { truckId: el.dataset.id });
            tone(r.ok ? 'ok' : 'bad');
            const w = r.ok ? (r.written || []) : [], m = r.ok ? (r.missing || []) : [];
            SCREENS.approve(r.ok ? flash('green', '✅ Receipt approved', w.length ? w.length + ' written to NetSuite' : 'Plan saved (no NetSuite write in this mode)', m.length ? m.length + ' pallets stay in transit' : '') : errBox(r.error));
        };

        // ── Manager: shadow report (v3) ──────────────────────────────────
        SCREENS.report = async () => {
            main('<div class="muted">Loading…</div>');
            const r = await api('report');
            if (!r.ok) { main(errBox(r.error)); return; }
            const mark = ok => (ok === true ? '✅' : ok === false ? '❌' : '⏳');
            main('<div class="muted">Write mode <b>' + esc(r.writeMode) + '</b>' + (r.pulledAt ? ' · NetSuite data from ' + esc(r.pulledAt) : '') + '</div>' +
                '<div class="card"><table class="tbl"><tr><th>Day</th><th>Trucks</th><th>Pallets</th><th>Pcs</th><th>Diffs</th></tr>' +
                r.days.map(d => '<tr><td>' + esc(d.day) + '</td><td>' + d.trucks + '</td><td>' + d.pallets + '</td><td>' + num(d.pieces) + '</td><td>' + (d.diffs ? '❌ ' + d.diffs : '✅') + '</td></tr>').join('') + '</table></div>' +
                '<div class="card"><table class="tbl"><tr><th></th><th>Truck</th><th>IF</th><th>Check</th><th>Portal</th><th>NetSuite</th></tr>' +
                r.rows.map(x => '<tr class="' + (x.ok === false ? 'warnrow' : '') + '"><td>' + mark(x.ok) + '</td><td>' + esc(x.truck) + '</td><td>' + esc(x.ifNum) + '</td><td>' + esc(x.check) +
                    '</td><td>' + esc(x.portal) + '</td><td>' + esc(x.netsuite) + '</td></tr>').join('') + '</table></div>');
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
                '<div class="card"><h4>Recent trucks</h4>' + (r.trucks.map(t => '<div class="warnrow"><span>' + esc(t.label) + ' · ' + t.pallets + ' pallets</span>' + statusPill(t.status) + '</div>').join('') ||
                    '<div class="muted">None</div>') + '</div>' +
                '<div class="card"><h4>Exceptions</h4>' + [['Missing pallets (in transit)', r.exc.missing], ['Never loaded', r.exc.neverLoaded],
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
