'use strict';
function miniWindowOptions(host = false) {
  return { width: host ? 340 : 320, height: host ? 246 : 216, useContentSize: true,
    resizable: false, maximizable: false, fullscreenable: false,
    show: false, alwaysOnTop: true, autoHideMenuBar: true };
}
function lockMiniWindow(win) {
  win.setResizable(false); win.setMaximizable(false); win.setFullScreenable(false);
  win.setAlwaysOnTop(true, 'floating'); win.setMenuBarVisibility(false);
  win.on('maximize', () => win.unmaximize());
}
module.exports = { miniWindowOptions, lockMiniWindow };
