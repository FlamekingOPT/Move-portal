// move_portal/test/ui.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadAmd } = require('./amd');
const ui = loadAmd('move_ui.js');

test('buildPage embeds boot data safely and the client script parses', () => {
    const html = ui.buildPage({ url: '/app/site/hosting/scriptlet.nl?script=1&deploy=1', mode: 'floor', me: 'X</script><b>',
        roster: ['Miguel'], fromName: 'Riverside', toName: 'Tippecanoe', maxPrint: 250 });
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.match(html, /<meta name="viewport"/);
    const m = /<script>([\s\S]*)<\/script>/.exec(html);
    assert.ok(m, 'has a script');
    assert.doesNotThrow(() => new Function(m[1]));
    assert.equal(html.indexOf('</script><b>'), -1, 'boot data cannot close the script tag');
});

test('client code never contains a closing script tag', () => {
    assert.equal(ui._clientMain.toString().replace(/\r/g, '').toLowerCase().indexOf('</script'), -1);
});

test('v3 screens exist and old ones are gone', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['SCREENS.trucks', "api('truck_scan'", "api('ship_mark'", "api('truck_planned'"].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
    ['SCREENS.load ', "api('scan_load'"].forEach(s => assert.equal(src.indexOf(s), -1, 'still has ' + s));
});

test('v3 inbound/approval/report screens exist', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['SCREENS.unload', 'SCREENS.approve', 'SCREENS.report', "api('unload_scan'", "api('receipt_approve'", "api('report'"].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
    ['SCREENS.recv ', 'SCREENS.toreceive', "api('scan_recv'", 'SCREENS.catchup'].forEach(s => assert.equal(src.indexOf(s), -1, 'still has ' + s));
});

test('every client api() action exists on the server and every data-act has an ACT handler', () => {
    const fs = require('fs'), path = require('path');
    const src = ui._clientMain.toString().replace(/\r/g, '');
    const server = fs.readFileSync(path.join(__dirname, '..', 'sl_move_portal.js'), 'utf8');
    const apis = new Set(); let m;
    const reApi = /api\('([a-z_]+)'/g;
    while ((m = reApi.exec(src))) apis.add(m[1]);
    assert.ok(apis.size > 10);
    apis.forEach(a => assert.ok(server.indexOf("act('" + a + "'") !== -1, 'server lacks act ' + a));
    const acts = new Set();
    const reAct = /data-act="([a-z]+)"/g;
    while ((m = reAct.exec(src))) acts.add(m[1]);
    assert.ok(acts.size > 10);
    acts.forEach(a => assert.ok(new RegExp('ACT\\.' + a + ' =').test(src), 'no ACT handler for ' + a));
});

test('departing state, confirm prompts, null-screen guards', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    assert.ok(src.indexOf("t.status === 'departed'") !== -1);
    assert.ok(src.indexOf('Departing… a NetSuite write is pending') !== -1);
    ['apretry', 'aprecv', 'dmark'].forEach(n => {
        const i = src.indexOf('ACT.' + n + ' =');
        assert.ok(i !== -1 && src.slice(i, i + 700).indexOf('confirm(') !== -1, 'no confirm in ' + n);
    });
    assert.ok(src.indexOf("if (!$('scanres')) return;") !== -1);
});

test('removed: no pending, cancel or skip-write paths; a departure that needs a fix again repaints', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['depart_cancel', 'depart_skip_write', 'apskip', 'apdepart', 'dcancel', 't.pending', 'r.departures'].forEach(k => assert.equal(src.indexOf(k), -1, k));
    assert.ok(src.indexOf('IF changed in NetSuite: needs a fix again') !== -1);
});

test('fix11: mark-shipped confirm text, stuck receipt button, scrollable report', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['Mark this truck shipped? A manager confirms it in Approvals.', 'overflow-x:auto']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    assert.equal(src.split("x.stuck ? 'Re-approve receipt'").length - 1, 2);
});

