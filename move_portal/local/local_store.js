// move_portal/local/local_store.js — node only, NOT deployed. Persists the fake data layer to a JSON file.
const fs = require('fs');
const { makeFakeData } = require('../test/fake_data');

function makeLocalStore(core, file) {
    const data = makeFakeData(core);
    if (fs.existsSync(file)) {
        let parsed;
        try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
        catch (e) { throw new Error('Local store file is corrupted and was not loaded: ' + file + ' (' + e.message + ')'); }
        Object.assign(data.db, parsed);
    }
    return { data, save: () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data.db, null, 1)); fs.renameSync(tmp, file); } };
}

module.exports = { makeLocalStore };
