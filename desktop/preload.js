'use strict';
const { contextBridge, ipcRenderer } = require('electron');
function subscribe(channel, callback) {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
contextBridge.exposeInMainWorld('localsoundDesktop', Object.freeze({
  openYoutube: value => ipcRenderer.invoke('desktop:open-youtube', value),
  prepareYoutubeCapture: () => ipcRenderer.invoke('desktop:prepare-capture'),
  confirmYoutubeCapture: () => ipcRenderer.invoke('desktop:confirm-capture'),
  showYoutubePanel: visible => ipcRenderer.invoke('desktop:youtube-panel-visible', visible),
  obscureYoutubePanel: obscured => ipcRenderer.invoke('desktop:youtube-panel-obscured', obscured),
  youtubePanelState: () => ipcRenderer.invoke('desktop:youtube-panel-state'),
  miniPlayerReady: () => ipcRenderer.invoke('desktop:mini-ready'),
  onYoutubePanel: callback => subscribe('desktop:youtube-panel', callback),
  onYoutubeVideo: callback => subscribe('desktop:youtube-video', callback),
  onShareYoutube: callback => subscribe('desktop:share-youtube', callback),
  onYoutubeClosed: callback => subscribe('desktop:youtube-closed', callback)
}));
