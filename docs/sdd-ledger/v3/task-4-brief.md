### Task 4: Write gate (`runOps`) and shadow compare

**Files:**
- Modify: `move_portal/move_verify.js`
- Modify: `move_portal/test/verify.test.js`

**Interfaces:**
- Produces:
  - `opKey(op)`: `if_qty:<ifId>:<item>`, `if_stamp:<ifId>`, `if_create:<toId>`, `receipt:<ifId>:<seq>`
  - `opAllowed(op, mode) → bool`
  - `normMode(m) → 'off'|'qty'|'on'`
  - `runOps(ops, mode, apply, done, onWrite) → {written: [keys], planOnly: [keys]}`. `apply(op)` returns an id string. Keys already in `done` are skipped, and `onWrite(key, id)` is called right after each write.
  - `resolveNew(op, writes)`: swaps `ifId: 'new:<toId>'` for `writes['if_create:<toId>']`, and throws if that's missing.
  - `shadowRows({trucks, ifInfo, ifsByTo, receipts, sku})` → `[{truck, seal, ifNum, check, portal, netsuite, ok}]`, where `ok` ∈ `true · false · null` (null = NetSuite hasn't caught up yet). The inputs:
    - `trucks`: departed truck rows
    - `ifInfo`: `{ifId: {ifNum, status, toId, lines: [{item, qty}]}}`
    - `ifsByTo`: `{toId: [ifId]}`
    - `receipts`: `{ifId: [{id, tranid, trailer, seal, lines: {item: qty}}]}`
    - `sku`: `{item: sku}`

- [ ] **Step 1: Write the failing tests** (append)

```js
test('opKey / opAllowed / normMode', () => {
    assert.equal(v.opKey({ op: 'if_qty', ifId: '9', item: '975' }), 'if_qty:9:975');
    assert.equal(v.opKey({ op: 'if_stamp', ifId: '9' }), 'if_stamp:9');
    assert.equal(v.opKey({ op: 'if_create', toId: '600' }), 'if_create:600');
    assert.equal(v.opKey({ op: 'receipt', ifId: '9', seq: 2 }), 'receipt:9:2');
    assert.deepEqual(['if_qty', 'if_stamp', 'if_create', 'receipt'].map(op => [v.opAllowed({ op }, 'off'), v.opAllowed({ op }, 'qty'), v.opAllowed({ op }, 'on')]),
        [[false, true, true], [false, false, true], [false, false, true], [false, false, true]]);
    assert.equal(v.normMode('weird'), 'off');
    assert.equal(v.normMode('qty'), 'qty');
});

test('runOps writes only what the mode allows, skips done keys, reports each write', () => {
    const ops = [{ op: 'if_qty', ifId: '9', item: '975', from: 504, to: 480 }, { op: 'if_stamp', ifId: '9' }, { op: 'if_qty', ifId: '8', item: '975', from: 10, to: 5 }];
    const calls = [], saved = {};
    const r = v.runOps(ops, 'qty', op => { calls.push(v.opKey(op)); return 'id' + calls.length; }, { 'if_qty:8:975': 'old' }, (k, id) => { saved[k] = id; });
    assert.deepEqual(calls, ['if_qty:9:975']);
    assert.deepEqual(saved, { 'if_qty:9:975': 'id1' });
    assert.deepEqual(r, { written: ['if_qty:9:975'], planOnly: ['if_stamp:9'] });
    assert.deepEqual(v.runOps(ops, 'off', () => { throw new Error('no'); }, {}, null).written, []);
});

test('resolveNew', () => {
    assert.deepEqual(v.resolveNew({ op: 'receipt', ifId: 'new:600', toId: '600' }, { 'if_create:600': '77' }), { op: 'receipt', ifId: '77', toId: '600' });
    assert.throws(() => v.resolveNew({ op: 'receipt', ifId: 'new:600', toId: '600' }, {}), /add-on IF from TO 600 was not created/);
    const op = { op: 'receipt', ifId: '9' };
    assert.equal(v.resolveNew(op, {}), op);
});

test('shadowRows compares plan vs NetSuite and leaves not-yet-done checks as null', () => {
    const truck = { id: '1', data: { depart: { truckNo: 3, day: '2026-10-05', trailer: '537224', seal: '5249330' },
        alloc: [{ ifId: '9001', ifNum: 'IF9001', toId: '500', toNum: 'TO500', lines: { 975: 480 }, addOn: false },
            { ifId: 'new:600', ifNum: '(new)', toId: '600', toNum: 'TO600', lines: { 975: 24 }, addOn: true }],
        received: { 9001: { 975: 480 } } } };
    const rows = v.shadowRows({ trucks: [truck], sku: { 975: 'YSN100' },
        ifInfo: { 9001: { ifNum: 'IF9001', status: 'C', toId: '500', lines: [{ item: '975', qty: 504 }] }, 9100: { ifNum: 'IF9100', status: 'C', toId: '600', lines: [{ item: '975', qty: 24 }] } },
        ifsByTo: { 500: ['9001'], 600: ['9100'] },
        receipts: { 9001: [{ id: '1', tranid: 'IR1', trailer: '537224', seal: 'SEAL: 5249330', lines: { 975: 480 } }],
            9100: [{ id: '2', tranid: 'IR2', trailer: '537224', seal: 'SEAL: 5249330', lines: { 975: 24 } }] } });
    const pick = (ifNum, check) => rows.find(r => r.ifNum === ifNum && r.check === check);
    assert.deepEqual(pick('IF9001', 'IF qty YSN100'), { truck: 'Truck 3 · 10/05', seal: '5249330', ifNum: 'IF9001', check: 'IF qty YSN100', portal: '480', netsuite: '504', ok: false });
    assert.equal(pick('IF9001', 'Shipped').ok, true);
    assert.equal(pick('IF9001', 'Trailer').ok, true);
    assert.equal(pick('IF9001', 'Seal').ok, true);
    assert.equal(pick('IF9001', 'Receipt qty YSN100').ok, true);
    assert.equal(pick('IF9100', 'Add-on IF on TO600').ok, true);                // found by the seal on its receipt
    assert.equal(pick('IF9100', 'Receipt qty YSN100').ok, null);               // portal hasn't approved that receipt yet
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: FAIL with `v.opKey is not a function`.

- [ ] **Step 3: Implement** (add before `return`, and export `opKey, opAllowed, normMode, runOps, resolveNew, shadowRows`)

```js
    // ── write gate ───────────────────────────────────────────────────────
    function opKey(op) {
        if (op.op === 'if_qty') return 'if_qty:' + op.ifId + ':' + op.item;
        if (op.op === 'if_create') return 'if_create:' + op.toId;
        if (op.op === 'receipt') return 'receipt:' + op.ifId + ':' + op.seq;
        return op.op + ':' + op.ifId;
    }
    function normMode(m) { return m === 'qty' || m === 'on' ? m : 'off'; }
    function opAllowed(op, mode) { const m = normMode(mode); return m === 'on' || (m === 'qty' && op.op === 'if_qty'); }
    function runOps(ops, mode, apply, done, onWrite) {
        const written = [], planOnly = [];
        (ops || []).forEach(op => {
            const key = opKey(op);
            if (!opAllowed(op, mode)) { planOnly.push(key); return; }
            if (done && done[key]) return;
            const id = String(apply(op));
            if (onWrite) onWrite(key, id);
            written.push(key);
        });
        return { written, planOnly };
    }
    function resolveNew(op, writes) {
        if (!op.ifId || String(op.ifId).indexOf('new:') !== 0) return op;
        const id = writes && writes['if_create:' + op.toId];
        if (!id) throw new Error('The add-on IF from TO ' + op.toId + ' was not created yet');
        return Object.assign({}, op, { ifId: String(id) });
    }

    // ── shadow compare (beta) ────────────────────────────────────────────
    function shadowRows(o) {
        const rows = [], sku = o.sku || {};
        const planned = {};
        (o.trucks || []).forEach(t => ((t.data && t.data.alloc) || []).forEach(a => { if (!a.addOn) planned[a.ifId] = true; }));
        (o.trucks || []).forEach(t => {
            const d = t.data || {}, dep = d.depart;
            if (!dep) return;
            const label = memoFor(dep.truckNo, dep.day), sealTxt = 'SEAL: ' + normSeal(dep.seal);
            const row = (ifNum, check, portal, netsuite, ok) => rows.push({ truck: label, seal: dep.seal, ifNum: ifNum, check: check, portal: String(portal), netsuite: netsuite == null ? '—' : String(netsuite), ok: ok });
            (d.alloc || []).forEach(a => {
                let realId = a.addOn ? null : a.ifId;
                if (a.addOn) {
                    realId = ((o.ifsByTo || {})[a.toId] || []).find(id => !planned[id] && ((o.receipts || {})[id] || []).some(r => normSeal(r.seal) === sealTxt)) || null;
                    const f = realId && o.ifInfo[realId];
                    row(f ? f.ifNum : '(new)', 'Add-on IF on ' + a.toNum, 'needed', f ? f.ifNum : null, f ? true : null);
                }
                const info = realId ? (o.ifInfo || {})[realId] : null;
                const ifNum = info ? info.ifNum : a.ifNum;
                if (!info) return;
                Object.keys(a.lines).forEach(k => {
                    const ns = (info.lines || []).filter(l => String(l.item) === k).reduce((s, l) => s + Number(l.qty || 0), 0);
                    row(ifNum, 'IF qty ' + (sku[k] || k), a.lines[k], ns, info.status === 'C' ? ns === a.lines[k] : null);
                });
                row(ifNum, 'Shipped', 'yes', info.status === 'C' ? 'yes' : info.status, info.status === 'C' ? true : null);
                const rs = (o.receipts || {})[realId] || [];
                if (!rs.length) return;
                row(ifNum, 'Trailer', dep.trailer, rs.map(r => r.trailer).join(', '), rs.every(r => normSeal(r.trailer) === normSeal(dep.trailer)));
                row(ifNum, 'Seal', dep.seal, rs.map(r => r.seal).join(', '), rs.every(r => normSeal(r.seal) === sealTxt));
                const mine = (d.received || {})[a.ifId] || null;
                Object.keys(a.lines).forEach(k => {
                    const ns = rs.reduce((s, r) => s + (Number(r.lines[k]) || 0), 0);
                    const p = mine ? Number(mine[k]) || 0 : null;
                    row(ifNum, 'Receipt qty ' + (sku[k] || k), p == null ? 'not approved' : p, ns, p == null ? null : p === ns);
                });
            });
        });
        return rows;
    }
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `node --test "move_portal/test/verify.test.js"`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_verify.js move_portal/test/verify.test.js
git commit -m "feat(v3): write gate (off|qty|on) + shadow compare rows"
```

---

