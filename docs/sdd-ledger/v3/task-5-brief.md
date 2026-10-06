### Task 5: Snapshot → reads (`buildReads`), SuiteQL text, `local/snapshot_ns.js`

**Files:**
- Modify: `move_portal/move_verify.js` (add `SQL` and `buildReads`)
- Create: `move_portal/test/fixtures/snapshot_sample.json`
- Create: `move_portal/local/snapshot_ns.js`
- Modify: `move_portal/test/verify.test.js`

**Interfaces:**
- Produces:
  - `SQL(locFrom, locTo) → {toLines, ifLines, links, receipts, items}`: SuiteQL strings. `links`, `receipts` and `items` take a comma list via `.replace('{IDS}', ids)`.
  - `buildReads(raw)` → the **`move_ns` interface**, used by everything later:
    - `plannedIfs() → [{ifId, ifNum, status, trandate, toId, toNum, lines: [{item, sku, qty}]}]` (status A/B, IF id order)
    - `openToLines() → [{toId, toNum, trandate, toStatus, item, sku, qty, remaining}]` (status B/D/E and remaining > 0)
    - `ifInfo() → {ifId: {ifNum, status, toId, lines}}`, covering every IF in the snapshot
    - `ifsByTo() → {toId: [ifId]}`
    - `receiptsByIf() → {ifId: [{id, tranid, trailer, seal, lines: {item: qty}}]}`
    - `items() → [{item, sku, desc, upc}]`
    - `pulledAt() → string`
    - `resetCache()`: a no-op here
  - `makeSnapshotNs(verify, rawOrPath)` in `local/snapshot_ns.js` returns the same interface. A path is read with `fs`.
- **Raw snapshot format.** Keys are lowercase because SuiteQL returns them that way. Rows are copied straight from query output:
  ```json
  { "pulledAt": "2026-10-05T14:00:00-07:00", "locFrom": "35", "locTo": "46",
    "toLines":  [{ "toid": 1, "tonum": "TO1", "tostatus": "D", "trandate": "2026-10-01", "item": 975, "sku": "YSN100", "qty": 10080 }],
    "ifLines":  [{ "ifid": 2, "ifnum": "IF2", "status": "B", "trandate": "2026-10-05", "toid": 1, "item": 975, "sku": "YSN100", "qty": 504 }],
    "links":    [{ "ifid": 2, "rcptid": 3 }],
    "receipts": [{ "rcptid": 3, "tranid": "IR3", "trailer": "537224", "seal": "SEAL: 1", "item": 975, "qty": 504 }],
    "items":    [{ "item": 975, "sku": "YSN100", "descr": "...", "upc": "..." }] }
  ```
  `remaining` = Σ TO qty − Σ IF qty, for every IF status. Picked/Packed IFs already count as fulfilled on the TO.

- [ ] **Step 1: Create the fixture `move_portal/test/fixtures/snapshot_sample.json`**

```json
{
  "pulledAt": "2026-10-05T14:00:00-07:00", "locFrom": "35", "locTo": "46",
  "toLines": [
    { "toid": 500, "tonum": "TO500", "tostatus": "D", "trandate": "2026-10-01", "item": 975, "sku": "YSN100", "qty": 1560 },
    { "toid": 600, "tonum": "TO600", "tostatus": "B", "trandate": "2026-09-29", "item": 975, "sku": "YSN100", "qty": 504 },
    { "toid": 700, "tonum": "TO700", "tostatus": "B", "trandate": "2026-09-28", "item": 11, "sku": "YSN201", "qty": 1200 },
    { "toid": 800, "tonum": "TO800", "tostatus": "G", "trandate": "2026-09-20", "item": 11, "sku": "YSN201", "qty": 100 }
  ],
  "ifLines": [
    { "ifid": 9000, "ifnum": "IF9000", "status": "C", "trandate": "2026-10-03", "toid": 500, "item": 975, "sku": "YSN100", "qty": 504 },
    { "ifid": 9001, "ifnum": "IF9001", "status": "B", "trandate": "2026-10-05", "toid": 500, "item": 975, "sku": "YSN100", "qty": 504 },
    { "ifid": 9002, "ifnum": "IF9002", "status": "A", "trandate": "2026-10-05", "toid": 500, "item": 975, "sku": "YSN100", "qty": 288 },
    { "ifid": 9002, "ifnum": "IF9002", "status": "A", "trandate": "2026-10-05", "toid": 500, "item": 975, "sku": "YSN100", "qty": 216 },
    { "ifid": 9050, "ifnum": "IF9050", "status": "C", "trandate": "2026-09-21", "toid": 800, "item": 11, "sku": "YSN201", "qty": 100 }
  ],
  "links": [{ "ifid": 9000, "rcptid": 7000 }, { "ifid": 1234, "rcptid": 7999 }],
  "receipts": [{ "rcptid": 7000, "tranid": "IR7000", "trailer": "537224", "seal": "SEAL: 5249300", "item": 975, "qty": 504 }],
  "items": [{ "item": 975, "sku": "YSN100", "descr": "100# LP cylinder", "upc": "0975" }, { "item": 11, "sku": "YSN201", "descr": "20# LP cylinder", "upc": "111" }]
}
```

