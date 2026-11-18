// Keep fixture values literal in both JavaScript source and embedded script text.
function javascriptLiteral(value) {
  return JSON.stringify(value).replace(/[<>\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
module.exports = javascriptLiteral;
