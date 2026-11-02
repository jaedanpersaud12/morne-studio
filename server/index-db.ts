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
  const rows = db.query(`SELECT file, kind, title, line, text, bm25(para) AS score FROM para WHERE para MATCH ? ORDER BY score LIMIT ?`).all(safeQ, limit) as any[];
  return rows.map((r) => ({ ...r, score: -r.score }));
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
