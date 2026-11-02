import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ChapterMeta, BibleFile, Tree, Entity, VersionInfo } from "../shared/types";

// ---------- config ----------
const cfgPath = path.resolve(import.meta.dir, "..", "studio.config.json");
const cfg = JSON.parse(await readFile(cfgPath, "utf8")) as { bookDir: string; port: number };
export const PORT = Number(process.env.PORT ?? cfg.port ?? 3131);
export const BOOK = path.resolve(
  process.env.BOOK_DIR ?? path.resolve(path.dirname(cfgPath), cfg.bookDir),
);
if (!existsSync(path.join(BOOK, "chapters"))) {
  console.error(`[studio] bookDir ${BOOK} has no chapters/ folder. Set BOOK_DIR or edit studio.config.json.`);
}

// ---------- path safety ----------
export function safe(rel: string): string {
  const abs = path.resolve(BOOK, rel);
  if (!abs.startsWith(BOOK + path.sep) && abs !== BOOK) throw new Error("path escapes book dir");
  return abs;
}
export const rel = (abs: string) => path.relative(BOOK, abs).split(path.sep).join("/");

// ---------- helpers ----------
export const words = (s: string) => (s.trim().match(/\S+/g) ?? []).length;
const firstHeading = (s: string) => s.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export async function readText(relPath: string) {
  return readFile(safe(relPath), "utf8");
}
export async function writeText(relPath: string, content: string) {
  const abs = safe(relPath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

// ---------- tree ----------
export async function tree(): Promise<Tree> {
  const chaptersDir = path.join(BOOK, "chapters");
  const chapters: ChapterMeta[] = [];
  const entities = await loadEntities();
  const names = new Set(entities.flatMap((e) => e.aliases));
  for (const d of (await readdir(chaptersDir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
    const latest = path.join(chaptersDir, d.name, "LATEST.md");
    if (!existsSync(latest)) continue;
    const txt = await readFile(latest, "utf8");
    const st = await stat(latest);
    const m = d.name.match(/^ch(\d+)-(.+)$/);
    const heading = firstHeading(txt) ?? d.name;
    const title = heading.replace(/^Chapter\s+\d+\s*[—-]\s*/i, "");
    const body = txt.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")) ?? "";
    const pov = body.match(/\b([A-Z][a-z]+)\b/g)?.find((w) => names.has(w)) ?? null;
    let versions = 0;
    const vdir = path.join(chaptersDir, d.name, "versions");
    if (existsSync(vdir)) versions = (await readdir(vdir)).filter((f) => f.endsWith(".md")).length;
    chapters.push({
      id: d.name,
      number: m ? Number(m[1]) : 0,
      slug: m ? m[2] : d.name,
      title,
      pov,
      words: words(txt),
      versions,
      mtime: st.mtimeMs,
    });
  }
  chapters.sort((a, b) => a.number - b.number);

  const bible: BibleFile[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".md")) {
        const t = await readFile(p, "utf8");
        bible.push({ path: rel(p), title: firstHeading(t) ?? e.name, words: words(t) });
      }
    }
  };
  if (existsSync(path.join(BOOK, "bible"))) await walk(path.join(BOOK, "bible"));
  bible.sort((a, b) => a.path.localeCompare(b.path));

  const other: BibleFile[] = [];
  for (const f of ["HANDOFF.md", "README.md", "notes/README.md"]) {
    const p = path.join(BOOK, f);
    if (existsSync(p)) {
      const t = await readFile(p, "utf8");
      other.push({ path: f, title: firstHeading(t) ?? f, words: words(t) });
    }
  }
  return { bookDir: BOOK, chapters, bible, other };
}

// ---------- entities ----------
let entityCache: { at: number; list: Entity[] } | null = null;

export async function loadEntities(force = false): Promise<Entity[]> {
  if (!force && entityCache && Date.now() - entityCache.at < 5000) return entityCache.list;
  const list: Entity[] = [];
  const castDir = path.join(BOOK, "bible", "cast");
  if (existsSync(castDir)) {
    for (const f of (await readdir(castDir)).filter((f) => f.endsWith(".md") && !f.startsWith("_") && f !== "supporting.md")) {
      const txt = await readFile(path.join(castDir, f), "utf8");
      const h = firstHeading(txt);
      if (!h) continue;
      // "Lonny Hale, 17"  |  "Cole \"Judge\" Mayers, 17"  |  "The Gardener"
      const m = h.match(/^(.*?)(?:,\s*(\d+))?\s*$/);
      let name = (m?.[1] ?? h).trim();
      const age = m?.[2] ?? null;
      const aliases = new Set<string>();
      const nick = name.match(/"([^"]+)"/)?.[1];
      if (nick) aliases.add(nick);
      name = name.replace(/\s*"[^"]+"\s*/, " ").replace(/\s+/g, " ").trim();
      aliases.add(name);
      const parts = name.replace(/^The\s+/i, "").split(" ");
      const short = nick ?? parts[0];
      aliases.add(parts[0]);
      if (name.startsWith("The ")) aliases.add(name.slice(4));
      const element = txt.match(/Element:\s*([^.\n*]+)/)?.[1]?.trim() ?? null;
      const tier = txt.match(/Depth tier\s*(\d)/)?.[1] ?? null;
      const oneLine =
        txt.split(/\r?\n/).find((l, i) => i > 0 && l.trim() && !l.startsWith("#") && !l.startsWith("**") && !l.startsWith("|") && !l.startsWith("-"))?.trim() ?? null;
      const id = f.replace(/\.md$/, "");
      const group: Entity["group"] = /antagonist/i.test(txt.slice(0, 400)) || id === "judge" || id === "gardener" ? "antagonist" : "main";
      list.push({ id, name, short, aliases: [...aliases], age, element, tier, oneLine, file: `bible/cast/${f}`, group });
    }
    // supporting: bullets like "- **Ears, 13.** Air. The lookout..."
    const sup = path.join(castDir, "supporting.md");
    if (existsSync(sup)) {
      const txt = await readFile(sup, "utf8");
      for (const m of txt.matchAll(/^- \*\*([^*]+?)\*\*\s*(.*)$/gm)) {
        const head = m[1].replace(/\.$/, "");
        const nm = head.split(",")[0].trim();
        const age = head.match(/,\s*(\d+)/)?.[1] ?? null;
        if (!/^[A-Z]/.test(nm) || nm.split(" ").length > 4 || /^No /.test(nm) || /[:'’]/.test(nm)) continue;
        const id = slugify(nm);
        if (list.some((e) => e.id === id)) continue;
        const aliases = new Set<string>([nm]);
        const nick = nm.match(/"([^"]+)"/)?.[1];
        if (nick) aliases.add(nick);
        const clean = nm.replace(/\s*"[^"]+"\s*/, " ").replace(/\s+/g, " ").trim();
        aliases.add(clean);
        const toks = clean.split(" ").filter((w) => !/^(Dr|Mr|Mrs|Miss|Ms|Big|Little|Old|The)\.?$/.test(w));
        const isGroup = /^The\s/.test(clean);           // "The Nettle girl", "The little ones"
        const hon = clean.match(/^((?:Old\s)?(?:Dr|Mr|Mrs|Miss|Ms)\.?)\s/)?.[1];
        if (isGroup) aliases.add(clean.replace(/^The\s/, ""));
        else if (hon) aliases.add(`${hon.replace(/^Old\s/, "")} ${toks.at(-1)}`);   // "Mr. Hale", not bare "Hale"
        else if (toks[0] && /^[A-Z]/.test(toks[0])) aliases.add(toks[0]);
        if (nick && toks.length) { aliases.add(`${nick} ${toks[0]}`); aliases.add(`${nick} ${toks.at(-1)}`); }
        list.push({
          id,
          name: clean,
          short: nick ?? (isGroup ? clean.replace(/^The\s/, "") : hon ? `${hon.replace(/^Old\s/, "")} ${toks.at(-1)}` : toks[0] ?? clean),
          aliases: [...aliases],
          age,
          element: m[2].match(/^(Fire|Water|Earth|Air|Lightning|Life\s*\/\s*decay)\b[^.]*/)?.[0]?.trim() ?? null,
          tier: null,
          oneLine: m[2].trim(),
          file: "bible/cast/supporting.md",
          group: "supporting",
        });
      }
    }
  }
  // extra aliases from an optional file in the book repo
  const extra = path.join(BOOK, "bible", "cast", "aliases.json");
  if (existsSync(extra)) {
    const map = JSON.parse(await readFile(extra, "utf8")) as Record<string, string[]>;
    for (const e of list) if (map[e.id]) e.aliases = [...new Set([...e.aliases, ...map[e.id]])];
  }
  // drop aliases that are common words or too short
  const stop = new Set(["The", "Dr", "Mr", "Mrs", "Miss", "Big", "Little", "Granny", "Mother"]);
  for (const e of list) e.aliases = e.aliases.filter((a) => a.length > 2 && !stop.has(a));
  entityCache = { at: Date.now(), list };
  return list;
}

// ---------- versions ----------
export async function versions(chapterId: string): Promise<VersionInfo[]> {
  const vdir = safe(`chapters/${chapterId}/versions`);
  if (!existsSync(vdir)) return [];
  const out: VersionInfo[] = [];
  for (const f of (await readdir(vdir)).filter((f) => f.endsWith(".md")).sort()) {
    const t = await readFile(path.join(vdir, f), "utf8");
    const m = f.match(/^(v\d+)-(\d{8}-\d{4})/);
    out.push({ file: `chapters/${chapterId}/versions/${f}`, label: m?.[1] ?? f, stamp: m?.[2] ?? "", words: words(t) });
  }
  return out;
}

/** Mirrors scripts/save-version.sh: snapshot LATEST.md -> versions/vNNN-YYYYMMDD-HHMM.md and append CHANGELOG line. */
export async function snapshot(chapterId: string, note: string) {
  const dir = safe(`chapters/${chapterId}`);
  const latest = path.join(dir, "LATEST.md");
  if (!existsSync(latest)) throw new Error("no LATEST.md");
  const vdir = path.join(dir, "versions");
  await mkdir(vdir, { recursive: true });
  const n = (await readdir(vdir)).length + 1;
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const label = `v${String(n).padStart(3, "0")}`;
  const out = path.join(vdir, `${label}-${stamp}.md`);
  await writeFile(out, await readFile(latest, "utf8"), "utf8");
  const cl = path.join(dir, "CHANGELOG.md");
  const prev = existsSync(cl) ? await readFile(cl, "utf8") : `# Changelog: ${chapterId}\n\n`;
  await writeFile(cl, prev.replace(/\s*$/, "\n") + `- ${label} (${stamp}): ${note || "snapshot"}\n`, "utf8");
  return { file: rel(out), label, stamp };
}

/** Mirrors scripts/build-manuscript.sh */
export async function buildManuscript() {
  const t = await tree();
  const d = new Date();
  const pad = (x: number) => String(x).padStart(2, "0");
  const built = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  let out = `# Morne Bay (working title)\n\n_Built ${built}. Do not edit; edit chapters/*/LATEST.md and rerun scripts/build-manuscript.sh._\n\n`;
  for (const c of t.chapters) out += "\n" + (await readText(`chapters/${c.id}/LATEST.md`)) + "\n\n";
  await writeText("manuscript/full.md", out);
  return { words: words(out), chapters: t.chapters.length };
}
