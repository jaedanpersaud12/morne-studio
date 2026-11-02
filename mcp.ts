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
  Bun.serve(mod.default as any);
  return "started Studio's server in the background";
}

async function call<T = any>(p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + p, { ...init, headers: { ...HDR, ...(init?.headers ?? {}) } });
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
const wrap = <A,>(f: (a: A) => Promise<ReturnType<typeof ok>>) => async (a: A) => { try { return await f(a); } catch (e) { return fail(e); } };
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
}, wrap(async () => {
  const t = await get("/tree");
  const ch = t.chapters.map((c: any) => `ch ${c.number}  ${c.title}  · ${c.pov ?? "?"} POV · ${c.words} words · ${`chapters/${c.id}/LATEST.md`}`);
  const bible = t.bible.map((b: any) => `${b.title}  · ${b.path}`);
  return ok(`CHAPTERS\n${ch.join("\n")}\n\nBIBLE\n${bible.join("\n")}${t.other?.length ? `\n\nOTHER\n${t.other.map((o: any) => o.path).join("\n")}` : ""}`);
}));

server.registerTool("read_file", {
  title: "Read a chapter or bible file",
  description: "Returns the file with line numbers. `path` can be a repo path (bible/cast/kit.md) or a chapter number (\"6\"). Long files: pass a line range.",
  inputSchema: { path: z.string(), start_line: z.number().int().min(1).optional(), end_line: z.number().int().min(1).optional() },
}, wrap(async ({ path: p, start_line, end_line }) => {
  const file = await chapterPath(p);
  const { content } = await get(`/file${q({ path: file })}`);
  const lines: string[] = content.split("\n");
  const a = (start_line ?? 1) - 1, b = Math.min(lines.length, end_line ?? (start_line ? start_line + 199 : 600));
  const body = lines.slice(a, b).map((l, i) => `${a + i + 1}\t${l}`).join("\n");
  return ok(`${file} (lines ${a + 1}-${b} of ${lines.length})\n${body}${b < lines.length ? `\n… ${lines.length - b} more lines; pass start_line=${b + 1}` : ""}`);
}));

server.registerTool("search", {
  title: "Search the book",
  description: "Full-text search over every chapter and bible file. Short keyword queries work best.",
  inputSchema: { query: z.string(), limit: z.number().int().min(1).max(50).optional() },
}, wrap(async ({ query, limit }) => {
  const hits = (await get<any[]>(`/search${q({ q: query })}`)).slice(0, limit ?? 20);
  if (!hits.length) return ok(`No hits for "${query}".`);
  return ok(hits.map((h) => `[${h.kind === "chapter" ? "ch" : "bible"}] ${h.file} L${h.line} — ${h.title}\n  ${unmark(h.text).slice(0, 300)}`).join("\n"));
}));

