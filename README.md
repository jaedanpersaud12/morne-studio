# Morne Bay Studio

A writing desk for the `morne-bay` book repo. The book repo stays the source of truth: the app reads and writes its markdown, keeps planning data in `studio/*.json` inside it, snapshots versions the way `scripts/save-version.sh` does, and keeps both your machines in sync through git.

## Run

Double-click **Start Studio.cmd** (Windows) or **start-studio.command** (Mac). It installs on first run, builds, opens http://localhost:3131 and keeps the server running in that window. In Chrome or Edge, use the install icon in the address bar to give it its own window and a taskbar/dock icon.

For working on the app itself: `bun install` then `bun dev`, and open http://localhost:5173 (hot reload). The server runs on :3131 and reads the book from `studio.config.json` → `bookDir` (default `../../Documents/morne-bay`), or `BOOK_DIR=... bun dev`.

## Views (Ctrl/⌘ + 1–6)

- **Write**: markdown editor (Ctrl+S save, Ctrl+\ focus). Every character name underlined: hover for a card, Ctrl-click to open it in Cast.
- **Board**: a card per chapter grouped by movement from bible/17, with days, beat, turn, status and an "ends worse?" check. Planned chapters from the outline appear as ghost cards with Create. Drag a card onto another to move it: folders, headings, versions and metadata renumber together. Words-by-POV bar on top.
- **Timeline**: days covered by each chapter, one lane per POV; below it the parallel-stories grid from bible/17 lined up with the chapters in each movement.
- **Who knows**: secrets × characters, each cell the chapter they learn it, with an as-of-chapter slider. The lint lists paragraphs where a POV character touches a secret before learning it; click to jump.
- **Ledger**: locked numbers from bible/00; every "N noun" in the prose for those nouns (two hundred kids, sixteen adults…) with the ones that differ from the locked value flagged; resources by day (IV bags, sleepers, fuel, gas, formula…) with step charts and editable tables.
- **Map**: fault lines (cast overview) and bonds (bible/09) between the cast. Click a person to isolate their lines.

Top bar: today's words against your target (click for a 16-week calendar, streak and 15/25/45-minute sprints), and in Write view ▶ read.

## Right panel (Write view)

- **Claude** (Ctrl+K): Tighten (with Replace selection), Check against bible, What does this cost?, Describe, and Ask the book (searches the manuscript and cites chapter + line). Uses bible/14, bible/19, bible/00 and the cast files of anyone named as its rulebook. Needs an Anthropic API key: gear icon → Settings. The key is stored in `studio.local.json` beside the app, which git ignores.
- **Notes**: margin notes anchored to a quote, never written into the prose (select text, Ctrl+Alt+M). Highlighted in the editor; click one to open it. Resolve, reopen, delete; this file or all files.
- **Cast**: presence heat-map, then a character's card and every paragraph that names them.
- **Tics**: counts from bible/14; click one to highlight every match in the editor. Dialogue pass lists every quoted line with its named speaker, flagging the ones with none.
- **History**: sync state and pull/push/commit; versions of this chapter with snapshot and word-level diff; export the whole book as EPUB, Word (.docx), or PDF through a 5.5 × 8.5 in print view.

## Read aloud (Settings → Read aloud)

Paste an ElevenLabs key and pick a narrator voice, plus a voice per POV character if you like. ▶ read starts at the cursor's paragraph, highlights each paragraph as it's read and scrolls with it.

## Sync between machines (Settings → Sync)

- **Commit on save**: each save commits that file; saves of the same file within 15 minutes fold into one commit. Board, Who knows and Ledger edits commit too.
- **Push automatically**: 45 seconds after the last commit.
- **Pull automatically**: on window focus and every 2 minutes. Clean files reload in place.
- If both machines changed the same paragraph, a dialog shows both sides per paragraph: pick one, or keep both. Nothing changes until you press Merge.

Git must know who you are on each machine (`git config --global user.name` / `user.email`) and be able to push without a prompt (it already can if `git push` works in your terminal).

Progress is kept per machine in `studio/progress/<machine>.json`, so two machines writing on the same day never conflict; the badge adds them up.

Extra names for a character: `bible/cast/aliases.json` → `{ "tock": ["Tobias"] }`.
