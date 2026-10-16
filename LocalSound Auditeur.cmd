@echo off
cd /d "%~dp0"
call npm run desktop:listener
if errorlevel 1 pause
