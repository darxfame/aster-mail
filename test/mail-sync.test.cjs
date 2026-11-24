const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const P = require('../desktop/protocol.cjs');
const mailSource = fs.readFileSync(require.resolve('../src/mail-ui.js'),'utf8');
const functions = mailSource.slice(mailSource.indexOf('function mergeInboxPage('));
function renderer(api = async () => assert.fail('Unexpected request')) {
  const selected = {id:'old',html:'<b>Open message</b>'}, state = {account:{sessionId:'session'},generation:1,view:'mail',folder:'inbox',filter:'all',query:'',folders:[{id:'inbox-id',wellKnown:'inbox',unread:1}],messages:[{id:'old',read:true}],selected,more:false};
  const list = {scrollTop:0,querySelectorAll:()=>[],insertAdjacentHTML(){}}, status = {};
  let renders = 0;
  const context = vm.createContext({ tr: value => value,state,api,mailWrites:0,mailWriteEpoch:0,$:selector=>selector==='#messages'?list:selector==='.reader-attachment-preview'?null:status,document:{querySelector:()=>null},renderSidebar(){},renderMessages(){renders++;},renderReader(){},loadReaderMeeting(){},time:()=> '10:00'});
  context.agentMailSession = null;
  const appSource = fs.readFileSync(require.resolve('../src/app.js'), 'utf8');
  vm.runInContext(appSource.slice(appSource.indexOf('function mailboxWriting()'), appSource.indexOf('async function api(')), context);
  vm.runInContext(functions,context);
  return {state,context,selected,list,get renders(){return renders;}};
}
const snapshot = {sessionId:'session',page:{items:[{id:'new',read:false},{id:'old',read:true}],more:false},inbox:{id:'inbox-id',unread:2,total:2}};
test('background inbox snapshot updates list and count while keeping the open reader and scroll',async()=>{
  const r=renderer(); await r.context.receiveInbox(snapshot);
  assert.deepEqual(Array.from(r.state.messages,m=>m.id),['new','old']); assert.equal(r.state.folders[0].unread,2);
  assert.equal(r.state.selected,r.selected); assert.equal(r.state.selected.html,'<b>Open message</b>'); assert.equal(r.renders,1); assert.equal(r.list.scrollTop,0);
  await r.context.receiveInbox(snapshot); assert.equal(r.renders,1);
});
test('old accounts, another folder, search, mailbox writes and pending page loads do not replace current mail',async()=>{
  for(const change of [{account:{sessionId:'other'}},{query:'search'},{mailLoading:1},{view:'contacts'}]) {
    const r=renderer(); Object.assign(r.state,change); await r.context.receiveInbox(snapshot); assert.equal(r.renders,0);
  }
  const r=renderer(); r.context.mailWrites=1; await r.context.receiveInbox(snapshot); assert.equal(r.renders,0); assert.equal(r.state.folders[0].unread,1);
});
test('a poll refreshes the active folder and changed open message without a mailbox write', async () => {
  const calls = [];
  const updated = { id: 'old', changeKey: 'v2', read: false, flagged: true };
  const r = renderer(async (operation, data) => {
    calls.push({ operation, data: { ...data } });
    if (operation === 'messages') return { items: [updated], more: false };
    if (operation === 'message') return { ...updated, html: '<b>Updated</b>' };
    assert.fail('Unexpected request');
  });
  r.state.folder = 'sentitems';
  r.selected.changeKey = 'v1';
  await r.context.receiveInbox(snapshot);
  assert.deepEqual(calls, [
    { operation: 'messages', data: { folder: 'sentitems', filter: 'all', offset: 0, refresh: true } },
    { operation: 'message', data: { id: 'old', changeKey: 'v2', refresh: true } },
  ]);
  assert.equal(r.state.messages[0].flagged, true);
  assert.equal(r.state.selected.html, '<b>Updated</b>');
  assert.equal(r.state.selected.read, false);
  await r.context.receiveInbox(snapshot);
  assert.equal(calls.length, 3);
  assert.equal(r.renders, 1);
});
test('an open message outside the current page is refreshed by ID and stale details are discarded', async () => {
  for (const invalidate of [
    () => {},
    r => { r.state.generation++; },
    r => { r.context.mailWriteEpoch++; },
    r => { r.state.selected = { id: 'other' }; },
  ]) {
    let finish;
    const r = renderer(async (operation, data) => {
      assert.equal(operation, 'message');
      assert.deepEqual({ ...data }, { id: 'older', refresh: true });
      return new Promise(resolve => { finish = resolve; });
    });
    Object.assign(r.selected, { id: 'older', changeKey: 'v1' });
    const pending = r.context.receiveInbox(snapshot);
    assert.equal(typeof finish, 'function');
    invalidate(r);
    finish({ id: 'older', changeKey: 'v2', html: 'Updated' });
    await pending;
    if (r.state.selected.id === 'other') assert.equal(r.state.selected.changeKey, undefined);
    else if (r.state.generation !== 1 || r.context.mailWriteEpoch) assert.equal(r.state.selected.changeKey, 'v1');
    else assert.equal(r.state.selected.changeKey, 'v2');
  }
});
test('unread refresh uses a server filter and discards reads overtaken by navigation or mutation',async()=>{
  let finish; const r=renderer((operation,data)=>{assert.equal(operation,'messages'); assert.equal(data.filter,'unread'); assert.equal(data.refresh,true); return new Promise(resolve=>{finish=resolve;});});
  r.state.filter='unread'; const pending=r.context.receiveInbox(snapshot); r.context.mailWriteEpoch++; finish(snapshot.page); await pending; assert.equal(r.renders,0);
});
test('MCP updates refresh the current folder without replacing the reader and discard obsolete snapshots', async () => {
  const r = renderer(async operation => operation === 'folders' ? [] : { items: [{ id: 'after-move' }], more: false });
  r.state.folder = 'target'; r.list.scrollTop = 80;
  const epoch = r.context.mailWriteEpoch;
  await r.context.receiveMailboxChange({ sessionId: 'session', busy: true });
  assert.equal(r.context.mailboxWriting(), true); assert.ok(r.context.mailWriteEpoch > epoch);
  await r.context.receiveInbox(snapshot); assert.equal(r.renders, 0);
  await r.context.receiveMailboxChange({ sessionId: 'session', busy: false });
  assert.equal(r.context.mailboxWriting(), false); assert.equal(r.renders, 1);
  assert.equal(r.state.messages[0].id, 'after-move'); assert.equal(r.state.selected, r.selected); assert.equal(r.list.scrollTop, 80);
  r.context.agentMailSession = 'old-session';
  assert.equal(r.context.mailboxWriting(), false, 'A retired account cannot leave the new account blocked');
});
test('navigation and a later write discard an in-flight MCP list refresh', async () => {
  for (const invalidate of [r => { r.state.generation++; }, r => { r.context.mailWriteEpoch++; }, r => { r.state.account = { sessionId: 'other' }; }]) {
    let finish;
    const r = renderer(async operation => operation === 'folders' ? [] : new Promise(resolve => { finish = resolve; }));
    const refresh = r.context.receiveMailboxChange({ sessionId: 'session', busy: false });
    invalidate(r); finish({ items: [{ id: 'obsolete' }], more: false }); await refresh;
    assert.equal(r.renders, 0); assert.equal(r.state.selected, r.selected);
  }
});
test('first-page merge preserves contiguous older pages, removes obsolete head items and avoids duplicates',()=>{
  const r=renderer(), old=Array.from({length:100},(_,i)=>({id:String(i)}));
  const page={items:[{id:'new'},...old.slice(0,49)],more:true};
  const result=r.context.mergeInboxPage(old,page);
  assert.equal(result.length,101); assert.equal(result[0].id,'new'); assert.equal(result.at(-1).id,'99'); assert.equal(new Set(result.map(m=>m.id)).size,101);
  assert.equal(r.context.mergeInboxPage(old,{items:[{id:'unrelated'}],more:true}).length,1);
  assert.equal(r.context.mergeInboxPage(old,{items:[],more:false}).length,0);
});
test('message list becomes readable before a slow folder tree finishes loading',async()=>{
  const source=fs.readFileSync(require.resolve('../src/app.js'),'utf8');
  let finish, rendered=false;
  const folders=new Promise(resolve=>{finish=resolve;});
  const context=vm.createContext({ closeMailAttachmentPreview() {}, window: { asterLoading: require('../src/loading-ui.js') }, tr: value => value,state:{generation:0,view:'mail',folder:'inbox',filter:'all',query:'',account:{},messages:[]},$:()=>({}),ready:()=>true,renderSidebar(){},clearError(){},icon:()=>'',time:()=>'',api:async operation=>operation==='messages'?{items:[],more:false}:folders,renderMail(){rendered=true;},refreshMailFolders:()=>folders,showError(){}});
  vm.runInContext(source.slice(source.indexOf('async function loadView('),source.indexOf('function filteredMessages(')),context);
  const loading=context.loadView(); await new Promise(resolve=>setImmediate(resolve));
  try {assert.equal(rendered,true);} finally {finish([]); await loading;}
});
test('previews separate HTML blocks and joined Cyrillic names without changing URLs or emails',()=>{
  assert.equal(P.mailPreview('<p>Анна</p><div>Обновила задачу</div><style>secret</style><br>TEST-1&nbsp;готово',true),'Анна Обновила задачу TEST-1 готово');
  assert.equal(P.mailPreview('КоровинДмитрийАлександровичupdated TEST-1'),'Коровин Дмитрий Александрович updated TEST-1');
  const address='АннаСмирнова@example.com https://example.com/АннаСмирнова'; assert.equal(P.mailPreview(address),address);
  assert.doesNotThrow(()=>P.mailPreview('&#999999999;',true));
});
test('recipient roles stay separate and names are escaped with contact buttons by group and index',()=>{
  const source=fs.readFileSync(require.resolve('../src/mail-ui.js'),'utf8');
  const context=vm.createContext({ tr: value => value,esc:value=>String(value).replace(/[<>&"]/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[char])),avatar:()=>'',icon:()=>''});
  vm.runInContext(source.slice(source.indexOf('function mailRecipientDetails(')),context);
  const html=context.mailRecipientDetails({to:Array.from({length:100},(_,i)=>({name:i===0?'<b>Анна</b>':`Участник ${i}`,email:`person${i}@example.com`})),cc:[{name:'Елена',email:'elena@example.com'}]});
  assert.match(html,/<details class="mail-recipients"><summary>/);
  assert.match(html,/Кому · 100/); assert.match(html,/Копия · 1/); assert.doesNotMatch(html,/Получатели · 101/); assert.match(html,/&lt;b&gt;Анна&lt;\/b&gt;/); assert.match(html,/class="mail-recipient-list"/); assert.match(html,/data-group="cc" data-index="0"/);
});
