@echo off
title FinPilot Server
cd /d "%~dp0"

echo ====================================================
echo  Starting FinPilot Server on http://localhost:3000
echo ====================================================

:: Open browser automatically
start http://localhost:3000

:: Run server with auto-reload on file changes
node --watch server/index.js
