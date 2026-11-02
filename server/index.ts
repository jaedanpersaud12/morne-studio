import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { streamText } from "hono/streaming";
import path from "node:path";
import { existsSync } from "node:fs";
import { BOOK, PORT, tree, readText, writeText, loadEntities, versions, snapshot, buildManuscript } from "./book";
import { search, backlinks, rebuild, presence } from "./index-db";
import { fingerprint } from "./stats";
import * as git from "./git";
import * as data from "./studio-data";
import { getSettings, putSettings, MODELS, TTS_MODELS } from "./settings";
import * as extras from "./extras";
import * as exporter from "./export";
import * as tts from "./tts";
import { existsSync as fileExists } from "node:fs";
import { run as runClaude } from "./claude";
import { watch } from "node:fs";
import type { StudioEvent } from "../shared/types";

// ---- live events: every open Studio window hears about edits from MCP, the other machine, or another window ----
const listeners = new Set<(e: StudioEvent) => void>();
export const broadcast = (e: StudioEvent) => { for (const l of listeners) { try { l(e); } catch {} } };
const recentWrites = new Map<string, number>(); // paths we just wrote ourselves, so the watcher doesn't echo them
try {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  watch(BOOK, { recursive: true }, (_ev, name) => {
    if (!name) return;
    const rel = String(name).replace(/\\/g, "/");
    if (rel.startsWith(".git") || !/\.(md|json)$/.test(rel)) return;
    clearTimeout(pending.get(rel));
    pending.set(rel, setTimeout(() => {
      pending.delete(rel);
      if (Date.now() - (recentWrites.get(rel) ?? 0) < 1500) return;
      rebuild().catch(() => {});
      broadcast({ t: "changed", path: rel, source: "disk" });
    }, 250));
  });
} catch (e) { console.error("[studio] file watcher unavailable:", e); }
const sourceOf = (c: { req: { header: (k: string) => string | undefined } }) => (c.req.header("x-studio-source") === "mcp" ? "mcp" : "studio") as "mcp" | "studio";

const app = new Hono();
const api = new Hono();

api.onError((e, c) => c.json({ error: e.message }, 400));
// the "AI can write" switch in Settings guards every change an MCP client asks for
api.use(async (c, next) => {
  if (c.req.method !== "GET" && c.req.header("x-studio-source") === "mcp" && !/\/(claude|ui\/goto|build|git\/pull)$/.test(c.req.path) && !(await getSettings()).aiWrites)
    return c.text("AI writes are turned off in Studio's Settings (\"AI can edit the book\").", 403);
  await next();
});

api.get("/tree", async (c) => c.json(await tree()));
api.get("/entities", async (c) => c.json(await loadEntities(c.req.query("force") === "1")));

api.get("/file", async (c) => {
  const p = c.req.query("path");
  if (!p) return c.text("path required", 400);
  try { return c.json({ path: p, content: await readText(p) }); }
  catch (e: any) { return c.text(e.message, e.code === "ENOENT" ? 404 : 400); }
});
api.put("/file", async (c) => {
  const { path: p, content, label } = await c.req.json<{ path: string; content: string; label?: string }>();
  if (!p || typeof content !== "string") return c.text("path and content required", 400);
  if (!p.endsWith(".md")) return c.text("only .md files", 400);
  let before: string | null = null;
  try { before = await readText(p); } catch {}
  const src = sourceOf(c);
  if (src === "mcp" && !(await getSettings()).aiWrites) return c.text("AI writes are turned off in Studio's Settings.", 403);
  recentWrites.set(p, Date.now());
  await writeText(p, content);
  rebuild().catch(() => {});
  broadcast({ t: "changed", path: p, source: src, label });
  const counted = await extras.recordSave(p, before, content).catch(() => false);
  const sync = await git.afterSave(p, label || p, counted ? [extras.progressFile()] : []).catch((e) => ({ ok: false, action: "error", message: String(e?.message ?? e) }));
  return c.json({ ok: true, words: (content.match(/\S+/g) ?? []).length, sync });
});

api.get("/search", async (c) => c.json(await search(c.req.query("q") ?? "")));
api.get("/backlinks/:id", async (c) => c.json(await backlinks(c.req.param("id"))));
api.get("/presence", async (c) => c.json(await presence()));