test('manager page uses the NetSuite login, no "I am" picker; floor keeps it', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    assert.ok(src.indexOf('if (isMgr) { S.who = B.me;') !== -1, 'manager who defaults to the NetSuite user');
    assert.ok(/const whoCtl = isMgr \? ''/.test(src), 'no picker on the manager page');
    assert.ok(src.indexOf("if (w) w.onchange") !== -1, 'picker wiring guarded');
});

test('verify-load UI: verify, take-off, stages, recheck alert, manager correct', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["api('truck_verify'", "api('trucks_recheck'", "api('truck_add_if'", "api('truck_drop_if'", "api('truck_correct'", 'Needs IF fix', 'Ready to ship',
        'Take off', 'back to Riverside', 'now matches its IF', 'mv_alerted', 'document.hidden']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ["api('depart_cancel'", "api('depart_skip_write'"].forEach(t => assert.equal(src.indexOf(t), -1, 'still has ' + t));
});

test('verify-load UI: take-off mode, stage buttons, scan modes', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['data-act="tverify"', 'data-act="taddif"', "api('truck_scan', { truckId: S.truckId, raw: v, mode: mode })", "wireScan('scan', doTruckScan, () => S.tmode)", "'takeoff'", '120000', "case 'taken_off'", "case 'not_on_truck'", 'Not on this truck',
        'Verify again', '← Other trucks', 'Mark shipped', "api('ship_mark'"]
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    assert.ok(/visibilitychange/.test(src), 'polling stops when hidden');
    assert.ok(src.indexOf('30000') !== -1, 'recheck every 30 s');
});

test('verify-load UI: needs-fix message depends on what changed', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['IF changed in NetSuite: needs a fix again', 'The load changed: verify again', "'if_gone'", "'if_short'", "'if_over'"]
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
});

test('verify-load UI: approvals needs-fix cards, write-mode wording, release, skipped and orphans', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['Plan only: fix in NetSuite', 'Changes IF quantities in NetSuite (add-on IFs: office creates them)', 'Changes IF quantities and creates add-on IFs in NetSuite',
        'Release to Needs IF fix', 'n.verifiedBy', 'n.verifiedAt', "api('depart_release'", 'canRelease', 'r.needsFix', '.orphans', '.skipped', 'correctError', 'data-act="apcorrect"', 'data-act="apdrop"']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ['apcorrect', 'aprelease', 'apdrop'].forEach(n => {
        const i = src.indexOf('ACT.' + n + ' =');
        assert.ok(i !== -1 && src.slice(i, i + 500).indexOf('confirm(') !== -1, 'no confirm in ' + n);
    });
});

test('review fixes: ready alert per ready event on every device; confirm and banner wording', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["r.ready", "t.id + '|' + t.at", 'No stamp is recorded for this truck', 'off the truck (portal only)'].forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    assert.equal(src.indexOf('Nothing was stamped'), -1);
    const css = ui.buildPage({ url: '/x?a=1', mode: 'floor', me: 'X', roster: [], fromName: 'R', toName: 'T', maxPrint: 1 });
    assert.match(css, /\.banner\{position:fixed;bottom:0/);
});

test('polish: no self-alert after Verify; banner pads main so it cannot cover controls', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["view.truck.id + '|' + view.verify.at", 'markSeen(r.view)', 'paddingBottom'].forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ['ACT.tverify =', 'ACT.taddif =', 'ACT.dmark ='].forEach(n => {
        const i = src.indexOf(n);
        assert.ok(i !== -1 && src.slice(i, i + 1000).indexOf('markSeen(r.view)') !== -1, 'no markSeen in ' + n);
    });
});

test('final fixes: manager add-any-IF picker on the needs-fix card; ids escaped; verify by may be an object', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['r.freeIfs', 'data-act="apaddany"', "api('truck_add_if'"].forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ['data-id="\' + p.id + \'"', 'data-id="\' + x.truck.id + \'"'].forEach(t => assert.equal(src.indexOf(t), -1, 'unescaped ' + t));
    assert.ok(src.indexOf("typeof vf.by === 'object'") !== -1, 'verify by object shown by name');
});

