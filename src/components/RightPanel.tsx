import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { diffWords } from "diff";
import { api } from "../api";
import { useStore, type Panel } from "../store";
import { TICS } from "../../shared/tics";
import ClaudePanel from "./ClaudePanel";
import { Segmented } from "./ui";
import { History as HistoryIcon, ListChecks, Sparkles, StickyNote, UsersRound } from "lucide-react";
import NotesPanel from "./NotesPanel";
import { goTo } from "../store";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function hl(text: string, aliases: string[]) {
  if (!aliases.length) return text;
  const re = new RegExp(`(?<![A-Za-z])(${aliases.map(esc).join("|")})(?![A-Za-z])`, "g");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}

const TABS: { id: Panel; label: string; icon: React.ReactNode }[] = [
  { id: "claude", label: "Claude", icon: <Sparkles size={13} /> }, { id: "notes", label: "Notes", icon: <StickyNote size={13} /> },
  { id: "cast", label: "Cast", icon: <UsersRound size={13} /> }, { id: "stats", label: "Tics", icon: <ListChecks size={13} /> },
  { id: "history", label: "History", icon: <HistoryIcon size={13} /> },
];

export default function RightPanel() {
  const { panel: raw, setPanel } = useStore();
  const panel = raw === "entity" || raw === "backlinks" ? "cast" : raw === "versions" || raw === "git" ? "history" : raw;
  const { data: notes = [] } = useQuery({ queryKey: ["notes"], queryFn: api.notes });
  const openPath = useStore((s) => s.openPath);
  const openNotes = notes.filter((n) => !n.resolved && n.file === openPath).length;
  return (
    <aside className="surface h-full min-h-0 flex flex-col">
      <div className="px-2 pt-2 pb-1 shrink-0">
        <Segmented label="Panel" size="sm" value={panel as Panel} onChange={setPanel}
          items={TABS.map((t) => ({ ...t, tip: t.label, badge: t.id === "notes" && openNotes > 0 ? <span className="ui-seg-badge num">{openNotes}</span> : undefined }))} />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-3 pb-4 text-sm">
        {panel === "cast" && <CastTab />}
        {panel === "history" && <History />}
        {panel === "notes" && <NotesPanel />}
        {panel === "stats" && <Stats />}
        {panel === "claude" && <ClaudePanel />}
      </div>
    </aside>
  );
}

function CastTab() {
  const { entityId, setEntity } = useStore();
  if (!entityId) return <Cast />;
  return (
    <div className="space-y-4">
      <button className="text-xs text-[var(--muted)] hover:text-[var(--fg)]" onClick={() => setEntity(null)}>← All characters</button>
      <EntityCard />
      <div className="pt-3 border-t border-[var(--line)]"><Backlinks /></div>
    </div>
  );
}

