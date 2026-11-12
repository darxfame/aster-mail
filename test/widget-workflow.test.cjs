const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../desktop/main.cjs'),'utf8');
const E = require('../src/events.js');
const now = Date.parse('2026-11-12T09:30:00Z');
const events = [{id:'current',changeKey:'v1',start:'2026-11-12T09:00:00Z',end:'2026-11-12T10:00:00Z'}, {id:'next',changeKey:'v1',start:'2026-11-12T10:00:00Z',end:'2026-11-12T11:00:00Z'}];
test('widget polls current and future details, reuses versioned cache and discards retired reads', async () => {
  const reads=[];
  let context;
  const active={ calendar:async()=>events.map(e=>({...e})), event:async ref=>{reads.push(ref);return {body:`https://teams.microsoft.com/l/${ref.id}`,cancelled:false};} };
  context=vm.createContext({ require, Date:class extends Date{static now(){return now;}}, client:active,polling:false,widgetDetail:null,widgetEvents:[],dismissedMeetings:new Set(),notificationSettings:{meetings:false},
    pollMail(){},pollMailReminders(){},pollingRange:()=>({}),refreshPrivacy:async()=>{},refreshWidget(){},tr:v=>v });
  vm.runInContext(source.slice(source.indexOf('async function pollNotifications()'),source.indexOf('function retireAccount()')),context);
  await context.pollNotifications(); assert.deepEqual(reads.map(r=>r.id),['current','next']);
  assert.equal(E.joinURL(context.widgetEvents[1]),'https://teams.microsoft.com/l/next');
  await context.pollNotifications();assert.equal(reads.length,2);
  events[1].changeKey='v2';await context.pollNotifications();assert.equal(reads.length,3);
  assert.equal(reads.at(-1).changeKey,'v2');
  events[1].changeKey='v3';active.event=async()=>{throw new Error('Offline');};await context.pollNotifications();
  assert.equal(E.joinURL(context.widgetEvents[1]),null,'Old-version body must not be grafted onto a new event');
  events[1].changeKey='v4';active.event=async()=>{context.client=null;context.widgetEvents=[];return {body:'private old body'};};
  await context.pollNotifications();assert.equal(context.widgetEvents.length,0);
});
test('widget join permits future calls while preserving sender, privacy, HTTPS and declined-event guards',async()=>{
  let handler,hidden=false;
  const opened=[],sender={mainFrame:{}},meeting={...events[1],response:'Accept',joinUrl:'https://teams.microsoft.com/l/future'};
  const context=vm.createContext({ipcMain:{handle(_name,fn){handler=fn;}},widgetWindow:{webContents:sender,hide(){}},widgetEvents:[meeting],privacyHidden:()=>hidden,
    httpsURL:require('../desktop/meetings.cjs').httpsURL,meetingLink:E.joinURL,moduleHost:{openMeeting:async url=>opened.push(url)},notificationSettings:{},errorMessage:e=>e.message,tr:v=>v});
  const begin=source.indexOf("  ipcMain.handle('aster-widget'");
  vm.runInContext(source.slice(begin,source.indexOf('  const image =',begin)),context);
  const event={sender,senderFrame:sender.mainFrame};
  assert.equal((await handler(event,'join',{id:'next'})).ok,true);assert.deepEqual(opened,['https://teams.microsoft.com/l/future']);
  hidden=true;assert.equal((await handler(event,'join',{id:'next'})).ok,false);hidden=false;
  meeting.response='Decline';assert.equal((await handler(event,'join',{id:'next'})).ok,false);meeting.response='Accept';
  meeting.joinUrl='http://teams.microsoft.com/l/future';assert.equal((await handler(event,'join',{id:'next'})).ok,false);
  assert.equal((await handler({sender:{},senderFrame:{}},'join',{id:'next'})).ok,false);
  assert.equal(opened.length,1);
});
