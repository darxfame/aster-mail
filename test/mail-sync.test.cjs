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
  const context = vm.createContext({state,api,mailWrites:0,mailWriteEpoch:0,$:selector=>selector==='#messages'?list:status,document:{querySelector:()=>null},renderSidebar(){},renderMessages(){renders++;},time:()=> '10:00'});
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
  for(const change of [{account:{sessionId:'other'}},{folder:'sentitems'},{query:'search'},{mailLoading:1},{view:'contacts'}]) {
    const r=renderer(); Object.assign(r.state,change); await r.context.receiveInbox(snapshot); assert.equal(r.renders,0);
  }
  const r=renderer(); r.context.mailWrites=1; await r.context.receiveInbox(snapshot); assert.equal(r.renders,0); assert.equal(r.state.folders[0].unread,1);
});
test('unread refresh uses a server filter and discards reads overtaken by navigation or mutation',async()=>{
  let finish; const r=renderer((operation,data)=>{assert.equal(operation,'messages'); assert.equal(data.filter,'unread'); assert.equal(data.refresh,true); return new Promise(resolve=>{finish=resolve;});});
  r.state.filter='unread'; const pending=r.context.receiveInbox(snapshot); r.context.mailWriteEpoch++; finish(snapshot.page); await pending; assert.equal(r.renders,0);
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
  const context=vm.createContext({state:{generation:0,view:'mail',folder:'inbox',filter:'all',query:'',account:{},messages:[]},$:()=>({}),ready:()=>true,renderSidebar(){},clearError(){},icon:()=>'',time:()=>'',api:async operation=>operation==='messages'?{items:[],more:false}:folders,renderMail(){rendered=true;},refreshMailFolders:()=>folders,showError(){}});
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
  const context=vm.createContext({esc:value=>String(value).replace(/[<>&"]/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[char])),avatar:()=>'',icon:()=>''});
  vm.runInContext(source.slice(source.indexOf('function mailRecipientDetails(')),context);
  const html=context.mailRecipientDetails({to:Array.from({length:100},(_,i)=>({name:i===0?'<b>Анна</b>':`Участник ${i}`,email:`person${i}@example.com`})),cc:[{name:'Елена',email:'elena@example.com'}]});
  assert.match(html,/<details class="mail-recipients" open><summary>/);
  assert.match(html,/Кому · 100/); assert.match(html,/Копия · 1/); assert.doesNotMatch(html,/Получатели · 101/); assert.match(html,/&lt;b&gt;Анна&lt;\/b&gt;/); assert.match(html,/class="mail-recipient-list"/); assert.match(html,/data-group="cc" data-index="0"/);
});
