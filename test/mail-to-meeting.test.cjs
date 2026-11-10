const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../src/mail-to-meeting.js');
const message = { id: 'mail+/=&id=other', subject: 'Re: Budget <review>', from: { name: 'Alex', email: 'alex@example.com' }, to: [{ email: 'own@example.com' }, { email: 'to@example.com' }, { email: 'TO@example.com' }], cc: [{ email: 'alias@example.com' }, { email: 'cc@example.com' }], bcc: [{ email: 'secret@example.com' }] };
test('mail-to-meeting suggests visible participants only, excludes own aliases and deduplicates case-insensitively', () => {
  const draft = M.draft(message, { ownEmails: ['own@example.com', 'ALIAS@example.com'], text: 'Plain text' });
  assert.equal(draft.title, message.subject);
  assert.equal(draft.attendees, 'alex@example.com, to@example.com, cc@example.com');
  assert.doesNotMatch(draft.body, /secret@example.com/); assert.doesNotMatch(draft.attendees, /own@|alias@|secret@/);
  assert.equal(draft.unknownIdentity, false); assert.equal(draft.omittedRecipients, false);
});
test('sent mail and mail from an own alias address the original visible recipients, never the author or Bcc', () => {
  for (const [from, sent] of [['own@example.com', false], ['unlisted-sender@example.com', true]]) {
    const draft = M.draft({ ...message, from: { email: from } }, { ownEmails: ['own@example.com', 'alias@example.com'], sent });
    assert.equal(draft.attendees, 'to@example.com, cc@example.com');
  }
});
test('unknown identity leaves attendees empty, and unresolved or invalid addresses are disclosed and excluded', () => {
  assert.equal(M.draft(message).attendees, ''); assert.equal(M.draft(message).unknownIdentity, true);
  const draft = M.draft({ ...message, from: { name: 'Unresolved Exchange person', email: '' }, cc: [{ email: 'not-an-email' }, { email: ' valid@example.com ' }] }, { ownEmails: ['own@example.com'] });
  assert.equal(draft.attendees, 'to@example.com, valid@example.com'); assert.equal(draft.omittedRecipients, true);
});
test('source links stay on the normalized HTTPS OWA origin and encode the complete item ID', () => {
  const link = new URL(M.sourceLink('https://mail.example.com/owa/', message.id));
  assert.equal(link.origin, 'https://mail.example.com'); assert.equal(link.pathname, '/owa/');
  assert.equal(link.searchParams.get('ItemID'), message.id); assert.equal(link.searchParams.get('id'), null);
  assert.equal(link.searchParams.get('viewmodel'), 'ReadMessageItem');
  for (const server of ['http://mail.example.com', 'https://user:secret@mail.example.com', 'https://mail.example.com/?password=secret', 'https://mail.example.com/other']) assert.equal(M.sourceLink(server, message.id), '');
  for (const id of ['', null, 'x'.repeat(16001), 'mail\n']) assert.equal(M.sourceLink('https://mail.example.com', id), '');
});
test('the draft keeps original subject/body content, bounds quoted text and discloses truncation', () => {
  const draft = M.draft(message, { ownEmails: ['own@example.com'], address: 'https://mail.example.com', text: 'x'.repeat(16001), received: 'Fictional date' });
  assert.equal(draft.truncated, true); assert.ok(draft.body.endsWith('x'.repeat(16000))); assert.ok(draft.body.includes(draft.sourceUrl));
  assert.match(draft.body, /Re: Budget <review>/); assert.match(draft.body, /Fictional date/);
});
function renderer(identity) {
  const state = { selected: message, account: {}, generation: 1, query: '', folder: 'inbox', folders: [], demo: false };
  const calls = [], form = { elements: Object.fromEntries(['title', 'attendees', 'body'].map(key => [key, { focus() {} }])), dataset: {}, prepend(note) { this.note = note; } };
  let opens = 0, dirty = 0;
  const context = vm.createContext({ state, tr: value => value, modalBusy: false, modalSequence: 0, messageOpenSequence: 1,
    isDraftMessage: () => false, $: selector => selector === '#modal' ? { open: false } : form,
    api: async operation => { calls.push(operation); return identity(); }, errorText: error => error.message,
    window: { asterMailToMeeting: M }, dateFormat: () => 'Fictional date', meetingPlainBody: () => 'Plain body',
    eventModal() { opens++; }, markModalDirty() { dirty++; }, document: { createElement: () => ({ setAttribute() {} }) },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/mail-to-meeting-ui.js'), 'utf8'), context);
  return { context, state, form, calls, get opens() { return opens; }, get dirty() { return dirty; } };
}
test('preparing a meeting only reads identity and fills the existing form; it never submits or sends', async () => {
  const f = renderer(async () => ({ emails: ['own@example.com', 'alias@example.com'] }));
  f.state.account.server = 'https://mail.example.com';
  await f.context.meetingFromMail({ isConnected: true });
  assert.deepEqual(f.calls, ['identity']); assert.equal(f.opens, 1); assert.equal(f.dirty, 1);
  assert.equal(f.form.elements.title.value, message.subject); assert.equal(f.state.selected, message);
  assert.equal(f.form.elements.attendees.value, 'alex@example.com, to@example.com, cc@example.com');
});
test('late identity reads never replace another mail, account, view or dialog', async () => {
  for (const change of [f => { f.state.selected = { id: 'another' }; }, f => { f.state.account = {}; }, f => { f.state.generation++; }, f => { f.context.modalSequence++; }]) {
    let finish; const f = renderer(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.context.meetingFromMail({ isConnected: true }); change(f); finish({ emails: ['own@example.com'] }); await pending;
    assert.equal(f.opens, 0); assert.equal(f.dirty, 0);
  }
});
test('identity failure still permits a manual draft and reports the failure without guessing attendees', async () => {
  const f = renderer(async () => { throw new Error('Fictional identity failure'); }); f.state.account.server = 'https://mail.example.com';
  await f.context.meetingFromMail({ isConnected: true });
  assert.equal(f.opens, 1); assert.equal(f.form.elements.attendees.value, ''); assert.match(f.form.note.textContent, /Fictional identity failure/);
});
