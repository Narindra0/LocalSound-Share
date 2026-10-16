'use strict';
if (window === window.top) {
  const pending = new Map(); let sequence = 0;
  function invoke(action, value) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Le lecteur ne répond pas. Réessayez.')); }, 10000);
      pending.set(id, { resolve, reject, timer });
      chrome.webview.postMessage({ id, action, value });
    });
  }
  chrome.webview.addEventListener('message', ({ data }) => {
    const request = pending.get(data.id); if (!request) return;
    pending.delete(data.id); clearTimeout(request.timer);
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data.value);
  });
  window.localsoundListener = Object.freeze({ nativeCompact:true,
    lastAddress:() => invoke('last-address'), connect:value => invoke('connect', value),
    changeRoom:() => invoke('change-room'), miniPlayerReady:() => invoke('mini-open'), restorePlayer:() => invoke('mini-close'),
    nativeState:() => invoke('test-state'), testExit:() => invoke('test-exit')
  });
}