api.get("/versions/:chapter", async (c) => c.json(await versions(c.req.param("chapter"))));
api.post("/snapshot", async (c) => {
  const { chapter, note } = await c.req.json<{ chapter: string; note: string }>();
  const r = await snapshot(chapter, note ?? "");
  await git.autoCommitPaths([`chapters/${chapter}`], `studio: snapshot ${chapter} ${r.label}${note ? ` (${note})` : ""}`).catch(() => null);
  return c.json(r);
});
api.post("/build", async (c) => c.json(await buildManuscript()));

api.get("/fingerprint", async (c) => {
  const p = c.req.query("path");
  if (!p) return c.text("path required", 400);
  return c.json(fingerprint(await readText(p)));
});

// ---- studio data ----
api.get("/outline", async (c) => c.json(await data.outline()));
api.get("/locked", async (c) => c.json(await data.lockedNumbers()));
api.get("/meta/chapters", async (c) => c.json(await data.getChaptersMeta()));
const commitData = (file: string, what: string, c?: any) => {
  recentWrites.set(file, Date.now());
  broadcast({ t: "data", key: file.replace(/^studio\/|\.json$/g, ""), source: c ? sourceOf(c) : "studio" });
  return git.autoCommitPaths([file], `studio: ${what}`).catch(() => null);
};
api.put("/meta/chapters", async (c) => { await data.putChaptersMeta(await c.req.json()); commitData("studio/chapters.json", "board", c); return c.json({ ok: true }); });
api.patch("/meta/chapters/:id", async (c) => { const m = await data.patchChapterMeta(c.req.param("id"), await c.req.json()); commitData("studio/chapters.json", "board", c); return c.json(m); });
api.get("/knowledge", async (c) => c.json(await data.getKnowledge()));
api.put("/knowledge", async (c) => { await data.putKnowledge(await c.req.json()); commitData("studio/knowledge.json", "who knows what", c); return c.json({ ok: true }); });
api.get("/knowledge/flags", async (c) => c.json(await data.knowledgeFlags()));
api.get("/ledger", async (c) => c.json(await data.getLedger()));
api.put("/ledger", async (c) => { await data.putLedger(await c.req.json()); commitData("studio/ledger.json", "ledger", c); return c.json({ ok: true }); });
api.post("/chapters/create", async (c) => {
  const { number, title, pov } = await c.req.json<{ number: number; title: string; pov: string }>();
  const r = await data.createChapter(number, title, pov);
  await rebuild();
  await git.autoCommitPaths(["chapters", "studio"], `studio: new chapter ${number} ${title}`).catch(() => null);
  return c.json(r);
});
api.post("/chapters/reorder", async (c) => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  const r = await data.reorder(ids);
  await rebuild();
  if (r.changed) await extras.renameNoteFiles(Object.fromEntries(r.plan.filter((x) => x.from !== x.to).map((x) => [`chapters/${x.from}/LATEST.md`, `chapters/${x.to}/LATEST.md`])));
  if (r.changed) await git.autoCommitPaths(["chapters", "studio"], "studio: reorder chapters").catch(() => null);
  return c.json(r);
});

// ---- settings ----
api.get("/settings", async (c) => c.json({ ...(await getSettings()), models: MODELS, ttsModels: TTS_MODELS, mcp: { command: process.execPath, args: [path.resolve(import.meta.dir, "..", "mcp.ts")] } }));
api.put("/settings", async (c) => c.json(await putSettings(await c.req.json())));

// ---- claude (streams newline-delimited JSON events) ----
api.post("/claude", async (c) => {
  const body = await c.req.json<import("./claude").RunOpts>();
  return streamText(c, async (stream) => {
    // events: status, turn, step (running/done), text deltas, done, error
    try { for await (const ev of runClaude(body)) await stream.write(JSON.stringify(ev) + "\n"); }
    catch (e: any) { await stream.write(JSON.stringify({ t: "error", message: String(e?.message ?? e) }) + "\n"); }
  });
});