test('a refused mark shipped reloads Shipments, error on top', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    assert.ok(src.indexOf('The truck changed on another device: verify again') !== -1);
    const i = src.indexOf('ACT.dmark =');
    assert.ok(i !== -1 && src.slice(i, i + 1100).indexOf('departRefused(r') !== -1, 'no departRefused in dmark');
    const j = src.indexOf('async function departRefused');
    assert.ok(j !== -1 && /shipList\(/.test(src.slice(j, j + 600)));
});

test('floor rework: Load out default, no Void, Shipments, trailer, short note, other items', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["['ship', 'Shipments']", "api('ship_mark'", "api('truck_other_add'", "api('unload_other_tick'", 'Why is it short?', 'shortNote', 'Trailer #', 'go to Shipments', 'Sent back by']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ["['void', 'Void']", "api('depart_preview'", "api('depart_confirm'"].forEach(t => assert.equal(src.indexOf(t), -1, 'still has ' + t));
});

test('floor rework: tab order, shipped today, other-item remove, ship-pending unload lock', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["out: [['trucks', 'Load out'], ['ship', 'Shipments'], ['req', 'Request label']]", 'SCREENS.ship', 'r.shippedToday', 'Waiting for manager', 'Shipped today',
        "api('truck_other_remove'", 'Armstrong Group', 'waiting for a manager to confirm shipping', 'r.trailers']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    assert.equal(src.indexOf('SCREENS.void'), -1, 'Void screen still there');
    assert.equal(src.indexOf('departForm('), -1, 'departure form still on the truck screen');
});

test('manager rework: 4 tabs, no toggle, merged Labels, approvals hierarchy', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["['labels', 'Labels']", "['approve', 'Approvals']", "['dash', 'Dashboard']", "['report', 'Report']", 'SCREENS.labels', "api('ship_confirm'", "api('ship_sendback'",
        'btn-correct', 'btn-addif', 'Add an IF to this truck', 'Ship confirmations'].forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    assert.equal(src.indexOf("['queue', 'Print queue']"), -1, 'old label tabs removed');
});

test('manager rework: default Approvals, late badge, otherDiffs, Drop calls drop_if, CSS hierarchy, note modal kept on error', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["mgr: 'dash'", 'LATE_MIN = 30', "waiting ' + x.ageMin + ' min", 'S.lateShips', 'n.otherDiffs', "api('truck_drop_if'", 'class="btn-correct" data-act="apcorrect"',
        'class="dbtn btn-addif" data-act="apaddopen"', 'labelQueue(', 'labelSku(', 'labelPlan(', 'labelReprint(', 'labelConfigs(', "S.poll = setInterval(loadQueue, 15000)",
        "String(r.view.truck.id) !== String(S.truckId)"].forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ['SCREENS.queue', 'SCREENS.plan', 'SCREENS.sku', 'SCREENS.configs', 'SCREENS.reprint'].forEach(t => assert.equal(src.indexOf(t), -1, 'still has ' + t));
    const i = src.indexOf('ACT.apdrop =');
    assert.ok(i !== -1 && src.slice(i, i + 400).indexOf('truck_correct') === -1, 'Drop never corrects');
    const j = src.indexOf('ACT.notesave =');
    assert.ok(j !== -1 && src.slice(j, j + 300).indexOf('closeNote()') === -1, 'the note modal stays until the verify goes through');
    const k = src.indexOf('ACT.otherrm =');
    assert.ok(k !== -1 && src.slice(k, k + 120).indexOf('needWho()') !== -1);
    const page = ui.buildPage({ url: '/x?a=1', mode: 'manager', me: 'X', roster: [], fromName: 'R', toName: 'T', maxPrint: 1 });
    assert.match(page, /\.btn-correct\{[^}]*font-size:19px/);
    assert.match(page, /\.dbtn\.btn-addif\{background:#fff;border:1px solid/);
});

test('final fixes: trailer edit on the truck header; ship_mark sends a trailer when the truck has none', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['data-act="ttrailer"', '✎ trailer', "api('truck_set_trailer'", 's_tr_', 'trl ? { trailer: tv } : {}'].forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
});

