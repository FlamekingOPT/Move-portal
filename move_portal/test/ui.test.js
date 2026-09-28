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
    assert.equal(ui._clientMain.toString().toLowerCase().indexOf('</script'), -1);
});
