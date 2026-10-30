// One-time local setup. The lasting private key lives only in the login keychain.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const identity = 'Aster Mail Local Signing';
function run(command, args) {
  try { return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (error) {
    if (args.includes('-P')) throw new Error(`Keychain import failed: ${String(error.stderr).replaceAll(process.env.ASTER_SIGNING_IMPORT_PASSWORD, '[redacted]').trim()}`);
    throw error;
  }
}
if (process.platform !== 'darwin') throw new Error('Signing setup requires macOS.');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aster-signing-'));
fs.chmodSync(directory, 0o700);
const certificate = path.join(directory, 'certificate.pem');
const key = path.join(directory, 'private.key');
const bundle = path.join(directory, 'identity.p12');
try {
  const keychain = run('/usr/bin/security', ['default-keychain', '-d', 'user']).trim().replace(/^"|"$/g, '');
  let existing;
  try { existing = run('/usr/bin/security', ['find-certificate', '-c', identity, '-p', keychain]); }
  catch (error) { if (error.status !== 44) throw error; }
  if (existing) {
    // Never silently replace a certificate: updates must keep the same key.
    const matches = run('/usr/bin/security', ['find-identity', '-p', 'codesigning', keychain]);
    if (!matches.includes(`"${identity}"`)) throw new Error('The existing signing certificate has no usable private key. Restore its .p12 backup; do not regenerate it.');
    fs.writeFileSync(certificate, existing, { mode: 0o600 });
  } else {
    run('/usr/bin/openssl', ['req', '-new', '-x509', '-newkey', 'rsa:3072', '-nodes', '-days', '3650', '-subj', `/CN=${identity}`,
      '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=codeSigning',
      '-keyout', key, '-out', certificate]);
    fs.chmodSync(key, 0o600);
    // The import bundle and its throwaway password are removed after import.
    process.env.ASTER_SIGNING_IMPORT_PASSWORD = crypto.randomBytes(32).toString('hex');
    run('/usr/bin/openssl', ['pkcs12', '-export', '-inkey', key, '-in', certificate, '-out', bundle, '-passout', 'env:ASTER_SIGNING_IMPORT_PASSWORD',
      '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1']);
    fs.chmodSync(bundle, 0o600);
    run('/usr/bin/security', ['import', bundle, '-k', keychain, '-P', process.env.ASTER_SIGNING_IMPORT_PASSWORD, '-T', '/usr/bin/codesign']);
  }
  const valid = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', keychain]);
  if (!valid.includes(`"${identity}"`)) {
    // User-scoped code-signing trust only; this never trusts the certificate for TLS.
    run('/usr/bin/security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign', '-k', keychain, certificate]);
  }
  if (!run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', keychain]).includes(`"${identity}"`)) throw new Error('Signing identity is not available. Check login keychain access.');
  console.log(`Ready: ${identity} in ${keychain}`);
  console.log(run('/usr/bin/openssl', ['x509', '-in', certificate, '-noout', '-fingerprint', '-sha256']).trim());
  console.log('Back up the certificate AND its private key using a password-protected .p12 export in Keychain Access.');
} finally {
  delete process.env.ASTER_SIGNING_IMPORT_PASSWORD;
  fs.rmSync(directory, { recursive: true, force: true });
}
