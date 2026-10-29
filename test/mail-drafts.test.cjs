const test = require('node:test');
const assert = require('node:assert/strict');
const { OWAClient } = require('../desktop/owa.cjs');
const soap = body => `<Envelope><ResponseCode>NoError</ResponseCode>${body}</Envelope>`;
const original = '<Message><ItemId Id="draft&amp;id" ChangeKey="old&amp;key"/><ItemClass>IPM.Note</ItemClass><IsDraft>true</IsDraft><Subject>Draft &amp; subject</Subject><Body BodyType="HTML">  &lt;p&gt;Full body&lt;/p&gt;  </Body><ToRecipients><Mailbox><Name>Anna</Name><EmailAddress>anna@example.com</EmailAddress></Mailbox></ToRecipients><CcRecipients><Mailbox><EmailAddress>cc@example.com</EmailAddress></Mailbox></CcRecipients><BccRecipients><Mailbox><EmailAddress>hidden@example.com</EmailAddress></Mailbox></BccRecipients><Attachments><FileAttachment><AttachmentId Id="retained"/><Name>logo.png</Name><Size>8</Size><ContentType>image/png</ContentType><ContentId>logo@example.com</ContentId><IsInline>true</IsInline></FileAttachment></Attachments></Message>';
function fixture({raw = original, fail = '', update = '<Message><ItemId Id="draft&amp;id" ChangeKey="updated&amp;key"/></Message>', attached = '<FileAttachment><AttachmentId Id="new" RootItemId="draft&amp;id" RootItemChangeKey="attached&amp;key"/></FileAttachment>'} = {}) {
  const calls = [];
  const client = new OWAClient({server:'https://mail.example.com'}, async (_url, options) => {
    const action = options.headers.SOAPAction.match(/\/([^/]+)"$/)[1];
    calls.push({action,body:options.body});
    if (action === fail) throw new Error('Lost response');
    return {status:200,text:soap(action === 'GetItem' ? raw : action === 'UpdateItem' ? update : action === 'CreateAttachment' ? attached : '')};
  },async ()=>'canary');
  client.canary = 'canary';
  return {client,calls};
}
const values = {ref:{id:'draft&id',changeKey:'old&key'},to:'anna@example.com',cc:'',bcc:'',subject:'Edited <&>',body:'Plain',bodyHtml:'<p>Edited <strong>body</strong></p>'};
test('draft reading retains the full HTML, all recipients and existing attachment metadata', async () => {
  const {client,calls} = fixture();
  const result = await client.editDraft({action:'read',ref:{id:'draft&id'}});
  assert.equal(result.isDraft,true);
  assert.equal(result.html,'  <p>Full body</p>  ');
  assert.equal(result.subject,'Draft & subject');
  assert.deepEqual(result.to,[{name:'Anna',email:'anna@example.com'}]);
  assert.equal(result.cc[0].email,'cc@example.com');
  assert.equal(result.bcc[0].email,'hidden@example.com');
  assert.deepEqual(result.ref,{id:'draft&id',changeKey:'old&key'});
  assert.deepEqual(result.attachments,[{id:'retained',name:'logo.png',size:8,type:'image/png',contentId:'logo@example.com',inline:true}]);
  assert.deepEqual(calls.map(call=>call.action),['GetItem']);
  assert.match(calls[0].body,/<t:BaseShape>AllProperties<\/t:BaseShape><t:BodyType>HTML<\/t:BodyType>/);
  assert.doesNotMatch(calls[0].body,/MaximumBodySize|ChangeKey=/);
});
test('draft writes reject non-drafts, meeting drafts and stale versions before any mutation', async () => {
  for (const raw of [original.replace('<IsDraft>true</IsDraft>','<IsDraft>false</IsDraft>'),original.replace('IPM.Note','IPM.Schedule.Meeting.Request'),original.replace('<ItemClass>IPM.Note</ItemClass>','')]) {
    const {client,calls} = fixture({raw});
    await assert.rejects(client.editDraft({...values,action:'send'}),/обычный почтовый черновик/);
    assert.deepEqual(calls.map(call=>call.action),['GetItem']);
  }
  for (const changeKey of ['', 'stale']) {
    const {client,calls} = fixture();
    await assert.rejects(client.editDraft({...values,action:'save',ref:{id:'draft&id',changeKey}}),/изменился/);
    assert.deepEqual(calls.map(call=>call.action),['GetItem']);
  }
});
test('missing body and unresolved legacy recipients cannot be silently discarded by a save', async () => {
  for (const raw of [original.replace(/<Body BodyType="HTML">[\s\S]*?<\/Body>/,''),original.replace('<EmailAddress>hidden@example.com</EmailAddress>','<EmailAddress>/o=Example/ou=Users/cn=hidden</EmailAddress><RoutingType>EX</RoutingType>')]) {
    const {client,calls} = fixture({raw});
    await assert.rejects(client.editDraft({...values,action:'save'}),/Продолжите редактирование в OWA/);
    assert.deepEqual(calls.map(call=>call.action),['GetItem']);
  }
});
test('saving updates the same draft with conflict protection and explicitly clears empty recipients', async () => {
  const {client,calls} = fixture();
  assert.deepEqual(await client.editDraft({...values,action:'save'}),{id:'draft&id',changeKey:'updated&key'});
  assert.deepEqual(calls.map(call=>call.action),['GetItem','UpdateItem']);
  assert.match(calls[1].body,/ConflictResolution="NeverOverwrite" MessageDisposition="SaveOnly"/);
  assert.match(calls[1].body,/Id="draft&amp;id" ChangeKey="old&amp;key"/);
  assert.match(calls[1].body,/<t:Subject>Edited &lt;&amp;&gt;<\/t:Subject>/);
  assert.match(calls[1].body,/<t:Body BodyType="HTML">&lt;p&gt;Edited &lt;strong&gt;body&lt;\/strong&gt;&lt;\/p&gt;<\/t:Body>/);
  for (const field of ['CcRecipients','BccRecipients']) assert.match(calls[1].body,new RegExp(`<t:DeleteItemField><t:FieldURI FieldURI="message:${field}"/>`));
  assert.doesNotMatch(calls[1].body,/DeleteAttachment|retained|CreateItem/);
});
test('sending an existing draft retains old attachments and uses the last new attachment version', async () => {
  const {client,calls} = fixture({attached:'<FileAttachment><AttachmentId RootItemId="draft&amp;id" RootItemChangeKey="first"/></FileAttachment><FileAttachment><AttachmentId RootItemId="draft&amp;id" RootItemChangeKey="last&amp;key"/></FileAttachment>'});
  assert.equal(await client.editDraft({...values,action:'send',attachments:[{name:'new.txt',content:'eA=='},{name:'next.txt',content:'eQ=='}]}),true);
  assert.deepEqual(calls.map(call=>call.action),['GetItem','UpdateItem','CreateAttachment','SendItem']);
  assert.match(calls[2].body,/<m:ParentItemId Id="draft&amp;id" ChangeKey="updated&amp;key"\/>/);
  assert.match(calls[2].body,/<t:Name>new.txt<\/t:Name>/);
  assert.doesNotMatch(calls[2].body,/retained|logo.png/);
  assert.match(calls[3].body,/Id="draft&amp;id" ChangeKey="last&amp;key"/);
});
test('plain draft send uses the updated key and accepts only CC or BCC recipients', async () => {
  for (const field of ['cc','bcc']) {
    const {client,calls} = fixture();
    await client.editDraft({...values,action:'send',to:'',[field]:'only@example.com'});
    assert.deepEqual(calls.map(call=>call.action),['GetItem','UpdateItem','SendItem']);
    assert.match(calls[2].body,/ChangeKey="updated&amp;key"/);
  }
});
test('existing and new attachment bytes share the size limit, and malformed new files never mutate', async () => {
  const invalid = [[{name:'x',content:'<invalid>'}],[{name:'x',content:'eA==',inline:'true'}],[{name:'x',content:'eA==',inline:true,contentId:'invalid cid',type:'image/png'}]];
  for (const attachments of invalid) {
    const {client,calls} = fixture();
    await assert.rejects(client.editDraft({...values,action:'save',attachments}),/Некорректн/);
    assert.deepEqual(calls.map(call=>call.action),['GetItem']);
  }
  const {client,calls} = fixture({raw:original.replace('<Size>8</Size>',`<Size>${20 * 1024 * 1024}</Size>`)});
  await assert.rejects(client.editDraft({...values,action:'save',attachments:[{name:'one.txt',content:'eA=='}]}),/20 МБ/);
  assert.deepEqual(calls.map(call=>call.action),['GetItem']);
  for (const raw of [original.replace('<Size>8</Size>',''),original.replace(/<Attachments>[\s\S]*?<\/Attachments>/,'<HasAttachments>true</HasAttachments>')]) {
    const missing = fixture({raw});
    await assert.rejects(missing.client.editDraft({...values,action:'save'}),/размер или ID вложений/);
    assert.deepEqual(missing.calls.map(call=>call.action),['GetItem']);
  }
});
test('lost mutation replies are never retried and always explain checking server state', async () => {
  for (const fail of ['UpdateItem','CreateAttachment','SendItem']) {
    const {client,calls} = fixture({fail});
    await assert.rejects(client.editDraft({...values,action:'send',attachments:[{name:'new.txt',content:'eA=='}]}),error=>{
      assert.match(error.message,/Lost response/);
      assert.match(error.message,/Проверьте «Черновики» и «Отправленные»/);
      assert.match(error.message,/Операция не повторялась/);
      return true;
    });
    assert.equal(calls.filter(call=>call.action===fail).length,1);
    assert.equal(calls.at(-1).action,fail);
  }
  const {client,calls} = fixture({fail:'GetItem'});
  await assert.rejects(client.editDraft({...values,action:'read'}),error=>error.message==='Lost response');
  assert.equal(calls.length,1);
});
test('missing or mismatched server keys stop the next write instead of sending blindly', async () => {
  for (const options of [{update:'<Message><ItemId Id="draft&amp;id"/></Message>'},{attached:'<FileAttachment><AttachmentId RootItemId="another" RootItemChangeKey="new"/></FileAttachment>'},{attached:'<FileAttachment><AttachmentId RootItemId="draft&amp;id"/></FileAttachment>'}]) {
    const {client,calls} = fixture(options);
    await assert.rejects(client.editDraft({...values,action:'send',attachments:[{name:'new.txt',content:'eA=='}]}),/Операция не повторялась/);
    assert.ok(!calls.some(call=>call.action==='SendItem'));
  }
});
