@echo off
title Morne Bay Studio
cd /d "%~dp0"
if not exist node_modules call bun install
call bun run build || (echo Build failed & pause & exit /b 1)
start "" http://localhost:3131
bun server/index.ts
