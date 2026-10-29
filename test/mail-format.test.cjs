const test = require('node:test');
const assert = require('node:assert/strict');
const { styleAllowed } = require('../src/rich-content.js');
const P = require('../desktop/protocol.cjs');

test('mail formatting permits text styling but excludes network, positioning and CSS expressions', () => {
  for (const [name,value] of [['color','#c03060'],['font-family','Georgia, serif'],['font-size','24px'],['font-weight','bold'],['text-align','center'],['text-decoration','underline line-through'],['background-color','rgb(255, 240, 166)']]) assert.equal(styleAllowed(name,value),true,`${name}: ${value}`);
  for (const [name,value] of [['background','url(https://example.com/tracker)'],['background-color','url(https://example.com)'],['color','var(--text)'],['color','expression(alert(1))'],['position','fixed'],['font-size','999px'],['font-family','url(https://example.com/font)'],['margin-left','-99px']]) assert.equal(styleAllowed(name,value),false,`${name}: ${value}`);
});
test('new mail, drafts and replies send HTML formatting while retaining reference keys and explicit recipients', () => {
  const data = {to:'anna@example.com',cc:'',subject:'Formatting',body:'Formatted text',bodyHtml:'<p style="text-align: center"><b>Formatted</b> <a href="https://example.com">text</a></p>'};
  const sent = P.sendSOAP(data);
  assert.match(sent,/<t:Body BodyType="HTML">&lt;p style=&quot;text-align: center&quot;&gt;/);
  assert.match(sent,/&lt;b&gt;Formatted&lt;\/b&gt;/);
  assert.match(P.sendSOAP(data,true),/MessageDisposition="SaveOnly"/);
  const reply = P.sendSOAP({...data,kind:'reply-all',reference:{id:'original',changeKey:'fresh-key'}});
  assert.match(reply,/<t:NewBodyContent BodyType="HTML">/);
  assert.match(reply,/<t:ReferenceItemId Id="original" ChangeKey="fresh-key"/);
  assert.match(reply,/<t:CcRecipients><\/t:CcRecipients>/);
});
