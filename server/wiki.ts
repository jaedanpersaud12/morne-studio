import path from "node:path";
import { readText, tree, loadEntities, words } from "./book";
import { backlinks as entityBacklinks, presence } from "./index-db";
import { git } from "./git";
import type { WikiPage } from "../shared/types";

/** The bible as a wiki: categories, pages with infoboxes, "what links here", and where a character appears. */

const CATS: { id: string; label: string; match: (p: string) => boolean }[] = [
  { id: "start", label: "Start here", match: (p) => /bible\/(00|01)-/.test(p) },
  { id: "people", label: "People", match: (p) => p.includes("/cast/") || /bible\/(09|10)-/.test(p) },
  { id: "world", label: "World", match: (p) => /bible\/(02|03|04|05|06|07|08|12|13)-/.test(p) },
  { id: "story", label: "Story", match: (p) => /bible\/(11|16|17|19)-/.test(p) },
  { id: "craft", label: "Craft", match: (p) => /bible\/(14|15|18)-/.test(p) },
];
export const categoryOf = (p: string) => CATS.find((c) => c.match(p))?.id ?? "other";

export async function index() {
  const t = await tree();
  const ents = await loadEntities();
  const log = await git(["log", "--name-only", "--format=@%ct", "-200", "--", "bible"]);
  const touched = new Map<string, number>();
  let when = 0;
  for (const l of log.out.split("\n")) { if (l.startsWith("@")) when = Number(l.slice(1)) * 1000; else if (l.trim() && !touched.has(l.trim())) touched.set(l.trim(), when); }
  const pages = t.bible.map((b) => {
    const e = ents.find((x) => x.file === b.path);
    return { path: b.path, title: b.title.replace(/^\d+\.\s*/, ""), words: b.words, category: categoryOf(b.path), edited: touched.get(b.path) ?? 0,
      entity: e ? { id: e.id, short: e.short, age: e.age, element: e.element, group: e.group, oneLine: e.oneLine } : undefined };
  });
  return { categories: [...CATS.map(({ id, label }) => ({ id, label })), { id: "other", label: "Other" }], pages };
}

const LINK = /\[([^\]]+)\]\(([^)#\s]+\.md)(#[^)]*)?\)/g;
const resolve = (from: string, href: string) => {
  const parts = from.split("/").slice(0, -1);
  for (const seg of href.split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
  return parts.join("/");
};

export async function page(p: string): Promise<WikiPage> {
  const content = await readText(p);
  const t = await tree();
  const all = [...t.bible.map((b) => ({ path: b.path, title: b.title, kind: "bible" as const })), ...t.chapters.map((c) => ({ path: `chapters/${c.id}/LATEST.md`, title: `${c.number}. ${c.title}`, kind: "chapter" as const }))];

  // what links here: any page whose markdown links resolve to this file
  const linksHere: WikiPage["linksHere"] = [];
  await Promise.all(all.filter((f) => f.path !== p).map(async (f) => {
    const text = await readText(f.path).catch(() => "");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(LINK)) if (resolve(f.path, m[2]) === p) {
        linksHere.push({ file: f.path, title: f.title.replace(/^\d+\.\s*/, ""), kind: f.kind, line: i + 1, text: lines[i].replace(LINK, "$1").replace(/[*_#>`]/g, "").trim().slice(0, 220) });
        break;
      }
    }
  }));
  linksHere.sort((a, b) => a.file.localeCompare(b.file));

  // outbound links (for "see also")
  const out = new Set<string>();
  for (const m of content.matchAll(LINK)) { const r = resolve(p, m[2]); if (r !== p) out.add(r); }

  // character pages: where they appear in the chapters
  const ents = await loadEntities();
  const e = ents.find((x) => x.file === p);
  let appears: WikiPage["appears"];
  if (e) {
    const pr = await presence();
    const row = pr.rows.find((r) => r.id === e.id);
    const hits = (await entityBacklinks(e.id)).filter((h) => h.kind === "chapter");
    const firstHit = hits[0];
    appears = {
      counts: t.chapters.map((c, i) => ({ number: c.number, title: c.title, path: `chapters/${c.id}/LATEST.md`, count: row?.counts[i] ?? 0, pov: (c.pov ?? "").toLowerCase() === e.short.toLowerCase() })),
      first: firstHit ? { file: firstHit.file, line: firstHit.line, text: firstHit.text.slice(0, 240) } : null,
      samples: hits.slice(0, 6).map((h) => ({ file: h.file, title: h.title, line: h.line, text: h.text.slice(0, 220) })),
    };
  }

  const lg = await git(["log", "-1", "--format=%cr%x09%s", "--", p]);
  const [when, subject] = lg.out.split("\t");
  return {
    path: p, title: (content.match(/^#\s+(.+)$/m)?.[1] ?? path.basename(p, ".md")).trim(), content, words: words(content),
    category: categoryOf(p), linksHere, seeAlso: [...out].filter((x) => all.some((a) => a.path === x)).map((x) => ({ path: x, title: (all.find((a) => a.path === x)!.title).replace(/^\d+\.\s*/, "") })),
    entity: e ? { id: e.id, name: e.name, short: e.short, age: e.age, element: e.element, tier: e.tier, group: e.group, oneLine: e.oneLine, aliases: e.aliases.filter((a) => a !== e.name && a !== e.short).slice(0, 6) } : undefined,
    appears, edited: when ? { when, subject } : null,
  };
}

export async function createPage(title: string, category: string) {
  const t = await tree();
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
  if (category === "people") {
    const p = `bible/cast/${slug}.md`;
    if (t.bible.some((b) => b.path === p)) throw new Error("A page with that name exists.");
    return { path: p, content: `# ${title}\n\n**Age:** \n**Element:** \n**Tier:** \n\nOne line on who they are.\n\n## Want\n\n## Wound\n\n## Voice\n\n## Arc\n\n## Relationships\n\n- [Juno](juno.md):\n` };
  }
  const nums = t.bible.map((b) => Number(b.path.match(/bible\/(\d+)-/)?.[1] ?? -1)).filter((n) => n >= 0);
  const n = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, "0");
  const p = `bible/${n}-${slug}.md`;
  return { path: p, content: `# ${Number(n)}. ${title}\n\nWhat this page settles, in one line.\n\n## Details\n\n## Open questions\n\n## See also\n\n- [Index](00-index.md)\n` };
}
