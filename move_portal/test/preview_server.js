// move_portal/test/preview_server.js — local preview / local beta. NOT deployed to NetSuite.
// node move_portal/test/preview_server.js [--snapshot file] [--store file]   → http://localhost:8765 (manager) and /?floor=1 (floor)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadAmd } = require('./amd');
const { makeLocalStore } = require('../local/local_store');
const { makeSnapshotNs } = require('../local/snapshot_ns');

const arg = k => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : null; };
const snapDir = path.join(__dirname, '..', 'snapshot');
const newest = fs.existsSync(snapDir) ? fs.readdirSync(snapDir).filter(f => /^prod-.*\.json$/.test(f)).sort().pop() : null;
const snapFile = arg('--snapshot') || (newest ? path.join(snapDir, newest) : path.join(__dirname, 'fixtures', 'snapshot_sample.json'));
const storeFile = arg('--store') || path.join(__dirname, '..', 'local', 'store.json');

const core = loadAmd('move_core.js');
const verify = loadAmd('move_verify.js');
const tpl = loadAmd('move_label_template.js');
const ui = loadAmd('move_ui.js');
const tx = require('./fake_tx').makeFakeTx();
const store = makeLocalStore(core, storeFile);
const data = store.data;
const ns = makeSnapshotNs(verify, snapFile);
const snap = JSON.parse(fs.readFileSync(snapFile, 'utf8'));

// Seed settings and items from the snapshot the first time the store is created.
if (!data.db.settings.v3seeded) {
    Object.assign(data.db.settings, { locFrom: String(snap.locFrom || '35'), locTo: String(snap.locTo || '46'), labelCode: 'qr', writeMode: 'off',
        defaultCarrier: 'Armstrong Group', trailers: ['537224', '416460', '105488', '522051', '211659'], v3seeded: true });
    ns.items().forEach(i => { if (!data.db.items.some(x => x.item === i.item)) data.db.items.push(i); });
    store.save();
}

let mgrNow = true;
const nowStamp = () => {
    const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const h = d.getHours(), h12 = h % 12 || 12;
    return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear() + ' ' + h12 + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0') + ' ' + (h < 12 ? 'am' : 'pm');
};
const sl = loadAmd('sl_move_portal.js', {
    'N/runtime': { getCurrentUser: () => ({ id: 5, name: mgrNow ? 'Preview manager' : 'Preview floor', roleId: mgrNow ? 'administrator' : 'x', role: mgrNow ? 3 : 9 }),
        getCurrentScript: () => ({ id: 's', deploymentId: 'd' }) },
    'N/log': { error: console.error, debug() {}, audit() {} }, 'N/render': {}, 'N/url': {},
    'N/format': { format: nowStamp, Type: { DATETIMETZ: 1 }, Timezone: { AMERICA_LOS_ANGELES: 1 } },
    './move_core': core, './move_data': data, './move_tx': tx, './move_label_template': tpl, './move_ui': ui, './move_verify': verify, './move_ns': ns
});

http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const floor = u.searchParams.get('floor') === '1';
    mgrNow = !floor;
    const action = u.searchParams.get('action');
    if (!action) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(ui.buildPage({ url: '/?script=1&deploy=1' + (floor ? '&floor=1' : ''), mode: floor ? 'floor' : 'manager', me: floor ? 'Floor' : 'Manager',
            roster: data.db.settings.roster || [], fromName: 'Riverside', toName: 'Tippecanoe', maxPrint: 250 }));
        return;
    }
    if (action === 'pdf') { res.setHeader('Content-Type', 'text/plain'); res.end('PDF would render here (' + u.search + ')'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
        let out;
        try { out = Object.assign({ ok: true }, sl._runAction(action, JSON.parse(body || '{}'), !floor)); store.save(); }
        catch (e) { out = { ok: false, error: e.message }; if (!e.user) console.error(e); }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out));
    });
}).listen(8765, '0.0.0.0', () => console.log('Move Portal local beta on http://localhost:8765 (manager) · /?floor=1 (floor) · snapshot ' + path.basename(snapFile) + ' · store ' + storeFile));