- [ ] **Step 2: Write the failing tests** (append to `verify.test.js`)

```js
const raw = require('./fixtures/snapshot_sample.json');

test('buildReads: planned IFs (A/B), merged lines, TO remaining after every IF, open TOs only', () => {
    const r = v.buildReads(raw);
    assert.deepEqual(r.plannedIfs().map(f => [f.ifId, f.status, f.toNum, f.lines]), [
        ['9001', 'B', 'TO500', [{ item: '975', sku: 'YSN100', qty: 504 }]],
        ['9002', 'A', 'TO500', [{ item: '975', sku: 'YSN100', qty: 504 }]]]);
    assert.deepEqual(r.openToLines().map(t => [t.toId, t.item, t.remaining]), [['500', '975', 48], ['600', '975', 504], ['700', '11', 1200]]);
    assert.deepEqual(r.ifsByTo(), { 500: ['9000', '9001', '9002'], 800: ['9050'] });
    assert.deepEqual(r.receiptsByIf(), { 9000: [{ id: '7000', tranid: 'IR7000', trailer: '537224', seal: 'SEAL: 5249300', lines: { 975: 504 } }] });
    assert.equal(r.ifInfo()['9000'].status, 'C');
    assert.deepEqual(r.items()[0], { item: '975', sku: 'YSN100', desc: '100# LP cylinder', upc: '0975' });
    assert.equal(r.pulledAt(), '2026-10-05T14:00:00-07:00');
});

test('SQL builds location-specific queries', () => {
    const q = v.SQL('35', '46');
    assert.match(q.toLines, /t\.transferlocation = 46/);
    assert.match(q.toLines, /x\.location = 35/);
    assert.match(q.ifLines, /tl\.location = 35/);
    assert.match(q.links, /linktype = 'TOrdCost'/);
    assert.match(q.receipts, /\{IDS\}/);
});

test('local snapshot_ns reads a file path', () => {
    const { makeSnapshotNs } = require('../local/snapshot_ns');
    const ns = makeSnapshotNs(v, require('path').join(__dirname, 'fixtures', 'snapshot_sample.json'));
    assert.equal(ns.plannedIfs().length, 2);
    ns.resetCache();
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `v.buildReads is not a function`.

- [ ] **Step 4: Implement in `move_verify.js`** (before `return`, and export `SQL, buildReads`)

```js
    // ── NetSuite reads: SuiteQL text + a builder shared by the live module and the snapshot ──
    function SQL(locFrom, locTo) {
        const F = Number(locFrom), T = Number(locTo);
        const moveTos = "SELECT t.id FROM transaction t WHERE t.type = 'TrnfrOrd' AND t.transferlocation = " + T;
        return {
            toLines: "SELECT t.id AS toid, t.tranid AS tonum, t.status AS tostatus, TO_CHAR(t.trandate, 'YYYY-MM-DD') AS trandate, " +
                "tl.item AS item, BUILTIN.DF(tl.item) AS sku, tl.quantity AS qty FROM transaction t JOIN transactionline tl ON tl.transaction = t.id " +
                "WHERE t.type = 'TrnfrOrd' AND t.transferlocation = " + T + " AND tl.location = " + T + " AND tl.quantity > 0 " +
                "AND t.id IN (SELECT x.transaction FROM transactionline x WHERE x.mainline = 'T' AND x.location = " + F + ")",
            ifLines: "SELECT f.id AS ifid, f.tranid AS ifnum, f.status AS status, TO_CHAR(f.trandate, 'YYYY-MM-DD') AS trandate, tl.createdfrom AS toid, " +
                "tl.item AS item, BUILTIN.DF(tl.item) AS sku, tl.quantity AS qty FROM transaction f JOIN transactionline tl ON tl.transaction = f.id " +
                "WHERE f.type = 'ItemShip' AND tl.mainline = 'F' AND tl.location = " + F + " AND tl.quantity > 0 AND tl.createdfrom IN (" + moveTos + ")",
            links: "SELECT ptl.previousdoc AS ifid, ptl.nextdoc AS rcptid FROM previoustransactionlink ptl WHERE ptl.linktype = 'TOrdCost' AND ptl.previousdoc IN ({IDS})",
            receipts: "SELECT r.id AS rcptid, r.tranid AS tranid, r.custbody_rsm_container_no AS trailer, r.custbody7 AS seal, tl.item AS item, tl.quantity AS qty " +
                "FROM transaction r JOIN transactionline tl ON tl.transaction = r.id WHERE r.type = 'ItemRcpt' AND tl.location = " + T + " AND tl.quantity > 0 AND r.id IN ({IDS})",
            items: "SELECT i.id AS item, i.itemid AS sku, i.displayname AS descr, i.upccode AS upc FROM item i WHERE i.id IN ({IDS})"
        };
    }

    function buildReads(raw) {
        raw = raw || {};
        const S = x => String(x == null ? '' : x);
        const toQty = {}, toMeta = {}, used = {}, ifs = {}, byTo = {};
        (raw.toLines || []).forEach(r => {
            const key = S(r.toid) + '|' + S(r.item);
            toQty[key] = (toQty[key] || 0) + Number(r.qty || 0);
            toMeta[S(r.toid)] = { toNum: S(r.tonum), trandate: S(r.trandate), toStatus: S(r.tostatus) };
            toMeta[key] = { sku: S(r.sku) };
        });
        (raw.ifLines || []).forEach(r => {
            const id = S(r.ifid), to = S(r.toid), it = S(r.item);
            const f = ifs[id] = ifs[id] || { ifId: id, ifNum: S(r.ifnum), status: S(r.status), trandate: S(r.trandate), toId: to, toNum: (toMeta[to] || {}).toNum || '', lines: [] };
            const l = f.lines.find(x => x.item === it);
            if (l) l.qty += Number(r.qty || 0); else f.lines.push({ item: it, sku: S(r.sku), qty: Number(r.qty || 0) });
            used[to + '|' + it] = (used[to + '|' + it] || 0) + Number(r.qty || 0);
            if ((byTo[to] = byTo[to] || []).indexOf(id) === -1) byTo[to].push(id);
        });
        Object.keys(byTo).forEach(k => byTo[k].sort((a, b) => Number(a) - Number(b)));
        const rcptIf = {};
        (raw.links || []).forEach(l => { if (ifs[S(l.ifid)]) rcptIf[S(l.rcptid)] = S(l.ifid); });
        const recs = {};
        (raw.receipts || []).forEach(r => {
            const ifId = rcptIf[S(r.rcptid)];
            if (!ifId) return;
            const list = recs[ifId] = recs[ifId] || [];
            let x = list.find(y => y.id === S(r.rcptid));
            if (!x) { x = { id: S(r.rcptid), tranid: S(r.tranid), trailer: S(r.trailer), seal: S(r.seal), lines: {} }; list.push(x); }
            x.lines[S(r.item)] = (x.lines[S(r.item)] || 0) + Number(r.qty || 0);
        });
        const byNum = (a, b) => Number(a.ifId) - Number(b.ifId);
        return {
            plannedIfs: () => Object.values(ifs).filter(f => PLANNED_IF_STATUS.indexOf(f.status) !== -1 && toMeta[f.toId]).sort(byNum).map(f => JSON.parse(JSON.stringify(f))),
            openToLines: () => Object.keys(toQty).map(key => {
                const p = key.split('|'), m = toMeta[p[0]];
                return { toId: p[0], toNum: m.toNum, trandate: m.trandate, toStatus: m.toStatus, item: p[1], sku: toMeta[key].sku, qty: toQty[key], remaining: toQty[key] - (used[key] || 0) };
            }).filter(r => OPEN_TO_STATUS.indexOf(r.toStatus) !== -1 && r.remaining > 0).sort((a, b) => Number(a.toId) - Number(b.toId)),
            ifInfo: () => { const o = {}; Object.values(ifs).forEach(f => { o[f.ifId] = { ifNum: f.ifNum, status: f.status, toId: f.toId, lines: f.lines.map(l => Object.assign({}, l)) }; }); return o; },
            ifsByTo: () => JSON.parse(JSON.stringify(byTo)),
            receiptsByIf: () => JSON.parse(JSON.stringify(recs)),
            items: () => (raw.items || []).map(i => ({ item: S(i.item), sku: S(i.sku), desc: S(i.descr), upc: S(i.upc) })),
            pulledAt: () => S(raw.pulledAt),
            resetCache: () => {}
        };
    }
```

- [ ] **Step 5: Create `move_portal/local/snapshot_ns.js`**

```js
// move_portal/local/snapshot_ns.js — node only, NOT deployed. A move_ns stand-in that reads a prod snapshot JSON.
const fs = require('fs');

function makeSnapshotNs(verify, rawOrPath) {
    const raw = typeof rawOrPath === 'string' ? JSON.parse(fs.readFileSync(rawOrPath, 'utf8')) : rawOrPath;
    return verify.buildReads(raw);
}

module.exports = { makeSnapshotNs };
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: PASS (19 tests). TO500 remaining = 1560 − 504 − 504 − 504 = 48. TO800 (status G) is excluded.

- [ ] **Step 7: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js move_portal/test/fixtures/snapshot_sample.json move_portal/local/snapshot_ns.js
git commit -m "feat(v3): snapshot reads builder + SuiteQL text + local snapshot_ns"
```

---

