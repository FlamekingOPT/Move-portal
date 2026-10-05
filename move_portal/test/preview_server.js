// move_portal/test/preview_server.js — local preview only, NOT deployed to NetSuite.
const http = require('http');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const data = require('./fake_data').makeFakeData(core);
const tx = require('./fake_tx').makeFakeTx();
const tpl = loadAmd('move_label_template.js');
const ui = loadAmd('move_ui.js');
const verify = loadAmd('move_verify.js');
const ns = require('../local/snapshot_ns').makeSnapshotNs(verify, require('path').join(__dirname, 'fixtures', 'snapshot_sample.json'));
data.db.items.push({ item: '11', sku: 'YSN201', desc: '20# LP Cylinder w/OPD', upc: '111' }, { item: '12', sku: 'YSN301', desc: '30# LP Cylinder', upc: '112' });
data.db.stock['35'] = { '11': { onHand: 12000, avail: 11000 }, '12': { onHand: 6000, avail: 6000 } };
data.db.configs.push({ item: '11', code: 'A', pcs: 120, isDefault: true, batch: 'B1' }, { item: '11', code: 'B', pcs: 60, isDefault: false, batch: 'B1' }, { item: '12', code: 'A', pcs: 60, isDefault: true, batch: 'B1' });
const mgr = process.argv[2] !== 'floor';
const sl = loadAmd('sl_move_portal.js', {
    'N/runtime': { getCurrentUser: () => ({ id: 5, name: 'Preview', roleId: mgr ? 'administrator' : 'x', role: mgr ? 3 : 9 }), getCurrentScript: () => ({ id: 's', deploymentId: 'd' }) },
    'N/log': { error: console.error, debug() {}, audit() {} }, 'N/render': {}, 'N/url': {},
    'N/format': { format: () => '10/14/2026 2:14:05 pm', Type: { DATETIMETZ: 1 }, Timezone: { AMERICA_LOS_ANGELES: 1 } },
    './move_core': core, './move_data': data, './move_tx': tx, './move_label_template': tpl, './move_ui': ui, './move_verify': verify, './move_ns': ns
});
http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const action = u.searchParams.get('action');
    if (!action) { res.end(ui.buildPage({ url: '/?script=1&deploy=1', mode: mgr ? 'manager' : 'floor', me: 'Preview', roster: ['Miguel', 'Santiago'], fromName: 'Riverside', toName: 'Tippecanoe', maxPrint: 250 })); return; }
    if (action === 'pdf') { res.setHeader('Content-Type', 'text/plain'); res.end('PDF would render here (' + u.search + ')'); return; }
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
        let out;
        try { out = Object.assign({ ok: true }, sl._runAction(action, JSON.parse(body || '{}'), mgr)); }
        catch (e) { out = { ok: false, error: e.message }; }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out));
    });
}).listen(8765, () => console.log('Move Portal preview on http://localhost:8765 (' + (mgr ? 'manager' : 'floor') + ')'));
