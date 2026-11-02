#!/usr/bin/env bun
/**
 * Morne Bay Studio as an MCP server (stdio).
 *
 * Every tool goes through Studio's own HTTP API, so an AI edit takes the same path as your typing:
 * saved, auto-committed to git (undo from History), and pushed live into any open Studio window.
 * If Studio isn't running, this process starts its server itself, so the tools always work.
 *
 * Claude Desktop config:  { "command": "bun", "args": ["<path>/morne-bay-studio/mcp.ts"] }
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// stdout belongs to the MCP protocol: route every log to stderr
console.log = console.error;
console.info = console.error;

const cfg = JSON.parse(readFileSync(path.join(import.meta.dir, "studio.config.json"), "utf8")) as { port: number };
const BASE = `http://127.0.0.1:${process.env.PORT ?? cfg.port ?? 3131}/api`;
const HDR = { "content-type": "application/json", "x-studio-source": "mcp" };

async function ensureServer() {
  try { const r = await fetch(`${BASE}/tree`, { signal: AbortSignal.timeout(1500) }); if (r.ok) return "attached to the running Studio"; } catch {}
  const mod = await import("./server/index.ts");
  const srv = Bun.serve(mod.default as any);
  // if the author launches Studio, it asks this background server to step aside; the MCP keeps running and reattaches
  mod.lifecycle.stop = () => { srv.stop(true); };
  return "started Studio's server in the background";
}

async function call<T = any>(p: string, init?: RequestInit): Promise<T> {
  const go = () => fetch(BASE + p, { ...init, headers: { ...HDR, ...(init?.headers ?? {}) } });
  let r: Response;
  try { r = await go(); }
  catch {
    // Studio restarting: wait for it, then start our own if it never comes back
    await Bun.sleep(2000);
    try { r = await go(); } catch { await ensureServer(); r = await go(); }
  }
  const text = await r.text();
  if (!r.ok) throw new Error(text.replace(/^\{"error":"|"\}$/g, "") || `${r.status} ${r.statusText}`);
  try { return JSON.parse(text); } catch { return text as T; }
}
const get = <T = any>(p: string) => call<T>(p);
const send = <T = any>(method: string, p: string, body?: unknown) => call<T>(p, { method, body: body === undefined ? undefined : JSON.stringify(body) });
const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();

const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
const json = (v: unknown) => ok(JSON.stringify(v, null, 2));
const fail = (e: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true });
// ---- live activity: every call shows up in Studio as it happens ----
type Meta = { path?: string; from?: number; to?: number; diff?: { old: string; new: string }; summary?: string };
type Ctx = { meta: Meta };
const post = (a: Record<string, unknown>) => fetch(`${BASE}/agent/activity`, { method: "POST", headers: HDR, body: JSON.stringify(a) }).catch(() => {});
const clip = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const chLabel = (p: string) => p.match(/^chapters\/ch0?(\d+)-/)?.[1] ? `ch ${p.match(/^chapters\/ch0?(\d+)-/)![1]}` : p.replace(/^bible\//, "");
async function describe(tool: string, a: any): Promise<{ label: string } & Meta> {
  const file = a?.path ? await chapterPath(a.path).catch(() => a.path) : undefined;
  switch (tool) {
    case "list_files": return { label: "Looking over the book" };
    case "read_file": return { label: `Reading ${chLabel(file!)}${a.start_line ? ` L${a.start_line}${a.end_line ? `–${a.end_line}` : ""}` : ""}`, path: file, from: a.start_line ?? 1, to: a.end_line ?? (a.start_line ? a.start_line + 199 : undefined) };
    case "search": return { label: `Searching “${clip(a.query, 32)}”` };
    case "ask_book": return { label: `Researching “${clip(a.question, 36)}”` };
    case "list_notes": return { label: `Reading notes${file ? ` on ${chLabel(file)}` : ""}`, path: file };
    case "edit_file": return { label: `Editing ${chLabel(file!)}${a.label ? ` · ${clip(a.label, 30)}` : ""}`, path: file };
    case "write_file": return { label: `Writing ${chLabel(a.path)}`, path: a.path };
    case "add_note": return { label: `Adding a note to ${chLabel(file!)}`, path: file };
    case "snapshot": return { label: `Snapshotting ${chLabel(await chapterPath(a.chapter).catch(() => a.chapter))}` };
    case "get_board": return { label: "Reading the board" };
    case "update_board": return { label: `Updating the board · ${a.chapter_id}` };
    case "get_knowledge": return { label: "Checking who knows what" };
    case "update_knowledge": return { label: `Updating who knows what${a.label ? ` · ${clip(a.label, 28)}` : ""}` };
    case "get_ledger": return { label: "Reading the ledger" };
    case "canon_checks": return { label: "Running canon checks" };
    case "build_manuscript": return { label: "Building the manuscript" };
    case "sync_status": return { label: "Checking sync" };
    case "sync": return { label: "Syncing with GitHub" };
    case "wiki_index": return { label: "Opening the wiki" };
    case "wiki_page": return { label: `Wiki · ${chLabel(file ?? a.path)}`, path: file };
    case "character": return { label: `Looking up ${clip(a.name, 24)}` };
    case "open_in_studio": return { label: `Pointing at ${chLabel(file!)}${a.line ? ` L${a.line}` : ""}`, path: file, from: a.line, to: a.line };
    default: return { label: tool };
  }
}
const wrap = <A,>(tool: string, f: (a: A, ctx: Ctx) => Promise<ReturnType<typeof ok>>) => async (a: A) => {
  const id = `${tool}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const t0 = Date.now();
  const d = await describe(tool, a).catch(() => ({ label: tool }));
  post({ id, tool, state: "running", at: t0, ...d });
  const ctx: Ctx = { meta: {} };
  try {
    const r = await f(a, ctx);
    const first = r.content[0].text.split("\n").find((l) => l.trim()) ?? "";
    const plain = /^[\[{]/.test(first.trim()) || /^[A-Z ]+(\(\d+\))?$/.test(first.trim()) ? undefined : clip(first, 90);
    post({ id, tool, state: "done", at: t0, ms: Date.now() - t0, ...d, ...ctx.meta, summary: ctx.meta.summary ?? plain });
    return r;
  } catch (e) {
    post({ id, tool, state: "error", at: t0, ms: Date.now() - t0, ...d, summary: e instanceof Error ? e.message : String(e) });
    return fail(e);
  }
};
const unmark = (s: string) => s.replace(/[\u0001\u0002]/g, "");

async function chapterPath(ref: string): Promise<string> {
  if (ref.includes("/")) return ref;
  const tree = await get("/tree");
  const n = Number(ref.replace(/^ch\s*/i, ""));
  const c = tree.chapters.find((x: any) => x.number === n || x.id === ref || x.title.toLowerCase() === ref.toLowerCase());
  if (!c) throw new Error(`No chapter "${ref}". Use list_files.`);
  return `chapters/${c.id}/LATEST.md`;
}

