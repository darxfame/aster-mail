// Exercise participant editing in Chromium with fictional demo data only.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const protocol = require('../desktop/protocol.cjs');
const root = path.resolve(__dirname, '..');
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'aster-participants-'));
app.setPath('userData', profile); app.on('window-all-closed', () => {});
let window;
app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({ show: true, width: 1280, height: 1000, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    const js = code => window.webContents.executeJavaScript(code);
    await window.loadFile(path.join(root, 'src/index.html'));
    await js('document.querySelector("[data-action=demo]").click()');
    for (const type of ['Resp.Pos', 'Resp.Neg', 'Resp.Tent', 'Notification.Forward']) {
      const mail = protocol.message({ ItemId: { Id: `fictional-${type}` }, ItemClass: `IPM.Schedule.Meeting.${type}`, Subject: 'Fictional meeting response',
        AssociatedCalendarItemId: { Id: 'fictional-calendar', ChangeKey: 'fresh' }, Start: '2026-11-17T12:00:00Z', End: '2026-11-17T13:00:00Z', Body: { BodyType: 'Text', Value: 'Fictional participant response.' } });
      await js(`state.messages.push(${JSON.stringify(mail)});openMessage(${JSON.stringify(mail.id)})`);
      assert.equal(await js('document.querySelectorAll("#reader .meeting-banner,#reader .eyebrow").length'), 0);
      assert.equal(await js('document.querySelector("#reader .plain-body").textContent'), 'Fictional participant response.');
    }
    await js('openMeeting(window.asterDemo.events.find(event => event.isOrganizer))');
    await js('editMeeting()');
    const original = await js('meetingFormValues(document.querySelector("#event-form"))');
    const optional = original.optionalAttendees.split(', ')[0];
    assert.equal(await js('document.querySelector("#event-form").elements.sendUpdates.options[1].disabled'), true);
    const choose = async (field, email) => {
      await js(`(() => { const input=document.querySelector('#event-form').elements[${JSON.stringify(field)}]; input.value+=', '+${JSON.stringify(email.slice(0, 4))}; input.focus(); input.setSelectionRange(input.value.length,input.value.length); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
      await js(`(() => {const input=document.querySelector('#event-form').elements[${JSON.stringify(field)}]; input.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true})); input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));})()`);
    };
    await choose('attendees', optional);
    assert.equal(await js('document.querySelector("#event-form").elements.sendUpdates.options[1].disabled'), false);
    await js(`(() => {const form=document.querySelector('#event-form');form.elements.sendUpdates.value='changed';form.elements.title.value+=' changed';form.elements.title.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await js('document.querySelector("#event-form").elements.sendUpdates.value'), 'all');
    assert.equal(await js('document.querySelector("#event-form").elements.sendUpdates.options[1].disabled'), true);
    await js(`(() => {const form=document.querySelector('#event-form');form.elements.title.value=${JSON.stringify(original.title)};form.elements.title.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    assert.equal(await js(`document.querySelector('#event-form').elements.optionalAttendees.value.includes(${JSON.stringify(optional)})`), false);
    assert.equal(await js(`document.querySelector('#event-form').elements.attendees.value.includes(${JSON.stringify(optional)})`), true);
    // Real DOM/DataTransfer events test both drop directions, cancellation and locked fields.
    const drag = (source, target, email, cancel = false) => js(`(() => {
      const form=document.querySelector('#event-form'), from=form.elements[${JSON.stringify(source)}], to=form.elements[${JSON.stringify(target)}];
      const card=[...from.closest('.field').querySelectorAll('.participant-card')].find(card=>card.textContent===${JSON.stringify(email)});
      const dataTransfer=new DataTransfer();
      card.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
      if (${cancel}) { card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer})); return; }
      const field=to.closest('.field'); field.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer}));
      field.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));
      card.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));
    })()`);
    await drag('attendees', 'optionalAttendees', optional, true);
    assert.equal(await js(`document.querySelector('#event-form').elements.attendees.value.includes(${JSON.stringify(optional)})`), true);
    await js('document.querySelector("#event-form").elements.optionalAttendees.disabled=true');
    await drag('attendees', 'optionalAttendees', optional);
    assert.equal(await js(`document.querySelector('#event-form').elements.attendees.value.includes(${JSON.stringify(optional)})`), true);
    await js('document.querySelector("#event-form").elements.optionalAttendees.disabled=false');
    await drag('attendees', 'optionalAttendees', optional);
    assert.equal(await js('document.querySelector("#event-form").elements.optionalAttendees.value'), optional);
    await drag('optionalAttendees', 'attendees', optional);
    assert.equal(await js('document.querySelector("#event-form").elements.optionalAttendees.value'), '');
    // Card activation selects the address in the original editable input, including a middle token.
    await js(`(() => { const input=document.querySelector('#event-form').elements.attendees; input.value='first@example.test, wrong@example.test, last@example.test'; input.dispatchEvent(new Event('input',{bubbles:true})); input.closest('.field').querySelectorAll('.participant-card')[1].click(); })()`);
    assert.equal(await js('document.activeElement.value.slice(document.activeElement.selectionStart,document.activeElement.selectionEnd)'), 'wrong@example.test');
    await window.webContents.insertText('correct@example.test');
    assert.equal(await js('document.querySelector("#event-form").elements.attendees.value'), 'first@example.test, correct@example.test, last@example.test');
    assert.equal(await js('[...document.querySelectorAll(".participant-card")].some(card=>card.textContent==="correct@example.test")'), true);
    const current = await js('meetingFormValues(document.querySelector("#event-form"))');
    for (const key of ['title', 'start', 'end', 'body', 'location']) assert.equal(current[key], original[key]);
    await drag('attendees', 'optionalAttendees', 'last@example.test');
    await js('document.querySelector("#event-form").elements.body.focus(); document.querySelector("#event-form").elements.attendees.scrollIntoView({block:"center"})');
    assert.equal(await js('[...document.querySelectorAll(".recipient-suggestions")].every(box=>box.hidden)'), true);
    await new Promise(resolve => setTimeout(resolve, 150));
    const output = path.join(root, 'release/meeting-participants-ui'); await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'participants.png'), (await window.webContents.capturePage()).toPNG());
    await js(`window.meetingSave=saveMeetingChanges;saveMeetingChanges=async(edit,changes,sendUpdates)=>{window.sentMeetingUpdate={changes,sendUpdates};};document.querySelector('#event-form').elements.sendUpdates.value='changed';document.querySelector('#event-form').requestSubmit()`);
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(await js('sentMeetingUpdate.sendUpdates'), 'changed');
    assert.equal(await js('Boolean(sentMeetingUpdate.changes.attendees)'), true);
    await js('saveMeetingChanges=meetingSave;void 0');
    console.log('PASS: cross-role search, both drag directions, cancellation, locked fields, editable email and preserved meeting fields.');
  } finally { window?.destroy(); await fs.rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
}).then(() => app.exit(0), error => { console.error(error); app.exit(1); });
