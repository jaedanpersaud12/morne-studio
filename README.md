# Morne Bay Studio

A writing desk for the `morne-bay` book repo. The repo stays the source of truth: the app reads markdown, writes markdown, snapshots versions the same way `scripts/save-version.sh` does, and talks to git.

## Run

```
bun install
bun dev
```
Open http://localhost:5173. The server runs on :3131 and reads the book from `studio.config.json` → `bookDir` (default `../../Documents/morne-bay`), or `BOOK_DIR=... bun dev`.

## What it does (v0.1)

- Chapters + bible in the sidebar, full-text search across all of it (SQLite FTS5, rebuilt on save)
- Markdown editor (CodeMirror 6): ⌘S save, ⌘\ focus mode, byte-for-byte round trip
- Every character name underlined; hover for a card, ⌘/Ctrl-click to open it
- Cast tab: presence heat-map (who is named how often per chapter) + chips
- Links tab: every paragraph that names the selected character, chapters first; click to jump
- Versions tab: snapshot with a note (writes `versions/vNNN-...md` + CHANGELOG line); word-level diff of any version vs now
- Tics tab: the counts from `bible/14 → Tics to count` (regex, no AI) + section enders
- Git tab: status, pull / push, commit all, build manuscript, history of the open file

Extra aliases for a character: `bible/cast/aliases.json` → `{ "tock": ["Tobias"], "dot-granny-vale": ["Granny"] }`.

## Next
Corkboard/timeline, who-knows-what matrix, inline Claude with the bible as system prompt, read-aloud per POV, Tauri wrap.
