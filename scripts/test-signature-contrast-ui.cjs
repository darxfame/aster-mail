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
    window = new BrowserWindow({ width: 1280, height: 850, show: true,
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 12 } } : {}),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    if (process.platform === 'darwin') await js("document.body.classList.add('desktop','mac')");
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
    // Original mail colors belong to the message, even in a dark application.
    await js(`setModalDirty(false);document.querySelector('#modal').close();state.theme='dark';document.body.classList.add('dark');state.messages[0].html=${JSON.stringify(html)};state.messages[0].meeting=null;openMessage(state.messages[0].id)`);
    await waitFor('Boolean(document.querySelector("#message-body iframe")?.contentDocument?.querySelector("[title=hex]"))');
    assert.equal(await js(`(()=>{const frame=document.querySelector('#message-body iframe');return frame.contentWindow.getComputedStyle(frame.contentDocument.body).backgroundColor;})()`), 'rgba(0, 0, 0, 0)', 'Only the authored box is white; the frame stays transparent');
    assert.equal(await js(`document.querySelector('#message-body iframe').contentDocument.querySelector('[title=hex]').style.color`), 'rgb(32, 32, 32)', 'Mail keeps authored text colors');
    assert.equal(await js(`document.querySelector('#message-body iframe').contentDocument.querySelector('div').style.backgroundColor`), 'white', 'Mail keeps authored backgrounds');
    assert.equal(await js('state.messages[0].html'), html, 'Viewing must not rewrite the original message');
    await fs.writeFile(path.join(output,'dark-mail.png'),(await window.webContents.capturePage()).toPNG());
    await js(`window.asterRichContent.render(document.querySelector('#message-body'),'<p>Fictional image failure</p><img src="https://images.example.test/logo.png">',{dark:true,title:'Fictional image',loadImages:async()=>({images:{},errors:{'https://images.example.test/logo.png':'Неподдерживаемый адрес изображения'}}),openLink(){}})`);
    await waitFor('Boolean(document.querySelector("#message-body iframe")?.contentDocument?.querySelector(".aster-image-unavailable"))');
    assert.equal(await js(`document.querySelector('#message-body iframe').contentDocument.querySelector('.aster-image-unavailable').title`), 'Неподдерживаемый адрес изображения\nАдрес изображения: https://images.example.test/logo.png', 'Failed images show both their reason and source address');
    for (const dark of [true,false]) for (const background of ['white','#202020']) {
      await js(`window.asterRichContent.render(document.querySelector('#message-body'),'<div style="background-color:${background}"><p>Fictional authored surface</p><img src="http://it/missing.png"></div>',{dark:${dark},title:'Missing image contrast',loadImages:async()=>({images:{},errors:{'http://it/missing.png':'HTTP 404'}}),openLink(){}})`);
      await waitFor('Boolean(document.querySelector("#message-body iframe")?.contentDocument?.querySelector(".aster-image-unavailable"))');
      const contrast = await js(`(()=>{const f=document.querySelector('#message-body iframe'),n=f.contentDocument.querySelector('.aster-image-unavailable'),v=f.contentWindow;const rgb=s=>s.match(/[\\d.]+/g).slice(0,3).map(Number),l=s=>rgb(s).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4}).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);const a=l(v.getComputedStyle(n).color),b=l(v.getComputedStyle(n.parentElement).backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);})()`);
      assert.ok(contrast>=4.5, `Missing-image labels remain readable on ${background} with dark=${dark}: ${contrast}`);
    }
    await js(`window.beaconLoads=0;window.asterRichContent.render(document.querySelector('#message-body'),'<p>Actual content</p><img width="1" height="1" src="http://www.google-analytics.com/collect?v=1&amp;tid=fictional">',{dark:true,title:'Tracking image',loadImages:async()=>{beaconLoads++;return{images:{},errors:{}}},openLink(){}})`);
    await waitFor('document.querySelector("#message-body iframe")?.contentDocument?.querySelector("p")?.textContent==="Actual content"');
    assert.equal(await js('beaconLoads'),0,'Known analytics pixels are not requested');
    assert.equal(await js('document.querySelector("#message-body iframe").contentDocument.querySelectorAll("img,.aster-image-unavailable").length'),0,'Invisible analytics pixels create no broken-image labels');
    await js(`window.asterRichContent.render(document.querySelector('#message-body'),'<html><body><p><br></p></body></html>',{dark:true,title:'Empty',openLink(){}})`);
    assert.equal(await js('document.querySelector("#message-body").children.length'),0,'Empty meeting responses have no artificial white rectangle');
    await js(`window.asterRichContent.render(document.querySelector('#message-body'),'<p style="color:#111111">Short text without background</p>',{dark:true,title:'Plain HTML',openLink(){}})`);
    await waitFor('document.querySelector("#message-body iframe")?.contentDocument?.querySelector("p")?.textContent==="Short text without background"');
    await new Promise(resolve=>setTimeout(resolve,60));
    assert.equal(await js(`(()=>{const f=document.querySelector('#message-body iframe'),v=f.contentWindow;return v.getComputedStyle(f.contentDocument.body).backgroundColor==='rgba(0, 0, 0, 0)' && v.getComputedStyle(f.contentDocument.querySelector('p')).color===v.getComputedStyle(f.contentDocument.body).color && f.offsetHeight<100;})()`),true,'Unstyled HTML follows the theme and fits its content');
    await js(`window.asterRichContent.render(document.querySelector('#message-body'),'<html><body bgcolor="#ffffff"><table style="width:100%"><tr><td>Full width table</td></tr></table></body></html>',{dark:true,title:'Authored background',openLink(){}})`);
    await waitFor('document.querySelector("#message-body iframe")?.contentDocument?.querySelector("td")?.textContent==="Full width table"');
    assert.equal(await js(`(()=>{const f=document.querySelector('#message-body iframe'),d=f.contentDocument;return f.contentWindow.getComputedStyle(d.body).backgroundColor==='rgb(255, 255, 255)' && Math.abs(d.querySelector('table').getBoundingClientRect().width-d.body.clientWidth)<2;})()`),true,'Explicit body backgrounds and full-width table layouts are preserved');
    await fs.writeFile(path.join(output,'authored-background.png'),(await window.webContents.capturePage()).toPNG());
    console.log('PASS: dark signature contrast for hex/named/HSL/alpha/nested/legacy colors, preserved emphasis/transparency, light colors and original outgoing markup.');
  } finally { window?.destroy(); await fs.rm(profile,{recursive:true,force:true,maxRetries:3}); }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
