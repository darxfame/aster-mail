const test = require('node:test');
const assert = require('node:assert/strict');
const { checkDeploymentTargets } = require('../scripts/verify-macos-compatibility.cjs');

test('macOS 13 deployment guard checks actual binary targets, including old load commands', () => {
  assert.equal(require('../package.json').build.mac.minimumSystemVersion, '13.0');
  const modern = version => `Load command 0\n cmd LC_BUILD_VERSION\n cmdsize 32\n platform 1\n minos ${version}\n sdk 26.5\n ntools 1\n`;
  const legacy = `Load command 1\n cmd LC_VERSION_MIN_MACOSX\n cmdsize 16\n version 12.0\n sdk 15.5\n`;
  checkDeploymentTargets(modern('13.0') + legacy, 'fixture');
  for (const version of ['13.0.1', '13.1', '14.0', '26.0']) assert.throws(() => checkDeploymentTargets(modern(version), 'fixture'), /Requires macOS/);
  assert.throws(() => checkDeploymentTargets('', 'fixture'), /Missing macOS deployment target/);
});
