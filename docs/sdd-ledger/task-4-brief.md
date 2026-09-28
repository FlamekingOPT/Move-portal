### Task 4: Core calendar, tracker, plan suggestion, stamp parsing

**Files:**
- Modify: `move_portal/move_core.js` (fill the `(Task 4)` section and extend the `return`)
- Test: `move_portal/test/core.test.js` (append)

**Interfaces:**
- Produces:
  - `isoAddDays(iso, n)`
  - `moveDays(fromIso, toIso, skip) → iso[]` (Mon–Sat, inclusive)
  - `nthMoveDayFrom(fromIso, n, skip)` (inclusive of `fromIso`)
  - `parseNsStamp(s) → {dayIso, hour}|null` (NetSuite `M/D/YYYY h:mm:ss am` format)
  - `estimateRemaining(onHand, defPcs) → {pallets, byItem, unknownItems}`
  - `trackerMetrics({todayIso, targetIso, startIso, skipDates, remaining, movedByDay, todayDone}) → {moved, remaining, total, movedToday, daysLeft, neededPerDay, avg7, avgAll, projectedFinish, onTrack}`. `neededPerDay` is `Infinity` when there's work left and no days remain.
  - `suggestPlan(rows:[{item, palletsLeft}], total) → {item: count}`

- [ ] **Step 1: Append the failing tests**

```js
// ── Task 4 ──
test('calendar helpers skip Sundays and skip dates', () => {
    assert.equal(core.isoAddDays('2026-10-01', -1), '2026-09-30');
    assert.equal(core.isoAddDays('2026-12-31', 1), '2027-01-01');
    assert.deepEqual(core.moveDays('2026-10-01', '2026-10-07', []), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07']);
    assert.deepEqual(core.moveDays('2026-10-01', '2026-10-07', ['2026-10-05']), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-06', '2026-10-07']);
    assert.deepEqual(core.moveDays('2026-10-08', '2026-10-07', []), []);
    assert.equal(core.moveDays('2026-10-01', '2026-11-15', []).length, 39);
    assert.equal(core.nthMoveDayFrom('2026-10-03', 1, []), '2026-10-03');
    assert.equal(core.nthMoveDayFrom('2026-10-04', 1, []), '2026-10-05');
    assert.equal(core.nthMoveDayFrom('2026-10-03', 2, []), '2026-10-05');
});

test('parseNsStamp reads NetSuite date-time text', () => {
    assert.deepEqual(core.parseNsStamp('10/14/2026 2:14:05 pm'), { dayIso: '2026-10-14', hour: 14 });
    assert.deepEqual(core.parseNsStamp('1/2/2026 12:05 am'), { dayIso: '2026-01-02', hour: 0 });
    assert.deepEqual(core.parseNsStamp('1/2/2026 12:05 pm'), { dayIso: '2026-01-02', hour: 12 });
    assert.equal(core.parseNsStamp('nope'), null);
});

test('estimateRemaining rounds pallets up and lists items with no config', () => {
    assert.deepEqual(core.estimateRemaining({ '11': 1200, '12': 610, '13': 5, '14': 0 }, { '11': 120, '12': 60 }),
        { pallets: 21, byItem: { '11': 10, '12': 11 }, unknownItems: ['13'] });
});

test('trackerMetrics mid-move, today not finished', () => {
    const moved = {};
    ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-12', '2026-10-13']
        .forEach(d => { moved[d] = 200; });
    const m = core.trackerMetrics({ todayIso: '2026-10-14', targetIso: '2026-11-15', startIso: '2026-10-01', skipDates: [], remaining: 5250, movedByDay: moved, todayDone: false });
    assert.deepEqual(m, { moved: 2200, remaining: 5250, total: 7450, movedToday: 0, daysLeft: 28, neededPerDay: 188,
        avg7: 200, avgAll: 200, projectedFinish: '2026-11-13', onTrack: true });
});

test('trackerMetrics after today is done, and edge cases', () => {
    const moved = { '2026-10-07': 200, '2026-10-08': 200, '2026-10-09': 200, '2026-10-10': 200, '2026-10-12': 200, '2026-10-13': 200, '2026-10-14': 150 };
    const m = core.trackerMetrics({ todayIso: '2026-10-14', targetIso: '2026-11-15', startIso: '2026-10-07', skipDates: [], remaining: 100, movedByDay: moved, todayDone: true });
    assert.equal(m.daysLeft, 27);
    assert.equal(m.avg7, 192.9);
    assert.equal(m.movedToday, 150);
    assert.equal(m.projectedFinish, '2026-10-15');
    const done = core.trackerMetrics({ todayIso: '2026-11-20', targetIso: '2026-11-15', startIso: '2026-10-01', skipDates: [], remaining: 5, movedByDay: {}, todayDone: false });
    assert.equal(done.daysLeft, 0);
    assert.equal(done.neededPerDay, Infinity);
    assert.equal(done.projectedFinish, null);
    assert.equal(done.onTrack, false);
    const none = core.trackerMetrics({ todayIso: '2026-10-14', targetIso: '2026-11-15', startIso: '2026-10-01', skipDates: [], remaining: 0, movedByDay: {}, todayDone: false });
    assert.equal(none.projectedFinish, '2026-10-14');
    assert.equal(none.neededPerDay, 0);
});

test('suggestPlan splits by pallets left and never exceeds them', () => {
    const rows = [{ item: '11', palletsLeft: 10 }, { item: '12', palletsLeft: 30 }];
    assert.deepEqual(core.suggestPlan(rows, 8), { '11': 2, '12': 6 });
    assert.deepEqual(core.suggestPlan(rows, 5), { '11': 1, '12': 4 });
    assert.deepEqual(core.suggestPlan(rows, 100), { '11': 10, '12': 30 });
    assert.deepEqual(core.suggestPlan(rows, 0), { '11': 0, '12': 0 });
    assert.deepEqual(core.suggestPlan([], 5), {});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test "move_portal/test/*.test.js"`