const server = new McpServer(
  { name: "morne-bay-studio", version: "1.0.0" },
  { instructions: "Tools for Morne Bay, a novel managed in Morne Bay Studio. Chapters are canon over the bible. Read before you edit; prefer edit_file (exact find-and-replace) over write_file. Every write is auto-committed to git and shows up live in the author's open Studio window. Respect the author's voice: suggest, don't rewrite whole scenes unless asked." },
);

// ---------------- reading ----------------
server.registerTool("list_files", {
  title: "List chapters and bible files",
  description: "Every chapter (number, title, POV, words, path) and every bible file (title, path).",
  inputSchema: {},
}, wrap("list_files", async (_a, ctx) => {
  const t = await get("/tree");
  ctx.meta = { summary: `${t.chapters.length} chapters · ${t.bible.length} bible files` };
  const ch = t.chapters.map((c: any) => `ch ${c.number}  ${c.title}  · ${c.pov ?? "?"} POV · ${c.words} words · ${`chapters/${c.id}/LATEST.md`}`);
  const bible = t.bible.map((b: any) => `${b.title}  · ${b.path}`);
  return ok(`CHAPTERS\n${ch.join("\n")}\n\nBIBLE\n${bible.join("\n")}${t.other?.length ? `\n\nOTHER\n${t.other.map((o: any) => o.path).join("\n")}` : ""}`);
}));

