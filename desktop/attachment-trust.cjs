const tr = require('../src/i18n.js').text;
const fs = require('node:fs/promises');

// Mark before writing any payload. No untracked plaintext staging copies are created.
async function markUntrusted(file, platform = process.platform, io = fs) {
  if (platform !== 'win32') return;
  const zone = '[ZoneTransfer]\r\nZoneId=3\r\n';
  await io.writeFile(`${file}:Zone.Identifier`, zone, { flag: 'w' });
  if (await io.readFile(`${file}:Zone.Identifier`, 'utf8') !== zone) throw new Error(tr('Не удалось проверить отметку безопасности вложения'));
}
async function writeAttachment(file, bytes, { assertActive = () => {}, mark = markUntrusted } = {}) {
  assertActive();
  let handle, created = false;
  try {
    try { handle = await fs.open(file, 'wx', 0o600); created = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; handle = await fs.open(file, 'r+'); }
    if (!(await handle.stat()).isFile()) throw new Error(tr('Выберите обычный файл'));
    assertActive(); await mark(file); assertActive();
    await handle.writeFile(bytes); await handle.truncate(bytes.length);
  } catch (error) {
    if (handle) { await handle.close(); handle = null; }
    if (created) {
      try { await fs.rm(file, { force: true }); }
      catch { throw new Error(`${tr("Вложение не сохранено. Не удалось удалить незавершённый файл:")} ${file}`); }
    }
    throw new Error(`${tr("Вложение не сохранено: не удалось безопасно записать файл.")} ${error.message}`);
  } finally { if (handle) await handle.close(); }
}
module.exports = { markUntrusted, writeAttachment };
