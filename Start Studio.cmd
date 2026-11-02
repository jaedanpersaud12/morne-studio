@echo off
title Morne Bay Studio
cd /d "%~dp0"
where bun >nul 2>nul || (echo Bun is not installed. In PowerShell run:  powershell -c "irm bun.sh/install.ps1 ^| iex"  then reopen this. & pause & exit /b 1)
echo Installing / checking packages...
call bun install || (echo bun install failed. & pause & exit /b 1)
echo Building...
call bun run build || (echo Build failed. & pause & exit /b 1)
curl -sf -o nul -m 2 -X POST http://localhost:3131/api/admin/shutdown && (echo Replacing an older Studio server... & timeout /t 2 >nul)
start "" http://localhost:3131
echo Studio running at http://localhost:3131  (close this window to stop it)
bun server/index.ts
echo.
echo The server stopped. If it says the port is in use, fully quit the Claude desktop app ^(it may be running an old copy of Studio^), then run this again. Otherwise copy any error above to Claude.
pause