server.registerTool("read_file", {
  title: "Read a chapter or bible file",
  description: "Returns the file with line numbers. `path` can be a repo path (bible/cast/kit.md) or a chapter number (\"6\"). Long files: pass a line range.",
  inputSchema: { path: z.string(), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() },
}, wrap("read_file", async ({ path: p, start_line, end_line }, ctx) => {
  const file = await chapterPath(p);
  const { content } = await get(`/file${q({ path: file })}`);
  const lines: string[] = content.split("\n");
  const a = (start_line ?? 1) - 1, b = Math.min(lines.length, end_line ?? (start_line ? start_line + 199 : 600));
  const body = lines.slice(a, b).map((l, i) => `${a + i + 1}\t${l}`).join("\n");
  ctx.meta = { path: file, from: a + 1, to: b, summary: `${b - a} lines` };
  return ok(`${file} (lines ${a + 1}-${b} of ${lines.length})\n${body}${b < lines.length ? `\n… ${lines.length - b} more lines; pass start_line=${b + 1}` : ""}`);
}));

server.registerTool("search", {
  title: "Search the book",
  description: "Full-text search over every chapter and bible file. Short keyword queries work best.",
  inputSchema: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
}, wrap("search", async ({ query, limit }, ctx) => {
  const hits = (await get<any[]>(`/search${q({ q: query })}`)).slice(0, limit ?? 20);
  if (!hits.length) return ok(`No hits for "${query}".`);
  ctx.meta = { summary: `${hits.length} passage${hits.length === 1 ? "" : "s"} · ${[...new Set(hits.map((h) => chLabel(h.file)))].slice(0, 4).join(", ")}` };
  return ok(hits.map((h) => `[${h.kind === "chapter" ? "ch" : "bible"}] ${h.file} L${h.line} — ${h.title}\n  ${unmark(h.text).slice(0, 300)}`).join("\n"));
}));

server.registerTool("ask_book", {
  title: "Ask the book (research agent)",
  description: "Studio's own research agent: searches chapters and bible, reads passages, and answers with line citations. Uses the Anthropic key in Studio's Settings.",
  inputSchema: { question: z.string() },
}, wrap("ask_book", async ({ question }) => {
  const r = await fetch(`${BASE}/claude`, { method: "POST", headers: HDR, body: JSON.stringify({ action: "ask", selection: "", question }) });
  let text = "", err = "", sources: any[] = [];
  for (const line of (await r.text()).split("\n")) {
    if (!line.trim()) continue;
    const ev = JSON.parse(line);
    if (ev.t === "turn") text = "";
    if (ev.t === "text") text += ev.d;
    if (ev.t === "error") err = ev.message;
    if (ev.t === "done") sources = ev.sources;
  }
  if (err) throw new Error(err);
  return ok(`${text.trim()}\n\nSources: ${sources.map((s) => s.label).join(", ") || "none"}`);
}));

server.registerTool("list_notes", {
  title: "List margin notes",
  description: "The author's margin notes, optionally for one file.",
  inputSchema: { path: z.string().optional(), include_resolved: z.boolean().optional() },
}, wrap("list_notes", async ({ path: p, include_resolved }) => {
  const file = p ? await chapterPath(p) : null;
  const notes = (await get<any[]>("/notes")).filter((n) => (!file || n.file === file) && (include_resolved || !n.resolved));
  return notes.length ? ok(notes.map((n) => `${n.id} · ${n.file} L${n.line}${n.resolved ? " (resolved)" : ""}\n  “${n.quote.slice(0, 120)}”\n  ${n.body}`).join("\n")) : ok("No notes.");
}));

// ---------------- writing ----------------
server.registerTool("edit_file", {
  title: "Edit a file (find and replace)",
  description: "Replace one exact, unique passage in a chapter or bible file. Read the file first and copy old_text exactly. The change is saved, committed to git, and appears live in Studio.",
  inputSchema: { path: z.string(), old_text: z.string().min(1), new_text: z.string(), label: z.string().optional().describe("Short description for the git history, e.g. 'tighten Juno at the counter'") },
}, wrap("edit_file", async ({ path: p, old_text, new_text, label }, ctx) => {
  const file = await chapterPath(p);
  const { content } = await get(`/file${q({ path: file })}`);
  const count = content.split(old_text).length - 1;
  if (count === 0) throw new Error("old_text not found. Read the file again and copy it exactly (whitespace counts).");
  if (count > 1) throw new Error(`old_text appears ${count} times. Include more surrounding text so it is unique.`);
  const at = content.indexOf(old_text);
  const line = content.slice(0, at).split("\n").length;
  const r = await send("PUT", "/file", { path: file, content: content.replace(old_text, new_text), label: `AI: ${label ?? "edit"}` });
  ctx.meta = { path: file, from: line, to: line + new_text.split("\n").length - 1, diff: { old: old_text, new: new_text }, summary: `Line ${line} · ${r.words.toLocaleString()} words` };
  return ok(`Edited ${file} at line ${line}. ${r.words} words. ${r.sync?.message ?? ""}`.trim());
}));

