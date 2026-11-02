#!/bin/bash
# Double-click on the Mac. Builds the app, opens it, and keeps the server running in this window.
cd "$(dirname "$0")"
[ -d node_modules ] || bun install
bun run build || exit 1
(sleep 1.5; open http://localhost:3131) &
exec bun server/index.ts
