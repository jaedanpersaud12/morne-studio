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
import { getSettings, putSettings, MODELS } from "./settings";
import { run as runClaude, type ClaudeAction } from "./claude";

const app = new Hono();
const api = new Hono();

api.onError((e, c) => c.json({ error: e.message }, 400));

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
  await writeText(p, content);
  rebuild().catch(() => {});
  const sync = await git.afterSave(p, label || p).catch((e) => ({ ok: false, action: "error", message: String(e?.message ?? e) }));
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
const commitData = (file: string, what: string) => git.autoCommitPaths([file], `studio: ${what}`).catch(() => null);
api.put("/meta/chapters", async (c) => { await data.putChaptersMeta(await c.req.json()); commitData("studio/chapters.json", "board"); return c.json({ ok: true }); });
api.patch("/meta/chapters/:id", async (c) => { const m = await data.patchChapterMeta(c.req.param("id"), await c.req.json()); commitData("studio/chapters.json", "board"); return c.json(m); });
api.get("/knowledge", async (c) => c.json(await data.getKnowledge()));
api.put("/knowledge", async (c) => { await data.putKnowledge(await c.req.json()); commitData("studio/knowledge.json", "who knows what"); return c.json({ ok: true }); });
api.get("/knowledge/flags", async (c) => c.json(await data.knowledgeFlags()));
api.get("/ledger", async (c) => c.json(await data.getLedger()));
api.put("/ledger", async (c) => { await data.putLedger(await c.req.json()); commitData("studio/ledger.json", "ledger"); return c.json({ ok: true }); });
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
  if (r.changed) await git.autoCommitPaths(["chapters", "studio"], "studio: reorder chapters").catch(() => null);
  return c.json(r);
});

// ---- settings ----
api.get("/settings", async (c) => c.json({ ...(await getSettings()), models: MODELS }));
api.put("/settings", async (c) => c.json(await putSettings(await c.req.json())));

// ---- claude (streams plain text) ----
api.post("/claude", async (c) => {
  const body = await c.req.json<{ action: ClaudeAction; selection: string; context?: string; chapter?: string; question?: string }>();
  return streamText(c, async (stream) => {
    try {
      for await (const chunk of runClaude(body)) await stream.write(chunk);
    } catch (e: any) {
      await stream.write(`\n\n⚠︎ ${e?.message ?? e}`);
    }
  });
});

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