server.registerTool("write_file", {
  title: "Create or replace a markdown file",
  description: "Write a whole .md file (new bible page, outline, etc.). For changes to an existing chapter prefer edit_file.",
  inputSchema: { path: z.string().regex(/\.md$/), content: z.string(), label: z.string().optional() },
}, wrap("write_file", async ({ path: p, content, label }) => {
  const r = await send("PUT", "/file", { path: p, content, label: `AI: ${label ?? `write ${p}`}` });
  return ok(`Wrote ${p} · ${r.words} words. ${r.sync?.message ?? ""}`.trim());
}));

server.registerTool("add_note", {
  title: "Add a margin note",
  description: "Attach a note to a passage. `quote` must be text that appears in the file; the note lands on its line.",
  inputSchema: { path: z.string(), quote: z.string().min(3), body: z.string().min(1) },
}, wrap("add_note", async ({ path: p, quote, body }, ctx) => {
  const file = await chapterPath(p);
  const { content } = await get(`/file${q({ path: file })}`);
  const at = content.indexOf(quote);
  if (at < 0) throw new Error("quote not found in the file.");
  const n = await send("POST", "/notes", { file, quote, line: content.slice(0, at).split("\n").length, body: `🤖 ${body}` });
  ctx.meta = { path: file, from: n.line, to: n.line, summary: clip(body, 80) };
  return ok(`Note ${n.id} on ${file} L${n.line}.`);
}));

server.registerTool("snapshot", {
  title: "Snapshot a chapter version",
  description: "Save a numbered version of a chapter (shows in its History) before a big change.",
  inputSchema: { chapter: z.string().describe("chapter number or id"), note: z.string() },
}, wrap("snapshot", async ({ chapter, note }) => {
  const file = await chapterPath(chapter);
  const id = file.split("/")[1];
  const r = await send("POST", "/snapshot", { chapter: id, note });
  return ok(`Snapshot ${r.label ?? ""} of ${id}.`);
}));

// ---------------- planning data ----------------
server.registerTool("get_board", {
  title: "Get the board",
  description: "Per-chapter planning data: days covered, beats, status, ending turn.",
  inputSchema: {},
}, wrap("get_board", async () => json(await get("/meta/chapters"))));

server.registerTool("update_board", {
  title: "Update a chapter's board card",
  description: "Patch one chapter's planning fields (keys as returned by get_board).",
  inputSchema: { chapter_id: z.string(), patch: z.record(z.string(), z.any()) },
}, wrap("update_board", async ({ chapter_id, patch }) => json(await send("PATCH", `/meta/chapters/${encodeURIComponent(chapter_id)}`, patch))));

server.registerTool("get_knowledge", {
  title: "Who knows what",
  description: "Secrets and the chapter each character learns them (0 = knew before the book; missing = doesn't know).",
  inputSchema: {},
}, wrap("get_knowledge", async () => json(await get("/knowledge"))));

server.registerTool("update_knowledge", {
  title: "Update who knows what",
  description: "Add or change a secret. Set knows[character] to a chapter number, or null to remove.",
  inputSchema: { secret_id: z.string().optional().describe("omit to create a new secret"), label: z.string().optional(), keywords: z.array(z.string()).optional(), note: z.string().optional(), knows: z.record(z.string(), z.number().int().min(0).nullable()).optional() },
}, wrap("update_knowledge", async ({ secret_id, label, keywords, note, knows }) => {
  const k = await get("/knowledge");
  let s = secret_id ? k.secrets.find((x: any) => x.id === secret_id) : null;
  if (secret_id && !s) throw new Error(`No secret ${secret_id}.`);
  if (!s) { if (!label) throw new Error("label is required for a new secret."); s = { id: `s${Date.now().toString(36)}`, label, keywords: keywords ?? [], knows: {} }; k.secrets.push(s); }
  if (label) s.label = label;
  if (keywords) s.keywords = keywords;
  if (note !== undefined) s.note = note;
  for (const [ch, v] of Object.entries(knows ?? {})) { if (v === null) delete s.knows[ch]; else s.knows[ch] = v; if (!k.characters.includes(ch)) k.characters.push(ch); }
  await send("PUT", "/knowledge", k);
  return json(s);
}));

