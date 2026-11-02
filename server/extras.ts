import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import { readText, writeText, safe, tree, loadEntities, words } from "./book";
import { lockedNumbers, paragraphs } from "./studio-data";
import type { Note, Progress, GraphData, NumberHit } from "../shared/types";

async function readJSON<T>(rel: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readText(rel)) as T; } catch { return fallback; }
}
const writeJSON = (rel: string, d: unknown) => writeText(rel, JSON.stringify(d, null, 2) + "\n");

// ---------------- margin notes (studio/notes.json) ----------------
// Notes anchor to a quote, not a position, so they survive edits. Every change is a server-side merge by id.
const NOTES = "studio/notes.json";
export const listNotes = async () => (await readJSON<{ notes: Note[] }>(NOTES, { notes: [] })).notes;
export async function addNote(n: Pick<Note, "file" | "quote" | "line" | "body">) {
  const notes = await listNotes();
  const note: Note = { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, file: n.file, quote: n.quote.slice(0, 600), line: n.line, body: n.body, resolved: false, created: new Date().toISOString(), machine: machine() };
  notes.push(note);
  await writeJSON(NOTES, { notes });
  return note;
}
export async function patchNote(id: string, patch: Partial<Pick<Note, "body" | "resolved" | "line">>) {
  const notes = await listNotes();
  const i = notes.findIndex((n) => n.id === id);
  if (i < 0) throw new Error("note not found");
  notes[i] = { ...notes[i], ...Object.fromEntries(Object.entries(patch).filter(([k]) => ["body", "resolved", "line"].includes(k))) };
  await writeJSON(NOTES, { notes });
  return notes[i];
}
export async function deleteNote(id: string) {
  const notes = (await listNotes()).filter((n) => n.id !== id);
  await writeJSON(NOTES, { notes });
}
/** When a chapter is renumbered, its notes follow. */
export async function renameNoteFiles(map: Record<string, string>) {
  const notes = await listNotes();
  let changed = false;
  for (const n of notes) if (map[n.file]) { n.file = map[n.file]; changed = true; }
  if (changed) await writeJSON(NOTES, { notes });
}

// ---------------- progress (studio/progress/<machine>.json) ----------------
// One file per machine so two machines writing on the same day never conflict.
export const machine = () => os.hostname().toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40) || "this-machine";
export const progressFile = () => `studio/progress/${machine()}.json`;
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Record a save's word delta against today. Only chapter prose counts, not the bible. */
export async function recordSave(relPath: string, before: string | null, after: string) {
  if (!/^chapters\/[^/]+\/LATEST\.md$/.test(relPath)) return false;
  const delta = words(after) - (before == null ? 0 : words(before));
  if (!delta) return false;
  const f = progressFile();
  const p = await readJSON<{ days: Progress["days"] }>(f, { days: {} });
  const d = (p.days[today()] ??= { added: 0, removed: 0 });
  if (delta > 0) d.added += delta; else d.removed += -delta;
  await writeJSON(f, p);
  return true;
}
export async function progress(target: number): Promise<Progress> {
  const days: Progress["days"] = {};
  const dir = safe("studio/progress");
  const machines: string[] = [];
  if (existsSync(dir)) {
    for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) {
      machines.push(f.replace(/\.json$/, ""));
      const p = await readJSON<{ days: Progress["days"] }>(`studio/progress/${f}`, { days: {} });
      for (const [k, v] of Object.entries(p.days)) {
        const d = (days[k] ??= { added: 0, removed: 0 });
        d.added += v.added; d.removed += v.removed;
      }
    }
  }
  // streak: consecutive days with words added, ending today (or yesterday, so the streak doesn't vanish at breakfast)
  let streak = 0;
  const cur = new Date();
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (!(days[key(cur)]?.added > 0)) cur.setDate(cur.getDate() - 1);
  while (days[key(cur)]?.added > 0) { streak++; cur.setDate(cur.getDate() - 1); }
  return { days, today: today(), target, streak, machines };
}

