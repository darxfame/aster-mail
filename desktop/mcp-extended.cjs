const P = require('./protocol.cjs');
const C = require('./calendar-events.cjs');
const recipients = require('../src/recipients.js');
const tr = require('../src/i18n.js').text;
const str = (maxLength = 16000) => ({ type: 'string', minLength: 1, maxLength });
const text = maxLength => ({ type: 'string', maxLength, pattern: '^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]*$' });
const choice = values => ({ type: 'string', enum: values });
const integer = (minimum = 0, maximum = 1000000) => ({ type: 'integer', minimum, maximum });
const bool = { type: 'boolean' }, session = { sessionId: str(200) };
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const list = (items, maxItems = 100) => ({ type: 'array', items, minItems: 0, maxItems });
const ref = object({ id: str(), changeKey: str() }, ['id']);
const scope = choice(['single', 'series']);
const attachment = object({ handle: str(100), sourceId: str(), sourceKind: choice(['mail', 'meeting']), attachmentId: str(), inline: bool, contentId: str(160) });
const compose = { to: list(str(254), 100), cc: list(str(254), 100), bcc: list(str(254), 100), subject: text(10000), body: text(1000000), bodyHtml: text(1000000), kind: choice(['new', 'reply', 'reply-all', 'forward']), reference: ref, replaceBody: bool, signature: choice(['auto', 'none']), attachments: list(attachment) };
const meetingWrites = new Set(['respond_meeting', 'remove_meeting', 'message_meeting']);
const sends = new Set(['send_mail', 'send_draft', ...meetingWrites]);
const globals = new Set(['get_client_settings', 'client_action', 'open_client_panel', 'list_modules', 'manage_module', 'run_module_command']);
const clientActions = ['save_settings', 'set_presentation', 'test_notification', 'dismiss_mail_alert', 'clear_mail_cache', 'check_updates', 'download_update', 'pause_update_download', 'cancel_update_download', 'cancel_update_install', 'install_update', 'save_update_preferences', 'open_link', 'show_app', 'show_widget', 'hide_widget', 'disconnect', 'reset_local_data', 'quit'];
const settings = { mail: bool, meetings: bool, sounds: bool, preview: bool, autoPrivacy: bool, mailTextPreview: bool, debugErrors: bool, privacyApps: list(str(100), 20), minutes: { ...integer(0, 30), enum: [0, 5, 10, 15, 30] }, timeZone: str(100), theme: choice(['light', 'dark']), language: choice(['ru', 'en']), interfaceScale: { type: 'number', minimum: 0.8, maximum: 2 }, workSchedule: object({ days: list(integer(0, 6), 7), start: str(5), end: str(5) }, ['days', 'start', 'end']), meetingMinutes: list(integer(0, 1440), 16), navigationPlacement: choice(['sidebar', 'bottom']), calendarView: choice(['auto', 'day', 'week', 'quarter']), sidebarHidden: bool, mailListWidth: integer(260, 720) };
const definitions = [
  ['get_identity', 'Read the active mailbox email addresses, never credentials.', session, ['sessionId'], false],
  ['get_content_images', 'Resolve inline and external raster images for a mail message or meeting using the existing isolated image transport and account-local cache.', { ...session, sourceId: str(), sourceKind: choice(['mail', 'meeting']) }, ['sessionId', 'sourceId'], false],
  ['send_mail', 'Send new mail, reply, reply-all or forward, with To/Cc/Bcc, plain text or sanitized HTML and attachments. Reply recipients default to the existing client algorithm. Native confirmation is disabled: agent/harness handles user authorization. Never retry an uncertain send.', { ...session, ...compose }, ['sessionId', 'body'], true],
  ['create_draft', 'Save a new server draft, including replies/forwards and attachments. Find its ID in drafts afterwards if Exchange returns no ID.', { ...session, ...compose }, ['sessionId', 'body'], true],
  ['read_draft', 'Read an editable ordinary mail draft including all recipients, full body, attachment metadata and current ChangeKey.', { ...session, id: str() }, ['sessionId', 'id'], false],
  ['update_draft', 'Save changes to the same server draft. Requires the exact ChangeKey from read_draft. Unspecified fields and existing attachments are preserved.', { ...session, id: str(), expectedChangeKey: str(), changes: object(compose) }, ['sessionId', 'id', 'expectedChangeKey', 'changes'], true],
  ['send_draft', 'Send an existing server draft with optional changes/new attachments, exact ChangeKey required. Native confirmation disabled; agent/harness handles authorization. Never retry an uncertain result.', { ...session, id: str(), expectedChangeKey: str(), changes: object(compose) }, ['sessionId', 'id', 'expectedChangeKey'], true],
  ['mail_action', 'Change read/unread, flag, importance, archive or trash for selected mail. Trash is a recoverable move, never permanent deletion.', { ...session, action: choice(['read', 'unread', 'flag', 'unflag', 'important', 'normal', 'archive', 'trash']), refs: list(ref) }, ['sessionId', 'action', 'refs'], true],
  ['folder_action', 'Mark a folder read (suppress receipts), rename a user folder, or move it to Deleted Items. System-folder protections remain enforced.', { ...session, action: choice(['read', 'rename', 'trash']), folder: str(), name: str(255), expectedChangeKey: str() }, ['sessionId', 'action', 'folder'], true],
  ['upload_attachment', 'Upload base64 chunks (up to 1 MiB encoded each) into account-owned memory. First chunk: name/type, offset=0. Continue with handle and exact byte offset. final=true completes. Total memory 20 MiB, 30-minute TTL. No local paths.', { ...session, name: str(255), type: str(200), content: { type: 'string', maxLength: 1048576 }, offset: integer(0, 20971520), handle: str(100), final: bool }, ['sessionId', 'content', 'offset'], false],
  ['select_attachments', 'Let the user select local files in Aster. Returns memory handles to use when sending; no filesystem paths are exposed.', session, ['sessionId'], false],
  ['release_attachment', 'Discard an uploaded/picked attachment from memory.', { ...session, handle: str(100) }, ['sessionId', 'handle'], false],
  ['read_attachment', 'Read a mail/meeting attachment as base64 chunks after verifying it belongs to the source. No disk persistence. offset is decoded bytes; default length 256 KiB.', { ...session, sourceId: str(), sourceKind: choice(['mail', 'meeting']), attachmentId: str(), offset: integer(0, 31457280), length: integer(1, 524288) }, ['sessionId', 'sourceId', 'attachmentId'], false],
  ['attachment_action', 'Preview/open an attachment in Aster or its system application, or explicitly Save As using a native picker. Source ownership and active-file protections apply.', { ...session, ...attachment.properties, action: choice(['preview', 'open', 'save', 'close_preview']) }, ['sessionId', 'action'], true],
  ['search_contacts', 'Search Exchange GAL by name/email, or list saved contacts when query is empty. Does not translate names.', { ...session, query: { type: 'string', maxLength: 1000 }, offset: integer() }, ['sessionId'], false],
  ['create_contact', 'Create an Exchange contact with name, email, company and phone.', { ...session, name: str(2000), email: str(254), company: text(2000), phone: str(200) }, ['sessionId', 'name', 'email'], true],
  ['contact_history', 'Read verified mail history for one exact contact email, up to 200 candidates. Returns server pagination and completeness limits.', { ...session, email: str(254), offset: integer(0, 199) }, ['sessionId', 'email'], false],
  ['contact_photo', 'Get the client-validated raster contact photo from the account-local cache.', { ...session, email: str(254) }, ['sessionId', 'email'], false],
  ['meeting_conflicts', 'Check actual calendar conflicts for one meeting, excluding itself. Unknown/truncated data stays unknown.', { ...session, id: str() }, ['sessionId', 'id'], false],
  ['respond_meeting', 'Accept, tentatively accept or decline one meeting/occurrence or a series. Native confirmation disabled; authorize in agent/harness. Does not infer acceptance from reading.', { ...session, id: str(), scope, response: choice(['accept', 'tentative', 'decline']) }, ['sessionId', 'id', 'scope', 'response'], true],
  ['remove_meeting', 'Cancel an organizer meeting or move the user copy to Deleted Items, with exact scope/version. Native confirmation disabled; agent/harness handles authorization. No retries.', { ...session, id: str(), scope, expectedChangeKey: str() }, ['sessionId', 'id', 'scope', 'expectedChangeKey'], true],
  ['message_meeting', 'Reply, reply-all or forward a meeting using its current reference and forwarding permissions. Native confirmation disabled; agent/harness handles authorization.', { ...session, id: str(), scope, kind: choice(['reply', 'reply-all', 'forward']), to: list(str(254), 100), body: text(1000000) }, ['sessionId', 'id', 'scope', 'kind', 'body'], true],
  ['join_meeting', 'Open the meeting link through the existing approved application routing in Aster.', { ...session, id: str() }, ['sessionId', 'id'], true],
  ['get_auto_replies', 'Read Exchange automatic replies and their revision before editing.', session, ['sessionId'], false],
  ['set_auto_replies', 'Update automatic replies using the previously read revision. Plain-text replies are escaped; external audience policy is preserved.', { ...session, revision: str(64), state: choice(['Disabled', 'Enabled', 'Scheduled']), audience: choice(['None', 'Known', 'All']), start: str(24), end: str(24), internal: text(32000), external: text(32000) }, ['sessionId', 'revision', 'state', 'audience'], true],
  ['get_quick_replies', 'Read quick-reply templates and their revision.', session, ['sessionId'], false],
  ['set_quick_replies', 'Replace quick-reply templates using the current revision; up to 30 templates, 64 KiB total.', { ...session, revision: integer(), replies: list(object({ id: str(80), title: str(100), body: text(8000) }, ['id', 'title', 'body']), 30) }, ['sessionId', 'revision', 'replies'], true],
  ['get_mail_reminders', 'List local mail reminders with tokens and current subject metadata.', session, ['sessionId'], false],
  ['set_mail_reminder', 'Schedule a local reminder for a message at a future UTC instant.', { ...session, id: str(), due: str(24) }, ['sessionId', 'id', 'due'], true],
  ['remove_mail_reminder', 'Remove a local mail reminder using its current token.', { ...session, id: str(), token: str(100) }, ['sessionId', 'id', 'token'], true],
  ['get_waiting_replies', 'List tracked sent messages and detected replies; refresh checks the bounded current inbox page.', { ...session, refresh: bool }, ['sessionId'], false],
  ['wait_for_reply', 'Track a verified sent message until the future UTC deadline.', { ...session, id: str(), due: str(24) }, ['sessionId', 'id', 'due'], true],
  ['remove_waiting_reply', 'Remove a message from reply tracking.', { ...session, id: str() }, ['sessionId', 'id'], true],
  ['set_meeting_reminders', 'Set/remove Aster-local reminder minutes for an exact meeting occurrence.', { ...session, id: str(), start: str(24), minutes: list(integer(0, 1440), 16), custom: bool }, ['sessionId', 'id', 'start', 'minutes', 'custom'], true],
  ['get_signature', 'Read the local signature, sync preference and OWA signature. No account credentials are returned.', session, ['sessionId'], false],
  ['set_signature', 'Set the local plain-text signature and whether to use the OWA signature. Does not change the server signature.', { ...session, signature: text(32000), sync: bool }, ['sessionId', 'signature', 'sync'], true],
  ['get_colleagues', 'Read pinned colleagues from the account-owned encrypted local profile.', session, ['sessionId'], false],
  ['set_colleagues', 'Replace pinned colleagues in the account-owned encrypted profile.', { ...session, people: list(object({ name: str(2000), email: str(254), company: text(2000) }, ['name', 'email']), 50) }, ['sessionId', 'people'], true],
  ['get_client_settings', 'Read notification/interface preferences, public update state and alerts. Works before Exchange login. No credentials/profile secrets.', {}, [], false],
  ['client_action', 'Use existing client controls: settings/privacy/notifications, updates, links, cache, widget, logout/reset/quit. Uses existing dirty-editor and lifecycle guards. Update installation/download and other changes retain Aster confirmation.', { action: choice(clientActions), settings: object(settings), enabled: bool, minutes: integer(15, 120), kind: choice(['mail', 'meeting']), id: str(), url: str(4000), autoCheck: bool }, ['action'], true],
  ['open_client_panel', 'Open an existing Aster panel without overwriting an open dialog. Account login, module installation (Connect click), service sign-in and module settings stay in their original UI. Also supports compose/meeting/contact panels.', { panel: choice(['settings', 'modules', 'account', 'signature', 'auto-replies', 'notifications', 'updates', 'quick-replies', 'waiting-replies', 'mail-reminders', 'directory', 'compose', 'meeting', 'contact']) }, ['panel'], false],
  ['list_modules', 'List installed module manifests and public commands, without module storage or credentials. Works before Exchange login.', {}, [], false],
  ['manage_module', 'Enable, disable or remove an installed module using existing isolated module lifecycle and grants. Installation/sign-in remain in the original modules panel.', { id: str(80), action: choice(['enable', 'disable', 'remove']) }, ['id', 'action'], true],
  ['run_module_command', 'Run a declared command of an installed module with existing sandbox permissions. Never grants new permissions or bypasses module settings/sign-in UI.', { id: str(80), command: str(80), input: { type: 'object', additionalProperties: true } }, ['id', 'command'], true],
];
async function file(input, ctx) {
  const { client, guard, files, owner } = ctx;
  if (input.handle) {
    if (input.sourceId || input.attachmentId) throw new Error('Choose one attachment source');
    const value = files.get(input.handle, owner);
    if (!value.complete) throw new Error('Attachment upload is incomplete');
    return value;
  }
  if (!input.sourceId || !input.attachmentId) throw new Error('Supply an attachment handle or source and attachment IDs');
  const source = input.sourceKind === 'meeting' ? await client.eventDetails({ id: input.sourceId }) : await client.message({ id: input.sourceId, refresh: true }); guard();
  const attachment = source.attachments.find(attachment => attachment.id === input.attachmentId);
  if (!attachment || attachment.size > 30 * 1024 * 1024) throw new Error('Attachment does not belong to this source or exceeds 30 MiB');
  const bytes = await client.attachment(attachment.id); guard();
  if (!Buffer.isBuffer(bytes) || bytes.length > 30 * 1024 * 1024) throw new Error('Invalid or oversized attachment');
  return { name: attachment.name, type: attachment.type, bytes };
}
async function mail(input, ctx, original) {
  const data = { ...input, kind: input.kind || 'new', subject: input.subject ?? original?.subject ?? '', body: input.body ?? original?.text ?? '', attachments: [] };
  for (const key of ['to', 'cc', 'bcc']) data[key] = input[key] === undefined ? (original?.[key] || []).map(person => person.email).join(',') : input[key].join(',');
  if (original && input.body === undefined && input.bodyHtml === undefined) data.bodyHtml = original.html || undefined;
  if (input.reference && ['reply', 'reply-all', 'forward'].includes(data.kind)) {
    const source = await ctx.client.message({ id: input.reference.id, refresh: true }); ctx.guard();
    data.reference = { id: source.id, changeKey: source.changeKey };
    if (!data.reference.changeKey) throw new Error('Missing fresh source ChangeKey');
    if (input.subject === undefined) data.subject = `${data.kind === 'forward' ? 'Fwd: ' : 'Re: '}${source.subject.replace(/^(Re|Fwd):\s*/i, '')}`;
    if (data.kind.startsWith('reply')) {
      const identity = await ctx.client.identity(); ctx.guard();
      const own = identity.emails || [identity.email].filter(Boolean);
      const folders = await ctx.client.folders(); ctx.guard();
      const sent = folders.some(folder => folder.wellKnown === 'sentitems' && folder.id === source.parentId);
      if (data.kind === 'reply-all' && !own.length && !sent) throw new Error('Cannot identify current mailbox for reply-all');
      const defaults = recipients.reply(source, own, data.kind === 'reply-all', sent);
      for (const key of ['to', 'cc', 'bcc']) if (input[key] === undefined) data[key] = defaults[key] || '';
    }
  } else if (data.kind !== 'new' || input.reference) throw new Error('A reply/forward requires one source reference');
  if (data.bodyHtml !== undefined) data.bodyHtml = await ctx.host.sanitize(data.bodyHtml, ctx.guard);
  if (!original && input.signature !== 'none' && ctx.host.signature) {
    const signature = await ctx.host.signature(data.kind, ctx.guard); ctx.guard();
    if (signature) {
      data.body += `\n\n${signature.text || ''}`;
      if (signature.html || data.bodyHtml) data.bodyHtml = await ctx.host.sanitize(`${data.bodyHtml || `<div style="white-space:pre-wrap">${P.escapeXML(input.body || '')}</div>`}<div>${signature.html || P.escapeXML(signature.text || '').replace(/\n/g, '<br>')}</div>`, ctx.guard);
      data.attachments.push(...(signature.attachments || []));
    }
  }
  let size = original?.attachments?.reduce((sum, attachment) => sum + attachment.size, 0) || 0;
  size += data.attachments.reduce((sum, attachment) => sum + Buffer.from(attachment.content, 'base64').length, 0);
  if (size > 20 * 1024 * 1024) throw new Error('Attachments exceed 20 MiB');
  for (const attachment of input.attachments || []) {
    const value = await file(attachment, ctx); ctx.guard(); size += value.bytes.length;
    if (size > 20 * 1024 * 1024) throw new Error('Attachments exceed 20 MiB');
    const prepared = { name: value.name, type: value.type, content: value.bytes.toString('base64') };
    if (attachment.inline) {
      if (!/^[a-zA-Z0-9@._-]{1,160}$/.test(attachment.contentId || '')) throw new Error('Invalid inline Content-ID');
      C.imageData({ ContentType: value.type, Content: prepared.content });
      Object.assign(prepared, { inline: true, contentId: attachment.contentId });
    }
    data.attachments.push(prepared);
  }
  for (const key of ['to', 'cc', 'bcc']) P.emails(data[key]);
  return data;
}
async function prepare(name, input, ctx) {
  const { client, guard, host, files, owner } = ctx;
  const invoke = (operation, data = input) => host.invoke(operation, data, guard);
  let perform, detail = '', noConfirm = sends.has(name), lifecycle = globals.has(name);
  if (name === 'send_mail' || name === 'create_draft') {
    const data = await mail(input, ctx); P.sendSOAP(data, name === 'create_draft');
    detail = `${data.to}\nCc: ${data.cc}\nBcc: ${data.bcc}\n${data.subject}\n\n${data.bodyHtml ? P.mailPreview(data.bodyHtml, true) : data.body}\n\n${data.attachments.map(file => `${file.name} (${Buffer.from(file.content, 'base64').length})`).join('\n')}`;
    perform = () => name === 'send_mail' ? client.send(data) : client.draft(data);
  }
  if (name === 'read_draft') perform = () => client.editDraft({ action: 'read', ref: { id: input.id } });
  if (name === 'update_draft' || name === 'send_draft') {
    const original = await client.editDraft({ action: 'read', ref: { id: input.id } }); guard();
    if (original.changeKey !== input.expectedChangeKey) throw new Error('Draft changed. Read it again before editing/sending.');
    if (input.changes?.kind && input.changes.kind !== 'new' || input.changes?.reference) throw new Error('An existing draft cannot become a different reply/forward');
    const data = await mail(input.changes || {}, ctx, original);
    detail = `${data.to}\nCc: ${data.cc}\nBcc: ${data.bcc}\n${data.subject}\n\n${data.bodyHtml ? P.mailPreview(data.bodyHtml, true) : data.body}\n\n${[...original.attachments, ...data.attachments].map(file => file.name).join('\n')}`;
    perform = () => client.editDraft({ ...data, action: name === 'send_draft' ? 'send' : 'save', ref: { id: input.id, changeKey: input.expectedChangeKey } });
  }
  if (name === 'mail_action') {
    if (!input.refs.length || new Set(input.refs.map(ref => ref.id)).size !== input.refs.length) throw new Error('Choose distinct messages');
    detail = `${input.action}: ${input.refs.length}`;
    perform = async () => {
      if (['read', 'unread', 'archive', 'trash'].includes(input.action)) return client.mailBatch(input);
      const results = [];
      for (const ref of input.refs) {
        guard();
        if (results.some(item => item.status === 'uncertain')) { results.push({ id: ref.id, status: 'skipped' }); continue; }
        try { await client.change({ ref, field: ['flag', 'unflag'].includes(input.action) ? 'Flag' : 'Importance', value: ['flag', 'unflag'].includes(input.action) ? input.action === 'flag' : input.action === 'important' ? 'High' : 'Normal' }); results.push({ id: ref.id, status: 'done' }); }
        catch { results.push({ id: ref.id, status: 'uncertain', error: 'Inspect the mailbox before another attempt. Nothing was retried.' }); }
      }
      return { results };
    };
  }
  if (name === 'folder_action') { detail = `${input.action}: ${input.folder}\n${input.name || ''}`; perform = () => client.folderOperation(input); }
  if (name === 'upload_attachment') perform = () => files.upload(input, owner);
  if (name === 'release_attachment') perform = () => files.remove(input.handle, owner);
  if (name === 'select_attachments') perform = () => host.pickFiles(files, owner, guard);
  if (name === 'read_attachment') {
    const value = await file(input, ctx); guard();
    const offset = input.offset || 0, chunk = value.bytes.subarray(offset, offset + (input.length || 262144));
    if (offset > value.bytes.length) throw new Error('Attachment offset exceeds size');
    perform = () => ({ name: value.name, type: value.type, size: value.bytes.length, offset, nextOffset: offset + chunk.length, more: offset + chunk.length < value.bytes.length, content: chunk.toString('base64') });
  }
  if (name === 'attachment_action') { const value = input.action === 'close_preview' ? null : await file(input, ctx); guard(); perform = () => host.attachment(input.action, value, guard); noConfirm = true; }
  if (name === 'search_contacts') perform = () => client.contacts({ query: input.query || '', offset: input.offset || 0 });
  if (name === 'get_identity') perform = () => client.identity();
  if (name === 'get_content_images') perform = () => client.contentImages({ ref: { id: input.sourceId }, kind: input.sourceKind === 'meeting' ? 'event' : 'message' });
  if (name === 'create_contact') { P.emails(input.email); detail = `${input.name}\n${input.email}\n${input.company || ''}\n${input.phone || ''}`; perform = () => client.createContact(input); }
  if (name === 'contact_history') perform = () => require('./contact-history.cjs').read(client, input, guard);
  if (name === 'contact_photo') perform = () => client.personPhoto({ email: input.email });
  if (name === 'meeting_conflicts') perform = () => client.eventConflicts({ ref: { id: input.id } });
  if (name === 'respond_meeting') perform = () => client.respond({ ref: { id: input.id }, scope: input.scope, response: { accept: 'AcceptItem', tentative: 'TentativelyAcceptItem', decline: 'DeclineItem' }[input.response] });
  if (name === 'remove_meeting') {
    const current = await client.eventDetails({ id: input.id, scope: input.scope }); guard();
    if (current.changeKey !== input.expectedChangeKey) throw new Error('Meeting changed. Read the same scope again.');
    C.removeRequest(current);
    perform = () => client.removeEvent({ ref: { id: input.id }, scope: input.scope, expectedChangeKey: input.expectedChangeKey });
  }
  if (name === 'message_meeting') {
    const data = { ref: { id: input.id }, scope: input.scope, kind: input.kind, body: input.body, to: (input.to || []).join(',') };
    const current = await client.eventDetails({ id: input.id, scope: input.scope }); guard(); C.messageSOAP(current, data);
    perform = () => client.eventMessage(data);
  }
  if (name === 'join_meeting') { perform = () => invoke('joinEvent', { id: input.id }); noConfirm = true; }
  const direct = { get_auto_replies: 'autoReplies', set_auto_replies: 'saveAutoReplies', get_quick_replies: 'quickReplies', set_quick_replies: 'saveQuickReplies', set_mail_reminder: 'setMailReminder', remove_mail_reminder: 'removeMailReminder', wait_for_reply: 'waitForReply', remove_waiting_reply: 'removeWaitingReply' };
  if (direct[name]) perform = () => invoke(direct[name]);
  if (name === 'get_mail_reminders') perform = async () => ({ ...await invoke('mailReminders'), ...await invoke('mailReminderSubjects') });
  if (name === 'get_waiting_replies') perform = () => invoke(input.refresh ? 'refreshWaitingReplies' : 'waitingReplies');
  if (name === 'set_meeting_reminders') { perform = () => invoke('saveMeetingReminders', { ...input, ref: { id: input.id } }); noConfirm = true; }
  if (['get_signature', 'set_signature', 'get_colleagues', 'set_colleagues'].includes(name)) perform = () => host.local(name, input, guard);
  if (name === 'get_client_settings') perform = () => host.settings(guard);
  if (name === 'client_action') perform = () => host.action(input, guard);
  if (name === 'open_client_panel') perform = () => host.panel(input.panel, guard);
  if (name === 'list_modules') perform = () => invoke('moduleCatalog', {});
  if (name === 'manage_module') perform = () => invoke(input.action === 'remove' ? 'moduleRemove' : 'moduleConfigure', { id: input.id, enabled: input.action === 'enable' });
  if (name === 'run_module_command') perform = () => invoke('moduleInvoke', { id: input.id, command: input.command, input: input.input || {} });
  if (!perform) throw new Error('Unknown extended MCP tool');
  const reviewed = Object.fromEntries(Object.entries(input).filter(([key]) => !['sessionId', 'revision', 'expectedChangeKey', 'token'].includes(key)));
  return { perform, noConfirm, lifecycle, prompt: { message: tr('MCP: выполнить изменение?'), detail: detail || `${name}\n${JSON.stringify(reviewed, null, 2)}` } };
}
module.exports = { definitions, prepare, globals, meetingWrites, sends };