server.registerTool("get_ledger", {
  title: "Resource ledger",
  description: "Locked numbers and day-by-day resource counts.",
  inputSchema: {},
}, wrap("get_ledger", async () => json({ locked: await get("/locked"), ledger: await get("/ledger") })));

server.registerTool("canon_checks", {
  title: "Canon checks",
  description: "Studio's automatic checks: POV characters referencing secrets before they learn them, and numbers in the prose that differ from the locked numbers.",
  inputSchema: {},
}, wrap("canon_checks", async (_a, ctx) => {
  const flags = await get<any[]>("/knowledge/flags");
  const nums = ((await get<any>("/numbers")).hits as any[]).filter((n) => !n.matches);
  ctx.meta = { summary: `${flags.length} knowledge flag${flags.length === 1 ? "" : "s"} · ${nums.length} numbers differ` };
  return ok(`KNOWLEDGE FLAGS (${flags.length})\n${flags.map((f) => `ch ${f.number} L${f.line} · ${f.pov} POV mentions "${f.keyword}" (${f.secret})\n  ${f.text.slice(0, 200)}`).join("\n") || "none"}\n\nNUMBERS THAT DIFFER (${nums.length})\n${nums.map((n) => `${n.chapter} L${n.line}: "${n.phrase}" (${n.value} ${n.noun})`).join("\n") || "none"}`);
}));

// ---------------- book + sync + UI ----------------
server.registerTool("build_manuscript", {
  title: "Build the manuscript",
  description: "Rebuild manuscript/full.md from every chapter.",
  inputSchema: {},
}, wrap("build_manuscript", async () => { const r = await send("POST", "/build"); return ok(`Built manuscript/full.md · ${r.chapters} chapters · ${r.words} words.`); }));

server.registerTool("sync_status", {
  title: "Git sync status",
  description: "Uncommitted files and how far this machine is ahead of or behind GitHub.",
  inputSchema: {},
}, wrap("sync_status", async () => { const s = await get("/git/status"); return ok(`branch ${s.branch ?? "?"} · ahead ${s.ahead} · behind ${s.behind} · ${s.dirty.length} changed file(s)${s.dirty.length ? "\n" + s.dirty.map((d: any) => `  ${d.status} ${d.path}`).join("\n") : ""}`); }));

server.registerTool("sync", {
  title: "Sync with GitHub",
  description: "Pull the other machine's changes, then push this machine's.",
  inputSchema: {},
}, wrap("sync", async () => { const a = await send("POST", "/git/pull"); const b = a.ok ? await send("POST", "/git/push") : null; return ok(`pull: ${a.message}${b ? `\npush: ${b.message}` : ""}`); }));

// ---------------- wiki ----------------
const fmtLinksHere = (w: any) => w.linksHere.length
  ? w.linksHere.map((l: any) => `  ${l.kind === "chapter" ? "ch" : "bible"} ${l.file} L${l.line} — ${l.text}`).join("\n")
  : "  (nothing links here)";
const fmtAppears = (w: any) => w.appears
  ? `MENTIONS BY CHAPTER\n${w.appears.counts.map((c: any) => `  ch ${c.number} ${c.title}: ${c.count}${c.pov ? " (POV)" : ""}`).join("\n")}\n` +
    `FIRST APPEARS: ${w.appears.first ? `${w.appears.first.file} L${w.appears.first.line} — ${w.appears.first.text}` : "not yet on the page"}\n` +
    `SAMPLE LINES\n${w.appears.samples.map((x: any) => `  ${x.file} L${x.line} — ${x.text}`).join("\n") || "  none"}`
  : "";

server.registerTool("wiki_index", {
  title: "Wiki index",
  description: "Every bible page grouped by wiki category (Start here, People, World, Story, Craft), with word counts and when each was last edited.",
  inputSchema: {},
}, wrap("wiki_index", async () => {
  const w = await get("/wiki/index");
  return ok(w.categories.map((c: any) => {
    const ps = w.pages.filter((p: any) => p.category === c.id);
    return ps.length ? `${c.label.toUpperCase()}\n${ps.map((p: any) => `  ${p.entity ? `${p.entity.short} (${p.entity.age ?? "?"}, ${p.entity.element ?? "?"})` : p.title} · ${p.path} · ${p.words} words${p.edited ? ` · edited ${new Date(p.edited).toISOString().slice(0, 10)}` : ""}`).join("\n")}` : "";
  }).filter(Boolean).join("\n\n"));
}));

