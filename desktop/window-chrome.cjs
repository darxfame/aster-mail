// Keep native Windows controls, snapping and keyboard behavior in the shared toolbar.
function windowsChrome(theme = 'light', platform = process.platform) {
  if (!['light', 'dark'].includes(theme)) throw new Error('Invalid window theme');
  return platform === 'win32' ? {
    titleBarStyle: 'hidden', autoHideMenuBar: true,
    titleBarOverlay: { color: '#00000000', symbolColor: theme === 'dark' ? '#eceef2' : '#242933', height: 40 },
  } : {};
}
module.exports = { windowsChrome };
