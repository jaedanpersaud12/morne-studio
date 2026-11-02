import { Database } from "bun:sqlite";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOOK, tree, loadEntities } from "./book";
import type { Backlink, SearchHit } from "../shared/types";

/** In-memory FTS5 index over paragraphs of every chapter LATEST.md and bible file. Rebuilt on demand (<100 ms). */
const db = new Database(":memory:");
db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS para USING fts5(file, kind, title, line UNINDEXED, text, tokenize='porter unicode61')`);
const ins = db.prepare(`INSERT INTO para(file, kind, title, line, text) VALUES (?, ?, ?, ?, ?)`);

let builtAt = 0;
export async function rebuild() {
  const t = await tree();
  db.run("DELETE FROM para");
  const files: { file: string; kind: "chapter" | "bible"; title: string }[] = [
    ...t.chapters.map((c) => ({ file: `chapters/${c.id}/LATEST.md`, kind: "chapter" as const, title: `${c.number}. ${c.title}` })),
    ...t.bible.map((b) => ({ file: b.path, kind: "bible" as const, title: b.title })),
  ];
  const tx = db.transaction((rows: any[]) => rows.forEach((r) => ins.run(...r)));
  const rows: any[] = [];
  for (const f of files) {
    const txt = await readFile(path.join(BOOK, f.file), "utf8");
    const lines = txt.split(/\r?\n/);
    let start = 0, buf: string[] = [];
    const flush = () => {
      const text = buf.join("\n").trim();
      if (text) rows.push([f.file, f.kind, f.title, start + 1, text]);
      buf = [];
    };
    lines.forEach((l, i) => {
      if (l.trim() === "") { flush(); start = i + 1; }
      else { if (!buf.length) start = i; buf.push(l); }
    });
    flush();
  }
  tx(rows);
  builtAt = Date.now();
  return rows.length;
}
export async function ensure() { if (Date.now() - builtAt > 3000) await rebuild(); }

export async function search(q: string, limit = 60): Promise<SearchHit[]> {
  await ensure();
  const safeQ = q.trim().replace(/["']/g, " ").split(/\s+/).filter(Boolean).map((w) => `"${w}"`).join(" ");
  if (!safeQ) return [];
  let rows = db.query(`SELECT file, kind, title, line, snippet(para, 4, '\u0001', '\u0002', '…', 22) AS text, bm25(para) AS score FROM para WHERE para MATCH ? ORDER BY score LIMIT ?`).all(safeQ, limit) as any[];
  if (!rows.length && safeQ.includes(" ")) {
    const loose = (await searchAny(q, { limit })).map((r) => ({ ...r, score: -r.score }));
    rows = loose as any[];
  }
  const clean = (s: string) => s.replace(/\|?\s*-{3,}\s*\|?/g, " ").replace(/\s*\|\s*/g, " · ").replace(/[#*_>`]+/g, "").replace(/\s{2,}/g, " ").trim();
  return rows.map((r) => ({ ...r, text: clean(r.text), score: -r.score }));
}

const STOP = new Set("a an and are as at be been but by can could did do does for from had has have he her hers him his how i if in into is it its just me my no not of on or our she so than that the their them then there these they this those to up was we were what when where which who whom why will with would you your anyone anybody someone something mentioned mention since ever any every does about after before ch chapter chapters book".split(" "));

/** Keyword search for the AI: drops stopwords, ORs the rest with prefix matching, expands character names to all their aliases.
 *  Returns whole paragraphs (trimmed), ranked by bm25, so the model reads real context. */
export async function searchAny(q: string, opts: { scope?: "chapters" | "bible" | "all"; limit?: number } = {}): Promise<(SearchHit & { full: string })[]> {
  await ensure();
  const ents = await loadEntities();
  const words = (q.toLowerCase().match(/[a-z0-9À-ɏ]+(?:'[a-z]+)?/g) ?? []).map((w) => w.replace(/'s$/, "")).filter((w) => w.length > 1 && !STOP.has(w));
  const nameTerms = new Set<string>(), topicTerms = new Set<string>();
  for (const w of words) {
    const e = ents.find((x) => x.aliases.some((a) => a.toLowerCase() === w) || x.short.toLowerCase() === w);
    if (e) e.aliases.forEach((a) => a.split(/\s+/).forEach((p) => { const k = p.toLowerCase().replace(/[^a-z0-9]/g, ""); if (k.length > 2) nameTerms.add(k); }));
    else topicTerms.add(w);
  }
  const or = (s: Set<string>) => [...s].slice(0, 16).map((w) => `"${w.replace(/"/g, "")}"*`).join(" OR ");
  if (!nameTerms.size && !topicTerms.size) return [];
  const scope = opts.scope ?? "all";
  const where = scope === "all" ? "" : ` AND kind = '${scope === "chapters" ? "chapter" : "bible"}'`;
  const run = (match: string) => db.query(`SELECT file, kind, title, line, text, snippet(para, 4, '\u0001', '\u0002', '…', 22) AS snip, bm25(para) AS score FROM para WHERE para MATCH ?${where} ORDER BY score LIMIT ?`).all(match, (opts.limit ?? 25) * 2) as any[];
  // a name and a topic: both must appear; otherwise either
  let rows: any[] = nameTerms.size && topicTerms.size ? run(`(${or(nameTerms)}) AND (${or(topicTerms)})`) : [];
  if (rows.length < 3) rows = rows.concat(run([or(nameTerms), or(topicTerms)].filter(Boolean).join(" OR ")).filter((r) => !rows.some((x) => x.file === r.file && x.line === r.line)));
  // bare headings carry no information
  rows = rows.filter((r) => !/^#{1,6}\s/.test(String(r.text)) || String(r.text).length > 80).slice(0, opts.limit ?? 25);
  return rows.map((r) => ({ file: r.file, kind: r.kind, title: r.title, line: r.line, text: r.snip, full: String(r.text).slice(0, 900), score: -r.score }));
}

/** Every paragraph in which an entity (any alias, word-bounded) appears. Chapters first, in order, then bible. */
export async function backlinks(entityId: string): Promise<Backlink[]> {
  await ensure();
  const e = (await loadEntities()).find((x) => x.id === entityId);
  if (!e) return [];
  const re = new RegExp(`(^|[^A-Za-z])(${e.aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=[^A-Za-z]|$)`);
  const rows = db.query(`SELECT file, kind, title, line, text FROM para ORDER BY kind DESC, file, line`).all() as Backlink[];
  return rows.filter((r) => re.test(r.text) && r.file !== e.file);
}

/** Counts of how often each entity is named per chapter: the POV / presence matrix. */
export async function presence(): Promise<{ chapters: string[]; rows: { id: string; short: string; counts: number[] }[] }> {
  await ensure();
  const t = await tree();
  const ents = await loadEntities();
  const texts = await Promise.all(t.chapters.map((c) => readFile(path.join(BOOK, "chapters", c.id, "LATEST.md"), "utf8")));
  const rows = ents.map((e) => {
    const re = new RegExp(`\\b(${e.aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "g");
    return { id: e.id, short: e.short, counts: texts.map((tx) => (tx.match(re) ?? []).length) };
  }).filter((r) => r.counts.some((n) => n > 0));
  rows.sort((a, b) => b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0));
  return { chapters: t.chapters.map((c) => `${c.number}`), rows };
}