server.registerTool("wiki_page", {
  title: "Wiki page with dependencies",
  description: "A bible page as the wiki sees it: what links here (every chapter and page that depends on it), see-also links, and for character pages their infobox, mentions per chapter, first appearance and sample lines. Use before changing a fact, to find everything that relies on it.",
  inputSchema: { path: z.string().describe("bible path, e.g. bible/03-power-system.md or bible/cast/kit.md") },
}, wrap("wiki_page", async ({ path: p }, ctx) => {
  const w = await get(`/wiki/page${q({ path: p })}`);
  ctx.meta = { path: p, summary: `${w.linksHere.length} link${w.linksHere.length === 1 ? "" : "s"} here${w.appears ? ` · in ${w.appears.counts.filter((c: any) => c.count).length} chapters` : ""}` };
  const e = w.entity;
  return ok([
    `${w.title} · ${w.path} · ${w.words} words · category ${w.category}${w.edited ? ` · edited ${w.edited.when}` : ""}`,
    e ? `INFOBOX: ${e.name} · age ${e.age ?? "?"} · element ${e.element ?? "?"} · tier ${e.tier ?? "?"} · ${e.group}${e.aliases.length ? ` · also ${e.aliases.join(", ")}` : ""}\n${e.oneLine ?? ""}` : "",
    `WHAT LINKS HERE (${w.linksHere.length})\n${fmtLinksHere(w)}`,
    `SEE ALSO\n${w.seeAlso.map((x: any) => `  ${x.title} · ${x.path}`).join("\n") || "  none"}`,
    fmtAppears(w),
  ].filter(Boolean).join("\n\n"));
}));

server.registerTool("character", {
  title: "Character lookup",
  description: "Everything about one character by any name or nickname: their bible page's infobox, mentions per chapter, first appearance, every chapter line that names them (up to `limit`), and what links to their page.",
  inputSchema: { name: z.string(), limit: z.number().int().min(1).max(80).optional() },
}, wrap("character", async ({ name, limit }, ctx) => {
  const ents = await get<any[]>("/entities");
  const n = name.toLowerCase();
  const e = ents.find((x) => x.id === n || x.short.toLowerCase() === n || x.name.toLowerCase() === n) ?? ents.find((x) => x.aliases.some((a: string) => a.toLowerCase() === n)) ?? ents.find((x) => x.name.toLowerCase().includes(n));
  if (!e) throw new Error(`No character "${name}". Known: ${ents.map((x) => x.short).join(", ")}`);
  const hits = (await get<any[]>(`/backlinks/${encodeURIComponent(e.id)}`)).filter((h) => h.kind === "chapter");
  const w = e.file ? await get(`/wiki/page${q({ path: e.file })}`) : null;
  ctx.meta = { path: e.file ?? undefined, summary: `${e.short} · ${hits.length} lines in the chapters` };
  return ok([
    `${e.name}${e.age ? `, ${e.age}` : ""} · ${e.group}${e.element ? ` · ${e.element}` : ""}${e.tier ? ` · tier ${e.tier}` : ""}${e.file ? ` · ${e.file}` : " · no page of their own (see bible/cast/supporting.md)"}`,
    `NAMES: ${e.aliases.join(", ")}`,
    e.oneLine ?? "",
    w ? fmtAppears(w) : "",
    `EVERY CHAPTER LINE (${hits.length}${hits.length > (limit ?? 30) ? `, showing ${limit ?? 30}` : ""})\n${hits.slice(0, limit ?? 30).map((h) => `  ${h.file} L${h.line} — ${unmark(h.text).slice(0, 240)}`).join("\n") || "  none yet"}`,
    w ? `WHAT LINKS TO THEIR PAGE (${w.linksHere.length})\n${fmtLinksHere(w)}` : "",
  ].filter(Boolean).join("\n\n"));
}));

server.registerTool("open_in_studio", {
  title: "Show a passage in Studio",
  description: "Jump the author's open Studio window to a file and line, e.g. to point at something you're discussing.",
  inputSchema: { path: z.string(), line: z.number().int().min(1).optional() },
}, wrap("open_in_studio", async ({ path: p, line }) => { const file = await chapterPath(p); const r = await send("POST", "/ui/goto", { path: file, line }); return ok(r.windows ? `Opened ${file}${line ? ` at line ${line}` : ""} in Studio.` : "Studio isn't open in a browser right now."); }));

const how = await ensureServer();
await server.connect(new StdioServerTransport());
console.error(`[morne-bay-studio mcp] ready · ${how}`);
