'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
if (isMainThread) {
  exports.readFileInfo = data => new Promise(resolve => {
    const worker = new Worker(__filename, { workerData: data });
    let settled = false;
    function done(value) { if (settled) return; settled = true; clearTimeout(timeout); worker.terminate(); resolve(value); }
    const timeout = setTimeout(() => done(null), 8000);
    worker.once('message', done); worker.once('error', () => done(null)); worker.once('exit', () => done(null));
  });
} else {
  (async () => {
    const { parseBuffer, selectCover } = await import('music-metadata');
    const result = await parseBuffer(workerData, undefined, { duration:false, skipPostHeaders:true });
    const cover = selectCover(result.common.picture);
    parentPort.postMessage({ title:result.common.title || '', artist:result.common.artist || '', artwork:cover?.data?.length <= 2 * 1024 * 1024 ? cover.data : null });
  })().catch(() => parentPort.postMessage(null));
}
