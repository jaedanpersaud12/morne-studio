import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import path from "node:path";
import { existsSync } from "node:fs";
import { BOOK, PORT, tree, readText, writeText, loadEntities, versions, snapshot, buildManuscript } from "./book";
import { search, backlinks, rebuild, presence } from "./index-db";
import { fingerprint } from "./stats";
import * as git from "./git";

const app = new Hono();
const api = new Hono();

api.get("/tree", async (c) => c.json(await tree()));
api.get("/entities", async (c) => c.json(await loadEntities(c.req.query("force") === "1")));

api.get("/file", async (c) => {
  const p = c.req.query("path");
  if (!p) return c.text("path required", 400);
  try { return c.json({ path: p, content: await readText(p) }); }
  catch (e: any) { return c.text(e.message, e.code === "ENOENT" ? 404 : 400); }
});
api.put("/file", async (c) => {
  const { path: p, content } = await c.req.json<{ path: string; content: string }>();
  if (!p || typeof content !== "string") return c.text("path and content required", 400);
  if (!p.endsWith(".md")) return c.text("only .md files", 400);
  await writeText(p, content);
  rebuild().catch(() => {});
  return c.json({ ok: true, words: (content.match(/\S+/g) ?? []).length });
});

api.get("/search", async (c) => c.json(await search(c.req.query("q") ?? "")));
api.get("/backlinks/:id", async (c) => c.json(await backlinks(c.req.param("id"))));
api.get("/presence", async (c) => c.json(await presence()));

api.get("/versions/:chapter", async (c) => c.json(await versions(c.req.param("chapter"))));
api.post("/snapshot", async (c) => {
  const { chapter, note } = await c.req.json<{ chapter: string; note: string }>();
  return c.json(await snapshot(chapter, note ?? ""));
});
api.post("/build", async (c) => c.json(await buildManuscript()));

api.get("/fingerprint", async (c) => {
  const p = c.req.query("path");
  if (!p) return c.text("path required", 400);
  return c.json(fingerprint(await readText(p)));
});

api.get("/git/status", async (c) => c.json(await git.status()));
api.post("/git/commit", async (c) => c.json(await git.commitAll((await c.req.json<{ message: string }>()).message)));
api.post("/git/pull", async (c) => c.json(await git.pull()));
api.post("/git/push", async (c) => c.json(await git.push()));
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
export default { port: PORT, fetch: app.fetch };
