'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { WebSocket, WebSocketServer } = require('ws');
const { listenerAddress } = require('./listener-address');
const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon', '.txt':'text/plain; charset=utf-8', '.zip':'application/zip' };
function createListenerServer({ publicDir = path.join(__dirname, '..', 'public') } = {}) {
  let target = null;
  const peers = new Set(), remotes = new Set();
  const server = http.createServer(async (req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (_) { res.writeHead(400).end(); return; }
    if (pathname.startsWith('/api/')) {
      const allowed = req.method === 'GET' && /^\/api\/(?:status|requests|artwork\/[a-f0-9]{64})$/.test(pathname) || req.method === 'POST' && pathname === '/api/requests';
      if (!allowed) { res.writeHead(403).end('Commandes réservées à l’hôte.'); return; }
      if (!target) { res.writeHead(503).end('Aucun salon connecté.'); return; }
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10000);
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      try {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4096) { res.writeHead(413).end(); return; } chunks.push(chunk); }
        const response = await fetch(target + pathname, { method: req.method, headers: { 'Content-Type': 'application/json' }, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}), signal: controller.signal, redirect: 'error' });
        const parts = []; let received = 0;
        for await (const part of response.body) { received += part.length; if (received > 4 * 1024 * 1024) throw new Error('Réponse trop volumineuse.'); parts.push(Buffer.from(part)); }
        const body = Buffer.concat(parts);
        res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': response.headers.get('cache-control') || 'no-store' }).end(body);
      } catch (_) { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error:'Le salon est injoignable. Vérifiez le Wi-Fi et le PC hôte.' })); }
      finally { clearTimeout(timeout); }
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
    const relative = pathname === '/' || pathname === '/connect' ? 'listener-connect.html' : pathname === '/listen' ? 'index.html' : pathname.slice(1);
    const file = path.resolve(publicDir, relative), root = path.resolve(publicDir) + path.sep;
    if (!file.startsWith(root) || !MIME[path.extname(file).toLowerCase()] || /(?:^|[\\/])\./.test(relative)) { res.writeHead(404).end(); return; }
    try {
      const stat = await fs.promises.stat(file); if (!stat.isFile()) throw new Error();
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()], 'Content-Length': stat.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options':'nosniff' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (_) { res.writeHead(404).end(); }
  });
  const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: 16384 });
  wss.on('error', () => {});
  wss.on('connection', socket => {
    if (!target) { socket.close(1013, 'Choisissez un salon.'); return; }
    peers.add(socket);
    const remote = new WebSocket(target.replace(/^http/, 'ws')); remotes.add(remote);
    const pending = []; let queued = 0;
    socket.on('message', (data, binary) => {
      if (binary) return;
      let msg; try { msg = JSON.parse(data); } catch (_) { return; }
      if (!['hello', 'ping', 'listen', 'unlisten'].includes(msg?.type)) return;
      if (msg.type === 'hello') msg = { type:'hello', role:'client', protocol: msg.protocol === 2 ? 2 : 1, codec:msg.codec === 'opus' ? 'opus' : 'pcm' };
      const text = JSON.stringify(msg);
      if (remote.readyState === WebSocket.OPEN) remote.send(text);
      else if (remote.readyState === WebSocket.CONNECTING && queued + text.length <= 16384) { pending.push(text); queued += text.length; }
    });
    remote.on('open', () => { for (const text of pending) remote.send(text); pending.length = 0; });
    remote.on('message', (data, binary) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 262144) { socket.close(1013, 'Reconnexion audio.'); return; }
      socket.send(data, { binary });
    });
    remote.on('close', () => { remotes.delete(remote); if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Reconnexion au salon.'); });
    remote.on('error', () => { if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Salon injoignable.'); });
    socket.on('close', () => { peers.delete(socket); remote.terminate(); }); socket.on('error', () => remote.terminate());
  });
  return {
    server,
    async connect(value) {
      const address = listenerAddress(value);
      let response, state;
      try { response = await fetch(address + '/api/status', { signal: AbortSignal.timeout(5000), redirect:'error' }); state = await response.json(); }
      catch (_) { throw new Error('Salon injoignable. Vérifiez l’adresse, le réseau et que l’hôte est lancé.'); }
      if (!response.ok || state.application !== 'localsound-share' && !(state.audio?.sampleRate === 48000 && ['system', 'file', 'tab'].includes(state.sourceKind))) throw new Error('Cette adresse ne correspond pas à un salon LocalSound.');
      for (const peer of peers) peer.terminate(); target = address; return address;
    },
    disconnect() { target = null; for (const peer of peers) peer.terminate(); },
    async close() { for (const peer of peers) peer.terminate(); for (const remote of remotes) remote.terminate(); wss.close(); await new Promise(resolve => server.close(resolve)); }
  };
}
module.exports = { createListenerServer };
