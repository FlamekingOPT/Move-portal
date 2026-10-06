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
.p-blue{background:var(--blue-soft);color:var(--blue)}.p-green{background:var(--green-soft);color:var(--green)}.p-amber{background:var(--amber-soft);color:var(--amber)}.p-red{background:var(--red-soft);color:var(--red)}.p-gray{background:#f1f5f9;color:#475569}.pill.p-violet{background:#ede9fe;color:#5b21b6}
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
textarea.inp{font-family:monospace;font-size:13px}textarea.inp.note{font-family:inherit;font-size:16px}
.btn-correct{display:block;width:100%;border:0;border-radius:12px;padding:18px;margin:12px 0 8px;font-size:19px;font-weight:800;background:var(--blue);color:#fff;cursor:pointer;box-shadow:0 2px 6px rgba(37,99,235,.35)}
.btn-correct:disabled{opacity:.45}.dbtn.btn-addif{background:#fff;border:1px solid var(--blue);color:var(--blue);font-weight:600;font-size:13px;padding:8px 12px}
.fixc{border:2px solid var(--amber)}.fixtxt{font-size:18px;font-weight:700;margin:6px 0;overflow-wrap:anywhere}.card.quiet{background:#f8fafc}.card.quiet h4{color:#475569}
.linkbtn{color:var(--blue);text-decoration:underline;cursor:pointer}.lsec>h3{margin-top:0}.modal .tbl{margin:8px 0}
.modal{position:fixed;inset:0;z-index:30;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.modal>div{background:#fff;border-radius:14px;padding:16px;width:100%;max-width:480px;max-height:90vh;overflow:auto}.modal h4{margin:0 0 8px;font-size:18px}
.oform{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.oform .inp{flex:1 1 160px;min-width:0;margin:0}.oform .num{flex:0 0 76px}
.tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0}.tools .inp{flex:1 1 180px;margin:0;padding:9px;font-size:14px}.tools select.inp{flex:0 1 220px}th.sortable{cursor:pointer;color:var(--blue)}
h3{font-size:15px;margin:16px 0 8px}
@media (max-width:900px){.grid4{grid-template-columns:repeat(2,1fr)}.grid3{grid-template-columns:1fr}}
`;

    function clientMain(B) {
        'use strict';
        const isMgr = B.mode === 'manager';
        const S = { side: get('mv_side') === 'in' ? 'in' : 'out', tab: null, who: get('mv_who') || '', poll: null,
            ed: null, edRender: null, truckId: null, tv: null, unloadId: null, lastIn: null, plan: null, pt: null, cfgRows: [], cfgImport: null, items: [], scrollTo: '' };
        if (isMgr) { S.who = B.me; S.side = 'mgr'; }   // the manager page is a NetSuite login: that user is the actor, no "I am" pick and no side toggle

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
        // Floor: Outbound / Inbound. Manager (spec 2026-10-06 §4): one tab bar, default Dashboard.
        const TABS = {
            out: [['trucks', 'Load out'], ['ship', 'Shipments'], ['req', 'Request label']],
            in: [['unload', 'Unload']],
            mgr: [['dash', 'Dashboard'], ['approve', 'Approvals'], ['labels', 'Labels'], ['report', 'Report']]
        };
        const DEF_TAB = { out: 'trucks', in: 'unload', mgr: 'dash' };

        function shell() {
            const whoCtl = isMgr ? ''
                : B.roster.length
                    ? '<select id="who"><option value="">— pick —</option>' + B.roster.map(n => '<option' + (n === S.who ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>'
                    : '<input id="who" value="' + esc(S.who) + '" placeholder="your name">';
            document.body.innerHTML = '<div class="top"><div class="ttl"><b>Move Portal</b><span>' + esc(B.me) + (isMgr ? ' · manager' : '') + '</span></div>' +
                (isMgr ? '</div>' : '<div class="who">I am ' + whoCtl + '</div>' +
                '<div class="toggle"><button data-act="side" data-v="out" class="' + (S.side === 'out' ? 'on out' : '') + '">📤 Outbound · ' + esc(B.fromName) + '</button>' +
                '<button data-act="side" data-v="in" class="' + (S.side === 'in' ? 'on in' : '') + '">📥 Inbound · ' + esc(B.toName) + '</button></div></div>') +
                '<div class="subnav" id="subnav"></div><main id="main"></main>';
            const w = $('who');
            if (w) w.onchange = w.oninput = () => { S.who = w.value.trim(); put('mv_who', S.who); };
            paintBanner();
            renderNav();
        }

        function paintNav() {
            const nav = $('subnav');
            if (nav) nav.innerHTML = TABS[S.side].map(t => '<div data-act="tab" data-v="' + t[0] + '" class="' + (t[0] === S.tab ? 'on' : '') + '">' + esc(t[1]) +
                (t[0] === 'approve' && S.lateShips ? ' <span class="pill p-amber" title="Ship confirmations waiting 30+ min">' + S.lateShips + '</span>' : '') + '</div>').join('');
        }
        function renderNav() {
            const tabs = TABS[S.side];
            if (!tabs.some(t => t[0] === S.tab)) S.tab = DEF_TAB[S.side];
            paintNav();
            closeNote();
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
            if ($('nmodal')) return;
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
                else if (fresh.length && S.side === 'out' && S.tab === 'ship') shipList();
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
        // Several editors can share a page (manager Labels): each lives in a box with data-edname; a handler
        // first selects the editor its element is in (edOf), which sets S.ed / S.edRender to that instance.
        function newLine() { return { item: '', sku: '', desc: '', onHand: null, cfgs: [], cfg: '', pcs: '' }; }
        function newEd() { return { lines: [newLine()], count: 1, note: '' }; }
        S.eds = {};
        function edOf(el) {
            const b = el && el.closest ? el.closest('[data-edname]') : null, I = b && S.eds[b.dataset.edname];
            if (I) { S.cur = I; S.ed = I.ed; S.edRender = I.render; }
            return I;
        }
        function resetEd() { const I = S.cur; I.ed = newEd(); S.ed = I.ed; I.render(); }
        function editedNote(l) {
            const c = l.cfgs.find(x => x.code === l.cfg);
            return c && Number(l.pcs) !== c.pcs ? '<div class="muted warn">⚠ Differs from Config ' + esc(c.code) + ' (' + c.pcs + '). The label will show EDITED.</div>' : '';
        }
        function edHtml(o, ed) {
            return ed.lines.map((l, i) => '<div class="card">' +
                '<label class="f">SKU' + (ed.lines.length > 1 ? ' ' + (i + 1) : '') + ' (type or scan the product barcode)</label>' +
                '<input class="inp" data-sku="' + i + '" value="' + esc(l.sku) + '" placeholder="e.g. YSN201" autocomplete="off">' +
                '<div data-skures="' + i + '"></div>' +
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
                    '<input class="inp" data-edcount="1" inputmode="numeric" value="' + esc(ed.count) + '"><button data-act="cnt" data-v="1">+</button></div>' : '') +
                (o.note ? '<label class="f">Note for the runner (optional)</label><input class="inp" data-ednote="1" value="' + esc(ed.note) + '" placeholder="e.g. aisle 12, top rack">' : '');
        }
        // Mounts the editor S.ed into box (name = its key); extraHtml goes inside the box (its buttons find this editor).
        function mountEd(o, extraHtml, name, box) {
            name = name || 'main';
            box = box || $('edbox');
            box.dataset.edname = name;
            const I = { ed: S.ed, box: box, items: [] };
            I.render = () => {
                const ed = I.ed;
                box.innerHTML = edHtml(o, ed) + (extraHtml || '');
                box.querySelectorAll('[data-sku]').forEach(inp => {
                    let t;
                    inp.oninput = () => { clearTimeout(t); t = setTimeout(() => skuSearch(I, +inp.dataset.sku, inp.value, false), 300); };
                    inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); skuSearch(I, +inp.dataset.sku, inp.value, true); } };
                });
                box.querySelectorAll('[data-pcs]').forEach(inp => {
                    inp.oninput = () => { ed.lines[+inp.dataset.pcs].pcs = inp.value; };
                    inp.onchange = () => I.render();
                });
                const c = box.querySelector('[data-edcount]'); if (c) c.oninput = () => { ed.count = c.value; };
                const n = box.querySelector('[data-ednote]'); if (n) n.oninput = () => { ed.note = n.value; };
            };
            S.eds[name] = I;
            S.cur = I;
            S.edRender = I.render;
            I.render();
            return I;
        }
        async function skuSearch(I, i, q, exact) {
            q = String(q || '').trim();
            const box = I.box.querySelector('[data-skures="' + i + '"]');
            if (!box) return;
            if (!q) { box.innerHTML = ''; return; }
            const r = await api('item_lookup', { q: q });
            if (!r.ok) { box.innerHTML = errBox(r.error); return; }
            const hit = r.items.find(x => x.sku.toUpperCase() === q.toUpperCase() || x.upc === q);
            if (exact && (hit || r.items.length === 1)) return pickItem(I, i, hit || r.items[0]);
            I.items = r.items;
            box.innerHTML = r.items.length ? '<div class="results">' + r.items.map((x, k) => '<div data-act="pick" data-i="' + i + '" data-k="' + k + '"><b>' + esc(x.sku) +
                '</b> <span class="muted">' + esc(x.desc) + '</span></div>').join('') + '</div>' : '<div class="muted">No match</div>';
        }
        function pickItem(I, i, x) {
            const l = I.ed.lines[i];
            Object.assign(l, { item: x.item, sku: x.sku, desc: x.desc, onHand: x.onHand, cfgs: x.cfgs || [] });
            const d = l.cfgs.find(c => c.isDefault) || l.cfgs[0];
            l.cfg = d ? d.code : '';
            l.pcs = d ? d.pcs : '';
            I.render();
        }
        ACT.pick = el => { const I = edOf(el); if (I) pickItem(I, +el.dataset.i, I.items[+el.dataset.k]); };
        ACT.cfg = el => { if (!edOf(el)) return; const l = S.ed.lines[+el.dataset.i]; l.cfg = el.dataset.v; const c = l.cfgs.find(x => x.code === l.cfg); if (c) l.pcs = c.pcs; S.edRender(); };
        ACT.pcs = el => { if (!edOf(el)) return; const l = S.ed.lines[+el.dataset.i]; l.pcs = Math.max(1, (Number(l.pcs) || 0) + Number(el.dataset.v)); S.edRender(); };
        ACT.cnt = el => { if (!edOf(el)) return; S.ed.count = Math.max(1, (Number(S.ed.count) || 0) + Number(el.dataset.v)); S.edRender(); };
        ACT.addline = el => { if (!edOf(el)) return; if (S.ed.lines.length >= 5) return alert('A mixed pallet can have at most 5 SKUs'); S.ed.lines.push(newLine()); S.edRender(); };
        ACT.rmline = el => { if (!edOf(el)) return; S.ed.lines.splice(+el.dataset.i, 1); S.edRender(); };
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

        // ── Outbound: request label (floor) ──────────────────────────────
        function useEd(name) { const I = S.eds[name]; S.cur = I; S.ed = I.ed; S.edRender = I.render; return I; }
        SCREENS.req = () => {
            S.ed = newEd();
            main('<div id="edbox"></div><div id="edmsg"></div><button class="btn pri" data-act="reqsend">Send to office printer</button>' +
                '<label class="f">My recent requests</label><div id="myreqs"><div class="muted">Loading…</div></div>');
            mountEd({ count: true, note: true }, '', 'req', $('edbox'));
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
            useEd('req');
            const bad = edInvalid();
            if (bad) { $('edmsg').innerHTML = errBox(bad); return; }
            busy(el, true);
            const r = await api('req_create', { lines: edPayload(), count: Number(S.ed.count) || 1, note: S.ed.note, via: 'phone' });
            busy(el, false);
            if (!$('edmsg')) return;
            if (!r.ok) { $('edmsg').innerHTML = errBox(r.error); return; }
            tone('ok');
            $('edmsg').innerHTML = flash('green', '✅ Sent to the office');
            useEd('req');
            resetEd();
            loadMyReqs();
        };

        // ── Manager Labels: reprint and void a label ─────────────────────
        function labelReprint(box) {
            box.innerHTML = '<label class="f">Scan or type a label</label><input class="inp" id="ptcode" placeholder="PLT…" autocomplete="off"><div id="ptres"></div><div id="ptmsg"></div><div id="pt_edbox"></div>';
            const i = $('ptcode');
            i.onkeydown = async e => {
                if (e.key === 'Tab') { e.preventDefault(); i.value += '\t'; return; }
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const r = await api('pallet_get', { code: i.value });
                if (!$('ptres')) return;
                i.select();
                $('ptmsg').innerHTML = '';
                $('pt_edbox').innerHTML = '';
                if (!r.ok) { $('ptres').innerHTML = errBox(r.error); return; }
                S.pt = r.pallet;
                renderPt();
            };
        }
        function renderPt() {
            const p = S.pt, canVoid = p.status === 'labeled';
            $('ptres').innerHTML = '<div class="card"><h4>' + esc(p.code) + ' · ' + esc(p.summary) + ' <span class="pill p-gray">' + esc(p.status) + '</span></h4>' +
                '<div class="muted">' + (p.loadNumber ? 'Load ' + esc(p.loadNumber) + ' · ' : '') + 'printed ' + esc(p.printedAt) + (p.edited ? ' · EDITED' : '') + '</div>' +
                '<div class="row2"><button class="dbtn pri" data-act="ptreprint">Reprint (same code)</button>' +
                '<button class="dbtn gh" data-act="ptrelabel"' + (canVoid ? '' : ' disabled') + '>Edit + reprint</button></div>' +
                (canVoid ? '<label class="f">Void reason</label><select class="inp" id="ptreason"><option>Broken up for stock</option><option>Sent to customer</option>' +
                    '<option>Damaged</option><option>Other</option></select><button class="btn ghost sm warn" data-act="ptvoid">Void this label</button>'
                    : '<div class="muted">Only labels not yet on a load can be voided' + (p.status === 'loaded' ? ' (remove it from its load first)' : '') + '.</div>') + '</div>';
        }
        ACT.ptvoid = async () => {
            if (!confirm('Void ' + S.pt.code + '?')) return;
            const r = await api('pallet_void', { palletId: S.pt.id, reason: $('ptreason').value });
            if (!$('ptmsg')) return;
            $('ptmsg').innerHTML = r.ok ? flash('green', '✅ ' + esc(S.pt.code) + ' voided') : errBox(r.error);
            if (r.ok) tone('ok');
        };
        ACT.ptreprint = async () => {
            const w = window.open('about:blank');
            const r = await api('pallet_reprint', { palletId: S.pt.id });
            if (!r.ok) { if (w) w.close(); if ($('ptmsg')) $('ptmsg').innerHTML = errBox(r.error); return; }
            if (w) w.location = pdfUrl('ids=' + S.pt.id);
        };
        ACT.ptrelabel = () => {
            S.ed = { lines: S.pt.edLines.map(l => Object.assign({}, l)), count: 1, note: '' };
            mountEd({}, '<button class="btn pri" data-act="ptrelabelgo">Print new label (voids ' + esc(S.pt.code) + ')</button>', 'pt', $('pt_edbox'));
        };
        ACT.ptrelabelgo = async el => {
            useEd('pt');
            const bad = edInvalid();
            if (bad) { $('ptmsg').innerHTML = errBox(bad); return; }
            const w = window.open('about:blank');
            busy(el, true);
            const r = await api('pallet_relabel', { palletId: S.pt.id, lines: edPayload() });
            busy(el, false);
            if (!r.ok) { if (w) w.close(); if ($('ptmsg')) $('ptmsg').innerHTML = errBox(r.error); return; }
            if (w) w.location = pdfUrl('job=' + encodeURIComponent(r.job));
            if (!$('ptmsg')) return;
            $('pt_edbox').innerHTML = '';
            $('ptmsg').innerHTML = flash('green', '✅ New label ' + esc(r.code) + ' printing; ' + esc(S.pt.code) + ' voided');
        };

        // ── Outbound: load out (v3) ──────────────────────────────────────
        SCREENS.trucks = () => (S.truckId ? truckDetail() : truckList());
        function whoName(b) { return b && typeof b === 'object' ? b.name : b; }
        function ifRow(f, pick) {
            return '<label class="it"><div>' + (pick ? '<input type="checkbox" data-if="' + esc(f.ifId) + '"> ' : '') + '<b>' + esc(f.ifNum) + '</b> · ' + esc(f.toNum) +
                ' · ' + esc(f.lines.map(l => l.sku + ' ' + num(l.qty)).join(', ')) + '</div><div class="muted">' + (f.estPallets ? '≈ ' + f.estPallets + ' pallets' : '') + '</div></label>';
        }
        // Trailer #: the trailers no open truck has (r.trailers, from the settings), or "Other…" with a typed number.
        function trailerHtml(list) {
            return '<label class="f" for="t_trailer">Trailer #</label><select class="inp" id="t_trailer"><option value="">— pick the trailer —</option>' +
                (list || []).map(t => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('') + '<option value="__other">Other…</option></select>' +
                '<input class="inp" id="t_trailer2" maxlength="20" placeholder="Type the trailer #" autocomplete="off" style="display:none">';
        }
        async function truckList() {
            main('<div class="muted">Loading…</div>');
            const r = await api('truck_planned');
            if (!r.ok) { main(errBox(r.error)); return; }
            main((r.open.length ? '<h3>Trucks loading</h3>' + r.open.map(t => '<div class="card bl" data-act="opentruck" data-id="' + esc(t.id) + '"><h4>' + esc(t.label) + ' ' +
                statusPill(t.status) + (t.sentBack && t.status === 'loading' ? ' <span class="pill p-amber">↩ Sent back</span>' : '') + '</h4><div class="muted">' + t.pallets + ' pallets</div></div>').join('') : '') +
                '<h3>Planned trucks · Picked/Packed IFs</h3><div class="card plist">' + (r.planned.map(f => ifRow(f, true)).join('') || '<div class="muted">No planned IFs. The office creates them in NetSuite.</div>') + '</div>' +
                trailerHtml(r.trailers) + '<div id="tmsg"></div><button class="btn pri" data-act="starttruck">Start truck with selected IFs</button>' +
                (r.pulledAt ? '<div class="muted sm">Data from ' + esc(r.pulledAt) + '</div>' : ''));
            const ts = $('t_trailer'), to = $('t_trailer2');
            if (ts) ts.onchange = () => { to.style.display = ts.value === '__other' ? '' : 'none'; if (ts.value === '__other') to.focus(); };
        }
        ACT.starttruck = async el => {
            if (needWho()) return;
            const ids = Array.from(document.querySelectorAll('[data-if]:checked')).map(x => x.dataset.if);
            const ts = $('t_trailer'), trailer = (ts.value === '__other' ? $('t_trailer2').value : ts.value).trim();
            if (!ids.length) { $('tmsg').innerHTML = errBox('Tick at least one IF'); return; }
            if (!trailer) { $('tmsg').innerHTML = errBox('Pick or type the trailer #'); return; }
            busy(el, true);
            const r = await api('truck_start', { ifIds: ids, trailer: trailer });
            busy(el, false);
            if (!r.ok) { $('tmsg').innerHTML = errBox(r.error); return; }
            S.truckId = r.view.truck.id;
            truckDetail(r);
        };
        function floorOpenTruck(el) {
            dropBanner(el.dataset.id);
            S.truckId = el.dataset.id;
            if (S.side !== 'out' || S.tab !== 'trucks') { S.side = 'out'; put('mv_side', 'out'); S.tab = 'trucks'; shell(); } else truckDetail();
        }
        ACT.backtruck = () => { S.truckId = null; truckList(); };
        ACT.goship = () => { S.truckId = null; S.tab = 'ship'; renderNav(); };
        async function truckDetail(pre) {
            if (S.tmodeTruck !== S.truckId) { S.tmodeTruck = S.truckId; S.otherOpen = false; setMode('load'); }
            const r = pre || await api('truck_get', { truckId: S.truckId });
            if (!r.ok) { main(errBox(r.error)); return; }
            main('<button class="btn ghost sm" data-act="backtruck">← All trucks</button><div class="card bl"><h4 id="thead"></h4><div class="muted" id="tsub"></div></div><div id="tsent"></div>' +
                '<div id="tscan"></div><div id="scanres"></div><div class="card" id="tlines"></div><div id="tfoot"></div><div class="card plist" id="plist"></div><div class="card" id="tother"></div>');
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
                ' · ' + esc(f.lines.map(l => l.sku + ' ' + num(l.qty)).join(', ')) + '</span><button class="dbtn ' + (mgr ? 'btn-addif" data-act="apaddif"' : 'pri" data-act="taddif"') + ' data-id="' + esc(truckId) +
                '" data-ifid="' + esc(f.ifId) + '" data-label="' + esc(f.ifNum) + '">Add to this truck</button></div>').join('') : '';
        }
        function noteHtml(n) { return n && n.text ? '<div class="muted">📝 Short note: ' + esc(n.text) + (n.by ? ' · ' + esc(whoName(n.by)) : '') + '</div>' : ''; }
        // One card per stage: loading → Verify; needs_fix → the diffs; ready → go to Shipments (the seal is entered there).
        function stageHtml(v) {
            const t = v.truck, st = t.status, vf = v.verify || {};
            const undo = '<button class="btn ghost sm" data-act="tundo">↶ Undo last scan</button>';
            const when = vf.at ? '<div class="muted">Checked ' + esc(vf.at) + (vf.by ? ' by ' + esc(typeof vf.by === 'object' ? vf.by.name : vf.by) : '') + '</div>' : '';
            const err = st !== 'departing' && t.error ? errBox(t.error) : '';
            if (st === 'loading') return err + '<button class="btn pri" data-act="tverify">✔ Verify load</button>' + undo;
            if (st === 'needs_fix') return err + '<div class="card amberc"><h4>⚠ Needs IF fix</h4>' + when + diffList(vf.diffs) + noteHtml(v.shortNote) + sugHtml(v.suggestions, false, t.id) +
                '<div class="muted">Keep loading or take pallets off, or wait for the office to fix the IF in NetSuite. A manager can correct it in Approvals.</div>' +
                '<div class="row2"><button class="dbtn pri" data-act="tverify">Verify again</button><button class="dbtn gh" data-act="backtruck">← Other trucks</button></div></div>' + undo;
            if (st === 'ready') return err + '<div class="card greenc"><h4>✅ Ready to ship</h4>' + when + '<div class="muted">The load matches its IFs. Enter the seal # on the Shipments tab.</div>' +
                '<button class="btn go" data-act="goship">✅ Ready to ship: go to Shipments</button></div>' + undo;
            if (st === 'ship_pending') return flash('amber', '🚚 Marked shipped: waiting for a manager to confirm', esc('Seal ' + ((t.shipReq || {}).seal || '')));
            if (st === 'departing') return flash('amber', 'Departing… a NetSuite write is pending', t.error ? esc(t.error) : '', 'A manager can press Retry in Approvals');
            if (t.depart && t.status === 'departed') return err + flash('green', '🚚 ' + esc(t.label) + ' left', esc('Seal ' + t.depart.seal),
                t.bol && t.bol.changed ? '<b>Reprint BOL REV 2</b> · BOL # ' + esc(t.bol.number) + ' · IFs ' + esc(t.bol.ifNums.join(', ')) : 'BOL unchanged');
            return err;
        }
        // Other (non-inventory) items: typed lines, not on an IF; ✕ and + Add only while the truck is open.
        function otherHtml(v, open) {
            const list = v.otherItems || [];
            return '<h4>Other items</h4>' + (list.map(o => '<div class="drow"><span>' + esc(o.desc) + ' × ' + num(o.qty) + '</span>' +
                (open ? '<button class="dbtn gh" data-act="otherrm" data-id="' + esc(o.id) + '" aria-label="Remove">✕</button>' : '') + '</div>').join('') || '<div class="muted">None</div>') +
                '<div id="omsg"></div>' + (!open ? '' : S.otherOpen ? '<div class="oform"><input class="inp" id="o_desc" maxlength="80" placeholder="Description, e.g. pallet jack" autocomplete="off">' +
                    '<input class="num" id="o_qty" inputmode="numeric" value="1" aria-label="Count"><button class="dbtn pri" data-act="otheradd">Add</button><button class="dbtn gh" data-act="otherclose">Close</button></div>'
                    : '<button class="btn ghost sm" data-act="otheropen">+ Add other item</button>');
        }
        function paintTruck(v, first) {
            S.tv = v;
            const t = v.truck, open = ['loading', 'needs_fix', 'ready'].indexOf(t.status) !== -1;
            $('thead').innerHTML = esc(t.label) + ' ' + statusPill(t.status) + (open ? ' <button class="dbtn gh sm" data-act="ttrailer" aria-label="Edit trailer">✎ trailer</button>' : '');
            $('tsub').textContent = t.depart ? [t.depart.carrier, 'Trailer ' + t.depart.trailer, 'Seal ' + t.depart.seal].join(' · ') : v.totals.pallets + ' pallets · ' + num(v.totals.pieces) + ' pcs';
            const sb = t.sentBack;
            $('tsent').innerHTML = sb && open ? '<div class="card amberc"><h4>↩ Sent back by ' + esc(whoName(sb.by)) + ': ' + esc(sb.note) + '</h4><div class="muted">' + esc(sb.at) +
                ' · fix it, verify again, then mark it shipped again on the Shipments tab</div></div>' : '';
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
            const keep = { d: ($('o_desc') || {}).value, q: ($('o_qty') || {}).value };
            $('tother').innerHTML = otherHtml(v, open);
            if ($('o_desc') && keep.d != null) { $('o_desc').value = keep.d; $('o_qty').value = keep.q; }
            $('tfoot').innerHTML = stageHtml(v);
        }
        // Fix the trailer # on an open truck (a typo, or a truck started before trailers were asked).
        ACT.ttrailer = async () => {
            if (needWho() || !S.tv) return;
            const val = window.prompt('Trailer #', S.tv.trailer || '');
            if (val == null) return;
            const r = await api('truck_set_trailer', { truckId: S.truckId, trailer: val.trim() });
            if (!$('scanres')) return;
            if (r.ok) { paintTruck(r.view, false); $('scanres').innerHTML = flash('green', '✅ Trailer ' + esc(r.view.trailer)); } else $('scanres').innerHTML = errBox(r.error);
        };
        ACT.otheropen = () => { S.otherOpen = true; paintTruck(S.tv, false); const d = $('o_desc'); if (d) d.focus(); };
        ACT.otherclose = () => { S.otherOpen = false; paintTruck(S.tv, false); };
        ACT.otheradd = async el => {
            if (needWho()) return;
            const desc = $('o_desc').value.trim(), qty = Number($('o_qty').value);
            if (!desc) { $('omsg').innerHTML = errBox('Type a description'); return; }
            if (!(Number.isInteger(qty) && qty >= 1)) { $('omsg').innerHTML = errBox('The count must be a whole number, 1 or more'); return; }
            busy(el, true);
            const r = await api('truck_other_add', { truckId: S.truckId, desc: desc, qty: qty });
            busy(el, false);
            if (!$('tother') || (r.ok && String(r.view.truck.id) !== String(S.truckId))) return;     // another truck is open now
            if (!r.ok) { tone('bad'); $('omsg').innerHTML = errBox(r.error); return; }
            tone('ok');
            $('o_desc').value = '';
            $('o_qty').value = '1';
            paintTruck(r.view, false);
            if ($('o_desc')) $('o_desc').focus();
        };
        ACT.otherrm = async el => {
            if (needWho()) return;
            const r = await api('truck_other_remove', { truckId: S.truckId, id: el.dataset.id });
            if (!$('tother') || (r.ok && String(r.view.truck.id) !== String(S.truckId))) return;
            if (r.ok) paintTruck(r.view, false); else $('omsg').innerHTML = errBox(r.error);
        };
        // A floor Verify that finds a short asks why (R2); Save sends the note with the same Verify.
        function noteModal(diffs) {
            closeNote();
            const m = document.createElement('div');
            m.id = 'nmodal';
            m.className = 'modal';
            m.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="ntitle"><h4 id="ntitle">Why is it short?</h4>' + diffList(diffs) +
                '<label class="f" for="n_text">Reason (required)</label><textarea class="inp note" id="n_text" rows="3" maxlength="300" placeholder="e.g. only 40 pallets on the shelf"></textarea>' +
                '<div id="n_msg"></div><div class="row2"><button class="dbtn pri" data-act="notesave">Save</button><button class="dbtn gh" data-act="notecancel">Cancel</button></div></div>';
            document.body.appendChild(m);
            $('n_text').focus();
        }
        function closeNote() { const m = $('nmodal'); if (m) m.remove(); }
        ACT.notecancel = () => { closeNote(); refocusScan(); };
        ACT.notesave = async el => {
            const text = $('n_text').value.trim();
            if (!text) { $('n_msg').innerHTML = errBox('Type why it is short'); $('n_text').focus(); return; }
            await ACT.tverify(el, text);          // the modal closes only when the verify goes through; on an error it keeps the text
        };
        ACT.tverify = async (el, shortNote) => {
            if (needWho()) return;
            busy(el, true);
            const r = await api('truck_verify', shortNote ? { truckId: S.truckId, shortNote: shortNote } : { truckId: S.truckId });
            busy(el, false);
            if (!$('scanres')) return;
            if (!r.ok && $('nmodal') && shortNote) { tone('bad'); $('n_msg').innerHTML = errBox(r.error); return; }
            if (!r.ok) { tone('bad'); $('scanres').innerHTML = errBox(r.error); return; }
            if (r.needsNote) { tone('warn'); if (!(shortNote && $('nmodal'))) noteModal(r.diffs); return; }
            closeNote();
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
                case 'locked': return flash('red', '❌ On ' + esc(r.otherLabel) + (r.reason === 'ship_pending' ? ', marked shipped' : ', departing'), line, 'Check with the supervisor.');
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

        // ── Outbound: Shipments (the floor marks a Ready truck shipped; a manager confirms it) ──
        SCREENS.ship = () => shipList();
        // msg: shown on top. Typed seals/carriers survive a reload (a refused mark keeps what was typed).
        async function shipList(msg) {
            const keep = {};
            document.querySelectorAll('[data-keep]').forEach(i => { keep[i.id] = i.value; });
            if (!$('shipbox')) main('<div id="shipbox"><div class="muted">Loading…</div></div>');
            const r = await api('truck_planned');
            if (S.tab !== 'ship' || !$('shipbox')) return;
            if (!r.ok) { $('shipbox').innerHTML = (msg || '') + errBox(r.error); return; }
            const ready = r.open.filter(t => t.status === 'ready'), wait = r.open.filter(t => t.status === 'ship_pending' || t.status === 'departing');
            const gets = await Promise.all(ready.map(t => api('truck_get', { truckId: t.id })));
            if (S.tab !== 'ship' || !$('shipbox')) return;
            S.shipViews = {};
            gets.forEach(g => { if (g.ok) S.shipViews[String(g.view.truck.id)] = g.view; });
            const carrier = r.carrier || 'Armstrong Group';
            $('shipbox').innerHTML = (msg || '') + '<h3>Ready to ship</h3>' + (ready.map(t => shipCard(t, S.shipViews[String(t.id)], carrier)).join('') ||
                    '<div class="muted">No truck is ready. Verify a load on Load out first.</div>') +
                '<h3>Waiting for manager</h3>' + (wait.map(t => {
                    const q = t.shipReq || {};
                    return '<div class="card"><h4>' + esc(t.label) + ' ' + statusPill(t.status) + '</h4><div class="muted">' + esc(['Seal ' + (q.seal || ''), q.carrier, t.pallets + ' pallets'].filter(Boolean).join(' · ')) +
                        '</div><div class="muted">Marked shipped by ' + esc(whoName(q.by) || '?') + ' · ' + esc(q.at || '') + '</div></div>';
                }).join('') || '<div class="muted">None</div>') +
                '<h3>Shipped today</h3>' + ((r.shippedToday || []).map(t => {
                    const d = t.depart || {};
                    return '<div class="card"><h4>🚚 ' + esc(t.label) + ' ' + statusPill(t.status) + '</h4><div class="muted">' +
                        esc(['Seal ' + d.seal, 'Trailer ' + d.trailer, d.carrier, t.pallets + ' pallets'].filter(Boolean).join(' · ')) + '</div></div>';
                }).join('') || '<div class="muted">None yet today</div>');
            Object.keys(keep).forEach(id => { const i = $(id); if (i && keep[id] != null) i.value = keep[id]; });
        }
        function shipCard(t, v, carrier) {
            const id = esc(t.id);
            if (!v) return '<div class="card"><h4>' + esc(t.label) + ' ' + statusPill(t.status) + '</h4>' + errBox('Could not read this truck. Open Shipments again.') + '</div>';
            const ifs = v.lines.map(l => l.ifNum).filter((n, i, a) => a.indexOf(n) === i);
            const oth = (v.otherItems || []).map(o => esc(o.desc) + ' × ' + num(o.qty)).join(', ');
            return '<div class="card greenc"><h4>' + esc(t.label) + ' ' + statusPill(t.status) + '</h4>' +
                '<div class="muted">' + esc('Trailer ' + (v.trailer || '')) + ' · IFs ' + esc(ifs.join(', ')) + '</div>' +
                '<div class="muted">' + num(v.totals.pallets) + ' pallets · ' + num(v.totals.pieces) + ' pcs' + (oth ? ' · Other: ' + oth : '') + '</div>' +
                (v.trailer ? '' : '<label class="f" for="s_tr_' + id + '">Trailer #</label><input class="inp" id="s_tr_' + id + '" data-keep="1" maxlength="20" placeholder="Trailer #" autocomplete="off">') +
                '<label class="f" for="s_seal_' + id + '">Seal #</label><input class="inp" id="s_seal_' + id + '" data-keep="1" maxlength="30" placeholder="Seal (tag) #" autocomplete="off">' +
                '<label class="f" for="s_car_' + id + '">Carrier</label><input class="inp" id="s_car_' + id + '" data-keep="1" maxlength="60" value="' + esc(v.carrier || carrier) + '">' +
                '<div id="s_msg_' + id + '"></div><button class="btn go" data-act="dmark" data-id="' + id + '">🚚 Mark shipped</button></div>';
        }
        // The re-check at Mark shipped no longer matches. "IF changed" only when an IF is gone or its qty differs from what the screen showed;
        // otherwise the load changed (a scan or take-off landed meanwhile).
        function ifChanged(diffs, prev) {
            const was = {};
            ((prev && prev.lines) || []).forEach(l => { was[l.ifNum + '|' + String(l.item)] = Number(l.expected); });
            return (diffs || []).some(d => d.kind === 'if_gone' || ((d.kind === 'if_short' || d.kind === 'if_over') && was[d.ifNum + '|' + String(d.item)] !== Number(d.ifQty)));
        }
        function needsFixAgain(r, id) {
            tone('bad');
            shipList(flash('red', ifChanged(r.diffs, S.shipViews[String(id)]) ? '❌ IF changed in NetSuite: needs a fix again' : '❌ The load changed: verify again',
                esc(r.view ? r.view.truck.label : ''), (r.diffs || []).map(d => esc(d.text)).join('<br>'), '<button data-act="opentruck" data-id="' + esc(id) + '">Open truck</button>'));
        }
        // A refused mark: the truck may have changed on another device; reload Shipments with the error on top.
        async function departRefused(r, id) {
            tone('bad');
            const g = await api('truck_get', { truckId: id });
            const moved = g.ok && ['loading', 'needs_fix'].indexOf(g.view.truck.status) !== -1;
            shipList(errBox(r.error) + (moved ? flash('amber', 'The truck changed on another device: verify again') : ''));
        }
        ACT.dmark = async el => {
            const id = el.dataset.id, seal = $('s_seal_' + id), car = $('s_car_' + id), sv = seal ? seal.value.trim() : '', trl = $('s_tr_' + id), tv = trl ? trl.value.trim() : '';
            if (needWho() || !seal) return;
            if (trl && !tv) { tone('bad'); $('s_msg_' + id).innerHTML = errBox('Enter the trailer #'); trl.focus(); return; }
            if (!sv) { tone('bad'); $('s_msg_' + id).innerHTML = errBox('Enter the seal #'); seal.focus(); return; }
            if (!confirm('Mark this truck shipped? A manager confirms it in Approvals.')) return;
            busy(el, true);
            const r = await api('ship_mark', Object.assign({ truckId: id, seal: sv, carrier: car.value }, trl ? { trailer: tv } : {}));
            busy(el, false);
            if (S.tab !== 'ship' || !$('shipbox')) return;
            if (!r.ok) { await departRefused(r, id); return; }
            markSeen(r.view);
            if (r.needsFix) { needsFixAgain(r, id); return; }
            tone('ok');
            seal.removeAttribute('data-keep');
            shipList(flash('green', '🚚 ' + esc(r.view.truck.label) + ' marked shipped', esc('Seal ' + sv), 'A manager confirms it in Approvals.'));
        };

        // ── Manager: Labels (requests · print a SKU · print plan · reprint · SKU configs) ──
        SCREENS.labels = () => {
            const sec = (id, title) => '<div class="card lsec"><h3>' + esc(title) + '</h3><div id="' + id + '"></div></div>';
            main(sec('lb_sku', 'Print a SKU') + sec('lb_queue', 'Label requests') + sec('lb_plan', 'Print plan') + sec('lb_reprint', 'Reprint') + sec('lb_configs', 'SKU configs'));
            labelQueue($('lb_queue'));
            labelSku($('lb_sku'));
            labelPlan($('lb_plan'));
            labelReprint($('lb_reprint'));
            labelConfigs($('lb_configs'));
        };
        // The queue refreshes every 15 s while Labels is open (renderNav clears S.poll on a tab change).
        function labelQueue(box) {
            S.ed = newEd();
            box.innerHTML = '<div id="qlist"><div class="muted">Loading…</div></div><div id="qmsg"></div>' +
                '<div class="card"><h4>Add a request (radio)</h4><input class="inp" id="radiowho" placeholder="Who called it in"><div id="q_edbox"></div><div id="qedmsg"></div>' +
                '<button class="btn pri sm" data-act="radiosend">Add to queue</button></div>';
            mountEd({ count: true, note: true }, '', 'queue', $('q_edbox'));
            loadQueue();
            S.poll = setInterval(loadQueue, 15000);
        }
        async function loadQueue() {
            const r = await api('req_list', { status: 'queued' });
            const box = $('qlist');
            if (box) box.innerHTML = !r.ok ? errBox(r.error) : (r.reqs.map(q => reqCard(q, true)).join('') || '<div class="muted">The queue is empty</div>');
        }
        ACT.radiosend = async el => {
            useEd('queue');
            const who = $('radiowho').value.trim();
            if (!who) { $('qedmsg').innerHTML = errBox('Enter who called it in'); return; }
            const bad = edInvalid();
            if (bad) { $('qedmsg').innerHTML = errBox(bad); return; }
            busy(el, true);
            const r = await api('req_create', { lines: edPayload(), count: Number(S.ed.count) || 1, note: S.ed.note, via: 'radio', requester: who });
            busy(el, false);
            if (!$('qedmsg')) return;
            if (!r.ok) { $('qedmsg').innerHTML = errBox(r.error); return; }
            useEd('queue');
            resetEd();
            $('qedmsg').innerHTML = '';
            $('radiowho').value = '';
            loadQueue();
        };
        ACT.reqprint = async el => {
            const w = window.open('about:blank');
            busy(el, true);
            const r = await api('req_print', { reqId: el.dataset.id });
            if (!r.ok) { if (w) w.close(); busy(el, false); if ($('qmsg')) $('qmsg').innerHTML = errBox(r.error); return; }
            if (w) w.location = pdfUrl('job=' + encodeURIComponent(r.job));
            loadQueue();
        };
        ACT.reqcancel = async el => {
            if (!confirm('Cancel this request?')) return;
            const r = await api('req_cancel', { reqId: el.dataset.id });
            if (!r.ok && $('qmsg')) $('qmsg').innerHTML = errBox(r.error);
            loadQueue();
        };

        async function labelPlan(box) {
            box.innerHTML = '<div class="muted">Loading plan…</div>';
            const r = await api('plan');
            if (!r.ok) { box.innerHTML = errBox(r.error); return; }
            S.plan = r;
            box.innerHTML = '<div class="muted"><b>' + esc(r.dayLabel) + '</b> · needed ' + (r.neededPerDay == null ? '—' : r.neededPerDay) + ' pallets/day · ' +
                r.labeledPallets + ' already labeled. Suggested counts split today\'s need across SKUs by pallets left. Change any count.</div>' +
                '<div id="planmsg"></div><div style="overflow-x:auto"><table class="tbl"><tr><th>SKU</th><th>Config</th><th>Pallets left</th><th>Labeled</th><th>Print</th><th></th></tr>' +
                r.rows.map((x, k) => '<tr><td><b>' + esc(x.sku) + '</b><div class="muted">' + esc(x.desc) + '</div></td><td>' + esc(x.cfg) + ' · ' + x.pcs + '</td><td>' + x.palletsLeft +
                    '</td><td>' + x.labeled + '</td><td><input class="num" data-plan="' + k + '" inputmode="numeric" value="' + x.suggest + '"></td><td><button class="dbtn pri" data-act="planrow" data-k="' + k +
                    '">Print</button></td></tr>').join('') + '</table></div><button class="btn go" data-act="planall">Print all</button>' +
                (r.noConfig.length ? '<div class="card warnc"><h4>' + r.noConfig.length + ' SKUs with stock but no config</h4><div class="muted">' + r.noConfig.map(x => esc(x.sku)).join(', ') +
                    '</div></div>' : '');
        }
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

        function labelSku(box) {
            S.ed = newEd();
            box.innerHTML = '<div id="sku_edbox"></div><div id="skumsg"></div><button class="btn pri" data-act="skuprint">Print labels</button>';
            mountEd({ count: true }, '', 'sku', $('sku_edbox'));
        }
        ACT.skuprint = async el => {
            useEd('sku');
            const bad = edInvalid();
            if (bad) { $('skumsg').innerHTML = errBox(bad); return; }
            const n = Math.floor(Number(S.ed.count) || 0);
            if (n < 1) return;
            busy(el, true);
            await printMany([{ lines: edPayload(), n: n }], 'office', $('skumsg'));
            busy(el, false);
        };

        // SKU configs: import (CSV) and the current list.
        async function labelConfigs(box) {
            box.innerHTML = '<div class="card"><h4>Import configs from the sheet (CSV)</h4><div class="muted">Columns: SKU, Config, Pcs per pallet, Default (Y/N). The import replaces all configs.</div>' +
                '<input type="file" id="cfgfile" accept=".csv,text/csv"><textarea id="cfgcsv" class="inp" rows="5" placeholder="…or paste CSV here"></textarea>' +
                '<button class="dbtn pri" data-act="cfgpreview">Preview import</button><div id="cfgmsg"></div></div><div id="cfglist"><div class="muted">Loading…</div></div>';
            $('cfgfile').onchange = e => {
                const f = e.target.files[0];
                if (!f) return;
                const rd = new FileReader();
                rd.onload = () => { $('cfgcsv').value = rd.result; };
                rd.readAsText(f);
            };
            const r = await api('cfg_list');
            if (!$('cfglist')) return;
            if (!r.ok) { $('cfglist').innerHTML = errBox(r.error); return; }
            S.cfgRows = r.rows;
            $('cfglist').innerHTML = '<h4>' + r.rows.length + ' SKUs with configs <button class="dbtn gh" data-act="cfgdownload">Download CSV</button></h4>' +
                (r.noConfig.length ? '<div class="muted warn">' + r.noConfig.length + ' SKUs have ' + esc(B.fromName) + ' stock but no config: ' + r.noConfig.map(x => esc(x.sku)).join(', ') + '</div>' : '') +
                '<div style="overflow-x:auto"><table class="tbl"><tr><th>SKU</th><th>Configs</th><th>' + esc(B.fromName) + ' on hand</th><th>Est. pallets</th></tr>' +
                r.rows.map(x => '<tr><td><b>' + esc(x.sku) + '</b><div class="muted">' + esc(x.desc) + '</div></td><td>' + x.cfgs.map(c => esc(c.code) + ' · ' + c.pcs + (c.isDefault ? ' ✓' : '')).join('<br>') +
                    '</td><td>' + num(x.onHand) + '</td><td>' + (x.estPallets || '—') + '</td></tr>').join('') + '</table></div>';
        }
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
            if (!$('cfgmsg')) return;
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
            const fail = msg => { busy(el, false); if ($('cfgmsg')) $('cfgmsg').innerHTML = errBox(msg); };
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
            const box = $('lb_configs');
            if (!box) return;
            await labelConfigs(box);
            if ($('cfgmsg')) $('cfgmsg').innerHTML = flash('green', '✅ Imported ' + all.length + ' configs');
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
                scanBox('rscan') + '<div id="scanres"></div><div class="card" id="uifs"></div><div class="card plist" id="uexp"></div><div class="card" id="uoth" style="display:none"></div><div id="ufoot"></div>');
            wireScan('rscan', doUnloadScan);
            paintUnload(r.view);
        }
        function paintUnload(v) {
            const t = v.truck;
            $('uhead').innerHTML = esc(t.label) + ' ' + statusPill(t.status);
            $('usub').textContent = (t.depart ? 'Seal ' + t.depart.seal + ' · Trailer ' + t.depart.trailer + ' · ' : '') + v.counts.in + ' of ' + v.counts.of + ' pallets in';
            $('uifs').innerHTML = '<table class="tbl"><tr><th>IF</th><th>Received / shipped</th></tr>' + v.perIf.map(f => '<tr class="' + (f.short ? '' : 'okrow') + '"><td>' + esc(f.ifNum) +
                '</td><td><b>' + num(f.received) + '</b> / ' + num(f.shipped) + '</td></tr>').join('') + '</table>' +
                (v.flagged.length ? flash('amber', '🟠 ' + v.flagged.length + ' never-loaded pallet(s) · waiting for the manager', esc(v.flagged.map(p => p.code).join(', ')), 'A manager accepts or rejects them in Approvals.') : '') +
                ((v.decided || []).length ? '<div class="diffs">' + v.decided.map(d => '<div>' + esc(d.text) + ' · ' + esc(d.by) + '</div>').join('') + '</div>' : '');
            $('uexp').innerHTML = '<h4>Still expected</h4>' + (v.expected.map(p => '<div class="it"><div><b>' + esc(p.code) + '</b> · ' + esc(p.summary) + '</div></div>').join('') || '<div class="muted">All in ✅</div>');
            const oth = v.otherItems || [], ob = $('uoth');
            ob.style.display = oth.length ? '' : 'none';
            ob.innerHTML = '<h4>Other items · ' + oth.filter(o => o.in).length + ' of ' + oth.length + ' in</h4>' + oth.map(o => '<div class="drow"><span>' + esc(o.desc) + ' × ' + num(o.qty) + '</span>' +
                '<button class="dbtn ' + (o.in ? 'go' : 'gh') + '" data-act="utick" data-id="' + esc(o.id) + '" data-on="' + (o.in ? '0' : '1') + '">' + (o.in ? '☑ In' : '☐ Tick') + '</button></div>').join('');
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
                case 'never_loaded': return flash('amber', '🟠 Never loaded on a truck', line, 'Flagged for the manager. Set it aside.');
                case 'locked': return r.reason === 'ship_pending' ? flash('red', '❌ ' + esc(r.otherLabel) + ' is waiting for a manager to confirm shipping', line, 'Ask a manager to confirm it in Approvals, then scan again.')
                    : flash('red', '❌ Its truck is still departing', line, 'Wait a minute and scan again.');
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
        ACT.utick = async el => {
            if (needWho()) return;
            busy(el, true);
            const r = await api('unload_other_tick', { truckId: S.unloadId, id: el.dataset.id, on: el.dataset.on === '1' });
            if (!$('scanres')) return;
            if (r.ok) paintUnload(r.view); else { busy(el, false); $('scanres').innerHTML = errBox(r.error); }
        };
        ACT.uundo = async () => { const r = await api('unload_undo', { truckId: S.unloadId }); if (r.ok) { S.lastIn = null; paintUnload(r.view); } else $('scanres').innerHTML = errBox(r.error); };
        ACT.udone = async () => { const r = await api('unload_done', { truckId: S.unloadId }); $('scanres').innerHTML = r.ok ? flash('green', 'Sent to the manager for receipt approval') : errBox(r.error); };

        // ── Manager: approvals (spec 2026-10-06 §4) ──────────────────────
        // Order: Ship confirmations · Correct the IF (one card per IF diff) · Trucks (quiet, one per needs_fix truck) · Retry/Release · Receipts.
        function corrLine(o) {
            return o.op === 'if_qty' ? (o.to < o.from ? '⬇ Lower ' : '⬆ Raise ') + esc((o.ifNum || '') + ' ' + num(o.from) + ' → ' + num(o.to))
                : o.op === 'if_create' ? '➕ Add-on IF from ' + esc(o.toNum || 'TO ' + o.toId) : o.op === 'drop_if' ? '✕ Take ' + esc(o.ifNum) + ' off the truck' : esc(o.op);
        }
        const LATE_MIN = 30;
        function shipConfirmCard(x) {
            const t = x.truck, id = esc(t.id), lab = esc(t.label), late = x.ageMin != null && x.ageMin >= LATE_MIN;
            const oth = (x.otherItems || []).map(o => esc(o.desc) + ' × ' + num(o.qty)).join(', ');
            return '<div class="card ' + (late ? 'amberc' : 'bl') + '"><h4>🚚 ' + lab + ' · marked shipped' + (late ? ' <span class="pill p-amber">waiting ' + x.ageMin + ' min</span>' : '') + '</h4>' +
                '<div class="muted">' + esc(['Trailer ' + x.trailer, 'Seal ' + x.seal, x.carrier].filter(Boolean).join(' · ')) + '</div>' +
                '<div class="diffs">' + (x.ifs || []).map(f => '<div><b>' + esc(f.ifNum) + '</b> · ' + esc((f.lines || []).map(l => l.sku + ' × ' + num(l.qty)).join(', ')) + '</div>').join('') + '</div>' +
                '<div class="muted">' + num(x.pallets) + ' pallets · ' + num(x.pcs) + ' pcs' + (oth ? ' · Other: ' + oth : '') + '</div>' +
                '<div class="muted">Marked shipped by ' + esc(x.markedBy || '?') + ' at ' + esc(x.markedAt) + (x.ageMin != null ? ' · ' + x.ageMin + ' min ago' : '') + '</div>' +
                '<div class="row2"><button class="dbtn go" data-act="apconfirm" data-id="' + id + '" data-label="' + lab + '">✅ Confirm shipped</button>' +
                '<button class="dbtn gh" data-act="apsendback" data-id="' + id + '" data-label="' + lab + '">↩ Send back</button></div></div>';
        }
        // One row per undecided never-loaded pallet (spec 2026-10-06 pm §2): Accept onto the truck it was scanned on, or Reject with a note.
        function flagRow(f) {
            return '<div class="drow"><span><b>' + esc(f.code) + '</b> · ' + esc(f.sku) + ' · ' + num(f.pcs) + ' pcs <span class="pill p-violet">' + esc(f.truckLabel) + '</span>' +
                '<div class="muted">never loaded on any truck · scanned by ' + esc(f.by || '?') + (f.at ? ' · ' + esc(f.at) : '') + (f.truckStatus === 'receiving' || f.truckStatus === 'departed' ? ' · truck still unloading' : '') + '</div></span>' +
                '<span class="row2" style="margin:0"><button class="dbtn go" data-act="apaccept" data-id="' + esc(f.truckId) + '" data-pid="' + esc(f.palletId) + '" data-label="' + esc(f.code) + '" data-truck="' + esc(f.truckLabel) + '">Accept onto this truck</button>' +
                '<button class="dbtn gh" data-act="apreject" data-id="' + esc(f.truckId) + '" data-pid="' + esc(f.palletId) + '" data-label="' + esc(f.code) + '">Reject</button></span></div>';
        }
        function flaggedCard(list) {
            return '<div class="card amberc"><h4>🟠 ' + list.length + ' pallet' + (list.length === 1 ? '' : 's') + ' scanned at ' + esc(B.toName) + ' that ' + (list.length === 1 ? 'was' : 'were') + ' never loaded</h4>' +
                '<div class="muted">decide now, or later on the receipt card</div><div class="diffs">' + list.map(flagRow).join('') + '</div></div>';
        }
        // One standalone card per IF diff: the instruction in large type and one big Correct the IF button.
        function fixCard(f, wmode) {
            const id = esc(f.truckId), lab = esc(f.truckLabel), wm = esc(wmode);
            const head = (f.ifNum ? f.ifNum : 'New IF from ' + (f.toNum || 'an office TO')) + (f.sku ? ' · ' + f.sku : '');
            const can = f.kind !== 'no_if' || f.toId;
            const corr = (f.corrections || []).map(k => '<div class="muted">📝 ' + corrLine(k.op || {}) + ' · ' + esc(whoName(k.by)) + ' · ' + esc(k.at) + '</div>').join('');
            return '<div class="card fixc"><div class="muted"><b>' + esc(head) + '</b> · ' + lab + '</div><div class="fixtxt">' + esc(f.text) + '</div>' + noteHtml(f.shortNote) + corr +
                (f.correctError ? errBox('Correction refused: ' + f.correctError + ' — fix it in NetSuite') : '') +
                (can ? '<button class="btn-correct" data-act="apcorrect" data-id="' + id + '" data-key="' + esc(f.key) + '" data-label="' + lab + '" data-wm="' + wm + '">Correct the IF</button>'
                    : '<div class="muted warn">No open TO covers this SKU: the office creates one in NetSuite.</div>') +
                '<div class="muted">' + esc(wmText(wmode)) + ' · <a href="#" class="linkbtn" data-act="apverify" data-id="' + id + '" data-label="' + lab + '">Re-check</a></div></div>';
        }
        // One quiet card per waiting truck: its IFs (Drop on a gone/empty one), + Add an IF (secondary), Open truck.
        // hasFix: a Correct-the-IF card exists for this truck (its button frees a stalled claim); else a truck-level button does.
        function truckCard(n, free, wmode, hasFix) {
            const t = n.truck, id = esc(t.id), lab = esc(t.label), open = !!(S.addOpen || {})[String(t.id)];
            return '<div class="card quiet"><h4>' + lab + ' ' + statusPill(t.status) + '</h4><div class="muted">' + num(t.pallets) + ' pallets loaded' +
                (n.verifiedAt ? ' · Checked by ' + esc(n.verifiedBy || '?') + ' at ' + esc(n.verifiedAt) : '') + '</div>' +
                (n.stuck ? '<div class="muted warn">⚠ A correction stalled. ' + (hasFix ? 'Press Correct the IF again to free it.' : 'Free it here, then re-check.') + '</div>' : '') +
                (n.stuck && !hasFix ? '<button class="btn-correct" data-act="apcorrect" data-id="' + id + '" data-label="' + lab + '" data-wm="' + esc(wmode) + '" data-drops="' + (n.ifs || []).filter(f => f.gone || f.empty).length + '">Free the stuck correction</button>' : '') +
                (n.correctError ? errBox('Correction refused: ' + n.correctError + ' — fix it in NetSuite') : '') +
                (n.otherDiffs || []).map(tx => '<div class="muted warn">⚠ ' + esc(tx) + '</div>').join('') +
                '<div class="diffs">' + (n.ifs || []).map(f => '<div class="drow"><span><b>' + esc(f.ifNum) + '</b> · ' + esc(f.toNum) + ' · ' + esc((f.lines || []).map(l => l.sku + ' ' + num(l.qty)).join(', ')) +
                    (f.gone ? ' <span class="pill p-red">not Picked/Packed</span>' : f.empty ? ' <span class="pill p-amber">nothing loaded</span>' : '') + '</span>' +
                    (f.gone || f.empty ? '<button class="dbtn gh" data-act="apdrop" data-id="' + id + '" data-ifid="' + esc(f.ifId) + '" data-label="' + esc(f.ifNum) + '">Drop</button>' : '') + '</div>').join('') + '</div>' +
                (n.orphans || []).map(o => '<div class="muted warn">⚠ Add-on ' + esc(o.text) + '</div>').join('') +
                (open ? sugHtml(n.suggestions, true, t.id) + anyIfHtml(free, t.id) : '') +
                '<div class="row2"><button class="dbtn btn-addif" data-act="apaddopen" data-id="' + id + '">' + (open ? '− Hide the IF picker' : '+ Add an IF to this truck') + '</button>' +
                '<button class="dbtn gh" data-act="opentruck" data-id="' + id + '">Open truck</button></div></div>';
        }
        // Manager only (spec §7): any Picked/Packed IF no truck has, not just the suggested ones.
        function anyIfHtml(free, truckId) {
            if (!free || !free.length) return '';
            return '<label class="f">Add any Packed IF</label><div class="row2"><select class="inp" id="apfree_' + esc(truckId) + '"><option value="">Pick an IF…</option>' +
                free.map(f => '<option value="' + esc(f.ifId) + '">' + esc(f.ifNum + ' · ' + f.toNum + ' · ' + (f.lines || []).map(l => l.sku + ' ' + l.qty).join(', ')) + '</option>').join('') +
                '</select><button class="dbtn btn-addif" data-act="apaddany" data-id="' + esc(truckId) + '">Add</button></div>';
        }
        // Ship confirmations waiting ≥ 30 min: a count badge on the Approvals tab.
        function setLate(n) { if (S.lateShips !== n) { S.lateShips = n; paintNav(); } }
        SCREENS.approve = async (msg) => {
            main((msg || '') + '<div class="muted">Loading…</div>');
            const r = await api('approvals');
            if (S.tab !== 'approve') return;
            if (!r.ok) { main((msg || '') + errBox(r.error)); return; }
            S.appr = r;
            paintApprove(msg);
        };
        function paintApprove(msg) {
            const r = S.appr;
            setLate((r.shipPending || []).filter(x => x.ageMin != null && x.ageMin >= LATE_MIN).length);
            const ship = (r.shipPending || []).length ? '<h3 id="ap_ship">Ship confirmations</h3>' + r.shipPending.map(shipConfirmCard).join('') : '';
            const fix = (r.fixes || []).length ? '<h3 id="ap_fix">Correct the IF</h3>' + r.fixes.map(f => fixCard(f, r.writeMode)).join('') : '';
            const trk = (r.trucks || []).length ? '<h3 id="ap_trucks">Trucks waiting for an IF fix</h3>' + r.trucks.map(n => truckCard(n, r.freeIfs, r.writeMode, (r.fixes || []).some(f => String(f.truckId) === String(n.truck.id)))).join('') : '';
            const flg = (r.flagged || []).length ? '<h3 id="ap_flag">Flagged pallets</h3>' + flaggedCard(r.flagged) : '';
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
                    ((x.flagged || []).length || (x.pending || []).length || (x.decided || []).length
                        ? '<div class="muted" style="margin-top:8px"><b>Flagged pallets' + ((x.flagged || []).length ? ' · ' + x.flagged.length + ' to decide' : '') + '</b></div>' +
                          '<div class="diffs">' + (x.flagged || []).map(flagRow).join('') + (x.pending || []).map(p => '<div><b>' + esc(p.code) + '</b> · ' + esc(p.text) + '</div>').join('') +
                          (x.decided || []).map(d => '<div class="muted">' + esc(d.text) + ' · ' + esc(d.by) + '</div>').join('') + '</div>' : '') +
                    (x.canApprove === false
                        ? '<button class="btn go" disabled>Approve receipt — ' + esc((x.blockReason || '').toLowerCase()) + '</button>'
                        : '<button class="btn go" data-act="aprecv" data-id="' + esc(x.truck.id) + '" data-label="' + esc(x.truck.label) + '">' + (x.stuck ? 'Re-approve receipt' : missing.length ? 'Approve short receipt' : 'Approve receipt') + '</button>') + '</div>';
            }).join('');
            main((msg || '') + (ship + fix + trk + flg + (ret ? '<h3 id="ap_retry">Stalled departures</h3>' + ret : '') + (rec ? '<h3 id="ap_rec">Receipts</h3>' + rec : '') || '<div class="muted">Nothing waiting for approval</div>'));
            if (S.scrollTo) { const a = $(S.scrollTo); S.scrollTo = ''; if (a) a.scrollIntoView({ block: 'start' }); }
        }
        ACT.apaddopen = el => { S.addOpen = S.addOpen || {}; S.addOpen[el.dataset.id] = !S.addOpen[el.dataset.id]; if (S.appr) paintApprove(''); };
        ACT.apconfirm = async el => {
            const label = el.dataset.label || 'this truck';
            if (!confirm('Confirm ' + label + ' shipped? It gets its Truck # and its IFs are stamped/shipped in NetSuite (as the write mode allows).')) return;
            busy(el, true);
            const r = await api('ship_confirm', { truckId: el.dataset.id });
            tone(r.ok && !r.needsFix ? 'ok' : 'bad');
            if (!r.ok) { SCREENS.approve(errBox(r.error)); return; }
            if (r.needsFix) { SCREENS.approve(flash('red', '❌ ' + esc(label) + ' no longer matches its IFs: back to Needs IF fix', '', (r.diffs || []).map(d => esc(d.text)).join('<br>'))); return; }
            const t = r.view.truck;
            SCREENS.approve(flash('green', '✅ ' + esc(t.label) + ' shipped', esc('Seal ' + ((t.depart || {}).seal || '')),
                t.bol && t.bol.changed ? '<b>Reprint BOL REV 2</b> · BOL # ' + esc(t.bol.number) + ' · IFs ' + esc(t.bol.ifNums.join(', ')) : 'BOL unchanged'));
        };
        ACT.apsendback = async el => {
            const label = el.dataset.label || 'this truck';
            const note = prompt('Send ' + label + ' back to the floor. Note for the floor (required):');
            if (note == null) return;
            if (!note.trim()) { tone('bad'); SCREENS.approve(errBox('Enter a note for the floor')); return; }
            busy(el, true);
            const r = await api('ship_sendback', { truckId: el.dataset.id, note: note.trim() });
            tone(r.ok ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? flash('amber', '↩ ' + esc(label) + ' sent back to the floor', esc(note.trim())) : errBox(r.error));
        };
        // Read-only look at a truck (manager): lines, pallets, other items.
        ACT.opentruck = async el => {
            if (!isMgr) return floorOpenTruck(el);
            const r = await api('truck_get', { truckId: el.dataset.id });
            closeNote();
            const m = document.createElement('div');
            m.id = 'nmodal';
            m.className = 'modal';
            if (!r.ok) {
                tone('bad');
                m.innerHTML = '<div role="dialog" aria-modal="true"><h4>Open truck</h4>' + errBox(r.error) + '<div class="row2"><button class="dbtn gh" data-act="notecancel">Close</button></div></div>';
                document.body.appendChild(m);
                return;
            }
            const v = r.view, t = v.truck;
            m.innerHTML = '<div role="dialog" aria-modal="true"><h4>' + esc(t.label) + ' ' + statusPill(t.status) + '</h4><div class="muted">' + num(v.totals.pallets) + ' pallets · ' + num(v.totals.pieces) + ' pcs</div>' +
                '<table class="tbl"><tr><th>IF</th><th>SKU</th><th>Scanned / expected</th></tr>' + v.lines.map(l => '<tr><td>' + esc(l.ifNum) + '</td><td>' + esc(l.sku) + '</td><td>' + num(l.scanned) + ' / ' + num(l.expected) + '</td></tr>').join('') +
                v.extras.map(x => '<tr class="warnrow"><td>add-on</td><td>' + esc(x.sku) + '</td><td>' + num(x.scanned) + ' extra</td></tr>').join('') + '</table>' +
                ((v.otherItems || []).length ? '<div class="muted">Other: ' + v.otherItems.map(o => esc(o.desc) + ' × ' + num(o.qty)).join(', ') + '</div>' : '') + noteHtml(v.shortNote) +
                '<div class="row2"><button class="dbtn gh" data-act="notecancel">Close</button></div></div>';
            document.body.appendChild(m);
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

        ACT.apaccept = async el => {
            if (!confirm('Accept ' + (el.dataset.label || 'this pallet') + ' onto ' + (el.dataset.truck || 'this truck') + '? Its IF is raised (or an add-on IF is planned) as the write mode allows, and it joins the receipt.')) return;
            busy(el, true);
            const r = await api('pallet_accept', { truckId: el.dataset.id, palletId: el.dataset.pid });
            tone(r.ok && r.outcome !== 'refused' ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? flash(r.outcome === 'accepted' ? 'green' : r.outcome === 'pending' ? 'amber' : 'red', esc(r.text)) : errBox(r.error));
        };
        ACT.apreject = async el => {
            const note = prompt('Reject ' + (el.dataset.label || 'this pallet') + '. Note for the floor (required):');
            if (note == null) return;
            if (!note.trim()) { tone('bad'); SCREENS.approve(errBox('Enter a note: why is this pallet rejected?')); return; }
            busy(el, true);
            const r = await api('pallet_reject', { truckId: el.dataset.id, palletId: el.dataset.pid, note: note.trim() });
            tone(r.ok ? 'ok' : 'bad');
            SCREENS.approve(r.ok ? flash('amber', esc(r.text)) : errBox(r.error));
        };
        // From the Dashboard's Waiting card: open Approvals scrolled to that section.
        ACT.goapprove = el => {
            S.tab = 'approve';
            S.scrollTo = el.dataset.v || '';
            renderNav();
        };

        // ── Manager: shadow report (v3) ──────────────────────────────────
        function histTable(rows) {
            const cols = ['Day', 'Truck', 'Trailer · seal', 'IFs', 'Pallets · pcs', 'Status', 'Started', 'Shipped', 'Confirmed', 'Received', 'Corrections'];
            return '<div style="overflow-x:auto"><table class="tbl"><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr>' + (rows.map(x => '<tr data-act="dashrow" data-id="' + esc(x.truckId) + '" style="cursor:pointer">' +
                '<td>' + esc(x.day) + '</td><td><b>' + esc(x.truck) + '</b></td><td>' + esc([x.trailer, x.seal].filter(Boolean).join(' · ')) + '</td><td>' + esc((x.ifs || []).join(', ')) + '</td><td>' + num(x.pallets) + ' · ' + num(x.pcs) + '</td>' +
                '<td>' + statusPill(x.status) + '</td><td class="muted">' + esc([x.startedBy, x.startedAt].filter(Boolean).join(' ')) + '</td><td class="muted">' + esc([x.markedBy, x.markedAt].filter(Boolean).join(' ')) + '</td>' +
                '<td class="muted">' + esc([x.confirmedBy, x.confirmedAt].filter(Boolean).join(' ')) + '</td><td class="muted">' + esc(x.receivedAt || '') + '</td><td class="muted">' + (x.corrections || []).map(esc).join('<br>') + '</td></tr>').join('') ||
                '<tr><td colspan="11" class="muted">No trucks yet</td></tr>') + '</table></div>';
        }
        function paintHist() {
            const r = S.report;
            if (!r || !$('hist')) return;
            const rows = sortRows(filterRows(r.history || [], S.histSt), S.histSt);
            $('hist').innerHTML = histTable(rows);
            setCount('hsn', rows.length, (r.history || []).length);
        }
        SCREENS.report = async () => {
            main('<div class="muted">Loading…</div>');
            const r = await api('report');
            if (!r.ok) { main(errBox(r.error)); return; }
            S.report = r;
            const mark = ok => (ok === true ? '✅' : ok === false ? '❌' : '⏳');
            main('<div class="muted">Write mode <b>' + esc(r.writeMode) + '</b>' + (r.pulledAt ? ' · NetSuite data from ' + esc(r.pulledAt) : '') + '</div>' +
                '<div class="card"><table class="tbl"><tr><th>Day</th><th>Trucks</th><th>Pallets</th><th>Pcs</th><th>Diffs</th></tr>' +
                r.days.map(d => '<tr><td>' + esc(d.day) + '</td><td>' + d.trucks + '</td><td>' + d.pallets + '</td><td>' + num(d.pieces) + '</td><td>' + (d.diffs ? '❌ ' + d.diffs : '✅') + '</td></tr>').join('') + '</table></div>' +
                '<div class="card"><div style="overflow-x:auto"><table class="tbl"><tr><th></th><th>Truck</th><th>IF</th><th>Check</th><th>Portal</th><th>NetSuite</th></tr>' +
                r.rows.map(x => '<tr class="' + (x.ok === false ? 'warnrow' : '') + '"><td>' + mark(x.ok) + '</td><td>' + esc(x.truck) + '</td><td>' + esc(x.ifNum) + '</td><td>' + esc(x.check) +
                    '</td><td>' + esc(x.portal) + '</td><td>' + esc(x.netsuite) + '</td></tr>').join('') + '</table></div></div>' +
                '<div class="card"><h4>Truck history</h4><div id="histtools"></div><div id="hist"></div></div>');
            $('histtools').innerHTML = tableTools('hs', S.histSt, HISTSORTS, 'hsn');
            wireTools('hs', S.histSt, paintHist);
            paintHist();
        };

        // ── Dashboard ────────────────────────────────────────────────────
        function barChart(days, needed) {
            if (!days.length) return '<div class="muted">No move days yet</div>';
            const W = 900, H = 190, x0 = 40, base = 160, top = 20;
            const max = Math.max(needed || 0, 1, ...days.map(d => d.n)) * 1.15;
            const w = (W - x0 - 10) / days.length;
            const y = v => base - v / max * (base - top);
            let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="Trucks shipped per day">';
            days.forEach((d, i) => {
                const bx = x0 + i * w + w * 0.15, bw = w * 0.7, by = y(d.n);
                s += '<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + (base - by) + '" rx="3" fill="' + (needed && d.n >= needed ? '#0d9488' : '#94a3b8') + '"/>';
                if (days.length <= 45) s += '<text x="' + (bx + bw / 2) + '" y="' + (by - 4) + '" font-size="10" text-anchor="middle" fill="#374151">' + d.n + '</text>' +
                    '<text x="' + (bx + bw / 2) + '" y="176" font-size="9" text-anchor="middle" fill="#6b7280">' + d.day.slice(5) + '</text>';
            });
            if (needed) s += '<line x1="' + x0 + '" x2="' + (W - 10) + '" y1="' + y(needed) + '" y2="' + y(needed) + '" stroke="#dc2626" stroke-dasharray="6 5"/>' +
                '<text x="' + (x0 + 4) + '" y="' + (y(needed) - 5) + '" font-size="11" fill="#dc2626">' + needed + ' plan</text>';
            return s + '<line x1="' + x0 + '" x2="' + (W - 10) + '" y1="' + base + '" y2="' + base + '" stroke="#cbd5e1"/></svg>';
        }
        // ── Dashboard (spec 2026-10-06 pm §3) ───────────────────────────
        const STAGES = ['Receipt pending', 'Waiting for manager', 'Ready to ship', 'Needs IF fix', 'Loading', 'In transit', 'Unloading', 'Received'];
        const HISTSORTS = [['stage', 'Sort: furthest along'], ['newest', 'Sort: newest step'], ['if', 'Sort: IF'], ['trailer', 'Sort: trailer']];
        const SORTS = [['stage', 'Sort: furthest along'], ['newest', 'Sort: newest step'], ['oldest', 'Sort: oldest step (stuck first)'], ['if', 'Sort: IF'], ['trailer', 'Sort: trailer']];
        const COLS = [['ifNum', 'Fulfillment'], ['toNum', 'TO'], ['truck', 'Truck'], ['', 'SKUs on truck'], ['pcs', 'Pallets · pcs'], ['', 'Received'], ['stage', 'Status'], ['newest', 'Last step']];
        // Search box · status select · sort select · "n of m": shared by Active loads and the Report's truck history. Client-side only.
        function tableTools(prefix, st, sorts, counterId) {
            return '<div class="tools"><input class="inp" id="' + prefix + 'q" value="' + esc(st.q) + '" placeholder="Search IF, TO, trailer, seal, Truck # or SKU…">' +
                '<select class="inp" id="' + prefix + 'st"><option value="">All statuses</option>' + STAGES.map(s => '<option' + (st.st === s ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>' +
                '<select class="inp" id="' + prefix + 'sort">' + sorts.map(s => '<option value="' + s[0] + '"' + (st.sort === s[0] ? ' selected' : '') + '>' + esc(s[1]) + '</option>').join('') + '</select>' +
                '<span class="muted" id="' + counterId + '"></span></div>';
        }
        function setCount(id, n, m) { const c = $(id); if (c) c.textContent = n + ' of ' + m; }
        function wireTools(prefix, st, repaint) {
            const q = $(prefix + 'q'), s = $(prefix + 'st'), o = $(prefix + 'sort');
            if (q) q.oninput = () => { st.q = q.value; repaint(); };
            if (s) s.onchange = () => { st.st = s.value; repaint(); };
            if (o) o.onchange = () => { st.sort = o.value; st.dir = 1; repaint(); };
        }
        function rowText(x) { return [x.ifNum, x.toNum, x.truck, x.trailer, x.seal, x.truckNo ? 'Truck ' + x.truckNo : '', (x.skus || []).map(s => s.sku).join(' '), (x.ifs || []).join(' ')].join(' ').toLowerCase(); }
        function filterRows(rows, st) {
            const q = (st.q || '').trim().toLowerCase();
            return rows.filter(x => (!st.st || x.stage === st.st) && (!q || rowText(x).indexOf(q) !== -1));
        }
        function stamp(v) { const t = Date.parse(v || ''); return isNaN(t) ? null : t; }
        function sortRows(rows, st) {
            const dir = st.dir || 1, k = st.sort || 'stage';
            const key = x => k === 'stage' ? STAGES.indexOf(x.stage) : k === 'newest' ? (stamp(x.lastAt || x.receivedAt || x.confirmedAt || x.markedAt || x.startedAt) === null ? Number.MAX_SAFE_INTEGER : -stamp(x.lastAt || x.receivedAt || x.confirmedAt || x.markedAt || x.startedAt))
                : k === 'oldest' ? (stamp(x.lastAt) === null ? Number.MAX_SAFE_INTEGER : stamp(x.lastAt))
                : k === 'if' || k === 'ifNum' ? Number(String(x.ifNum || (x.ifs || [])[0] || '').replace(/\D/g, '')) : k === 'trailer' ? String(x.trailer || '') : k === 'pcs' ? -Number(x.pcs || 0) : String(x[k] || '');
            return rows.slice().sort((p, q) => { const a = key(p), b = key(q); return (a < b ? -1 : a > b ? 1 : 0) * dir || Number(q.truckId) - Number(p.truckId); });
        }
        S.dashSt = { q: '', st: '', sort: 'stage', dir: 1 };
        S.histSt = { q: '', st: '', sort: 'newest', dir: 1 };
        function ago(min) { return min == null ? '' : min < 60 ? min + ' m ago' : Math.floor(min / 60) + ' h ' + (min % 60) + ' m ago'; }
        function loadsTable(rows) {
            const head = COLS.map(c => '<th' + (c[0] ? ' class="sortable" data-act="dashsort" data-k="' + c[0] + '"' : '') + '>' + esc(c[1]) + (c[0] && S.dashSt.sort === c[0] ? (S.dashSt.dir < 0 ? ' ↑' : ' ↓') : '') + '</th>').join('');
            return '<div style="overflow-x:auto"><table class="tbl"><tr>' + head + '</tr>' + (rows.map(x => '<tr data-act="dashrow" data-id="' + esc(x.truckId) + '" style="cursor:pointer">' +
                '<td><b>' + esc(x.ifNum) + '</b></td><td>' + esc(x.toNum || '') + '</td><td>' + esc(x.truck) + (x.truckNo && x.trailer ? ' · Trailer ' + esc(x.trailer) : '') + (x.seal ? ' · seal ' + esc(x.seal) : '') + '</td>' +
                '<td>' + (x.skus || []).map(s => esc(s.sku) + ' <span class="muted">×' + num(s.qty) + '</span>').join(', ') + '</td><td>' + num(x.pallets) + ' · ' + num(x.pcs) + '</td>' +
                '<td>' + (x.received == null ? '—' : num(x.received)) + (x.flagged ? ' <span class="warn">+' + x.flagged + ' flagged</span>' : '') + '</td><td>' + statusPill(x.status) + '</td>' +
                '<td class="muted' + (x.status === 'ship_pending' && x.lastMin >= LATE_MIN ? ' warn' : '') + '">' + esc((x.lastBy ? x.lastBy + ' ' : '') + String(x.lastKind || '').replace(/_/g, ' ')) + (x.lastMin == null ? '' : ' · ' + ago(x.lastMin)) + '</td></tr>').join('') ||
                '<tr><td colspan="8" class="muted">No active loads</td></tr>') + '</table></div>';
        }
        function paintLoads() {
            const r = S.dash;
            if (!r || !$('dashloads')) return;
            const rows = sortRows(filterRows(r.rows, S.dashSt), S.dashSt);
            $('dashloads').innerHTML = loadsTable(rows) +
                '<div class="muted">Default sort is furthest along first; click a column header or use the Sort menu. Received trucks drop off at the end of their day; the Report keeps the full history.</div>';
            setCount('dln', rows.length, r.rows.length);
        }
        ACT.dashsort = el => { const k = el.dataset.k; if (S.dashSt.sort === k) S.dashSt.dir = -S.dashSt.dir; else { S.dashSt.sort = k; S.dashSt.dir = 1; } const so = $('dlsort'); if (so) so.value = S.dashSt.sort; paintLoads(); };
        ACT.dashrow = el => ACT.opentruck(el);
        SCREENS.dash = async () => {
            main('<div class="muted">Loading…</div>');
            const r = await api('dashboard');
            if (S.tab !== 'dash') return;
            if (!r.ok) { main(errBox(r.error)); return; }
            S.dash = r;
            const shipQ = (r.waiting || []).find(w => w.queue === 'ship');
            setLate(shipQ && shipQ.late ? shipQ.count : 0);
            const k = (label, big, sub, cls) => '<div class="kpi ' + (cls || '') + '"><small>' + esc(label) + '</small><b>' + big + '</b><span>' + sub + '</span></div>';
            const w = r.waiting || [];
            const waiting = '<div class="card ' + (w.length ? 'amberc' : '') + '"><h4>Waiting for approval' + (w.length ? ' <span class="pill p-amber">' + w.reduce((s, x) => s + x.count, 0) + '</span>' : '') + '</h4>' +
                (w.length ? w.map(x => '<div class="warnrow" data-act="goapprove" data-v="ap_' + ({ ship: 'ship', fix: 'fix', trucks: 'trucks', flagged: 'flag', retry: 'retry', receipts: 'rec' })[x.queue] + '" style="cursor:pointer">' +
                    '<span><a href="#" class="linkbtn">' + esc(x.title) + '</a> <span class="muted">' + esc(x.first) + '</span></span><span class="pill ' + (x.late ? 'p-amber' : 'p-gray') + '">' + x.count + (x.late ? ' · over 30 min' : '') + '</span></div>').join('')
                    : '<div class="muted">Nothing waiting for approval</div>') + '</div>';
            const t = r.tiles;
            main(waiting + '<div class="grid4">' +
                k('Trucks shipped today', num(t.today), 'manager-confirmed · plan ' + t.plan + '/day', t.today >= t.plan ? 'good' : '') +
                k('Trucks per day · 7-day avg', t.avg7, 'move days Mon–Sat · all-time ' + t.avgAll) +
                k('Trucks shipped · total', num(t.total), num(t.received) + ' received at ' + esc(B.toName)) +
                k('In transit', num(t.inTransitTrucks) + ' truck' + (t.inTransitTrucks === 1 ? '' : 's'), num(t.inTransitPallets) + ' pallets · ' + t.missing + ' missing') +
                k('Finish date', '<span class="muted" style="font-size:14px">see Move Tracker</span>', 'truckloads to move live there') + '</div>' +
                '<div class="card"><h4>Active loads <span class="pill p-gray">' + new Set(r.rows.map(x => x.truckId)).size + ' trucks</span></h4><div class="muted">one row per IF, like the Move Tracker · not yet received · tap a row to open</div><div id="dashtools"></div><div id="dashloads"></div></div>' +
                '<div class="grid3"><div class="card"><h4>Trucks shipped per day</h4>' + barChart(r.days, r.tiles.plan) + '</div>' +
                '<div class="card"><h4>Exceptions</h4>' + [['Missing pallets (in transit)', r.exc.missing], ['Flagged, waiting on manager', r.exc.neverLoaded], ['Damaged', r.exc.damaged], ['Edited at dock', r.exc.edited],
                    ['Labeled, never loaded (stale)', r.exc.stale], ['SKUs with stock but no config', r.exc.noConfig]].map(x => '<div class="warnrow"><span>' + esc(x[0]) + '</span><b>' + x[1] + '</b></div>').join('') + '</div></div>');
            $('dashtools').innerHTML = tableTools('dl', S.dashSt, SORTS, 'dln');
            wireTools('dl', S.dashSt, paintLoads);
            paintLoads();
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
