// move_portal/test/amd.js
// Loads a SuiteScript AMD module (define([...], factory)) in node with injected deps.
const fs = require('fs');
const path = require('path');

function loadAmd(file, deps) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    let exported;
    function define(names, factory) {
        if (typeof names === 'function') { factory = names; names = []; }
        exported = factory.apply(null, names.map(n => {
            if (!deps || !(n in deps)) throw new Error(file + ': missing test dependency ' + n);
            return deps[n];
        }));
    }
    new Function('define', src)(define);
    return exported;
}

module.exports = { loadAmd };
