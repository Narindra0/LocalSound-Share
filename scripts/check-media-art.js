'use strict';
// Diagnostic local sans impression des titres, des artistes ou des images.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { imageType } = require('../artwork');
let script = fs.readFileSync(path.join(__dirname, 'media-info.ps1'), 'utf8');
script = script.replace('while ($true) {', 'for ($probe = 0; $probe -lt 1; $probe++) {')
  .replace('$cover = $null', '$cover = $null; [Console]::Error.WriteLine("thumbnail=" + [bool]$properties.Thumbnail)')
  .replace('if ($reader.Length -gt 0', '[Console]::Error.WriteLine("bytes=" + $reader.Length); if ($reader.Length -gt 0')
  .replace('} catch { } finally {', '} catch { [Console]::Error.WriteLine($_.Exception.Message) } finally {');
const child = spawn('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command',script], { windowsHide:true });
let pending = '';
child.stderr.on('data', data => process.stderr.write(data));
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  pending += chunk; let index;
  while ((index = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0,index); pending = pending.slice(index+1);
    try { const data = JSON.parse(line); console.log(JSON.stringify({available:data.available,sessions:data.sessions?.length,images:data.sessions?.filter(s=>s.artworkBase64).length,formats:data.sessions?.filter(s=>s.artworkBase64).map(s=>imageType(Buffer.from(s.artworkBase64,'base64')))})); } catch (_) {}
  }
});
const timeout = setTimeout(()=>child.kill(),12000);
child.on('exit',()=>clearTimeout(timeout));
