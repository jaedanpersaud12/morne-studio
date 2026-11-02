import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { marked } from "marked";
import { ArrowLeft, ArrowRight, BookMarked, BookOpen, ChevronRight, Clock, Compass, Feather, Globe2, Link2, PenLine, Plus, Search, Shuffle, Sparkles, UsersRound } from "lucide-react";
import { api } from "../api";
import { goTo, useStore } from "../store";
import { povColor } from "../povColors";
import { IconButton } from "../components/ui";
import type { WikiIndex, WikiPage } from "../../shared/types";

const CAT_ICON: Record<string, React.ReactNode> = {
  start: <Compass size={14} />, people: <UsersRound size={14} />, world: <Globe2 size={14} />, story: <BookOpen size={14} />, craft: <Feather size={14} />, other: <BookMarked size={14} />,
};
const resolve = (from: string, href: string) => {
  const parts = from.split("/").slice(0, -1);
  for (const seg of href.split("#")[0].split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
  return parts.join("/");
};
const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const firstSentences = (t: string) => { const m = t.match(/^(.+?[.!?])(\s+.+?[.!?])?(\s|$)/); const r = m ? (m[1] + (m[2] && (m[1] + m[2]).length < 170 ? m[2] : "")) : t; return r.length > 200 ? r.slice(0, 197) + "…" : r; };
const ago = (t: number) => { if (!t) return ""; const s = (Date.now() - t) / 1000; return s < 3600 ? `${Math.max(1, Math.round(s / 60))}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };

export default function WikiView() {
  const path = useStore((s) => s.wikiPath);
  const { data: idx } = useQuery({ queryKey: ["wikiIndex"], queryFn: api.wikiIndex });
  const [hist, setHist] = useState<{ stack: (string | null)[]; at: number }>({ stack: [path], at: 0 });
  const go = (p: string | null) => {
    useStore.setState({ wikiPath: p });
    try { localStorage.setItem("mbs-wiki", p ?? ""); } catch {}
    setHist((h) => ({ stack: [...h.stack.slice(0, h.at + 1), p], at: h.at + 1 }));
  };
  const step = (d: number) => setHist((h) => { const at = Math.max(0, Math.min(h.stack.length - 1, h.at + d)); useStore.setState({ wikiPath: h.stack[at] }); return { ...h, at }; });

  return (
    <div className="wiki h-full grid grid-cols-[236px_1fr] min-h-0">
      <WikiNav idx={idx} current={path} onGo={go} />
      <div className="min-w-0 min-h-0 flex flex-col">
        <div className="wiki-bar">
          <IconButton label="Back" onClick={() => step(-1)} disabled={hist.at === 0}><ArrowLeft size={15} /></IconButton>
          <IconButton label="Forward" onClick={() => step(1)} disabled={hist.at >= hist.stack.length - 1}><ArrowRight size={15} /></IconButton>
          <Crumbs idx={idx} path={path} onGo={go} />
          <IconButton label="Random page" onClick={() => idx && go(idx.pages[Math.floor(Math.random() * idx.pages.length)].path)}><Shuffle size={15} /></IconButton>
        </div>
        <div className="flex-1 min-h-0">
          {path ? <Page key={path} path={path} idx={idx} onGo={go} /> : <Home idx={idx} onGo={go} />}
        </div>
      </div>
    </div>
  );
}

// ---------------- left navigation ----------------
function WikiNav({ idx, current, onGo }: { idx?: WikiIndex; current: string | null; onGo: (p: string | null) => void }) {
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const shown = (idx?.pages ?? []).filter((p) => !q.trim() || p.title.toLowerCase().includes(q.toLowerCase()) || p.entity?.short.toLowerCase().includes(q.toLowerCase()));
  return (
    <nav className="wiki-nav" aria-label="Wiki pages">
      <button className="wiki-home-btn" data-active={!current || undefined} onClick={() => onGo(null)}>
        <span className="wiki-logo" aria-hidden>W</span><span className="flex-1 text-left"><span className="block text-[13.5px] font-semibold">Morne Bay wiki</span><span className="block text-[11.5px] text-[var(--muted)]">{idx?.pages.length ?? "…"} pages</span></span>
      </button>
      <div className="px-3 pb-2 flex gap-1.5">
        <label className="wiki-filter"><Search size={13} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter pages" aria-label="Filter pages" /></label>
        <IconButton label="New page" onClick={() => setCreating(true)}><Plus size={15} /></IconButton>
      </div>
      {creating && <NewPage idx={idx} onDone={(p) => { setCreating(false); if (p) onGo(p); }} />}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
        {idx?.categories.map((c) => {
          const pages = shown.filter((p) => p.category === c.id);
          if (!pages.length) return null;
          return (
            <div key={c.id} className="mb-3">
              <div className="wiki-cat">{CAT_ICON[c.id]}{c.label}<span className="ml-auto num">{pages.length}</span></div>
              {pages.map((p) => (
                <button key={p.path} className="wiki-link-row" data-active={current === p.path || undefined} onClick={() => onGo(p.path)} title={p.title}>
                  {p.entity ? <span className="pov-dot" style={{ ["--pov" as any]: povColor(p.entity.short) }} aria-hidden /> : <span className="w-[7px]" />}
                  <span className="truncate flex-1 text-left">{p.entity ? p.entity.short : p.title}</span>
                  {p.entity?.age && <span className="text-[11px] text-[var(--muted)] num">{p.entity.age}</span>}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function NewPage({ idx, onDone }: { idx?: WikiIndex; onDone: (p: string | null) => void }) {
  const [title, setTitle] = useState("");
  const [cat, setCat] = useState("world");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const say = useStore((s) => s.say);
  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try { const r = await api.wikiCreate(title.trim(), cat); await qc.invalidateQueries({ queryKey: ["wikiIndex"] }); qc.invalidateQueries({ queryKey: ["tree"] }); qc.invalidateQueries({ queryKey: ["entities"] }); say(`Created ${r.path}`); onDone(r.path); }
    catch (e: any) { say(e.message); setBusy(false); }
  };
  return (
    <form className="wiki-new" onSubmit={(e) => { e.preventDefault(); create(); }}>
      <input className="field w-full" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={cat === "people" ? "Character name" : "Page title"} onKeyDown={(e) => e.key === "Escape" && onDone(null)} />
      <div className="flex gap-1.5">
        <select className="field flex-1 text-xs" value={cat} onChange={(e) => setCat(e.target.value)}>
          {idx?.categories.filter((c) => c.id !== "other").map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button className="btn" disabled={busy || !title.trim()}>Create</button>
      </div>
    </form>
  );
}

function Crumbs({ idx, path, onGo }: { idx?: WikiIndex; path: string | null; onGo: (p: string | null) => void }) {
  const p = idx?.pages.find((x) => x.path === path);
  const cat = idx?.categories.find((c) => c.id === p?.category);
  return (
    <div className="wiki-crumbs">
      <button onClick={() => onGo(null)}>Wiki</button>
      {cat && <><ChevronRight size={12} aria-hidden /><span>{cat.label}</span></>}
      {p && <><ChevronRight size={12} aria-hidden /><span className="text-[var(--fg)] truncate">{p.entity ? p.entity.short : p.title}</span></>}
    </div>
  );
}

// ---------------- home ----------------
function Home({ idx, onGo }: { idx?: WikiIndex; onGo: (p: string) => void }) {
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  if (!idx) return null;
  const cast = idx.pages.filter((p) => p.entity);
  const recent = [...idx.pages].filter((p) => p.edited).sort((a, b) => b.edited - a.edited).slice(0, 6);
  const total = idx.pages.reduce((n, p) => n + p.words, 0);
  return (
    <div className="h-full overflow-y-auto">
      <div className="wiki-home">
        <header className="wiki-hero">
          <div className="text-[12px] text-[var(--muted)] mb-2">The story bible</div>
          <h1>Morne Bay</h1>
          <p>Every adult on the island is asleep. Everything the book knows about its world, its people and its rules, in one place.</p>
          <div className="wiki-stats num">
            <span><b>{idx.pages.length}</b> pages</span><span><b>{cast.length}</b> characters</span><span><b>{total.toLocaleString()}</b> words</span>{tree && <span><b>{tree.chapters.length}</b> chapters written</span>}
          </div>
        </header>

        <section>
          <h2 className="wiki-h2"><UsersRound size={15} /> People</h2>
          <div className="wiki-cast">
            {cast.map((p) => (
              <button key={p.path} className="wiki-person" style={{ ["--pov" as any]: povColor(p.entity!.short) }} onClick={() => onGo(p.path)}>
                <span className="wiki-avatar" aria-hidden>{p.entity!.short[0]}</span>
                <span className="min-w-0">
                  <span className="block font-medium text-[13.5px] truncate">{p.entity!.short}{p.entity!.age && <span className="text-[var(--muted)] font-normal num"> · {p.entity!.age}</span>}</span>
                  <span className="block text-[12px] text-[var(--muted)] line-clamp-2 leading-snug">{p.entity!.oneLine ?? p.title}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="grid gap-6 min-[1300px]:grid-cols-2">
          {idx.categories.filter((c) => c.id !== "people").map((c) => {
            const pages = idx.pages.filter((p) => p.category === c.id);
            if (!pages.length) return null;
            return (
              <section key={c.id} className="wiki-card">
                <h2 className="wiki-h2">{CAT_ICON[c.id]} {c.label}</h2>
                <ul>{pages.map((p) => <li key={p.path}><button onClick={() => onGo(p.path)}><span className="truncate">{p.title}</span><span className="num text-[var(--muted)] text-[11.5px]">{(p.words / 1000).toFixed(1)}k</span></button></li>)}</ul>
              </section>
            );
          })}
          {recent.length > 0 && (
            <section className="wiki-card">
              <h2 className="wiki-h2"><Clock size={15} /> Recently edited</h2>
              <ul>{recent.map((p) => <li key={p.path}><button onClick={() => onGo(p.path)}><span className="truncate">{p.entity?.short ?? p.title}</span><span className="text-[var(--muted)] text-[11.5px]">{ago(p.edited)}</span></button></li>)}</ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- a page ----------------
function Page({ path, idx, onGo }: { path: string; idx?: WikiIndex; onGo: (p: string) => void }) {
  const { data: page, isLoading, error } = useQuery({ queryKey: ["wikiPage", path], queryFn: () => api.wikiPage(path) });
  const scroller = useRef<HTMLDivElement>(null);
  const [activeH, setActiveH] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ path: string; x: number; y: number } | null>(null);
  const known = useMemo(() => new Set(idx?.pages.map((p) => p.path)), [idx]);

  const { html, toc } = useMemo(() => {
    if (!page) return { html: "", toc: [] as { id: string; text: string; level: number }[] };
    const body = page.content.replace(/^#\s+.+\n+/, "").replace(/<!--[\s\S]*?-->/g, (m) => `<div class="md-comment">${m.slice(4, -3).trim().replace(/</g, "&lt;")}</div>`);
    const toc: { id: string; text: string; level: number }[] = [];
    let raw = marked.parse(body, { gfm: true, async: false }) as string;
    raw = raw.replace(/<h([23])>(.*?)<\/h\1>/g, (_m, l, t) => { const id = slug(t); toc.push({ id, text: t.replace(/<[^>]+>/g, ""), level: Number(l) }); return `<h${l} id="${id}">${t}</h${l}>`; });
    // internal links become wiki links (with hover previews); missing pages are marked red, like a wiki
    raw = raw.replace(/<a href="([^"]+)"/g, (m, href) => {
      if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return m;
      const target = resolve(page.path, href);
      const isChapter = target.startsWith("chapters/");
      return `<a href="${href}" data-wiki="${target}" class="${isChapter ? "wiki-ch-link" : known.has(target) ? "wiki-internal" : "wiki-missing"}"`;
    });
    return { html: raw, toc };
  }, [page, known]);

  // scrollspy for the table of contents
  useLayoutEffect(() => {
    const el = scroller.current; if (!el || !toc.length) return;
    const onScroll = () => {
      const hs = toc.map((t) => el.querySelector<HTMLElement>(`#${CSS.escape(t.id)}`)).filter(Boolean) as HTMLElement[];
      const top = el.getBoundingClientRect().top + 90;
      let cur: string | null = null; for (const h of hs) if (h.getBoundingClientRect().top <= top) cur = h.id;
      setActiveH(cur);
    };
    onScroll(); el.addEventListener("scroll", onScroll, { passive: true }); return () => el.removeEventListener("scroll", onScroll);
  }, [toc]);

  if (isLoading) return <div className="p-10 text-[var(--muted)]">Loading…</div>;
  if (error || !page) return <div className="p-10 text-[var(--muted)]">This page doesn't exist yet.</div>;

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
    if (!a) return;
    const target = a.dataset.wiki;
    if (!target) { if (/^[a-z]+:/i.test(a.getAttribute("href") ?? "")) { a.target = "_blank"; a.rel = "noreferrer"; } return; }
    e.preventDefault(); setPreview(null);
    if (target.startsWith("chapters/")) goTo(target); else onGo(target);
  };
  const onOver = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a[data-wiki]") as HTMLAnchorElement | null;
    if (!a || a.classList.contains("wiki-missing")) return;
    const r = a.getBoundingClientRect();
    setPreview({ path: a.dataset.wiki!, x: r.left, y: r.bottom });
  };
  const ent = page.entity;

  return (
    <div ref={scroller} className="h-full overflow-y-auto overscroll-contain" onScroll={() => preview && setPreview(null)}>
      <div className="wiki-page">
        <article className="min-w-0">
          <div className="wiki-kicker">{CAT_ICON[page.category]}{idx?.categories.find((c) => c.id === page.category)?.label}</div>
          <h1 className="wiki-title">{ent ? ent.name : page.title.replace(/^\d+\.\s*/, "")}</h1>
          <div className="wiki-meta num">
            <span>{page.words.toLocaleString()} words</span>
            {page.edited && <span title={page.edited.subject}>Edited {page.edited.when}</span>}
            <span>{page.linksHere.length} link{page.linksHere.length === 1 ? "" : "s"} here</span>
            <button className="wiki-edit" onClick={() => goTo(page.path)}><PenLine size={13} /> Edit</button>
          </div>

          {ent && <Infobox page={page} />}

          <div className="read-md wiki-body" onClick={onClick} onMouseOver={onOver} onMouseLeave={() => setPreview(null)} dangerouslySetInnerHTML={{ __html: html }} />

          {page.appears && page.appears.samples.length > 0 && (
            <section className="wiki-section">
              <h2 className="wiki-h2"><BookOpen size={15} /> In the chapters</h2>
              <div className="space-y-1.5">
                {page.appears.samples.map((s, i) => (
                  <button key={i} className="wiki-quote" onClick={() => goTo(s.file, s.line)}>
                    <span className="wiki-quote-src num">{s.title.replace(/^(\d+)\.\s*/, "ch $1 · ")} · L{s.line}</span>
                    <span className="wiki-quote-text">{s.text}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="wiki-section">
            <h2 className="wiki-h2"><Link2 size={15} /> What links here</h2>
            {page.linksHere.length ? (
              <ul className="wiki-backlinks">
                {page.linksHere.map((l, i) => (
                  <li key={i}><button onClick={() => (l.kind === "chapter" ? goTo(l.file, l.line) : onGo(l.file))}>
                    <span className="wiki-bl-title">{l.kind === "chapter" ? <BookOpen size={12} /> : <BookMarked size={12} />}{l.title}</span>
                    <span className="wiki-bl-text">{l.text}</span>
                  </button></li>
                ))}
              </ul>
            ) : <div className="text-[13px] text-[var(--muted)]">Nothing links here yet. Link it from a related page with [{page.title.replace(/^\d+\.\s*/, "")}]({page.path.split("/").pop()}).</div>}
          </section>
        </article>

        <aside className="wiki-rail">
          {toc.length > 1 && (
            <nav className="wiki-toc" aria-label="On this page">
              <div className="wiki-rail-label">On this page</div>
              {toc.map((t) => (
                <a key={t.id} href={`#${t.id}`} data-level={t.level} data-active={activeH === t.id || undefined}
                  onClick={(e) => { e.preventDefault(); scroller.current?.querySelector(`#${CSS.escape(t.id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{t.text}</a>
              ))}
            </nav>
          )}
          {page.seeAlso.length > 0 && (
            <div className="wiki-toc">
              <div className="wiki-rail-label">See also</div>
              {page.seeAlso.slice(0, 10).map((s) => <a key={s.path} href="#" onClick={(e) => { e.preventDefault(); s.path.startsWith("chapters/") ? goTo(s.path) : onGo(s.path); }}>{s.title}</a>)}
            </div>
          )}
          <button className="wiki-ask" onClick={() => { useStore.getState().setView("write"); useStore.getState().setPanel("claude"); setTimeout(() => { const t = document.querySelector(".ai-composer textarea") as HTMLTextAreaElement | null; if (t) { t.focus(); } }, 80); }}>
            <Sparkles size={13} /> Ask the book about {ent ? ent.short : "this"}
          </button>
        </aside>
      </div>
      {preview && <Preview {...preview} />}
    </div>
  );
}

function Infobox({ page }: { page: WikiPage }) {
  const e = page.entity!;
  const color = povColor(e.short);
  const counts = page.appears?.counts ?? [];
  const max = Math.max(1, ...counts.map((c) => c.count));
  const povs = counts.filter((c) => c.pov).length;
  return (
    <aside className="wiki-infobox" style={{ ["--pov" as any]: color }}>
      <div className="wiki-ib-head">
        <span className="wiki-avatar wiki-avatar-lg" aria-hidden>{e.short[0]}</span>
        <div className="min-w-0"><div className="font-semibold text-[15px] leading-tight">{e.name}</div><div className="text-[12px] text-[var(--muted)] capitalize">{e.group}</div></div>
      </div>
      <dl className="wiki-ib-rows">
        {e.age && <><dt>Age</dt><dd className="num">{e.age}</dd></>}
        {e.element && <><dt>Element</dt><dd>{e.element}</dd></>}
        {e.tier && <><dt>Tier</dt><dd>{e.tier}</dd></>}
        {e.aliases.length > 0 && <><dt>Also</dt><dd>{e.aliases.join(", ")}</dd></>}
        {povs > 0 && <><dt>POV</dt><dd>{povs} chapter{povs === 1 ? "" : "s"}</dd></>}
      </dl>
      {e.oneLine && <p className="wiki-ib-line">{firstSentences(e.oneLine)}</p>}
      {counts.length > 0 && (
        <div className="wiki-ib-chart">
          <div className="wiki-rail-label">Mentions by chapter</div>
          <div className="wiki-bars" role="img" aria-label={`Mentions by chapter: ${counts.map((c) => `ch ${c.number} ${c.count}`).join(", ")}`}>
            {counts.map((c) => (
              <button key={c.number} className="wiki-chartbar" data-pov={c.pov || undefined} title={`ch ${c.number} ${c.title}: ${c.count}${c.pov ? " · POV" : ""}`} onClick={() => goTo(c.path)}>
                <span style={{ height: `${Math.max(c.count ? 8 : 2, (c.count / max) * 100)}%` }} />
                <i className="num">{c.number}</i>
              </button>
            ))}
          </div>
        </div>
      )}
      {page.appears?.first && <button className="wiki-ib-first" onClick={() => goTo(page.appears!.first!.file, page.appears!.first!.line)}>First appears · ch {page.appears.first.file.match(/ch0?(\d+)/)?.[1]} L{page.appears.first.line}</button>}
    </aside>
  );
}

function Preview({ path, x, y }: { path: string; x: number; y: number }) {
  const { data } = useQuery({ queryKey: ["wikiPage", path], queryFn: () => api.wikiPage(path), staleTime: 60_000, enabled: !path.startsWith("chapters/") });
  const first = data?.content.replace(/^#.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "").split(/\n\s*\n/).map((s) => s.trim()).find((s) => s && !s.startsWith("|") && !s.startsWith("-") && !s.startsWith("**")) ?? "";
  if (path.startsWith("chapters/") || !data) return null;
  const left = Math.min(x, window.innerWidth - 360);
  return (
    <div className="wiki-preview popover" style={{ left, top: y + 8 }}>
      {data.entity && <div className="wiki-preview-bar" style={{ background: povColor(data.entity.short) }} />}
      <div className="font-semibold text-[13.5px]">{data.entity?.name ?? data.title.replace(/^\d+\.\s*/, "")}</div>
      <div className="text-[12.5px] text-[var(--fg-dim)] leading-relaxed line-clamp-5 mt-1" dangerouslySetInnerHTML={{ __html: marked.parseInline(first.slice(0, 420), { async: false }) as string }} />
      <div className="text-[11px] text-[var(--muted)] mt-2 num">{data.words.toLocaleString()} words · {data.linksHere.length} links here</div>
    </div>
  );
}
