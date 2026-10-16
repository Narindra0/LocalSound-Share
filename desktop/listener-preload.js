'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localsoundListener', Object.freeze({
  connect: value => ipcRenderer.invoke('listener:connect', value),
  lastAddress: () => ipcRenderer.invoke('listener:last-address'),
  changeRoom: () => ipcRenderer.invoke('listener:change-room'),
  miniPlayerReady: () => ipcRenderer.invoke('listener:mini-ready')
}));