// ---- live events (server-sent) ----
api.get("/events", (c) => streamText(c, async (stream) => {
  c.header("content-type", "text/event-stream"); c.header("cache-control", "no-cache");
  let closed = false;
  const send = (e: StudioEvent) => { if (!closed) stream.write(`data: ${JSON.stringify(e)}\n\n`).catch(() => {}); };
  listeners.add(send);
  send({ t: "hello" });
  stream.onAbort(() => { closed = true; listeners.delete(send); });
  while (!closed) { await stream.sleep(25_000); if (!closed) await stream.write(": ping\n\n").catch(() => { closed = true; }); }
  listeners.delete(send);
}));
api.post("/ui/goto", async (c) => { const { path: p, line } = await c.req.json<{ path: string; line?: number }>(); broadcast({ t: "goto", path: p, line }); return c.json({ ok: true, windows: listeners.size }); });

// ---- notes ----
api.get("/notes", async (c) => c.json(await extras.listNotes()));
api.post("/notes", async (c) => { const n = await extras.addNote(await c.req.json()); commitData("studio/notes.json", "notes", c); return c.json(n); });
api.patch("/notes/:id", async (c) => { const n = await extras.patchNote(c.req.param("id"), await c.req.json()); commitData("studio/notes.json", "notes", c); return c.json(n); });
api.delete("/notes/:id", async (c) => { await extras.deleteNote(c.req.param("id")); commitData("studio/notes.json", "notes", c); return c.json({ ok: true }); });

// ---- progress, map, numbers ----
api.get("/progress", async (c) => c.json(await extras.progress((await getSettings()).dailyTarget)));
api.get("/graph", async (c) => c.json(await extras.graph()));
api.get("/numbers", async (c) => c.json(await extras.numberHits()));

// ---- export ----
const bookMeta = async () => { const s = await getSettings(); let author = s.authorName; if (!author) { const r = await git.git(["config", "user.name"]); author = r.out || "Author"; } return { title: s.bookTitle || "Morne Bay", author }; };
const fileName = (title: string, ext: string) => `${title.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-") || "book"}.${ext}`;
api.get("/export/epub", async (c) => { const m = await bookMeta(); return new Response(new Blob([await exporter.epub(m.title, m.author) as BlobPart]), { headers: { "content-type": "application/epub+zip", "content-disposition": `attachment; filename="${fileName(m.title, "epub")}"` } }); });
api.get("/export/docx", async (c) => { const m = await bookMeta(); return new Response(new Blob([await exporter.docx(m.title, m.author) as BlobPart]), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": `attachment; filename="${fileName(m.title, "docx")}"` } }); });
api.get("/export/print", async (c) => { const m = await bookMeta(); return c.html(await exporter.printHtml(m.title, m.author)); });

// ---- read-aloud ----
api.get("/tts/voices", async (c) => c.json(await tts.voices()));
api.post("/tts", async (c) => { const { text, pov } = await c.req.json<{ text: string; pov: string | null }>(); return tts.speak(text, pov); });

// ---- git / sync ----
api.get("/git/status", async (c) => c.json({ ...(await git.status()), sync: git.syncState() }));
api.post("/git/commit", async (c) => c.json(await git.commitAll((await c.req.json<{ message: string }>()).message)));
api.post("/git/pull", async (c) => c.json(await git.pull()));
api.post("/git/push", async (c) => c.json(await git.push()));
api.post("/git/resolve", async (c) => c.json(await git.resolve((await c.req.json<{ resolutions: Record<string, string> }>()).resolutions)));
api.get("/git/log", async (c) => c.json(await git.fileLog(c.req.query("path") ?? "")));
api.get("/git/show", async (c) => c.json({ content: await git.showAt(c.req.query("hash") ?? "HEAD", c.req.query("path") ?? "") }));

app.route("/api", api);

// production: serve the built app
const dist = path.resolve(import.meta.dir, "..", "dist");
if (existsSync(dist)) {
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), dist) || "." }));
  app.get("*", serveStatic({ path: path.join(path.relative(process.cwd(), dist) || ".", "index.html") }));
}

console.log(`[studio] book: ${BOOK}`);
console.log(`[studio] api:  http://localhost:${PORT}/api/tree`);
export default { port: PORT, fetch: app.fetch, idleTimeout: 120 };
