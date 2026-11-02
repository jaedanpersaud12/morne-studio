import { rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { readText, writeText, safe, tree, loadEntities } from "./book";
import type { StudioChapters, Outline, Movement, OutlineRow, ParallelGrid, LockedNumber, Knowledge, KnowledgeFlag, Ledger } from "../shared/types";

// ---------- JSON helpers (files live in the book repo under studio/) ----------
async function readJSON<T>(rel: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readText(rel)) as T; } catch { return fallback; }
}
async function writeJSON(rel: string, data: unknown) { await writeText(rel, JSON.stringify(data, null, 2) + "\n"); }

export const getChaptersMeta = () => readJSON<StudioChapters>("studio/chapters.json", { chapters: {} });
export const putChaptersMeta = (d: StudioChapters) => writeJSON("studio/chapters.json", d);
/** Merge a patch into one chapter's entry. The board sends patches, never the whole file, so a stale tab can't overwrite. */
export async function patchChapterMeta(id: string, patch: Record<string, unknown>) {
  const meta = await getChaptersMeta();
  const allowed = ["dayStart", "dayEnd", "beat", "turn", "endsWorse", "status"];
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
  meta.chapters[id] = { ...(meta.chapters[id] ?? {}), ...clean };
  await putChaptersMeta(meta);
  return meta;
}
export const getKnowledge = () => readJSON<Knowledge>("studio/knowledge.json", { characters: [], secrets: [] });
export const putKnowledge = (d: Knowledge) => writeJSON("studio/knowledge.json", d);
export const getLedger = () => readJSON<Ledger>("studio/ledger.json", { resources: [] });
export const putLedger = (d: Ledger) => writeJSON("studio/ledger.json", d);

const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
const isRule = (c: string[]) => c.every((x) => /^:?-+:?$/.test(x));

