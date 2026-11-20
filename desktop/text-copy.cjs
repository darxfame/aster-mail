function enableTextCopy(window, tr) {
  const contents = window.webContents;
  const mac = process.platform === 'darwin';
  contents.on('before-input-event', (event, input) => {
    const copyModifier = mac ? input.meta && !input.control : input.control && !input.meta;
    // The Russian keyboard layout reports Cyrillic Es on the C key.
    if (input.type !== 'keyDown' || input.isComposing || input.alt || input.shift || !copyModifier ||
        !['c', '\u0441'].includes(input.key.toLowerCase())) return;
    event.preventDefault();
    contents.copy();
  });
  contents.on('context-menu', (_event, { selectionText, editFlags }) => {
    if (!selectionText || !editFlags.canCopy) return;
    const { Menu } = require('electron');
    Menu.buildFromTemplate([{ label: tr('Копировать'), click: () => contents.copy() }]).popup({ window });
  });
}

module.exports = { enableTextCopy };