// ---------------- map: fault lines + bonds ----------------
export async function graph(): Promise<GraphData> {
  const ents = await loadEntities();
  const find = (s: string) => ents.find((e) => e.group !== "supporting" && (e.short === s || e.aliases.includes(s)))
    ?? ents.find((e) => e.short === s || e.aliases.includes(s));
  const nodes = new Map<string, GraphData["nodes"][number]>();
  const node = (raw: string) => {
    const name = raw.trim();
    const e = find(name.split(/[,;]/)[0].trim());
    const id = e?.id ?? `x:${name.toLowerCase().slice(0, 40)}`;
    if (!nodes.has(id)) nodes.set(id, { id, label: e?.short ?? name.split(/[,;]/)[0].trim(), entity: !!e, group: e?.group ?? "other" });
    return id;
  };
  const edges: GraphData["edges"] = [];
  // fault lines: ```  A ──(label)── B  ```  in bible/cast/_overview.md
  try {
    const ov = await readText("bible/cast/_overview.md");
    const block = ov.split(/^## The fault-line map/m)[1]?.match(/```\s*\n([\s\S]*?)```/)?.[1] ?? "";
    for (const l of block.split(/\r?\n/)) {
      const m = l.match(/^(.+?)\s*─+\((.+?)\)─+\s*(.+)$/);
      if (!m) continue;
      const lefts = m[1].split(/\s*\+\s*/);
      const right = m[3].trim();
      for (const left of lefts) {
        const a = node(left);
        if (/^(himself|herself|themselves)$/i.test(right)) { edges.push({ from: a, to: a, label: m[2], kind: "fault", note: right, source: "bible/cast/_overview.md" }); continue; }
        const b = node(right);
        edges.push({ from: a, to: b, label: m[2], kind: "fault", note: right.includes(",") || right.includes(";") ? right : undefined, source: "bible/cast/_overview.md" });
      }
    }
  } catch {}
  // bonds: "### A and B: label" in bible/09-relationships.md
  try {
    const rel = await readText("bible/09-relationships.md");
    for (const m of rel.matchAll(/^###\s+(.+?)\s+and\s+(.+?):\s*(.+)$/gm)) {
      const a = node(m[1]), b = node(m[2].replace(/^the\s+/i, "the "));
      edges.push({ from: a, to: b, label: m[3].trim(), kind: "bond", source: "bible/09-relationships.md" });
    }
    for (const m of rel.matchAll(/^###\s+(\w+)\s+and\s+the\s+(.+)$/gm)) {
      if (/:/.test(m[0])) continue;
      const a = node(m[1]), b = node(`the ${m[2]}`);
      edges.push({ from: a, to: b, label: `the ${m[2]}`, kind: "bond", source: "bible/09-relationships.md" });
    }
  } catch {}
  return { nodes: [...nodes.values()], edges };
}

// ---------------- numbers in the prose vs locked numbers ----------------
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
function parseNum(s: string): number | null {
  const t = s.toLowerCase().replace(/,/g, "");
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](one|two|three|four|five|six|seven|eight|nine)$/);
  if (m) return WORDS[m[1]] + WORDS[m[2]];
  const hu = t.match(/^(\w+)[- ]hundred(?:[- ](?:and[- ])?(\w+(?:[- ]\w+)?))?$/);
  if (hu && WORDS[hu[1]]) return WORDS[hu[1]] * 100 + (hu[2] ? parseNum(hu[2]) ?? 0 : 0);
  const th = t.match(/^(\w+)[- ]thousand$/);
  if (th && WORDS[th[1]]) return WORDS[th[1]] * 1000;
  return WORDS[t] ?? null;
}
const UNIT = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";
const NUM_WORD = "(\\d+(?:,\\d{3})*|" + UNIT + "[- ]hundred(?:[- ](?:and[- ])?" + UNIT + "(?:[- ]" + UNIT + ")?)?|(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[- ](?:one|two|three|four|five|six|seven|eight|nine)|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)(?:[- ]thousand)?)";

/** Pull "N noun" facts out of the locked-numbers table, then find every "N noun" in the chapters and compare. */
export async function numberHits(): Promise<{ locked: { noun: string; values: number[]; source: string }[]; hits: NumberHit[] }> {
  const ln = await lockedNumbers();
  const facts = new Map<string, { values: Set<number>; source: string }>();
  for (const l of ln) {
    for (const m of l.value.matchAll(/(?<![\d,])(\d+(?:,\d{3})*)(?:\s+to\s+(\d+(?:,\d{3})*))?\s+([a-z]+)/gi)) {
      const noun = m[3].toLowerCase();
      // only plural count nouns ("houses", "adults", "litres"); skips "1 in 10", "50, skin", "aged", "under"
      if (noun.length < 4 || !noun.endsWith("s") || ["under", "aged", "powered", "real", "breaths"].includes(noun) && noun !== "breaths") continue;
      const lo = Number(m[1].replace(/,/g, "")), hi = m[2] ? Number(m[2].replace(/,/g, "")) : lo;
      const f = facts.get(noun) ?? { values: new Set<number>(), source: l.thing };
      for (let v = lo; v <= hi && v - lo < 20; v++) f.values.add(v);
      facts.set(noun, f);
    }
  }
  const nouns = [...facts.keys()];
  if (!nouns.length) return { locked: [], hits: [] };
  const ADJ = "(?:more|grown|little|small|old|young|sleeping|awake|other|whole|full|empty)\\s+";
  const re = new RegExp(`(?<![\\w-])${NUM_WORD}\\s+(?:${ADJ})?(${nouns.map((n) => n.replace(/s$/, "")).join("|")})s?\\b`, "gi");
  const hits: NumberHit[] = [];
  const t = await tree();
  for (const c of t.chapters) {
    for (const p of paragraphs(await readText(`chapters/${c.id}/LATEST.md`))) {
      for (const m of p.text.matchAll(re)) {
        const n = parseNum(m[1]);
        if (n == null) continue;
        const nounKey = nouns.find((x) => x.replace(/s$/, "") === m[2].toLowerCase().replace(/s$/, "")) ?? m[2].toLowerCase();
        const f = facts.get(nounKey)!;
        const at = m.index ?? 0;
        hits.push({ chapter: c.id, number: c.number, line: p.line, phrase: m[0], value: n, noun: nounKey, matches: f.values.has(n), context: p.text.slice(Math.max(0, at - 70), at + m[0].length + 70) });
      }
    }
  }
  return { locked: [...facts.entries()].map(([noun, f]) => ({ noun, values: [...f.values].sort((a, b) => a - b), source: f.source })), hits };
}
