// move_portal/local/snapshot_ns.js — node only, NOT deployed. A move_ns stand-in that reads a prod snapshot JSON.
const fs = require('fs');

function makeSnapshotNs(verify, rawOrPath) {
    const raw = typeof rawOrPath === 'string' ? JSON.parse(fs.readFileSync(rawOrPath, 'utf8')) : rawOrPath;
    return verify.buildReads(raw);
}

module.exports = { makeSnapshotNs };
