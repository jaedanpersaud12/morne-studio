# Morne Bay Studio

A writing desk for the `morne-bay` book repo. The book repo stays the source of truth: the app reads and writes its markdown, keeps planning data in `studio/*.json` inside it, snapshots versions the way `scripts/save-version.sh` does, and keeps both your machines in sync through git.

## Run

```
bun install
bun dev
```
Open http://localhost:5173. The server runs on :3131 and reads the book from `studio.config.json` → `bookDir` (default `../../Documents/morne-bay`), or `BOOK_DIR=... bun dev`.

## Views (Ctrl/⌘ + 1–5)

- **Write**: markdown editor (Ctrl+S save, Ctrl+\ focus). Every character name underlined: hover for a card, Ctrl-click to open it in Cast.
- **Board**: a card per chapter grouped by movement from bible/17, with days, beat, turn, status and an "ends worse?" check. Planned chapters from the outline appear as ghost cards with Create. Drag a card onto another to move it: folders, headings, versions and metadata renumber together. Words-by-POV bar on top.
- **Timeline**: days covered by each chapter, one lane per POV; below it the parallel-stories grid from bible/17 lined up with the chapters in each movement.
- **Who knows**: secrets × characters, each cell the chapter they learn it, with an as-of-chapter slider. The lint lists paragraphs where a POV character touches a secret before learning it; click to jump.
- **Ledger**: locked numbers from bible/00 and resources by day (IV bags, sleepers, fuel, gas, formula…), each with a step chart and an editable table.

## Right panel (Write view)

- **Claude** (Ctrl+K): Tighten (with Replace selection), Check against bible, What does this cost?, Describe, and Ask the book (searches the manuscript and cites chapter + line). Uses bible/14, bible/19, bible/00 and the cast files of anyone named as its rulebook. Needs an Anthropic API key: gear icon → Settings. The key is stored in `studio.local.json` beside the app, which git ignores.
- **Cast**: presence heat-map, then a character's card and every paragraph that names them.
- **Versions**: snapshot with a note; word-level diff of any version against now.
- **Tics**: counts from bible/14; click one to highlight every match in the editor. Dialogue pass lists every quoted line with its named speaker, flagging the ones with none.
- **Sync**: state, pull/push now, commit, build manuscript, history of the open file.

## Sync between machines (Settings → Sync)

- **Commit on save**: each save commits that file; saves of the same file within 15 minutes fold into one commit. Board, Who knows and Ledger edits commit too.
- **Push automatically**: 45 seconds after the last commit.
- **Pull automatically**: on window focus and every 2 minutes. Clean files reload in place.
- If both machines changed the same paragraph, a dialog shows both sides per paragraph: pick one, or keep both. Nothing changes until you press Merge.

Git must know who you are on each machine (`git config --global user.name` / `user.email`) and be able to push without a prompt (it already can if `git push` works in your terminal).

Extra names for a character: `bible/cast/aliases.json` → `{ "tock": ["Tobias"] }`.