server.registerTool("ask_book", {
  title: "Ask the book (research agent)",
  description: "Studio's own research agent: searches chapters and bible, reads passages, and answers with line citations. Uses the Anthropic key in Studio's Settings.",
  inputSchema: { question: z.string() },
}, wrap(async ({ question }) => {
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
}, wrap(async ({ path: p, include_resolved }) => {
  const file = p ? await chapterPath(p) : null;
  const notes = (await get<any[]>("/notes")).filter((n) => (!file || n.file === file) && (include_resolved || !n.resolved));
  return notes.length ? ok(notes.map((n) => `${n.id} · ${n.file} L${n.line}${n.resolved ? " (resolved)" : ""}\n  “${n.quote.slice(0, 120)}”\n  ${n.body}`).join("\n")) : ok("No notes.");
}));

// ---------------- writing ----------------
server.registerTool("edit_file", {
  title: "Edit a file (find and replace)",
  description: "Replace one exact, unique passage in a chapter or bible file. Read the file first and copy old_text exactly. The change is saved, committed to git, and appears live in Studio.",
  inputSchema: { path: z.string(), old_text: z.string().min(1), new_text: z.string(), label: z.string().optional().describe("Short description for the git history, e.g. 'tighten Juno at the counter'") },
}, wrap(async ({ path: p, old_text, new_text, label }) => {
  const file = await chapterPath(p);
  const { content } = await get(`/file${q({ path: file })}`);
  const count = content.split(old_text).length - 1;
  if (count === 0) throw new Error("old_text not found. Read the file again and copy it exactly (whitespace counts).");
  if (count > 1) throw new Error(`old_text appears ${count} times. Include more surrounding text so it is unique.`);
  const at = content.indexOf(old_text);
  const line = content.slice(0, at).split("\n").length;
  const r = await send("PUT", "/file", { path: file, content: content.replace(old_text, new_text), label: `AI: ${label ?? "edit"}` });
  return ok(`Edited ${file} at line ${line}. ${r.words} words. ${r.sync?.message ?? ""}`.trim());
}));

server.registerTool("write_file", {
  title: "Create or replace a markdown file",
  description: "Write a whole .md file (new bible page, outline, etc.). For changes to an existing chapter prefer edit_file.",
  inputSchema: { path: z.string().regex(/\.md$/), content: z.string(), label: z.string().optional() },
}, wrap(async ({ path: p, content, label }) => {
  const r = await send("PUT", "/file", { path: p, content, label: `AI: ${label ?? `write ${p}`}` });
  return ok(`Wrote ${p} · ${r.words} words. ${r.sync?.message ?? ""}`.trim());
}));

server.registerTool("add_note", {
  title: "Add a margin note",
  description: "Attach a note to a passage. `quote` must be text that appears in the file; the note lands on its line.",
  inputSchema: { path: z.string(), quote: z.string().min(3), body: z.string().min(1) },
}, wrap(async ({ path: p, quote, body }) => {
  const file = await chapterPath(p);
  const { content } = await get(`/file${q({ path: file })}`);
  const at = content.indexOf(quote);
  if (at < 0) throw new Error("quote not found in the file.");
  const n = await send("POST", "/notes", { file, quote, line: content.slice(0, at).split("\n").length, body: `🤖 ${body}` });
  return ok(`Note ${n.id} on ${file} L${n.line}.`);
}));

server.registerTool("snapshot", {
  title: "Snapshot a chapter version",
  description: "Save a numbered version of a chapter (shows in its History) before a big change.",
  inputSchema: { chapter: z.string().describe("chapter number or id"), note: z.string() },
}, wrap(async ({ chapter, note }) => {
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
}, wrap(async () => json(await get("/meta/chapters"))));

server.registerTool("update_board", {
  title: "Update a chapter's board card",
  description: "Patch one chapter's planning fields (keys as returned by get_board).",
  inputSchema: { chapter_id: z.string(), patch: z.record(z.string(), z.any()) },
}, wrap(async ({ chapter_id, patch }) => json(await send("PATCH", `/meta/chapters/${encodeURIComponent(chapter_id)}`, patch))));

server.registerTool("get_knowledge", {
  title: "Who knows what",
  description: "Secrets and the chapter each character learns them (0 = knew before the book; missing = doesn't know).",
  inputSchema: {},
}, wrap(async () => json(await get("/knowledge"))));

server.registerTool("update_knowledge", {
  title: "Update who knows what",
  description: "Add or change a secret. Set knows[character] to a chapter number, or null to remove.",
  inputSchema: { secret_id: z.string().optional().describe("omit to create a new secret"), label: z.string().optional(), keywords: z.array(z.string()).optional(), note: z.string().optional(), knows: z.record(z.string(), z.number().int().min(0).nullable()).optional() },
}, wrap(async ({ secret_id, label, keywords, note, knows }) => {
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
}, wrap(async () => json({ locked: await get("/locked"), ledger: await get("/ledger") })));

server.registerTool("canon_checks", {
  title: "Canon checks",
  description: "Studio's automatic checks: POV characters referencing secrets before they learn them, and numbers in the prose that differ from the locked numbers.",
  inputSchema: {},
}, wrap(async () => {
  const flags = await get<any[]>("/knowledge/flags");
  const nums = ((await get<any>("/numbers")).hits as any[]).filter((n) => !n.matches);
  return ok(`KNOWLEDGE FLAGS (${flags.length})\n${flags.map((f) => `ch ${f.number} L${f.line} · ${f.pov} POV mentions "${f.keyword}" (${f.secret})\n  ${f.text.slice(0, 200)}`).join("\n") || "none"}\n\nNUMBERS THAT DIFFER (${nums.length})\n${nums.map((n) => `${n.chapter} L${n.line}: "${n.phrase}" (${n.value} ${n.noun})`).join("\n") || "none"}`);
}));

// ---------------- book + sync + UI ----------------
server.registerTool("build_manuscript", {
  title: "Build the manuscript",
  description: "Rebuild manuscript/full.md from every chapter.",
  inputSchema: {},
}, wrap(async () => { const r = await send("POST", "/build"); return ok(`Built manuscript/full.md · ${r.chapters} chapters · ${r.words} words.`); }));

server.registerTool("sync_status", {
  title: "Git sync status",
  description: "Uncommitted files and how far this machine is ahead of or behind GitHub.",
  inputSchema: {},
}, wrap(async () => { const s = await get("/git/status"); return ok(`branch ${s.branch ?? "?"} · ahead ${s.ahead} · behind ${s.behind} · ${s.dirty.length} changed file(s)${s.dirty.length ? "\n" + s.dirty.map((d: any) => `  ${d.status} ${d.path}`).join("\n") : ""}`); }));

server.registerTool("sync", {
  title: "Sync with GitHub",
  description: "Pull the other machine's changes, then push this machine's.",
  inputSchema: {},
}, wrap(async () => { const a = await send("POST", "/git/pull"); const b = a.ok ? await send("POST", "/git/push") : null; return ok(`pull: ${a.message}${b ? `\npush: ${b.message}` : ""}`); }));

server.registerTool("open_in_studio", {
  title: "Show a passage in Studio",
  description: "Jump the author's open Studio window to a file and line, e.g. to point at something you're discussing.",
  inputSchema: { path: z.string(), line: z.number().int().min(1).optional() },
}, wrap(async ({ path: p, line }) => { const file = await chapterPath(p); const r = await send("POST", "/ui/goto", { path: file, line }); return ok(r.windows ? `Opened ${file}${line ? ` at line ${line}` : ""} in Studio.` : "Studio isn't open in a browser right now."); }));

const how = await ensureServer();
await server.connect(new StdioServerTransport());
console.error(`[morne-bay-studio mcp] ready · ${how}`);
