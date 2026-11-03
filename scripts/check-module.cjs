const { readPackage } = require('../desktop/modules.cjs');
const path = require('node:path');
if (process.argv.length !== 3) { console.error('Usage: node scripts/check-module.cjs <module-folder>'); process.exitCode = 1; }
else readPackage(path.resolve(process.argv[2])).then(bundle => console.log(JSON.stringify({ id: bundle.manifest.id, version: bundle.manifest.version, digest: bundle.digest, files: bundle.files.size, permissions: bundle.manifest.permissions }, null, 2)), error => { console.error(error.message); process.exitCode = 1; });
