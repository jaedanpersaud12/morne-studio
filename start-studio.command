#!/bin/bash
# Double-click on the Mac. Installs/updates packages, builds, opens the app, keeps the server running here.
cd "$(dirname "$0")"
command -v bun >/dev/null || { echo 'Bun is not installed. Run: curl -fsSL https://bun.sh/install | bash'; read -r; exit 1; }
bun install || { echo 'bun install failed'; read -r; exit 1; }
bun run build || { echo 'Build failed'; read -r; exit 1; }
(sleep 1.5; open http://localhost:3131) &
bun server/index.ts
echo; echo 'The server stopped. If there is an error above, copy it to Claude.'; read -r
