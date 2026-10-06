### Task 13: Local beta: prod snapshot, local store, preview server

**Files:**
- Create: `move_portal/local/local_store.js`
- Modify: `move_portal/test/preview_server.js`
- Modify: `.gitignore`
- Modify: `.claude/launch.json` (only if it exists; add `move-preview-beta`)
- Create (not committed): `move_portal/snapshot/prod-2026-10-05.json`

**Interfaces:**
- Produces:
  - `makeLocalStore(core, file) → {data, save()}`. `data` is a `fake_data` instance whose `db` is loaded from `file` (if it exists). `save()` writes `db` back.
  - Preview server: `node move_portal/test/preview_server.js [--snapshot <file>] [--store <file>]`.
    - Defaults: newest `move_portal/snapshot/prod-*.json` (else the test fixture), and `move_portal/local/store.json`.
    - `?floor=1` in the page URL gives the floor view, and the page's own API calls carry it too.
    - The server listens on `0.0.0.0:8765`, so scanners on the same wifi can reach `http://<pc-ip>:8765/?floor=1`.

- [ ] **Step 1: Add the gitignore entries** to `.gitignore` (create the file if missing):

```
move_portal/local/store.json
move_portal/snapshot/
```

- [ ] **Step 2: Create `move_portal/local/local_store.js`**

```js
// move_portal/local/local_store.js — node only, NOT deployed. Persists the fake data layer to a JSON file.
const fs = require('fs');
const { makeFakeData } = require('../test/fake_data');

function makeLocalStore(core, file) {
    const data = makeFakeData(core);
    if (fs.existsSync(file)) Object.assign(data.db, JSON.parse(fs.readFileSync(file, 'utf8')));
    return { data, save: () => fs.writeFileSync(file, JSON.stringify(data.db, null, 1)) };
}

module.exports = { makeLocalStore };
```

- [ ] **Step 3: Test the store** (append to `move_portal/test/fake_data.test.js`)

```js
test('local store round-trips db to a file', () => {
    const os = require('os'), path = require('path'), fs = require('fs');
    const { makeLocalStore } = require('../local/local_store');
    const core = require('./amd').loadAmd('move_core.js');
    const f = path.join(os.tmpdir(), 'mv-store-' + Date.now() + '.json');
    const a = makeLocalStore(core, f);
    a.data.createLoad({ number: 'X', status: 'loading', data: { v3: true } });
    a.save();
    const b = makeLocalStore(core, f);
    assert.equal(b.data.loadsByStatus(['loading']).length, 1);
    fs.unlinkSync(f);
});
```

Run: `node --test "move_portal/test/fake_data.test.js"`
Expected: PASS.

- [ ] **Step 4: Rewrite `move_portal/test/preview_server.js`**

```js
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
```

- [ ] **Step 5: Pull the prod snapshot (controller session only; it needs the NetSuite SuiteQL connector, read-only)**

1. Build the SQL: `node -e "const v=require('./move_portal/test/amd').loadAmd('move_verify.js'); console.log(JSON.stringify(v.SQL('35','46'),null,1))"`
2. Run `toLines`, then `ifLines`, with `ns_runCustomSuiteQL` (`pageSize` 1000, every page).
3. Collect the distinct IF ids from `ifLines` and run `links` with `{IDS}` = those ids, comma-joined (chunks of 500).
4. Run `receipts` with `{IDS}` = the distinct `rcptid`s from `links`.
5. Run `items` with `{IDS}` = the distinct items from `toLines`.
6. Write `move_portal/snapshot/prod-2026-10-05.json`: `{"pulledAt": "<ISO now, LA time>", "locFrom": "35", "locTo": "46", "toLines": [...], "ifLines": [...], "links": [...], "receipts": [...], "items": [...]}`. Keep the rows exactly as returned, keys included.
7. Sanity check: `node -e "const v=require('./move_portal/test/amd').loadAmd('move_verify.js'); const r=v.buildReads(require('./move_portal/snapshot/prod-2026-10-05.json')); console.log(r.plannedIfs().length,'planned', r.openToLines().length,'open TO lines')"`
   Expected: some planned IFs. On 2026-10-05, prod had status-A/B IFs such as IF72287–IF72291 on TO 7679913.

- [ ] **Step 6: Run the full suite**

Run: `node --test "move_portal/test/*.test.js"`
Expected: all pass.

- [ ] **Step 7: Commit** (the snapshot and store are gitignored)

```bash
git add .gitignore move_portal/local/local_store.js move_portal/test/preview_server.js move_portal/test/fake_data.test.js
git commit -m "feat(v3): local beta: prod snapshot + persistent local store + floor/manager preview"
```

---

