@echo off
title Morne Bay Studio
cd /d "%~dp0"
where bun >nul 2>nul || (echo Bun is not installed. In PowerShell run:  powershell -c "irm bun.sh/install.ps1 ^| iex"  then reopen this. & pause & exit /b 1)
echo Installing / checking packages...
call bun install || (echo bun install failed. & pause & exit /b 1)
echo Building...
call bun run build || (echo Build failed. & pause & exit /b 1)
start "" http://localhost:3131
echo Studio running at http://localhost:3131  (close this window to stop it)
bun server/index.ts
echo.
echo The server stopped. If there is an error above, copy it to Claude.
pause
