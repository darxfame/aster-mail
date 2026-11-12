// Exercise actual Chromium color parsing and signature previews with fictional HTML.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-signature-contrast-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
async function waitFor(expression) {
  for (let i = 0; i < 150; i++) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(`Signature did not become ready: ${expression}`);
}
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ width: 1280, height: 850, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    const html = '<div style="background-color:white;color:#1f1f1f"><p title="nested">С уважением, Команда Aster</p>'
      + '<p><span title="hex" style="color:#202020">Тёмный текст</span><br><font title="legacy" color="#333333">Подпись из Outlook</font></p>'
      + '<p><span title="alpha" style="color:rgba(0,0,0,.87)">Полупрозрачный чёрный</span><br><span title="hsl" style="color:hsl(0,0%,12%)">HSL</span><br><span title="named" style="color:darkslategray">Именованный цвет</span></p>'
      + '<p><b title="accent" style="color:#f5b0d0">Акцент</b><a href="https://example.test">Ссылка</a><span title="transparent" style="color:transparent">Hidden</span></p></div>';
    await js(`window.fixtureSignature={html:${JSON.stringify(html)},text:'Fictional signature',images:{},errors:{}};state.theme='dark';document.body.classList.add('dark');syncSignature=true;serverSignature=fixtureSignature;settingsModal()`);
    await js('document.querySelector("#settings-tab-signature").click()');
    await waitFor('Boolean(document.querySelector("#signature-preview iframe")?.contentDocument?.querySelector("[title=hex]"))');
    for (const title of ['nested','hex','legacy','alpha','hsl','named']) {
      assert.equal(await js(`(() => {const frame=document.querySelector('#signature-preview iframe'),view=frame.contentWindow;return view.getComputedStyle(frame.contentDocument.querySelector('[title=${title}]')).color===view.getComputedStyle(frame.contentDocument.body).color;})()`), true, title + ' must inherit readable text in dark mode');
    }
    assert.equal(await js(`document.querySelector('#signature-preview iframe').contentDocument.querySelector('[title=accent]').style.color`), 'rgb(245, 176, 208)');
    assert.equal(await js(`document.querySelector('#signature-preview iframe').contentDocument.querySelector('[title=transparent]').style.color`), 'transparent');
    assert.equal(await js('fixtureSignature.html'), html, 'Display correction must not rewrite the outgoing signature');
    const output=path.join(root,'release/signature-contrast-ui');await fs.mkdir(output,{recursive:true});
    await new Promise(resolve=>setTimeout(resolve,100));
    await fs.writeFile(path.join(output,'dark.png'),(await window.webContents.capturePage()).toPNG());
    await js(`state.theme='light';document.body.classList.remove('dark');renderSignaturePreview(document.querySelector('#signature-preview'),fixtureSignature)`);
    await waitFor('Boolean(document.querySelector("#signature-preview iframe")?.contentDocument?.querySelector("[title=hex]"))');
    assert.equal(await js(`document.querySelector('#signature-preview iframe').contentDocument.querySelector('[title=hex]').style.color`), 'rgb(32, 32, 32)', 'Light mode retains the original color');
    assert.equal(await js('fixtureSignature.html'), html);
    console.log('PASS: dark signature contrast for hex/named/HSL/alpha/nested/legacy colors, preserved emphasis/transparency, light colors and original outgoing markup.');
  } finally { window?.destroy(); await fs.rm(profile,{recursive:true,force:true,maxRetries:3}); }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
