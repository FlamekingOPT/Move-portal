const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const core = loadAmd('move_core.js');
const P = core.PALLET;

test('parseScan accepts PLT codes in any case and rejects everything else', () => {
    assert.deepEqual(core.parseScan(' plt48213 '), { raw: 'PLT48213', palletId: 48213 });
    assert.deepEqual(core.parseScan('0714528803'), { raw: '0714528803', palletId: null });
    assert.deepEqual(core.parseScan('PLT0'), { raw: 'PLT0', palletId: null });
    assert.deepEqual(core.parseScan(null), { raw: '', palletId: null });
    assert.equal(core.palletCode(7), 'PLT7');
});

test('summarize, headline and totalPieces', () => {
    const one = [{ item: '11', sku: 'YSN201', cfg: 'A', pcs: 120 }];
    const custom = [{ item: '11', sku: 'YSN201', cfg: '', pcs: 7 }];
    const mixed = [{ item: '1', sku: 'YSN330', cfg: 'A', pcs: 24 }, { item: '2', sku: 'YSN10LB', cfg: '', pcs: 40 }];
    assert.equal(core.summarize(one), 'YSN201 · A · 120');
    assert.equal(core.summarize(custom), 'YSN201 · custom · 7');
    assert.equal(core.summarize(mixed), 'MIXED · YSN330 ×24, YSN10LB ×40');
    assert.equal(core.headline(one), 'YSN201 · Config A');
    assert.equal(core.headline(custom), 'YSN201 · Custom');
    assert.equal(core.headline(mixed), 'MIXED · 2 SKUs');
    assert.equal(core.totalPieces(mixed), 64);
    assert.equal(core.summarize([]), '');
});

test('isEdited is true only for a single-SKU pallet whose pieces differ from its config', () => {
    const pcs = { '11': { A: 120, B: 60 } };
    assert.equal(core.isEdited([{ item: '11', cfg: 'A', pcs: 120 }], pcs), false);
    assert.equal(core.isEdited([{ item: '11', cfg: 'A', pcs: 80 }], pcs), true);
    assert.equal(core.isEdited([{ item: '11', cfg: '', pcs: 80 }], pcs), false);
    assert.equal(core.isEdited([{ item: '11', cfg: 'A', pcs: 1 }, { item: '12', cfg: 'A', pcs: 1 }], pcs), false);
    assert.equal(core.isEdited([{ item: '99', cfg: 'A', pcs: 1 }], pcs), false);
});

test('validateLines', () => {
    assert.equal(core.validateLines([{ item: '11', sku: 'YSN201', pcs: 5 }]), '');
    assert.match(core.validateLines([]), /At least one SKU/);
    assert.match(core.validateLines([{ item: '', pcs: 5 }]), /Unknown SKU/);
    assert.match(core.validateLines([{ item: '11', sku: 'YSN201', pcs: 0 }]), /whole number above 0 for YSN201/);
    assert.match(core.validateLines([{ item: '11', sku: 'YSN201', pcs: 2.5 }]), /whole number/);
    assert.match(core.validateLines([{ item: '11', sku: 'YSN201', pcs: 1 }, { item: '11', sku: 'YSN201', pcs: 2 }]), /appears twice/);
    const six = [1, 2, 3, 4, 5, 6].map(i => ({ item: String(i), sku: 'S' + i, pcs: 1 }));
    assert.match(core.validateLines(six), /at most 5/);
});

test('pcsMap and defaultPcs', () => {
    const cfg = { '11': [{ code: 'A', pcs: 120, isDefault: false }, { code: 'B', pcs: 60, isDefault: true }], '12': [{ code: 'A', pcs: 60, isDefault: false }] };
    assert.deepEqual(core.pcsMap(cfg), { '11': { A: 120, B: 60 }, '12': { A: 60 } });
    assert.deepEqual(core.defaultPcs(cfg), { '11': 60, '12': 60 });
    assert.equal(P.LABELED, 'labeled');
    assert.equal(P.IN_TRANSIT, 'in_transit');
    assert.equal(P.SHIPPED, undefined);
});

