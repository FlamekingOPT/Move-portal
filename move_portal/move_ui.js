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
.scanbox.takeoff{border:3px solid var(--amber);background:var(--amber-soft)}
.smode{display:flex;gap:6px;margin-top:10px}.smode button{flex:1;border:2px solid var(--line);background:#fff;border-radius:10px;padding:10px 6px;font-weight:700;font-size:14px;color:var(--muted)}
.smode button.on{border-color:var(--blue);background:var(--blue-soft);color:var(--blue)}.smode button.on.off{border-color:var(--amber);background:var(--amber-soft);color:var(--amber)}
.card.amberc{border:2px solid var(--amber);background:#fffbeb}.card.greenc{border:2px solid var(--green);background:#f0fdf4}
.diffs div{padding:6px 0;border-bottom:1px solid var(--line);font-size:14px;overflow-wrap:anywhere}.diffs div:last-child{border:0}
.drow{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:14px}.drow:last-child{border:0}.drow span{overflow-wrap:anywhere;min-width:0}.drow button{flex:0 0 auto}
.banner{position:fixed;bottom:0;left:0;right:0;z-index:20;padding:8px 12px}
.banner div{display:flex;flex-wrap:wrap;align-items:center;gap:8px;background:var(--green);color:#fff;border-radius:12px;padding:12px;margin-top:6px;font-weight:700;box-shadow:0 -4px 14px rgba(0,0,0,.25)}
.banner span{flex:1 1 180px;min-width:0;overflow-wrap:anywhere}.banner button{border:0;border-radius:9px;padding:10px 14px;font-weight:700;background:rgba(255,255,255,.25);color:#fff;font-size:15px}
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
        if (isMgr) S.who = B.me;   // the manager page is a NetSuite login: that user is the actor, no "I am" pick

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
                const seq = kind === 'ok' ? [[880, 0.08], [1320, 0.1]] : kind === 'warn' ? [[660, 0.09], [0, 0.05], [660, 0.09]]
                    : kind === 'off' ? [[740, 0.09], [494, 0.14]] : kind === 'ready' ? [[880, 0.08], [1320, 0.1], [0, 0.12], [880, 0.08], [1320, 0.1]] : [[180, 0.35]];
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

        const PILL = { loading: ['Loading', 'p-blue'], needs_fix: ['⚠ Needs IF fix', 'p-amber'], ready: ['✅ Ready to ship', 'p-green'], ship_pending: ['Shipped by floor', 'p-amber'], departing: ['Departing…', 'p-amber'],
            departed: ['In transit', 'p-blue'], receiving: ['Unloading', 'p-blue'], approving: ['Receiving…', 'p-amber'], received: ['Received', 'p-green'], error: ['Needs attention', 'p-red'] };
        // What Correct the IF does under each write mode (confirm text and card notes).
        const WM = { off: 'Plan only: fix in NetSuite', qty: 'Changes IF quantities in NetSuite (add-on IFs: office creates them)',
            on: 'Changes IF quantities and creates add-on IFs in NetSuite' };
        function wmText(m) { return WM[m] || WM.off; }
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
            const whoCtl = isMgr ? ''
                : B.roster.length
                    ? '<select id="who"><option value="">— pick —</option>' + B.roster.map(n => '<option' + (n === S.who ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>'
                    : '<input id="who" value="' + esc(S.who) + '" placeholder="your name">';
            document.body.innerHTML = '<div class="top"><div class="ttl"><b>Move Portal</b><span>' + esc(B.me) + (isMgr ? ' · manager' : '') + '</span></div>' +
                (isMgr ? '' : '<div class="who">I am ' + whoCtl + '</div>') +
                '<div class="toggle"><button data-act="side" data-v="out" class="' + (S.side === 'out' ? 'on out' : '') + '">📤 Outbound · ' + esc(B.fromName) + '</button>' +
                '<button data-act="side" data-v="in" class="' + (S.side === 'in' ? 'on in' : '') + '">📥 Inbound · ' + esc(B.toName) + '</button></div></div>' +
                '<div class="subnav" id="subnav"></div><main id="main"></main>';
            const w = $('who');
            if (w) w.onchange = w.oninput = () => { S.who = w.value.trim(); put('mv_who', S.who); };
            paintBanner();
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
        ACT.tab = el => { S.tab = el.dataset.v; S.truckId = null; S.unloadId = null; S.lastIn = null; renderNav(); };
        ACT.clearres = () => { const r = $('scanres'); if (r) r.innerHTML = ''; };
        ACT.typecode = el => { const i = $(el.dataset.v); if (i) { i.setAttribute('inputmode', 'text'); i.focus(); } };

        // ── floor: re-check needs_fix trucks every 30 s; alert once per truck per device when one turns ready ──
        S.banner = [];
        function alerted() { try { return JSON.parse(get('mv_alerted') || '[]'); } catch (e) { return []; } }
        function paintBanner() {
            let b = $('rbanner');
            const m = $('main');
            if (!S.banner.length) { if (b) b.remove(); if (m) m.style.paddingBottom = ''; return; }
            if (!b) { b = document.createElement('div'); b.id = 'rbanner'; b.className = 'banner'; document.body.appendChild(b); }
            b.innerHTML = S.banner.map(t => '<div><span>✅ ' + esc(t.label) + ' now matches its IF: ready to ship</span>' +
                '<button data-act="opentruck" data-id="' + esc(t.id) + '">Open</button><button data-act="bannerx" data-id="' + esc(t.id) + '" aria-label="Dismiss">✕</button></div>').join('');
            if (m) m.style.paddingBottom = (b.offsetHeight + 16) + 'px';     // the fixed banner never covers the last controls
        }
        // This device just verified a ready truck: its own ready event needs no banner.
        function markSeen(view) {
            if (!view || !view.truck || view.truck.status !== 'ready' || !view.verify) return;
            const k = String(view.truck.id + '|' + view.verify.at), seen = alerted();
            if (seen.indexOf(k) === -1) put('mv_alerted', JSON.stringify(seen.concat([k]).slice(-300)));
        }
        function dropBanner(id) { S.banner = S.banner.filter(t => String(t.id) !== String(id)); paintBanner(); }
        ACT.bannerx = el => dropBanner(el.dataset.id);
        async function recheck() {
            if (document.hidden || S.rcBusy) return;
            S.rcBusy = true;
            try {
                const r = await api('trucks_recheck');
                if (!r.ok || !r.ready) return;
                // One alert per ready event (truck id + verify time) on every device, also after needs_fix → ready again.
                const key = t => String(t.id + '|' + t.at), seen = alerted(), fresh = r.ready.filter(t => seen.indexOf(key(t)) === -1);
                if (fresh.length) {
                    put('mv_alerted', JSON.stringify(seen.concat(fresh.map(key)).slice(-300)));
                    fresh.forEach(t => { S.banner = S.banner.filter(x => String(x.id) !== String(t.id)).concat([{ id: String(t.id), label: t.label }]); });
                    paintBanner();
                    tone('ready');
                }
                if (r.ready.some(t => String(t.id) === String(S.truckId)) && $('tfoot') && S.tv && S.tv.truck.status === 'needs_fix') truckDetail();
                else if (fresh.length && S.side === 'out' && S.tab === 'trucks' && !S.truckId) truckList();
            } finally { S.rcBusy = false; }
        }
        function startRecheck() { if (!isMgr && !S.rc && !document.hidden) S.rc = setInterval(recheck, 30000); }
        function stopRecheck() { clearInterval(S.rc); S.rc = null; }
        if (!isMgr) {
            document.addEventListener('visibilitychange', () => { if (document.hidden) stopRecheck(); else { startRecheck(); recheck(); } });
            startRecheck();
        }

        // Scan input: queue every Enter so nothing is lost while a request runs. tag(): captured with each scan (the truck scan mode).
        function wireScan(id, fn, tag) {
            const i = $(id);
            if (!i) return;
            i.focus();
            const q = [];
            let running = false;
            async function pump() {
                if (running) return;
                running = true;
                while (q.length) { const e = q.shift(); await fn(e[0], e[1]); }
                running = false;
                refocusScan();
            }
            i.onkeydown = e => {
                if (e.key === 'Tab') { e.preventDefault(); i.value += '\t'; return; }
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const v = i.value.trim();
                i.value = '';
                if (v) { q.push([v, tag ? tag() : undefined]); pump(); }
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
                (acts && q.status === 'queued' ? '<div class="row2"><button class="dbtn pri" data-act="reqprint" data-id="' + esc(q.id) + '">Print</button>' +
                    '<button class="dbtn gh" data-act="reqcancel" data-id="' + esc(q.id) + '">Cancel</button></div>' : '') + '</div>';
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
            main((r.open.length ? '<h3>Trucks loading</h3>' + r.open.map(t => '<div class="card bl" data-act="opentruck" data-id="' + esc(t.id) + '"><h4>' + esc(t.label) + ' ' +
                statusPill(t.status) + '</h4><div class="muted">' + t.pallets + ' pallets</div></div>').join('') : '') +
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
        ACT.opentruck = el => {
            dropBanner(el.dataset.id);
            S.truckId = el.dataset.id;
            if (S.side !== 'out' || S.tab !== 'trucks') { S.side = 'out'; put('mv_side', 'out'); S.tab = 'trucks'; shell(); } else truckDetail();
        };
        ACT.backtruck = () => { S.truckId = null; truckList(); };
        async function truckDetail(pre) {
            if (S.tmodeTruck !== S.truckId) { S.tmodeTruck = S.truckId; setMode('load'); }
            const r = pre || await api('truck_get', { truckId: S.truckId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backtruck">← All trucks</button><div class="card bl"><h4 id="thead"></h4><div class="muted" id="tsub"></div></div>' +
                '<div id="tscan"></div><div id="scanres"></div><div class="card" id="tlines"></div><div id="tfoot"></div><div class="card plist" id="plist"></div>');
            paintTruck(r.view, true);
        }

        // Scan mode: Load or Take off. Take off falls back to Load after 2 minutes without a scan.
        S.tmode = 'load';
        function modeHtml() {
            return '<div class="smode"><button data-act="tmode" data-v="load" class="' + (S.tmode === 'load' ? 'on' : '') + '">➕ Load</button>' +
                '<button data-act="tmode" data-v="off" class="' + (S.tmode === 'off' ? 'on off' : '') + '">➖ Take off</button></div>';
        }
        function paintMode() {
            const box = $('tmodebox'), i = $('scan');
            if (box) box.innerHTML = modeHtml();
            if (i) {
                i.closest('.scanbox').classList.toggle('takeoff', S.tmode === 'off');
                i.placeholder = S.tmode === 'off' ? 'Scan a pallet to take it off…' : 'Scan pallet label…';
            }
        }
        function setMode(m) {
            S.tmode = m === 'off' ? 'off' : 'load';
            clearTimeout(S.tmodeT);
            if (S.tmode === 'off') S.tmodeT = setTimeout(() => setMode('load'), 120000);
            paintMode();
        }
        ACT.tmode = el => setMode(el.dataset.v);

        function diffList(diffs) { return '<div class="diffs">' + (diffs || []).map(d => '<div>' + esc(d.text) + '</div>').join('') + '</div>'; }
        // Picked/Packed IFs no truck has, on this truck's TOs. Never attached without an explicit Add.
        function sugHtml(list, mgr, truckId) {
            return list && list.length ? '<label class="f">Packed IFs no truck has yet</label>' + list.map(f => '<div class="drow"><span><b>' + esc(f.ifNum) + '</b> · ' + esc(f.toNum) +
                ' · ' + esc(f.lines.map(l => l.sku + ' ' + num(l.qty)).join(', ')) + '</span><button class="dbtn pri" ' + (mgr ? 'data-act="apaddif"' : 'data-act="taddif"') + ' data-id="' + esc(truckId) +
                '" data-ifid="' + esc(f.ifId) + '" data-label="' + esc(f.ifNum) + '">Add to this truck</button></div>').join('') : '';
        }
        // Mark shipped (rework Task 2): the trailer is the truck's; a manager confirms in Approvals. Task 4 moves this to the Shipments tab.
        function departForm(v) {
            return '<input class="inp" id="d_seal" placeholder="Seal #"><input class="inp" id="d_carrier" value="' + esc(v.carrier) + '"><div id="dmsg"></div>' +
                '<button class="btn go" data-act="dmark">🚚 Mark shipped</button>';
        }
        // One card per stage: loading → Verify; needs_fix → the diffs; ready → the departure form.
        function stageHtml(v) {
            const t = v.truck, st = t.status, vf = v.verify || {};
            const undo = '<button class="btn ghost sm" data-act="tundo">↶ Undo last scan</button>';
            const when = vf.at ? '<div class="muted">Checked ' + esc(vf.at) + (vf.by ? ' by ' + esc(typeof vf.by === 'object' ? vf.by.name : vf.by) : '') + '</div>' : '';
            const err = st !== 'departing' && t.error ? errBox(t.error) : '';
            if (st === 'loading') return err + '<button class="btn pri" data-act="tverify">✔ Verify load</button>' + undo;
            if (st === 'needs_fix') return err + '<div class="card amberc"><h4>⚠ Needs IF fix</h4>' + when + diffList(vf.diffs) + sugHtml(v.suggestions, false, t.id) +
                '<div class="muted">Keep loading or take pallets off, or wait for the office to fix the IF in NetSuite. A manager can correct it in Approvals.</div>' +
                '<div class="row2"><button class="dbtn pri" data-act="tverify">Verify again</button><button class="dbtn gh" data-act="backtruck">← Other trucks</button></div></div>' + undo;
            if (st === 'ready') return err + '<div class="card greenc"><h4>✅ Ready to ship</h4>' + when + '<div class="muted">The load matches its IFs. Enter the seal #.</div>' +
                departForm(v) + '</div>' + undo;
            if (st === 'ship_pending') return flash('amber', '🚚 Marked shipped: waiting for a manager to confirm', esc('Seal ' + ((t.shipReq || {}).seal || '')));
            if (st === 'departing') return flash('amber', 'Departing… a NetSuite write is pending', t.error ? esc(t.error) : '', 'A manager can press Retry in Approvals');
            if (t.depart && t.status === 'departed') return err + flash('green', '🚚 ' + esc(t.label) + ' left', esc('Seal ' + t.depart.seal),
                t.bol && t.bol.changed ? '<b>Reprint BOL REV 2</b> · BOL # ' + esc(t.bol.number) + ' · IFs ' + esc(t.bol.ifNums.join(', ')) : 'BOL unchanged');
            return err;
        }
        function paintTruck(v, first) {
            S.tv = v;
            const t = v.truck, open = ['loading', 'needs_fix', 'ready'].indexOf(t.status) !== -1;
            $('thead').innerHTML = esc(t.label) + ' ' + statusPill(t.status);
            $('tsub').textContent = t.depart ? [t.depart.carrier, 'Trailer ' + t.depart.trailer, 'Seal ' + t.depart.seal].join(' · ') : v.totals.pallets + ' pallets · ' + num(v.totals.pieces) + ' pcs';
            if (first) {
                $('tscan').innerHTML = open ? '<div id="tmodebox"></div>' + scanBox('scan') : '';
                if (open) { wireScan('scan', doTruckScan, () => S.tmode); paintMode(); }
            }
            $('tlines').innerHTML = '<table class="tbl"><tr><th>IF</th><th>SKU</th><th>Scanned / expected</th></tr>' +
                v.lines.map(l => '<tr class="' + (l.scanned === l.expected ? 'okrow' : l.scanned > l.expected ? 'warnrow' : '') + '"><td>' + esc(l.ifNum) + '</td><td>' + esc(l.sku) +
                    '</td><td><b>' + num(l.scanned) + '</b> / ' + num(l.expected) + (l.estPallets ? ' <span class="muted">(' + l.estPallets + ' plt)</span>' : '') + '</td></tr>').join('') +
                v.extras.map(x => '<tr class="warnrow"><td>add-on</td><td>' + esc(x.sku) + '</td><td><b>' + num(x.scanned) + '</b> extra</td></tr>').join('') + '</table>';
            $('plist').innerHTML = v.pallets.slice().reverse().map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + '</div>' +
                (open ? '<div class="ac"><button data-act="tremove" data-id="' + esc(p.id) + '">✕</button></div>' : '') + '</div>').join('') || '<div class="muted">No pallets yet</div>';
            const keep = { d_seal: ($('d_seal') || {}).value, d_carrier: ($('d_carrier') || {}).value };
            $('tfoot').innerHTML = stageHtml(v);
            if ($('d_seal') && keep.d_seal != null) { $('d_seal').value = keep.d_seal || ''; $('d_carrier').value = keep.d_carrier || ''; }
        }
        ACT.tverify = async el => {
            if (needWho()) return;
            busy(el, true);
            const r = await api('truck_verify', { truckId: S.truckId });
            busy(el, false);
            if (!$('scanres')) return;
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            markSeen(r.view);
            tone(r.match ? 'ok' : 'warn');
            paintTruck(r.view, false);
            $('scanres').innerHTML = r.match ? flash('green', '✅ Ready to ship', 'The load matches its IFs')
                : flash('amber', '⚠ Needs IF fix', r.diffs.length + ' difference' + (r.diffs.length === 1 ? '' : 's') + ': see the card below');
        };
        ACT.taddif = async el => {
            if (needWho()) return;
            busy(el, true);
            const r = await api('truck_add_if', { truckId: S.truckId, ifId: el.dataset.ifid });
            busy(el, false);
            if (!$('scanres')) return;
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            markSeen(r.view);
            tone(r.match ? 'ok' : 'warn');
            paintTruck(r.view, false);
            $('scanres').innerHTML = flash(r.match ? 'green' : 'amber', '➕ ' + esc(el.dataset.label) + ' added',
                r.match ? 'The load matches its IFs: ready to ship' : 'Still needs an IF fix: see the card below');
        };
        function departBody() { return { truckId: S.truckId, seal: $('d_seal').value, carrier: $('d_carrier').value }; }
        // The departure re-check no longer matches. "IF changed" only when an IF is gone or its qty differs from what the screen showed;
        // otherwise the load changed (a scan or take-off landed meanwhile).
        function ifChanged(diffs, prev) {
            const was = {};
            ((prev && prev.lines) || []).forEach(l => { was[l.ifNum + '|' + String(l.item)] = Number(l.expected); });
            return (diffs || []).some(d => d.kind === 'if_gone' || ((d.kind === 'if_short' || d.kind === 'if_over') && was[d.ifNum + '|' + String(d.item)] !== Number(d.ifQty)));
        }
        function needsFixAgain(r) {
            const prev = S.tv;
            tone('bad');
            paintTruck(r.view, true);
            $('scanres').innerHTML = flash('red', ifChanged(r.diffs, prev) ? '❌ IF changed in NetSuite: needs a fix again' : '❌ The load changed: verify again',
                (r.diffs || []).map(d => esc(d.text)).join('<br>'));
        }
        // A refused departure: the truck may have changed on another device, so refetch and repaint (the form keeps what was typed
        // while the truck is still Ready). The error goes in scanres, above the repainted stage card.
        async function departRefused(r) {
            tone('bad');
            const g = await api('truck_get', { truckId: S.truckId });
            if (!g.ok || !$('tfoot')) { if ($('dmsg')) $('dmsg').innerHTML = errBox(r.error); return; }
            paintTruck(g.view, true);
            $('scanres').innerHTML = errBox(r.error) +
                (['loading', 'needs_fix'].indexOf(g.view.truck.status) !== -1 ?flash('amber', 'The truck changed on another device: verify again') : '');
        }
        ACT.dmark = async el => {
            if (needWho()) return;
            if (!confirm('Mark this truck shipped? A manager confirms it in Approvals.')) return;
            busy(el, true);
            const r = await api('ship_mark', departBody());
            busy(el, false);
            if (!$('tfoot')) return;
            if (!r.ok) { await departRefused(r); return; }
            markSeen(r.view);
            if (r.needsFix) { needsFixAgain(r); return; }
            tone('ok');
            paintTruck(r.view, true);
        };
        ACT.tundo = async () => { const r = await api('truck_undo', { truckId: S.truckId }); if (!$('scanres')) return; if (r.ok) paintTruck(r.view, false); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tremove = async el => { const r = await api('truck_remove', { truckId: S.truckId, palletId: el.dataset.id }); if (!$('scanres')) return; if (r.ok) paintTruck(r.view, false); else $('scanres').innerHTML = errBox(r.error); };
        ACT.tmovehere = async el => { const r = await api('truck_move_here', { truckId: S.truckId, palletId: el.dataset.id }); if (!$('scanres')) return; $('scanres').innerHTML = r.ok ? flash('green', '✅ Moved here') : errBox(r.error); if (r.ok) paintTruck(r.view, false); };
        function truckResultHtml(r) {
            const p = r.pallet, line = p ? esc(p.code + ' · ' + p.summary) : '', raw = esc('"' + String(r.raw).replace(/\t/g, ' ⇥ ') + '"');
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), esc(p.pieces + ' pcs · ' + p.code), r.view.totals.pallets + ' pallets on the truck');
                case 'taken_off': return flash('amber', '➖ Taken off: ' + esc(p.code) + ' → back to Riverside', esc(p.summary), r.view.totals.pallets + ' pallets on the truck');
                case 'not_on_truck': return flash('red', '❌ Not on this truck', line || raw, 'Nothing was taken off.');
                case 'over': return flash('amber', '🟡 Over the IF qty', line, 'Verify will ask for an IF fix.');
                case 'addon': return flash('amber', '🟡 Not on this truck\'s IFs', line, 'Needs an add-on IF from ' + esc(r.addonTo ? r.addonTo.toNum : 'an office TO') + '. Verify will ask for it.');
                case 'no_to': return flash('red', '❌ No open TO for ' + esc(r.sku), line, 'Set it aside and call the office.');
                case 'dup': return flash('amber', '🟡 Already on this truck', line, 'No change.');
                case 'other_truck': return flash('amber', '🟡 On ' + esc(r.otherLabel), line, '', '<button data-act="tmovehere" data-id="' + esc(p.id) + '">Move here</button><button data-act="clearres">Leave it</button>');
                case 'locked': return flash('red', '❌ On ' + esc(r.otherLabel) + ', departing', line, 'Check with the supervisor.');
                case 'shipped': return flash('red', '❌ Already left', line, 'This pallet is on a truck that departed.');
                case 'void': return flash('red', '❌ Label cancelled', line, 'Request a new label.');
                default: return flash('red', '❌ Unknown label', raw, 'Not a move label. Maybe a product barcode?');
            }
        }
        // mode: the scan mode when the code was scanned (queued scans keep theirs).
        async function doTruckScan(v, mode) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            if (S.tmode === 'off') setMode('off');            // a scan restarts the 2-minute fallback to Load
            const r = await api('truck_scan', { truckId: S.truckId, raw: v, mode: mode });
            if (!$('scanres')) return;
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.result === 'taken_off' ? 'off' : r.tone);
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
            main(r.trucks.map(t => '<div class="card bt" data-act="openunload" data-id="' + esc(t.id) + '"><h4>' + esc(t.label) + ' ' + statusPill(t.status) + '</h4><div class="muted">' +
                esc(t.depart ? 'Seal ' + t.depart.seal + ' · Trailer ' + t.depart.trailer : '') + ' · ' + t.received + ' of ' + t.pallets + ' in' + (t.missing ? ' · ' + t.missing + ' missing' : '') + '</div></div>').join('') ||
                '<div class="muted">No trucks in transit</div>');
        }
        ACT.openunload = el => { S.lastIn = null; S.unloadId = el.dataset.id; unloadDetail(); };
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
            $('ufoot').innerHTML = (t.error ? errBox(t.error) : '') + '<button class="btn ghost sm" data-act="uundo">↶ Undo last scan</button>' + (S.lastIn ? '<button class="btn ghost sm" data-act="udamaged" data-id="' + esc(S.lastIn) + '">Mark last pallet damaged</button>' : '') +
                '<button class="btn go" data-act="udone">Unloading done: send to manager</button>';
        }
        function unloadResultHtml(r) {
            const p = r.pallet, line = p ? esc(p.code + ' · ' + p.summary) : '';
            switch (r.result) {
                case 'ok': return flash('green', '✅ ' + esc(p.headline), line, r.view.counts.in + ' of ' + r.view.counts.of + ' in');
                case 'late': return flash('green', '✅ Late arrival', line, 'It goes on a second receipt for this IF (manager OK).');
                case 'dup': return flash('amber', '🟡 Already scanned in', line, 'No change.');
                case 'dup_other': return flash('amber', '🟡 Already received on ' + esc(r.otherLabel), line, '');
                case 'other_truck': return flash('amber', '🟡 Belongs to ' + esc(r.otherLabel), line, '', '<button data-act="uother" data-id="' + esc(p.id) + '">Receive it there</button><button data-act="clearres">Set aside</button>');
                case 'never_loaded': return flash('amber', '🟠 Never loaded on a truck', line, 'Flagged for the office. Set it aside.');
                case 'locked': return flash('red', '❌ Its truck is still departing', line, 'Wait a minute and scan again.');
                case 'void': return flash('red', '❌ Label cancelled', line, 'Set aside and call the supervisor.');
                default: return flash('red', '❌ Unknown label', esc('"' + String(r.raw).replace(/\t/g, ' ⇥ ') + '"'), '');
            }
        }
        async function doUnloadScan(v) {
            if (!S.who) { tone('bad'); $('scanres').innerHTML = errBox('Pick your name in "I am" first, then scan again.'); return; }
            const r = await api('unload_scan', { truckId: S.unloadId, raw: v });
            if (!$('scanres')) return;
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            tone(r.tone);
            if (r.result === 'ok' || r.result === 'late') S.lastIn = r.pallet.id;
            $('scanres').innerHTML = unloadResultHtml(r);
            if (r.view) paintUnload(r.view);
        }
        ACT.uother = async el => { const r = await api('unload_other', { palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('green', '✅ Received on its own truck') : errBox(r.error); };
        ACT.udamaged = async el => { const r = await api('unload_damaged', { palletId: el.dataset.id }); $('scanres').innerHTML = r.ok ? flash('amber', 'Marked damaged') : errBox(r.error); };
        ACT.uundo = async () => { const r = await api('unload_undo', { truckId: S.unloadId }); if (r.ok) { S.lastIn = null; paintUnload(r.view); } else $('scanres').innerHTML = errBox(r.error); };
        ACT.udone = async () => { const r = await api('unload_done', { truckId: S.unloadId }); $('scanres').innerHTML = r.ok ? flash('green', 'Sent to the manager for receipt approval') : errBox(r.error); };

        // ── Manager: approvals (v3) ──────────────────────────────────────
        function corrLine(o) {
            return o.op === 'if_qty' ? (o.to < o.from ? '⬇ Lower ' : '⬆ Raise ') + esc((o.ifNum || '') + ' ' + num(o.from) + ' → ' + num(o.to))
                : o.op === 'if_create' ? '➕ Add-on IF from ' + esc(o.toNum || 'TO ' + o.toId) : o.op === 'drop_if' ? '✕ Take ' + esc(o.ifNum) + ' off the truck' : esc(o.op);
        }
        // One card per needs_fix truck: diffs (Drop for a gone/empty IF, Correct for a qty or add-on fix), suggestions, Correct all, Re-check.
        function fixCard(n, free) {
            const t = n.truck, id = esc(t.id), lab = esc(t.label), wm = esc(n.writeMode), diffs = n.diffs || [], live = {};
            diffs.forEach(d => { live[d.key] = 1; });
            const can = d => d.kind === 'if_short' || d.kind === 'if_over' || (d.kind === 'no_if' && d.toId);
            const drops = diffs.filter(d => d.kind === 'if_gone' || d.kind === 'if_empty').length;
            const rows = diffs.map(d => '<div class="drow"><span>' + esc(d.text) + '</span>' +
                (d.kind === 'if_empty' || d.kind === 'if_gone' ? '<button class="dbtn gh" data-act="apdrop" data-id="' + id + '" data-ifid="' + esc(d.ifId) + '" data-label="' + esc(d.ifNum) + '">Drop</button>'
                    : can(d) ? '<button class="dbtn gh" data-act="apcorrect" data-id="' + id + '" data-key="' + esc(d.key) + '" data-label="' + lab + '" data-wm="' + wm + '">Correct</button>' : '') + '</div>').join('');
            const corr = (n.corrections || []).filter(k => live[k.key]).map(k => '<div class="muted">📝 ' + corrLine(k.op || {}) + ' · ' + esc(k.by && typeof k.by === 'object' ? k.by.name : k.by) + ' · ' + esc(k.at) + '</div>').join('');
            return '<div class="card amberc"><h4>⚠ ' + lab + ' · Needs IF fix</h4><div class="muted">' + num(t.pallets) + ' pallets loaded' +
                (n.verifiedAt ? ' · checked ' + esc(n.verifiedAt) + (n.verifiedBy ? ' by ' + esc(n.verifiedBy) : '') : '') + '</div>' +
                (n.stuck ? '<div class="muted warn">⚠ A correction stalled. Press Correct the IF again to free it.</div>' : '') +
                (n.correctError ? errBox('Correction refused: ' + n.correctError + ' — fix it in NetSuite') : '') +
                '<div class="diffs">' + rows + '</div>' + corr +
                (n.orphans || []).map(o => '<div class="muted warn">⚠ Add-on ' + esc(o.text) + '</div>').join('') +
                sugHtml(n.suggestions, true, t.id) + anyIfHtml(free, t.id) +
                '<div class="muted">Correct the IF: ' + esc(wmText(n.writeMode)) + '</div>' +
                '<div class="row2">' + (diffs.some(can) || drops ? '<button class="dbtn pri" data-act="apcorrect" data-id="' + id + '" data-label="' + lab + '" data-wm="' + wm + '" data-drops="' + drops + '">Correct the IF</button>' : '') +
                '<button class="dbtn gh" data-act="apverify" data-id="' + id + '" data-label="' + lab + '">Re-check</button>' +
                '<button class="dbtn gh" data-act="opentruck" data-id="' + id + '">Open truck</button></div></div>';
        }
        // Manager only (spec §7): any Picked/Packed IF no truck has, not just the suggested ones.
        function anyIfHtml(free, truckId) {
            if (!free || !free.length) return '';
            return '<label class="f">Add any Packed IF</label><div class="row2"><select class="inp" id="apfree_' + esc(truckId) + '"><option value="">Pick an IF…</option>' +
                free.map(f => '<option value="' + esc(f.ifId) + '">' + esc(f.ifNum + ' · ' + f.toNum + ' · ' + (f.lines || []).map(l => l.sku + ' ' + l.qty).join(', ')) + '</option>').join('') +
                '</select><button class="dbtn gh" data-act="apaddany" data-id="' + esc(truckId) + '">Add</button></div>';
        }
        SCREENS.approve = async (msg) => {
            main((msg || '') + '<div class="muted">Loading…</div>');
            const r = await api('approvals');
            if (!r.ok) { main(errBox(r.error)); return; }
            const fix = (r.needsFix || []).length ? '<h3>Needs IF fix</h3>' + r.needsFix.map(n => fixCard(n, r.freeIfs)).join('') : '';
            const ret = r.retries.map(t => '<div class="card"><h4>⚠ ' + esc(t.label) + '</h4>' + errBox(t.error || 'Departure stalled, press Retry') +
                '<button class="btn pri" data-act="apretry" data-id="' + esc(t.id) + '" data-label="' + esc(t.label) + '">Retry</button>' +
                (t.canRelease ? '<button class="btn ghost sm" data-act="aprelease" data-id="' + esc(t.id) + '" data-label="' + esc(t.label) + '">Release to Needs IF fix</button>' : '') + '</div>').join('');
            const rec = r.receipts.map(x => {
                const head = '<h4>📥 ' + esc(x.truck.label) + (x.lateOnly ? ' · late arrivals' : ' · receipt') + '</h4>';
                if (!x.perIf) return '<div class="card warnc">' + head + (x.stuck ? '<div class="muted warn">⚠ Stuck, re-approve</div>' : '') + errBox(x.error || 'Could not build the receipt') +
                    '<button class="btn go" data-act="aprecv" data-id="' + esc(x.truck.id) + '" data-label="' + esc(x.truck.label) + '">' + (x.stuck ? 'Re-approve receipt' : 'Approve receipt') + '</button></div>';
                const missing = x.missing || [];
                return '<div class="card">' + head + (x.stuck ? '<div class="muted warn">⚠ Stuck, re-approve</div>' : '') + (x.error ? errBox(x.error) : '') +
                    '<table class="tbl"><tr><th>IF</th><th>Received / shipped</th></tr>' +
                    x.perIf.map(f => '<tr class="' + (f.short ? 'warnrow' : 'okrow') + '"><td>' + esc(f.ifNum) + '</td><td>' + num(f.received) + ' / ' + num(f.shipped) + '</td></tr>').join('') + '</table>' +
                    (missing.length ? '<div class="muted">Missing: ' + esc(missing.join(', ')) + '</div>' : '') +
                    '<button class="btn go" data-act="aprecv" data-id="' + esc(x.truck.id) + '" data-label="' + esc(x.truck.label) + '">' + (x.stuck ? 'Re-approve receipt' : missing.length ? 'Approve short receipt' : 'Approve receipt') + '</button></div>';
            }).join('');
            main((msg || '') + (fix + ret + rec || '<div class="muted">Nothing waiting for approval</div>'));
        };
        ACT.apretry = async el => { if (!confirm('Retry departure of ' + ((el.dataset.label) || 'this truck') + '?')) return; busy(el, true); const r = await api('depart_retry', { truckId: el.dataset.id }); tone(r.ok ? 'ok' : 'bad'); SCREENS.approve(r.ok ? flash('green', '✅ Departed') : errBox(r.error)); };
        ACT.aprelease = async el => {
            if (!confirm('Release ' + (el.dataset.label || 'this truck') + ' to Needs IF fix? No stamp is recorded for this truck; the seal is freed and the load is checked again.')) return;
            busy(el, true);
            const r = await api('depart_release', { truckId: el.dataset.id });
            tone(r.ok ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? flash(r.match ? 'green' : 'amber', '↩ Released ' + esc(el.dataset.label), r.match ? 'It matches its IFs: ready to ship again' : 'It needs an IF fix: see below') : errBox(r.error));
        };
        // After a needs-fix action: the verify result on top, then the refreshed list.
        function verifyMsg(r, label, head) {
            return r.match ? flash('green', '✅ ' + esc(label) + ' matches now', head ? esc(head) + ' · ready to ship' : 'Ready to ship')
                : flash('amber', '⚠ ' + esc(label) + ' still needs a fix', head ? esc(head) : '', (r.diffs || []).map(d => esc(d.text)).join('<br>'));
        }
        ACT.apcorrect = async el => {
            const label = el.dataset.label || 'this truck';
            const drops = el.dataset.key ? 0 : Number(el.dataset.drops) || 0;
            if (!confirm('Correct the IF on ' + label + (el.dataset.key ? ' (this line)' : ' (every line it can)') + '?\n' + wmText(el.dataset.wm) +
                (drops ? ', and takes ' + drops + ' IF(s) off the truck (portal only)' : ''))) return;
            busy(el, true);
            const body = { truckId: el.dataset.id };
            if (el.dataset.key) body.keys = [el.dataset.key];
            const r = await api('truck_correct', body);
            tone(r.ok ? 'ok' : 'bad');
            if (!r.ok) { SCREENS.approve(errBox(r.error)); return; }
            const w = r.written || [], po = r.planOnly || [], sk = r.skipped || [], vd = r.verify || {};
            const head = [w.length ? w.length + ' written to NetSuite' : '', po.length ? po.length + ' plan only: fix in NetSuite' : ''].filter(Boolean).join(' · ') || 'Nothing written to NetSuite';
            SCREENS.approve(verifyMsg(vd, label, head) + (sk.length ? '<div class="card">' + sk.map(s => '<div class="muted warn">Skipped: ' + esc(s.reason) + '</div>').join('') + '</div>' : ''));
        };
        ACT.apdrop = async el => {
            if (!confirm('Take ' + (el.dataset.label || 'this IF') + ' off this truck? Portal only: nothing changes in NetSuite.')) return;
            busy(el, true);
            const r = await api('truck_drop_if', { truckId: el.dataset.id, ifId: el.dataset.ifid });
            tone(r.ok ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? verifyMsg(r, r.view.truck.label, (el.dataset.label || 'IF') + ' dropped') : errBox(r.error));
        };
        ACT.apaddif = async el => {
            busy(el, true);
            const r = await api('truck_add_if', { truckId: el.dataset.id, ifId: el.dataset.ifid });
            tone(r.ok ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? verifyMsg(r, r.view.truck.label, (el.dataset.label || 'IF') + ' added') : errBox(r.error));
        };
        ACT.apaddany = async el => {
            const sel = $('apfree_' + el.dataset.id);
            if (!sel || !sel.value) { tone('bad'); return; }
            const label = sel.options[sel.selectedIndex].text.split(' · ')[0];
            busy(el, true);
            const r = await api('truck_add_if', { truckId: el.dataset.id, ifId: sel.value });
            tone(r.ok ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? verifyMsg(r, r.view.truck.label, label + ' added') : errBox(r.error));
        };
        ACT.apverify = async el => {
            busy(el, true);
            const r = await api('truck_verify', { truckId: el.dataset.id });
            tone(r.ok ? (r.match ? 'ok' : 'warn') : 'bad');
            SCREENS.approve(r.ok ? verifyMsg(r, el.dataset.label || r.view.truck.label, '') : errBox(r.error));
        };
        ACT.aprecv = async el => {
            if (!confirm('Approve receipt for ' + ((el.dataset.label) || 'this truck') + '? This posts in NetSuite when writes are on.')) return;
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
                '<div class="card"><div style="overflow-x:auto"><table class="tbl"><tr><th></th><th>Truck</th><th>IF</th><th>Check</th><th>Portal</th><th>NetSuite</th></tr>' +
                r.rows.map(x => '<tr class="' + (x.ok === false ? 'warnrow' : '') + '"><td>' + mark(x.ok) + '</td><td>' + esc(x.truck) + '</td><td>' + esc(x.ifNum) + '</td><td>' + esc(x.check) +
                    '</td><td>' + esc(x.portal) + '</td><td>' + esc(x.netsuite) + '</td></tr>').join('') + '</table></div></div>');
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