Expected: FAIL. `core.isoAddDays is not a function`.

- [ ] **Step 3: Replace the `// ── (Task 4) …` line with:**

```js
    // ── calendar (ISO YYYY-MM-DD strings, computed in UTC to avoid DST) ──
    const DAY_MS = 86400000;
    function pad2(n) { return String(n).padStart(2, '0'); }
    function isoToUtc(iso) { const p = String(iso).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
    function utcToIso(t) { return new Date(t).toISOString().slice(0, 10); }
    function isoAddDays(iso, n) { return utcToIso(isoToUtc(iso) + n * DAY_MS); }
    function isMoveDay(iso, skipSet) { return new Date(isoToUtc(iso)).getUTCDay() !== 0 && !skipSet[iso]; }
    function skipSetOf(skip) { const s = {}; (skip || []).forEach(d => { s[d] = true; }); return s; }

    function moveDays(fromIso, toIso, skip) {
        const out = [], sk = skipSetOf(skip);
        for (let t = isoToUtc(fromIso), end = isoToUtc(toIso); t <= end; t += DAY_MS) {
            const iso = utcToIso(t);
            if (isMoveDay(iso, sk)) out.push(iso);
        }
        return out;
    }

    function nthMoveDayFrom(fromIso, n, skip) {
        const sk = skipSetOf(skip);
        let iso = fromIso, count = 0;
        for (let guard = 0; guard < 5000; guard++) {
            if (isMoveDay(iso, sk)) { count++; if (count >= n) return iso; }
            iso = isoAddDays(iso, 1);
        }
        return null;
    }

    // NetSuite DATETIMETZ text in M/D/YYYY format, e.g. "10/14/2026 2:14:05 pm"
    function parseNsStamp(s) {
        const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?/i.exec(String(s || ''));
        if (!m) return null;
        let h = Number(m[4]);
        if (m[6]) { const pm = /pm/i.test(m[6]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
        return { dayIso: m[3] + '-' + pad2(m[1]) + '-' + pad2(m[2]), hour: h };
    }

    // ── tracker ───────────────────────────────────────────────────────────
    function estimateRemaining(onHand, defPcs) {
        const byItem = {}, unknownItems = [];
        let pallets = 0;
        Object.keys(onHand || {}).forEach(k => {
            const q = Number(onHand[k]) || 0;
            if (q <= 0) return;
            const pcs = Number(defPcs && defPcs[k]) || 0;
            if (!pcs) { unknownItems.push(k); return; }
            byItem[k] = Math.ceil(q / pcs);
            pallets += byItem[k];
        });
        return { pallets, byItem, unknownItems };
    }

    function trackerMetrics(o) {
        const skip = o.skipDates || [];
        const moved = o.movedByDay || {};
        const movedTotal = Object.keys(moved).reduce((a, k) => a + (Number(moved[k]) || 0), 0);
        const fromIso = o.todayDone ? nthMoveDayFrom(isoAddDays(o.todayIso, 1), 1, skip) : o.todayIso;
        const daysLeft = fromIso > o.targetIso ? 0 : moveDays(fromIso, o.targetIso, skip).length;
        const done = moveDays(o.startIso, o.todayIso, skip).filter(d => d < o.todayIso || o.todayDone);
        const sumOf = ds => ds.reduce((a, d) => a + (Number(moved[d]) || 0), 0);
        const last7 = done.slice(-7);
        const avg7 = last7.length ? sumOf(last7) / last7.length : 0;
        const avgAll = done.length ? sumOf(done) / done.length : 0;
        const remaining = Math.max(0, Number(o.remaining) || 0);
        const needed = daysLeft ? Math.ceil(remaining / daysLeft) : (remaining > 0 ? Infinity : 0);
        let projected = null;
        if (remaining === 0) projected = o.todayIso;
        else if (avg7 > 0) projected = nthMoveDayFrom(fromIso, Math.ceil(remaining / avg7), skip);
        return {
            moved: movedTotal, remaining, total: movedTotal + remaining, movedToday: Number(moved[o.todayIso]) || 0,
            daysLeft, neededPerDay: needed, avg7: Math.round(avg7 * 10) / 10, avgAll: Math.round(avgAll * 10) / 10,
            projectedFinish: projected, onTrack: !!projected && projected <= o.targetIso
        };
    }

    // Split `total` labels across SKUs in proportion to pallets left (largest remainder).
    function suggestPlan(rows, total) {
        const out = {};
        const sum = rows.reduce((a, r) => a + r.palletsLeft, 0);
        const want = Math.min(Math.max(0, Math.floor(Number(total) || 0)), sum);
        if (!want) { rows.forEach(r => { out[r.item] = 0; }); return out; }
        const parts = rows.map(r => {
            const raw = want * r.palletsLeft / sum;
            return { item: r.item, base: Math.floor(raw), frac: raw - Math.floor(raw), cap: r.palletsLeft };
        });
        let left = want - parts.reduce((a, p) => a + p.base, 0);
        parts.slice().sort((a, b) => b.frac - a.frac).forEach(p => { if (left > 0 && p.base < p.cap) { p.base++; left--; } });
        parts.forEach(p => { out[p.item] = Math.min(p.base, p.cap); });
        return out;
    }
```

In the `return` object, add: `isoAddDays, moveDays, nthMoveDayFrom, parseNsStamp, estimateRemaining, trackerMetrics, suggestPlan`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test "move_portal/test/*.test.js"`
Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add move_portal/move_core.js move_portal/test/core.test.js
git commit -m "feat(move): move-day calendar, tracker metrics, plan suggestion"
```

---

