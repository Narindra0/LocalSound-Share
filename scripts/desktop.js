'use strict';
const path = require('node:path');
const { spawn } = require('node:child_process');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, '..', 'desktop', 'main.js')], { stdio: 'inherit', windowsHide: true, env });
child.on('error', err => { console.error('[desktop]', err.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
