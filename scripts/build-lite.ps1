$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPackage = Get-Content -Raw -LiteralPath (Join-Path $taskRoot 'package.json') | ConvertFrom-Json
$taskSdkVersion = '1.0.4258.31'
$taskSdk = Join-Path $taskRoot "artifacts/webview2-sdk/$taskSdkVersion"
if (!(Test-Path -LiteralPath (Join-Path $taskSdk 'lib/net462/Microsoft.Web.WebView2.Core.dll'))) {
  $taskArchive = Join-Path $taskRoot 'artifacts/webview2-sdk/sdk.zip'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $taskArchive) | Out-Null
  Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$taskSdkVersion/microsoft.web.webview2.$taskSdkVersion.nupkg" -OutFile $taskArchive
  Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskSdk -Force
}
$taskStage = Join-Path $taskRoot 'artifacts/listener-lite'
New-Item -ItemType Directory -Force -Path $taskStage | Out-Null
$taskPayload = Join-Path $taskStage 'payload.zip'
$taskZipScript = @'
const fs=require('node:fs'),path=require('node:path'),{ZipFile}=require('yazl');
const root=process.cwd(),sdk=process.argv[2],output=process.argv[3];
const zip=new ZipFile();
function add(dir,prefix){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name),name=prefix+entry.name;if(entry.isDirectory())add(file,name+'/');else if(entry.isFile())zip.addFile(file,name);}}
add(path.join(root,'public'),'public/');
for(const name of ['Microsoft.Web.WebView2.Core.dll','Microsoft.Web.WebView2.WinForms.dll'])zip.addFile(path.join(sdk,'lib/net462',name),name);
zip.addFile(path.join(sdk,'runtimes/win-x64/native/WebView2Loader.dll'),'WebView2Loader.dll');
zip.addFile(path.join(root,'desktop/lite/bridge.js'),'lite-bridge.js');
zip.addFile(path.join(sdk,'LICENSE.txt'),'WebView2-SDK-LICENSE.txt');
zip.addFile(path.join(root,'LICENSE.txt'),'LocalSound-LICENSE.txt');
const stream=fs.createWriteStream(output);zip.outputStream.pipe(stream);zip.end();stream.on('close',()=>console.log('Ressources embarquées : '+fs.statSync(output).size+' octets'));
'@
Push-Location $taskRoot
try {
  $taskZipScript | & node - $taskSdk $taskPayload
  if ($LASTEXITCODE -ne 0) { throw 'Échec de préparation des ressources.' }
  $taskAssembly = Join-Path $taskStage 'AssemblyInfo.cs'
  $taskVersion = $taskPackage.version
  @"
using System.Reflection;
[assembly: AssemblyTitle("LocalSound Auditeur Léger")]
[assembly: AssemblyProduct("LocalSound Auditeur Léger")]
[assembly: AssemblyCompany("Ranjalahy Narindra")]
[assembly: AssemblyCopyright("Copyright © 2026 Ranjalahy Narindra")]
[assembly: AssemblyVersion("$taskVersion.0")]
[assembly: AssemblyFileVersion("$taskVersion.0")]
"@ | Set-Content -LiteralPath $taskAssembly -Encoding utf8
  $taskOutputDir = Join-Path $taskRoot 'release/auditeur-leger'
  New-Item -ItemType Directory -Force -Path $taskOutputDir | Out-Null
  $taskExe = Join-Path $taskOutputDir "LocalSound-Auditeur-Leger-$taskVersion-Windows-x64.exe"
  $taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
  & $taskCompiler /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 "/out:$taskExe" "/win32icon:$taskRoot/public/branding/icon.ico" "/win32manifest:$taskRoot/desktop/lite/app.manifest" "/resource:$taskPayload,payload.zip" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Net.Http.dll /reference:System.Web.Extensions.dll /reference:System.IO.Compression.dll "/reference:$taskSdk/lib/net462/Microsoft.Web.WebView2.Core.dll" "/reference:$taskSdk/lib/net462/Microsoft.Web.WebView2.WinForms.dll" (Join-Path $taskRoot 'desktop\lite\Launcher.cs') (Join-Path $taskRoot 'desktop\lite\ListenerForm.cs') $taskAssembly
  if ($LASTEXITCODE -ne 0) { throw 'Compilation du lecteur léger impossible.' }
  Get-Item -LiteralPath $taskExe | Select-Object FullName,Length
} finally { Pop-Location }