test('final fixes: manager Open truck shows the error in its modal when truck_get fails', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    const i = src.indexOf('ACT.opentruck ='), j = src.indexOf('const v = r.view', i);
    assert.ok(i !== -1 && j !== -1 && src.slice(i, j).indexOf('errBox(r.error)') !== -1, 'Open truck error not shown');
});

test('final fixes: a stalled correction on a truck with no fix card gets a truck-level free button', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['Free the stuck correction', 'n.stuck && !hasFix', 'truckCard(n, r.freeIfs, r.writeMode, (r.fixes || []).some(f => String(f.truckId) === String(n.truck.id)))']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    const i = src.indexOf('Free the stuck correction'), b = src.lastIndexOf('<button', i);
    assert.ok(/class="btn-correct" data-act="apcorrect"/.test(src.slice(b, i)) && src.slice(b, i).indexOf('data-key') === -1, 'free button: btn-correct apcorrect with no key');
});

test('2026-10-06 pm: Dashboard first and default; Labels start with Print a SKU', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    assert.ok(src.indexOf("mgr: [['dash', 'Dashboard'], ['approve', 'Approvals'], ['labels', 'Labels'], ['report', 'Report']]") !== -1, 'tab order');
    assert.ok(src.indexOf("mgr: 'dash'") !== -1, 'default tab');
    assert.ok(src.indexOf("main(sec('lb_sku', 'Print a SKU') + sec('lb_xlsx', 'Upload an Excel') + sec('lb_weights', 'Unit weights') + sec('lb_queue', 'Label requests') + sec('lb_plan', 'Print plan') + sec('lb_reprint', 'Reprint') + sec('lb_configs', 'SKU configs'))") !== -1, 'labels order');
});

test('2026-10-06 pm: flagged pallets card and receipt rows with Accept / Reject; Approve waits; anchors for the dashboard links', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['Flagged pallets', 'data-act="apaccept"', 'data-act="apreject"', "api('pallet_accept'", "api('pallet_reject'", 'Accept onto this truck', 'x.blockReason', 'x.canApprove', 'r.flagged', 'x.pending', 'x.decided',
        'id="ap_ship"', 'id="ap_fix"', 'id="ap_trucks"', 'id="ap_flag"', 'id="ap_retry"', 'id="ap_rec"', 'ACT.goapprove =', 'decide now, or later on the receipt card', 'waiting for the manager', 'v.decided', 'Flagged at Tippecanoe', "case 'flagged_tippecanoe'"]
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    assert.equal(src.indexOf('The office will sort these out.'), -1);
    ['apaccept', 'apreject'].forEach(n => {
        const i = src.indexOf('ACT.' + n + ' =');
        assert.ok(i !== -1 && src.slice(i, i + 600).indexOf(n === 'apaccept' ? 'confirm(' : 'prompt(') !== -1, 'no dialog in ' + n);
    });
});

test('2026-10-06 pm: Dashboard shows waiting queues, truck tiles, Active loads with search/filter/sort; Report has the history table', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['Waiting for approval', 'Nothing waiting for approval', 'Trucks shipped today', 'Trucks per day · 7-day avg', 'Trucks shipped · total', 'In transit', 'see Move Tracker', 'Active loads',
        'Trucks shipped per day', 'Flagged, waiting on manager', 'Search IF, TO, trailer, seal, Truck # or SKU', 'furthest along', 'oldest step', 'data-act="dashsort"', 'data-act="dashrow"', 'data-act="goapprove"',
        'r.waiting', 'r.tiles', 'r.rows', 'Truck history', 'r.history', 'function tableTools(']
        .forEach(t => assert.ok(src.indexOf(t) !== -1, 'missing ' + t));
    ['Total pallets to move', 'Pallets remaining', 'Projected finish', 'Recent trucks', 'Remaining by SKU', 'r.bySku', 'm.projectedFinish'].forEach(t => assert.equal(src.indexOf(t), -1, 'still has ' + t));
    assert.ok(src.indexOf("barChart(r.days, r.tiles.plan") !== -1, 'chart counts trucks against the plan line');
    assert.equal(src.indexOf('Pallets moved per day'), -1);
});