function Cast() {
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });
  const { data: pres } = useQuery({ queryKey: ["presence"], queryFn: api.presence, refetchInterval: 15000 });
  const { setEntity } = useStore();
  const groups = ["main", "antagonist", "supporting"] as const;
  return (
    <div className="space-y-4">
      {pres && (
        <div>
          <div className="label mb-1">Presence by chapter</div>
          <table className="w-full text-xs num">
            <thead><tr><th className="text-left font-normal text-[var(--muted)]"></th>{pres.chapters.map((c) => <th key={c} className="font-normal text-[var(--muted)] w-6 text-center">{c}</th>)}</tr></thead>
            <tbody>
              {pres.rows.slice(0, 12).map((r) => {
                const max = Math.max(...r.counts, 1);
                return (
                  <tr key={r.id} className="cursor-pointer hover:bg-[var(--hover)]" onClick={() => setEntity(r.id)}>
                    <td className="py-0.5 pr-1 truncate max-w-[72px]">{r.short}</td>
                    {r.counts.map((n, i) => <td key={i} className="text-center"><span className="inline-block w-5 h-4 rounded-sm" style={{ background: `color-mix(in oklab, var(--accent) ${Math.round((n / max) * 85)}%, transparent)` }} title={`${r.short}: ${n} in ch ${pres.chapters[i]}`} aria-label={`${n}`} /></td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {groups.map((g) => (
        <div key={g}>
          <div className="label mb-1">{g}</div>
          <div className="flex flex-wrap gap-1">
            {entities.filter((e) => e.group === g).map((e) => (
              <button key={e.id} onClick={() => setEntity(e.id)} className={`ent-chip ent-${g}`}>{e.short}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EntityCard() {
  const { entityId, setOpenPath } = useStore();
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });
  const e = entities.find((x) => x.id === entityId);
  const { data: file } = useQuery({ queryKey: ["file", e?.file], queryFn: () => api.file(e!.file!), enabled: !!e?.file && e.file !== "bible/cast/supporting.md" });
  if (!e) return <div className="text-[var(--muted)]">Hover a name in the text, or ⌘/Ctrl-click it.</div>;
  return (
    <div className="space-y-3">
      <div>
        <div className="text-lg font-semibold leading-tight">{e.name}{e.age && <span className="text-[var(--muted)] font-normal">, {e.age}</span>}</div>
        <div className="text-xs text-[var(--muted)]">{[e.element, e.tier && `tier ${e.tier}`, e.group].filter(Boolean).join(" · ")}</div>
      </div>
      {e.oneLine && <p className="text-[13px] leading-relaxed">{e.oneLine}</p>}
      <div className="text-xs text-[var(--muted)]">Matches: {e.aliases.join(", ")}</div>
      <div className="flex gap-2">
        {e.file && <button className="btn" onClick={() => setOpenPath(e.file!)}>Open file</button>}
      </div>
      {file && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--muted)] hover:text-[var(--fg)]">Bible file</summary>
          <pre className="whitespace-pre-wrap leading-relaxed text-[var(--fg-dim)] font-[inherit] mt-2">{file.content}</pre>
        </details>
      )}
    </div>
  );
}

function Backlinks() {
  const { entityId, setOpenPath, setJumpLine, openPath } = useStore();
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });
  const e = entities.find((x) => x.id === entityId);
  const { data: links = [] } = useQuery({ queryKey: ["backlinks", entityId], queryFn: () => api.backlinks(entityId!), enabled: !!entityId });
  if (!e) return <div className="text-[var(--muted)]">Pick a character first.</div>;
  const chapters = links.filter((l) => l.kind === "chapter"), bible = links.filter((l) => l.kind === "bible");
  const go = (file: string, line: number) => { if (openPath !== file) setOpenPath(file); setTimeout(() => setJumpLine(line), openPath !== file ? 150 : 0); };
  const List = ({ items }: { items: typeof links }) => (
    <div className="space-y-1">
      {items.map((l, i) => (
        <button key={i} onClick={() => go(l.file, l.line)} className="block w-full text-left rounded-md px-2 py-1.5 hover:bg-[var(--hover)]">
          <div className="text-xs text-[var(--muted)]">{l.title} · L{l.line}</div>
          <div className="text-[13px] leading-snug line-clamp-3">{hl(l.text, e!.aliases)}</div>
        </button>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="font-medium">{e.name} <span className="text-[var(--muted)] font-normal">· {chapters.length} in chapters, {bible.length} in bible</span></div>
      <List items={chapters} />
      {bible.length > 0 && <><div className="label">Bible</div><List items={bible} /></>}
    </div>
  );
}

function History() {
  return (
    <div className="space-y-6">
      <section className="space-y-3"><h3 className="label">Sync</h3><Git /></section>
      <section className="space-y-3 pt-4 border-t border-[var(--line)]"><h3 className="label">Versions of this chapter</h3><Versions /></section>
      <section className="space-y-2 pt-4 border-t border-[var(--line)]">
        <h3 className="label">Export the book</h3>
        <div className="flex flex-wrap gap-2">
          <a className="btn" href="/api/export/epub" download>EPUB</a>
          <a className="btn" href="/api/export/docx" download>Word (.docx)</a>
          <a className="btn" href="/api/export/print" target="_blank" rel="noreferrer">PDF (print view)</a>
        </div>
        <p className="text-xs text-[var(--muted)]">All chapters in order, typographic quotes, scene breaks. PDF opens a 5.5 × 8.5 in print view: press Save as PDF. Title and author in Settings.</p>
      </section>
    </div>
  );
}

function Versions() {
  const { openPath, say } = useStore();
  const qc = useQueryClient();
  const chapter = openPath?.match(/^chapters\/([^/]+)\/LATEST\.md$/)?.[1] ?? null;
  const { data: versions = [] } = useQuery({ queryKey: ["versions", chapter], queryFn: () => api.versions(chapter!), enabled: !!chapter });
  const [a, setA] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { data: cur } = useQuery({ queryKey: ["file", openPath], queryFn: () => api.file(openPath!), enabled: !!openPath });
  const { data: old } = useQuery({ queryKey: ["file", a], queryFn: () => api.file(a!), enabled: !!a });
  const snap = useMutation({
    mutationFn: () => api.snapshot(chapter!, note),
    onSuccess: (r) => { say(`Saved ${r.label}`); setNote(""); qc.invalidateQueries({ queryKey: ["versions", chapter] }); qc.invalidateQueries({ queryKey: ["tree"] }); },
  });
  const parts = useMemo(() => (old && cur ? diffWords(old.content, cur.content) : null), [old, cur]);
  const stats = useMemo(() => parts ? { add: parts.filter((p) => p.added).reduce((n, p) => n + (p.value.match(/\S+/g) ?? []).length, 0), del: parts.filter((p) => p.removed).reduce((n, p) => n + (p.value.match(/\S+/g) ?? []).length, 0) } : null, [parts]);
  if (!chapter) return <div className="text-[var(--muted)]">Open a chapter to see its versions.</div>;
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Snapshot note" className="flex-1 rounded-md bg-[var(--bg)] border border-[var(--line)] px-2 py-1 text-sm outline-none focus:border-[var(--accent)]" />
        <button className="btn" onClick={() => snap.mutate()} disabled={snap.isPending}>Snapshot</button>
      </div>
      <div className="flex flex-wrap gap-1">
        {versions.map((v) => <button key={v.file} onClick={() => setA(a === v.file ? null : v.file)} className={`chip ${a === v.file ? "chip-on" : ""}`} title={v.stamp}>{v.label} <span className="opacity-60">{(v.words / 1000).toFixed(1)}k</span></button>)}
      </div>
      {parts && stats && (
        <div>
          <div className="text-xs text-[var(--muted)] mb-2">{a?.split("/").pop()?.slice(0, 4)} → now · <span className="text-[var(--add)]">+{stats.add}</span> <span className="text-[var(--del)]">−{stats.del}</span> words</div>
          <div className="diff text-[13px] leading-relaxed font-[var(--font-prose)] whitespace-pre-wrap">
            {parts.map((p, i) => p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i} className="text-[var(--fg-dim)]">{collapse(p.value)}</span>)}
          </div>
        </div>
      )}
      {!a && versions.length > 0 && <div className="text-xs text-[var(--muted)]">Pick a version to diff it against the current text.</div>}
    </div>
  );
}
function collapse(s: string) {
  if (s.length <= 320) return s;
  const head = s.slice(0, 160).replace(/\s+\S*$/, ""), tail = s.slice(-160).replace(/^\S*\s+/, "");
  return head + "\n   […]\n" + tail;
}

function Stats() {
  const { openPath, highlightTic, setHighlightTic } = useStore();
  const { data: f } = useQuery({ queryKey: ["fingerprint", openPath], queryFn: () => api.fingerprint(openPath!), enabled: !!openPath });
  if (!f) return <div className="text-[var(--muted)]">Open a file.</div>;
  const rows = TICS.map((t) => [t.id, f.counts[t.id] ?? 0, t.label] as const).sort((x, y) => y[1] - x[1]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["words", f.words.toLocaleString()], ["sentences", f.sentences], ["avg len", f.avgSentence]].map(([k, v]) => (
          <div key={k} className="rounded-md bg-[var(--bg)] py-2"><div className="text-base font-semibold num">{v}</div><div className="label">{k}</div></div>
        ))}
      </div>
      <div className="label">Tic counts (bible/14) <span className="normal-case tracking-normal">· click to highlight</span></div>
      <table className="w-full text-[13px]">
        <tbody>{rows.map(([k, n, label]) => (
          <tr key={k} role="button" tabIndex={0} aria-pressed={highlightTic === k} onClick={() => n && setHighlightTic(highlightTic === k ? null : k)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); n && setHighlightTic(highlightTic === k ? null : k); } }}
            className={`border-t border-[var(--line)] ${n ? "cursor-pointer hover:bg-[var(--hover)]" : "opacity-50"} ${highlightTic === k ? "bg-[var(--active)]" : ""}`}>
            <td className="py-1 pr-2">{highlightTic === k ? "● " : ""}{label}</td><td className="py-1 text-right num font-medium">{n}</td><td className="py-1 pl-2 text-right num text-[var(--muted)] w-14">{f.per1k[k]}/1k</td></tr>
        ))}</tbody>
      </table>
      <div className="label">Section enders</div>
      <ol className="space-y-1 text-xs text-[var(--fg-dim)] list-decimal pl-4">{f.sectionEnders.map((s, i) => <li key={i}>{s}</li>)}</ol>
      <DialoguePass />
    </div>
  );
}

/** Every line of dialogue alone, with the speaker the text names (or "?"). If you can't tell who's talking, neither can the reader. */
function DialoguePass() {
  const { openPath } = useStore();
  const [open, setOpen] = useState(false);
  const { data: file } = useQuery({ queryKey: ["file", openPath], queryFn: () => api.file(openPath!), enabled: !!openPath && open });
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });
  const lines = useMemo(() => {
    if (!file) return [];
    const names = entities.flatMap((e) => e.aliases.map((a) => [a, e.short] as const)).sort((a, b) => b[0].length - a[0].length);
    const out: { line: number; quote: string; who: string }[] = [];
    file.content.split(/\r?\n/).forEach((l, i) => {
      const quotes = l.match(/["“][^"”]+["”]/g);
      if (!quotes) return;
      const said = l.match(/(?:["”],?\s+|\.\s+)([A-Z][a-z]+(?: [A-Z][a-z]+)?) said|said ([A-Z][a-z]+)/);
      let who = said?.[1] ?? said?.[2] ?? "";
      if (!who) { const n = names.find(([a]) => new RegExp(`(?<![A-Za-z])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`).test(l.replace(/["“][^"”]+["”]/g, ""))); who = n?.[1] ?? ""; }
      else who = names.find(([a]) => a === who)?.[1] ?? who;
      quotes.forEach((q) => out.push({ line: i + 1, quote: q.slice(1, -1), who: who || "?" }));
    });
    return out;
  }, [file, entities]);
  const unknown = lines.filter((l) => l.who === "?").length;
  return (
    <div className="pt-2 border-t border-[var(--line)] space-y-2">
      <button className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Hide dialogue pass" : "Dialogue pass"}</button>
      {open && (
        <>
          <div className="text-xs text-[var(--muted)] num">{lines.length} lines · {unknown} with no named speaker in the paragraph</div>
          <ul className="space-y-0.5">
            {lines.map((l, i) => (
              <li key={i}>
                <button onClick={() => goTo(openPath!, l.line)} className="row w-full text-left rounded px-1.5 py-1 hover:bg-[var(--hover)] grid grid-cols-[64px_1fr] gap-2 text-[13px]">
                  <span className={`text-xs truncate ${l.who === "?" ? "text-[var(--del)]" : "text-[var(--muted)]"}`}>{l.who}</span>
                  <span className="leading-snug">{l.quote}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Git() {
  const { say, openPath, setConflicts, setSettingsOpen } = useStore();
  const qc = useQueryClient();
  const { data: s } = useQuery({ queryKey: ["git"], queryFn: api.git.status, refetchInterval: 8000 });
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: log = [] } = useQuery({ queryKey: ["gitlog", openPath], queryFn: () => api.git.log(openPath!), enabled: !!openPath });
  const [msg, setMsg] = useState("");
  const refresh = () => ["git", "tree", "file", "gitlog", "meta", "knowledge", "ledger", "flags"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const pull = async () => {
    const r = await api.git.pull();
    if (r.action === "conflict" && r.conflicts) setConflicts(r.conflicts);
    say(`Pull · ${r.message}`); refresh();
  };
  const push = async () => { const r = await api.git.push(); say(`Push · ${r.ok ? "done" : r.out}`); refresh(); };
  const commit = async () => { const r = await api.git.commit(msg.trim()); say(r.ok ? "Committed" : r.out); setMsg(""); refresh(); };
  const build = async () => { const r = await api.build(); say(`Manuscript built · ${r.words.toLocaleString()} words`); refresh(); };
  if (!s) return null;
  const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`; };
  const state = s.behind > 0 ? `${s.behind} to pull` : s.ahead > 0 ? (s.sync.pushPending ? `${s.ahead} to push · pushing soon` : `${s.ahead} to push`) : "in sync";
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-[var(--bg)] p-2.5 space-y-1">
        <div className="flex items-center justify-between text-[13px]"><span><span className="font-medium">{s.branch}</span> · <span className={s.ahead || s.behind ? "text-[var(--accent)]" : "text-[var(--add)]"}>{state}</span></span></div>
        {s.last && <div className="text-xs text-[var(--muted)]">Last commit {s.last.hash} · {s.last.subject} · {s.last.when}</div>}
        {s.sync.lastPull && <div className="text-xs text-[var(--muted)]">Pulled {ago(s.sync.lastPull.at)} · {s.sync.lastPull.result.message}</div>}
        {s.sync.lastPush && <div className={`text-xs ${s.sync.lastPush.ok ? "text-[var(--muted)]" : "text-[var(--del)]"}`}>Pushed {ago(s.sync.lastPush.at)} · {s.sync.lastPush.ok ? "ok" : s.sync.lastPush.message}</div>}
        {settings && <div className="text-xs text-[var(--muted)]">Auto: {[settings.autoCommit && "commit", settings.autoPush && "push", settings.autoPull && "pull"].filter(Boolean).join(" · ") || "off"} · <button className="underline underline-offset-2" onClick={() => setSettingsOpen(true)}>change</button></div>}
      </div>
      <div className="flex gap-2 flex-wrap"><button className="btn" onClick={pull}>Pull now</button><button className="btn" onClick={push}>Push now</button><button className="btn" onClick={build}>Build manuscript</button></div>
      <div>
        <div className="label mb-1">Uncommitted ({s.dirty.length})</div>
        {s.dirty.length === 0 ? <div className="text-xs text-[var(--muted)]">Nothing.</div> : <ul className="text-xs space-y-0.5">{s.dirty.map((d) => <li key={d.path} className="truncate" title={d.path}><span className="text-[var(--muted)] w-5 inline-block">{d.status}</span>{d.path}</li>)}</ul>}
      </div>
      {s.dirty.length > 0 && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) commit(); }}>
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Commit message" className="field flex-1" />
          <button className="btn" disabled={!msg.trim()}>Commit all</button>
        </form>
      )}
      {log.length > 0 && <div><div className="label mb-1">History of this file</div><ul className="text-xs space-y-1">{log.map((l) => <li key={l.hash}><span className="text-[var(--muted)] num">{l.hash}</span> {l.subject} <span className="text-[var(--muted)]">· {l.when}</span></li>)}</ul></div>}
    </div>
  );
}
