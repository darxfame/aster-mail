const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const execute = promisify(execFile);
test('optional Xerj refuses noninteractive use without explicit per-operation consent', async () => {
  for (const operation of ['search', 'setup', 'serve']) {
    await assert.rejects(execute(process.execPath, [path.join(__dirname, '../scripts/xerj.cjs'), operation, 'fictional-query'], { timeout: 5000 }), error => {
      assert.match(error.stderr, /Ask the user before using Xerj/); return true;
    });
  }
});