test('2026-10-06 pm fix: the table toolbars are rendered once, so typing in the search box keeps focus', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['paintLoads', 'paintHist'].forEach(n => {
        const i = src.indexOf('function ' + n);
        assert.ok(i !== -1, 'no ' + n);
        const ends = ['function ', 'ACT.', 'SCREENS.'].map(t => src.indexOf(t, i + 10)).filter(x => x !== -1);
        const body = src.slice(i, Math.min(...ends));
        assert.equal(body.indexOf('tableTools('), -1, n + ' must not rebuild the toolbar');
    });
    const di = src.indexOf('SCREENS.dash ='), dj = src.indexOf('SCREENS.', di + 10);
    const dash = src.slice(di, dj === -1 ? undefined : dj);
    assert.equal(dash.split('id="dashtools"').length - 1, 1, 'dash renders id="dashtools" once');
    const ri = src.indexOf('SCREENS.report ='), rj = src.indexOf('SCREENS.', ri + 10);
    assert.equal(src.slice(ri, rj === -1 ? undefined : rj).split('id="histtools"').length - 1, 1, 'report renders id="histtools" once');
    assert.ok(src.indexOf('HISTSORTS') !== -1 && src.indexOf("receivedAt || x.confirmedAt || x.markedAt || x.startedAt") !== -1, 'history sort fallbacks');
});

test('scan-built floor screens: no IF list when office IFs are off, Finish loading, weight on Verify, Finish → Shipments', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['function scanTable(', 'ACT.finishload', 'Finish loading', 'Finish → Shipments', 'r.officeIfs', 'Start Trailer', 'pallets × ', 'without weight', 'Approve will be blocked']
        .forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
});

test('finishload delegates to tverify, which guards a stale truck', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    assert.ok(/ACT\.finishload = [^\n]*ACT\.tverify\(/.test(src));
    const t = src.slice(src.indexOf('ACT.tverify ='));
    assert.ok(t.slice(0, 600).indexOf('S.truckId') !== -1 && t.slice(0, 900).indexOf("!$('scanres')") !== -1);
});

test('tverify captures the truck id before the await and words the flash for scan trucks', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    const t = src.slice(src.indexOf('ACT.tverify ='), src.indexOf('ACT.taddif ='));
    assert.ok(t.indexOf('const tid = S.truckId') !== -1 && t.indexOf('const tid') < t.indexOf("await api('truck_verify'"));
    assert.ok(t.indexOf('String(tid) !== String(S.truckId)') !== -1);
    assert.ok(src.indexOf('Load checked') !== -1);
});

test('manager screens: plain Approve / Reject card, Excel label upload, odd pallet, over-stock warning', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['✅ Approve', '↩ Reject', 'function labelUpload(', 'function readSheet(', 'xlsx/0.18.5/xlsx.full.min.js', "api('labels_preview'", 'Odd pallet', 'You can still print',
        'Download template', 'Release (after you Close ', 'pcs per pallet', 'odd pallet pcs'].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
});

