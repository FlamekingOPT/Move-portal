// move_portal/test/preview_server.js — local preview / local beta. NOT deployed to NetSuite.
// node move_portal/test/preview_server.js [--snapshot file] [--store file] [--port n]   → http://localhost:8765 (manager) and /?floor=1 (floor)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadAmd } = require('./amd');
const { makeLocalStore } = require('../local/local_store');
const { makeSnapshotNs } = require('../local/snapshot_ns');
const { labelsHtml } = require('../local/label_html');

const arg = k => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const snapDir = path.join(__dirname, '..', 'snapshot');
const newest = fs.existsSync(snapDir) ? fs.readdirSync(snapDir).filter(f => /^prod-.*\.json$/.test(f)).sort().pop() : null;
const snapFile = arg('--snapshot') || (newest ? path.join(snapDir, newest) : path.join(__dirname, 'fixtures', 'snapshot_sample.json'));
const PORT = Number(arg('--port')) || 8765;
const storeFile = arg('--store') || path.join(__dirname, '..', 'local', 'store.json');

const core = loadAmd('move_core.js');
const verify = loadAmd('move_verify.js');
const tpl = loadAmd('move_label_template.js');
const ui = loadAmd('move_ui.js');
const tx = require('./fake_tx').makeFakeTx();
const store = makeLocalStore(core, storeFile);
const data = store.data;
const ns = makeSnapshotNs(verify, snapFile);
tx._t.onApply = op => ns.applyOp(op);   // qty mode locally: an if_qty correction lands in the in-memory snapshot
const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));

// Seed settings the first time the store is created; merge items and trailers on every start.
const TRAILERS = ['537224', '416460', '105488', '522051', '211659', '543804', '487491'];
if (!data.db.settings.v3seeded) {
    Object.assign(data.db.settings, { locFrom: String(snap.locFrom || '35'), locTo: String(snap.locTo || '46'), labelCode: 'qr', writeMode: 'off',
        defaultCarrier: 'Armstrong Group', trailers: TRAILERS.slice(), v3seeded: true });
}
data.db.settings.trailers = data.db.settings.trailers || [];
TRAILERS.forEach(t => { if (data.db.settings.trailers.indexOf(t) < 0) data.db.settings.trailers.push(t); });
ns.items().forEach(i => {
    const have = data.db.items.find(x => String(x.sku).toUpperCase() === String(i.sku).toUpperCase());
    if (!have) data.db.items.push(i);
    else { if (i.desc) have.desc = i.desc; if (!have.item) have.item = i.item; }
});
// Riverside on hand for the print plan, from the snapshot's onHand rows. A snapshot without them leaves the stock as it is.
const onHand = ns.onHand ? ns.onHand() : {};
if (Object.keys(onHand).length) {
    const stock = {};
    Object.keys(onHand).forEach(k => { stock[k] = { onHand: onHand[k], avail: onHand[k] }; });
    data.db.stock[String(data.db.settings.locFrom)] = stock;
}
store.save();

let mgrNow = true;
const nowStamp = () => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const h = d.getHours(), h12 = h % 12 || 12;
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() + ' ' + h12 + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + ' ' + (h < 12 ? 'am' : 'pm');
};
const sl = loadAmd('sl_move_portal.js', {
    'N/runtime': { getCurrentUser: () => ({ id: 5, name: mgrNow ? 'Preview manager' : 'Preview floor', roleId: mgrNow ? 'administrator' : 'x', role: mgrNow ? 3 : 9 }),
        getCurrentScript: () => ({ id: 's', deploymentId: mgrNow ? 'customdeploy_move_portal' : 'customdeploy_move_portal_floor' }) },
    'N/log': { error: console.error, debug() {}, audit() {} }, 'N/render': {}, 'N/url': {},
    'N/format': { format: nowStamp, Type: { DATETIMETZ: 1 }, Timezone: { AMERICA_LOS_ANGELES: 1 } },
    './move_core': core, './move_data': data, './move_tx': tx, './move_label_template': tpl, './move_ui': ui, './move_verify': verify, './move_ns': ns
});

http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const floor = u.searchParams.get('floor') === '1';
    const action = u.searchParams.get('action');
    if (!action) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(ui.buildPage({ url: '/?script=1&deploy=1' + (floor ? '&floor=1' : ''), mode: floor ? 'floor' : 'manager', me: floor ? 'Floor' : 'Manager',
            roster: data.db.settings.roster || [], fromName: 'Riverside', toName: 'Tippecanoe', maxPrint: 250 }));
        return;
    }
    if (action === 'pdf') {
        // local stand-in for the NetSuite BFO PDF: printable 4x6 HTML (selection mirrors sl_move_portal.js pdf())
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const job = u.searchParams.get('job'), ids = u.searchParams.get('ids');
        const ps = job ? data.palletsByJob(String(job)).filter(p => p.status !== verify.VP.VOID) : data.palletsByIds(String(ids || '').split(','));
        if (!ps.length) { res.end('No labels to print'); return; }
        res.end(labelsHtml(ps.map(p => ({ code: p.code, lines: p.lines, pieces: p.pieces, edited: p.edited, printedDay: p.printedDay, by: p.data.printedBy || '', summary: p.summary })),
            { header: u.searchParams.get('header') === '1', fromName: 'Riverside', toName: 'Tippecanoe', core }));
        return;
    }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
        let out;
        mgrNow = !floor;
        try { out = Object.assign({ ok: true }, sl._runAction(action, JSON.parse(body || '{}'), !floor)); }
        catch (e) { out = { ok: false, error: e.message }; if (!e.user) console.error(e); }
        if (out.ok) { try { store.save(); } catch (e) { console.error('STORE SAVE FAILED', e); } }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out));
    });
}).listen(PORT, '0.0.0.0', () => console.log('Move Portal local beta on http://localhost:' + PORT + ' (manager) · /?floor=1 (floor) · snapshot ' + path.basename(snapFile) + ' · store ' + storeFile));
