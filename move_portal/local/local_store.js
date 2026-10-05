// move_portal/local/local_store.js — node only, NOT deployed. Persists the fake data layer to a JSON file.
const fs = require('fs');
const { makeFakeData } = require('../test/fake_data');

function makeLocalStore(core, file) {
    const data = makeFakeData(core);
    if (fs.existsSync(file)) Object.assign(data.db, JSON.parse(fs.readFileSync(file, 'utf8')));
    return { data, save: () => fs.writeFileSync(file, JSON.stringify(data.db, null, 1)) };
}

module.exports = { makeLocalStore };