// Pull a named client function (brace-counted) out of the serialized client and run it without a browser.
function clientFn(src, name) {
    const i = src.indexOf('function ' + name + '('), o = src.indexOf('{', src.indexOf(')', i));
    let d = 0, j = o;
    for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break; }
    return src.slice(i, j + 1);
}
function xlsxFns() {
    const src = ui._clientMain.toString().replace(/\r/g, ''), k = src.indexOf('const HEAD =');
    const h = src.slice(k, src.indexOf(String.fromCharCode(10), k));
    return new Function(h + String.fromCharCode(10) + ['mapRows', 'csvObjs', 'printSpecs'].map(n => clientFn(src, n)).join(String.fromCharCode(10)) + String.fromCharCode(10) + 'return { mapRows, csvObjs, printSpecs };')();
}
test('excel upload helpers: mapRows, csvObjs, printSpecs behave', () => {
    const f = xlsxFns();
    const rows = f.mapRows([{ ' SKU ': 'A', 'Pcs  per pallet': 72, PALLETS: 4, 'odd pallet pcs': 18 }]);
    assert.deepStrictEqual(rows, [{ sku: 'A', pcs: 72, pallets: 4, odd: 18 }]);
    assert.throws(() => f.mapRows([{ SKU: 'A', 'Pcs per pallet': 72 }]), /needs the columns/);
    assert.strictEqual(f.mapRows([{ SKU: 'A', 'Pcs per pallet': 72, Pallets: 4 }])[0].odd, '');
    assert.deepStrictEqual(f.csvObjs('SKU,Pallets\r\nA,4\r\n'), [{ SKU: 'A', Pallets: '4' }]);
    assert.deepStrictEqual(f.csvObjs('SKU,Pallets\r\n'), []);
    const specs = f.printSpecs({ rows: [{ status: 'ok', item: '11', sku: 'A', cfg: 'A', pcs: 72, pallets: 4, odd: 18 }, { status: 'skip', item: '9', sku: 'X', pcs: 1, pallets: 9, odd: 0 },
        { status: 'warn', item: '12', sku: 'B', cfg: '', pcs: 36, pallets: 0, odd: 5 }] });
    assert.strictEqual(specs.length, 3);
    assert.strictEqual(specs.reduce((a, s) => a + s.n, 0), 6);
    assert.strictEqual(specs[1].lines[0].pcs, 18);
});

test('scan truck ship messages: Plan saved in off/qty, TO + IF numbers in on', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['Plan saved (writeMode ', ' written to NetSuite', 'shipped in the portal'].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
});

test('label counts: no stale-label row on the dashboard; the plan says "on trucks"', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    assert.equal(src.indexOf('Labeled, never loaded (stale)'), -1);
    assert.ok(src.indexOf('already on trucks') !== -1);
});

// ── drop trailer docs (spec 2026-10-16 §3) ──
test('ui: drop-trailer copy is present', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['Ready for docs', '📄 Send for docs', 'Waiting for docs', 'At dock', '📄 Docs ready · at dock', '🚛 Picked up',
        'Approve writes the TO + IF (Packed). Shipped happens when you confirm the pickup.', 'Docs out of sync', '🔒 Load locked',
        'Writing docs…', 'The seal # goes in at the dock', 'Send this trailer for docs? A manager approves them in Approvals.', 'Plan saved (writes are off)',
        'No seal yet', 'Sent for docs by ', "api('dock_seal'", "api('picked_up'", "api('dock_resync'"].forEach(s => assert.ok(src.includes(s), s));
});

test('ui: Dashboard STAGES mirror the server STAGE_ORDER', () => {
    const fs = require('fs'), path = require('path');
    const server = fs.readFileSync(path.join(__dirname, '..', 'sl_move_portal.js'), 'utf8');
    const sm = /const STAGE_ORDER = (\[[^\]]*\]);/.exec(server), cm = /const STAGES = (\[[^\]]*\]);/.exec(ui._clientMain.toString().replace(/\r/g, ''));
    assert.ok(sm && cm);
    assert.deepEqual(JSON.parse(cm[1].replace(/'/g, '"')), JSON.parse(sm[1].replace(/'/g, '"')));
});

test('ui: dock step kinds have human labels; at-dock scan results are handled', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["docs_written: 'Docs written'", "picked_up: 'Picked up'", "dock_edit: 'Changed at the dock'",
        "case 'short'", "case 'refused'", "case 'out_of_sync'", "at_dock: ['📄 Docs ready · at dock', 'p-green']"].forEach(s => assert.ok(src.includes(s), s));
});

test('ui: at-dock lock copy (load and unload) and the scan box on a status change', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    [', at the dock waiting for pickup', 'That trailer has its paperwork. Leave this pallet on it.',
        '❌ Its trailer is still at Riverside waiting for pickup', 'Set it aside and tell the office.', 'S.tvStatus'].forEach(s => assert.ok(src.includes(s), s));
});