// ── Task 3 ──
test('parseCsv handles quotes, CRLF and blank lines', () => {
    const rows = core.parseCsv('SKU,Config,Pcs,Default\r\n"YSN,201",A,120,Y\r\n\r\nYSN301, B ,"60",\n"say ""hi""",C,1,N');
    assert.deepEqual(rows, [
        ['SKU', 'Config', 'Pcs', 'Default'],
        ['YSN,201', 'A', '120', 'Y'],
        ['YSN301', 'B', '60', ''],
        ['say "hi"', 'C', '1', 'N']
    ]);
    assert.deepEqual(core.parseCsv(''), []);
});

test('buildConfigImport validates rows and resolves one default per SKU', () => {
    const skus = { YSN201: '11', YSN301: '12', YSN401: '13' };
    const rows = [
        ['SKU', 'Config', 'Pcs per pallet', 'Default'],
        ['ysn201', 'a', '120', 'Y'],
        ['YSN201', 'B', '60', 'N'],
        ['YSN301', 'A', '60', ''],
        ['NOPE', 'A', '5', 'Y'],
        ['YSN301', 'B', '0', 'N'],
        ['YSN201', 'A', '100', 'N'],
        ['YSN401', 'A', '10', 'Y'],
        ['YSN401', 'B', '20', 'yes'],
        ['', 'A', '1', 'Y']
    ];
    const r = core.buildConfigImport(rows, skus);
    assert.deepEqual(r.unknownSkus, ['NOPE']);
    assert.deepEqual(r.configs, [
        { item: '11', sku: 'YSN201', code: 'A', pcs: 120, isDefault: true },
        { item: '11', sku: 'YSN201', code: 'B', pcs: 60, isDefault: false },
        { item: '12', sku: 'YSN301', code: 'A', pcs: 60, isDefault: true },
        { item: '13', sku: 'YSN401', code: 'A', pcs: 10, isDefault: true },
        { item: '13', sku: 'YSN401', code: 'B', pcs: 20, isDefault: false }
    ]);
    assert.deepEqual(r.errors.map(e => e.row), [6, 7, 10, 0]);
    assert.match(r.errors[0].msg, /YSN301 B: pieces must be a whole number/);
    assert.match(r.errors[1].msg, /YSN201 A: duplicate config/);
    assert.match(r.errors[2].msg, /Missing SKU/);
    assert.match(r.errors[3].msg, /YSN401: more than one default, using A/);
});

test('buildConfigImport works without a header row', () => {
    const r = core.buildConfigImport([['YSN201', 'A', '120', 'Y']], { YSN201: '11' });
    assert.equal(r.configs.length, 1);
    assert.equal(r.errors.length, 0);
});

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

// ── Task 12b ──
test('parseScan reads the pallet id from a tab/comma/pipe payload', () => {
    assert.deepEqual(core.parseScan('PLT48213\tYSN201\t120'), { raw: 'PLT48213\tYSN201\t120', palletId: 48213 });
    assert.equal(core.parseScan('plt48213,ysn201,120').palletId, 48213);
    assert.equal(core.parseScan('PLT48213|YSN201|120').palletId, 48213);
    assert.equal(core.parseScan(' PLT7\tX\t1 ').palletId, 7);
    assert.equal(core.parseScan('PLT48213X\tYSN201').palletId, null);
    assert.equal(core.parseScan('YSN201\tPLT48213').palletId, null);
});

test('barcodePayload lists code then SKU and pieces per line, tab-separated', () => {
    assert.equal(core.barcodePayload('PLT1', [{ sku: 'YSN201', pcs: 120 }]), 'PLT1\tYSN201\t120');
    assert.equal(core.barcodePayload('PLT2', [{ sku: 'YSN330', pcs: 24 }, { sku: 'YSN10LB', pcs: 40 }]), 'PLT2\tYSN330\t24\tYSN10LB\t40');
    assert.equal(core.barcodePayload('PLT3', []), 'PLT3');
});