// ---------- outline (bible/17) ----------
export async function outline(): Promise<Outline> {
  let txt = "";
  try { txt = await readText("bible/17-book-one-outline.md"); } catch { return { movements: [], rows: [], grid: null }; }
  const movements: Movement[] = [];
  const rows: OutlineRow[] = [];
  let grid: ParallelGrid | null = null;
  let cur: Movement | null = null;
  let inGrid = false;
  let header: string[] | null = null;
  for (const l of txt.split(/\r?\n/)) {
    const m = l.match(/^##\s+Movement\s+(\d+):\s*(.+?)\s*(?:\(([^)]*)\))?\s*$/);
    if (m) {
      const span = m[3] ?? "";
      const ch = span.match(/ch\s*(\d+)\s*[–-]\s*(\d+)/);
      cur = { index: Number(m[1]), name: m[2], span, chapters: ch ? [Number(ch[1]), Number(ch[2])] : null };
      movements.push(cur); header = null; inGrid = false; continue;
    }
    if (/^##\s/.test(l)) { cur = null; header = null; inGrid = /parallel stories/i.test(l); continue; }
    if (/^###\s/.test(l)) { header = null; continue; }
    if (!l.trim().startsWith("|")) { header = null; continue; }
    const c = cells(l);
    if (isRule(c)) continue;
    if (!header) { header = c; if (inGrid && /^movement$/i.test(c[0])) grid = { columns: c.slice(1), rows: [] }; continue; }
    if (inGrid && grid && /^movement$/i.test(header[0])) { grid.rows.push({ movement: c[0], cells: c.slice(1) }); continue; }
    if (cur && /^\d+$/.test(c[0])) {
      const hasTitle = header.some((h) => /^title$/i.test(h));
      rows.push({ number: Number(c[0]), pov: c[1], title: hasTitle ? c[2] : null, beats: hasTitle ? c[3] : c[2], movementIndex: cur.index });
    }
  }
  return { movements, rows, grid };
}

// ---------- locked numbers (bible/00) ----------
export async function lockedNumbers(): Promise<LockedNumber[]> {
  let txt = "";
  try { txt = await readText("bible/00-index.md"); } catch { return []; }
  const sec = txt.split(/^## Locked numbers\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const out: LockedNumber[] = [];
  let seenHeader = false;
  for (const l of sec.split(/\r?\n/)) {
    if (!l.trim().startsWith("|")) continue;
    const c = cells(l);
    if (isRule(c)) continue;
    if (!seenHeader) { seenHeader = true; continue; }
    out.push({ thing: c[0], value: c[1] ?? "" });
  }
  return out;
}

// ---------- paragraphs ----------
export function paragraphs(txt: string) {
  const out: { line: number; text: string }[] = [];
  let buf: string[] = [], start = 0;
  txt.split(/\r?\n/).forEach((l, i) => {
    if (l.trim() === "") { if (buf.length) out.push({ line: start + 1, text: buf.join(" ") }); buf = []; }
    else { if (!buf.length) start = i; buf.push(l); }
  });
  if (buf.length) out.push({ line: start + 1, text: buf.join(" ") });
  return out;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- knowledge lint ----------
export async function knowledgeFlags(): Promise<KnowledgeFlag[]> {
  const k = await getKnowledge();
  if (!k.secrets.length) return [];
  const t = await tree();
  const ents = await loadEntities();
  const povId = (short: string | null) => (short ? ents.find((e) => e.short === short || e.aliases.includes(short))?.id ?? null : null);
  const flags: KnowledgeFlag[] = [];
  for (const ch of t.chapters) {
    const pid = povId(ch.pov);
    if (!pid) continue;
    const paras = paragraphs(await readText(`chapters/${ch.id}/LATEST.md`)).filter((p) => !p.text.startsWith("#"));
    for (const s of k.secrets) {
      const learned = s.knows[pid];
      if (learned !== undefined && learned !== null && learned <= ch.number) continue;
      const kws = s.keywords.map((x) => x.trim()).filter(Boolean);
      if (!kws.length) continue;
      // Capitalised keywords are names: case-sensitive whole words ("Ears" must not match "ears").
      // Lower-case keywords are phrases: case-insensitive, prefix match ("shell" matches "shells").
      const names = kws.filter((k) => /^[A-Z]/.test(k));
      const phrases = kws.filter((k) => !/^[A-Z]/.test(k));
      const res = [
        names.length ? new RegExp(`(?<![A-Za-z])(${names.map(esc).join("|")})(?![A-Za-z])`) : null,
        phrases.length ? new RegExp(`(?<![A-Za-z])(${phrases.map(esc).join("|")})`, "i") : null,
      ].filter(Boolean) as RegExp[];
      for (const p of paras) {
        const m = res.map((r) => p.text.match(r)).find(Boolean);
        if (m) flags.push({ chapter: ch.id, number: ch.number, pov: pid, secret: s.id, line: p.line, text: p.text, keyword: m[1] });
      }
    }
  }
  return flags;
}

// ---------- chapters: create + reorder ----------
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const pad = (n: number) => String(n).padStart(2, "0");

export async function createChapter(number: number, title: string, pov: string) {
  const t = await tree();
  if (!Number.isInteger(number) || number < 1) throw new Error("bad chapter number");
  if (t.chapters.some((c) => c.number === number)) throw new Error(`chapter ${number} already exists`);
  const slug = slugify(title) || `chapter-${number}`;
  const id = `ch${pad(number)}-${slug}`;
  if (existsSync(safe(`chapters/${id}`))) throw new Error(`${id} already exists`);
  await mkdir(safe(`chapters/${id}/versions`), { recursive: true });
  // mirrors scripts/new-chapter.sh
  await writeText(`chapters/${id}/LATEST.md`, `# Chapter ${pad(number)} — ${title}\n\n<!-- POV: ${pov}. Three scenes: set up, complicate, turn. End on a turn. See bible/14-writing-rules.md -->\n\n`);
  await writeText(`chapters/${id}/CHANGELOG.md`, `# Changelog: ${id}\n`);
  const meta = await getChaptersMeta();
  meta.chapters[id] = { ...(meta.chapters[id] ?? {}), status: "outline" };
  await putChaptersMeta(meta);
  return { id };
}

export async function reorder(ids: string[]) {
  const t = await tree();
  const existing = t.chapters.map((c) => c.id);
  if (ids.length !== existing.length || new Set(ids).size !== ids.length || ids.some((i) => !existing.includes(i)))
    throw new Error("order must list every chapter exactly once");
  const plan = ids.map((id, i) => {
    const c = t.chapters.find((x) => x.id === id)!;
    return { from: id, to: `ch${pad(i + 1)}-${c.slug}`, n: i + 1 };
  });
  const moves = plan.filter((p) => p.from !== p.to);
  if (!moves.length) return { changed: 0, plan };
  const dir = safe("chapters");
  const stamp = Date.now();
  for (const p of moves) await rename(path.join(dir, p.from), path.join(dir, `__reorder_${stamp}_${p.from}`));
  for (const p of moves) await rename(path.join(dir, `__reorder_${stamp}_${p.from}`), path.join(dir, p.to));
  for (const p of plan) {
    const f = `chapters/${p.to}/LATEST.md`;
    const s = await readText(f);
    const s2 = s.replace(/^#\s+Chapter\s+\d+(\s*[—–-])/m, (_m, dash) => `# Chapter ${p.n}${dash}`);
    if (s2 !== s) await writeText(f, s2);
  }
  const meta = await getChaptersMeta();
  const next: StudioChapters = { chapters: {} };
  for (const [k, v] of Object.entries(meta.chapters)) if (!existing.includes(k)) next.chapters[k] = v;
  for (const p of plan) if (meta.chapters[p.from]) next.chapters[p.to] = meta.chapters[p.from];
  await putChaptersMeta(next);
  return { changed: moves.length, plan };
}