test('ui final I1: at the dock other items get + Add / ✕ and pallets get ✕ (truck_remove routes to a dock take-off)', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['otherHtml(v, open || dock)', "(open || dock ? '<div class=\"ac\"><button data-act=\"tremove\""].forEach(s => assert.ok(src.includes(s), s));
    assert.equal(src.includes('otherHtml(v, open);'), false);
});

test('ui final I2b: managers get "Mark picked up without NetSuite" on the at-dock card and the out-of-sync card', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["api('picked_up_force'", 'Mark picked up without NetSuite', 'data-act="dforce"',
        'Mark this trailer picked up WITHOUT updating NetSuite? The office must fix the TO/IF by hand.'].forEach(s => assert.ok(src.includes(s), s));
    ["(isMgr ? forceBtn(t.id, t.label) : '')", "forceBtn(o.id, o.label)"].forEach(s => assert.ok(src.includes(s), 'button on both cards: ' + s));
});

test('ui final minor: step labels for the dock re-sync, the dock seal and the forced pickup', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["docs_resynced: 'Docs re-synced'", "dock_seal: 'Seal added'", "picked_up_forced: 'Picked up (no NetSuite)'"].forEach(s => assert.ok(src.includes(s), s));
});

test('Shipments cards each carry a View load button', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    assert.ok(src.indexOf('📋 View load') !== -1);
    assert.ok(src.indexOf('data-act="opentruck"') !== -1);
    assert.ok(src.split('viewBtn(').length - 1 >= 7, 'every card builder uses viewBtn');
});

test('2026-10-17: manager ship-confirm cards open the load; the pop-up shows weights and one row per pallet', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    const card = clientFn(src, 'shipConfirmCard');
    assert.equal((card.match(/data-act="opentruck"/g) || []).length, 2, 'View load on both scan and office ship-confirm cards');
    const pw = new Function('esc', 'num', 'return ' + clientFn(src, 'palletWeights'))(s => String(s), n => String(n));
    const html = pw({ scan: { pallets: 2, tare: 100, rows: [{ item: '11', pcs: 100, lbs: 500 }, { item: '12', pcs: 10, lbs: null }] },
        pallets: [{ code: 'PLT1', status: 'loaded', summary: 'YSN201 · 100', pieces: 100, lines: [{ item: '11', pcs: 100 }] },
            { code: 'PLT2', status: 'loaded', summary: 'YSN301 · 10', pieces: 10, lines: [{ item: '12', pcs: 10 }] },
            { code: 'PLT3', status: 'labeled', summary: 'x', pieces: 1, lines: [] }] });
    assert.ok(html.indexOf('550 lb') !== -1, 'item weight × pcs + tare share');
    assert.ok(html.indexOf('no weight') !== -1);
    assert.equal(html.indexOf('PLT3'), -1, 'only loaded pallets');
});

test('2026-10-17: manager-only writes copy: pickup confirm, send back to Load out, locked dock', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ['Picked up · confirm shipped', '✅ Confirm shipped', "api('pickup_confirm'", "api('pickup_reject'", "api('dock_sendback'", '↩ Send back to Load out',
        'Picked up · waiting for manager', 'Sent to a manager to confirm it shipped.', 'ask a manager to send the trailer back', 'with only the change'].forEach(t => assert.ok(src.includes(t), t));
    const card = clientFn(src, 'pickupCard');
    assert.ok(card.includes('data-act="pkconfirm"') && card.includes('data-act="opentruck"'));
});

test('ui: weights card, overweight banner and weight in item search exist', () => {
    const src = ui._clientMain.toString().replace(/\r/g, '');
    ["api('weights_preview'", "api('weights_save'", "api('weights_list'", "'Unit weights'", "'⚠ Over '", "'at least '", 'Download current weights'].forEach(s => assert.ok(src.indexOf(s) !== -1, 'missing ' + s));
});
