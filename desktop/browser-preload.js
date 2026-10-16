'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('youtubeBrowser', Object.freeze({
  navigate: value => ipcRenderer.invoke('browser:navigate', value),
  action: value => ipcRenderer.invoke('browser:action', value),
  onState: callback => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('browser:state', handler);
    ipcRenderer.invoke('browser:state').then(callback);
  }
}));
