import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { diffWords } from "diff";
import { api } from "../api";
import { useStore, type Panel } from "../store";

const TABS: { id: Panel; label: string }[] = [
  { id: "cast", label: "Cast" }, { id: "entity", label: "Card" }, { id: "backlinks", label: "Links" },
  { id: "versions", label: "Versions" }, { id: "stats", label: "Tics" }, { id: "git", label: "Git" },
];

export default function RightPanel() {
  const { panel, setPanel } = useStore();
  return (
    <aside className="h-full flex flex-col bg-[var(--panel)] border-l border-[var(--line)]">
      <div className="flex gap-0.5 px-2 pt-2 border-b border-[var(--line)]">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setPanel(t.id)} className={`px-2.5 py-1.5 text-xs rounded-t-md ${panel === t.id ? "bg-[var(--bg)] text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}>{t.label}</button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-sm">
        {panel === "cast" && <Cast />}
        {panel === "entity" && <EntityCard />}
        {panel === "backlinks" && <Backlinks />}
        {panel === "versions" && <Versions />}
        {panel === "stats" && <Stats />}
        {panel === "git" && <Git />}
      </div>
    </aside>
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
          <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] mb-1">Presence by chapter</div>
          <table className="w-full text-[11px] tabular-nums">
            <thead><tr><th className="text-left font-normal text-[var(--muted)]"></th>{pres.chapters.map((c) => <th key={c} className="font-normal text-[var(--muted)] w-6 text-center">{c}</th>)}</tr></thead>
            <tbody>
              {pres.rows.slice(0, 12).map((r) => {
                const max = Math.max(...r.counts, 1);
                return (
                  <tr key={r.id} className="cursor-pointer hover:bg-[var(--hover)]" onClick={() => setEntity(r.id)}>
                    <td className="py-0.5 pr-1 truncate max-w-[72px]">{r.short}</td>
                    {r.counts.map((n, i) => <td key={i} className="text-center"><span className="inline-block w-5 h-4 rounded-sm" style={{ background: `color-mix(in oklab, var(--accent) ${Math.round((n / max) * 85)}%, transparent)` }} title={String(n)} /></td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {groups.map((g) => (
        <div key={g}>
          <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] mb-1">{g}</div>
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
  const { entityId, setOpenPath, setPanel } = useStore();
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
        <button className="btn" onClick={() => setPanel("backlinks")}>Backlinks</button>
      </div>
      {file && <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--fg-dim)] font-[inherit] border-t border-[var(--line)] pt-3">{file.content.slice(0, 2500)}{file.content.length > 2500 ? "\n…" : ""}</pre>}
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
          <div className="text-[11px] text-[var(--muted)]">{l.title} · L{l.line}</div>
          <div className="text-[12.5px] leading-snug line-clamp-3">{l.text}</div>
        </button>
      ))}
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="font-medium">{e.name} <span className="text-[var(--muted)] font-normal">· {chapters.length} in chapters, {bible.length} in bible</span></div>
      <List items={chapters} />
      {bible.length > 0 && <><div className="text-[11px] uppercase tracking-wider text-[var(--muted)]">Bible</div><List items={bible} /></>}
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
  const { openPath } = useStore();
  const { data: f } = useQuery({ queryKey: ["fingerprint", openPath], queryFn: () => api.fingerprint(openPath!), enabled: !!openPath });
  if (!f) return <div className="text-[var(--muted)]">Open a file.</div>;
  const rows = Object.entries(f.counts).sort((x, y) => y[1] - x[1]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["words", f.words.toLocaleString()], ["sentences", f.sentences], ["avg len", f.avgSentence]].map(([k, v]) => (
          <div key={k} className="rounded-md bg-[var(--bg)] py-2"><div className="text-base font-semibold tabular-nums">{v}</div><div className="text-[10px] uppercase tracking-wider text-[var(--muted)]">{k}</div></div>
        ))}
      </div>
      <div className="text-[11px] uppercase tracking-wider text-[var(--muted)]">Tic counts (bible/14)</div>
      <table className="w-full text-[12.5px]">
        <tbody>{rows.map(([k, n]) => (
          <tr key={k} className="border-t border-[var(--line)]"><td className="py-1 pr-2">{k}</td><td className="py-1 text-right tabular-nums font-medium">{n}</td><td className="py-1 pl-2 text-right tabular-nums text-[var(--muted)] w-14">{f.per1k[k]}/1k</td></tr>
        ))}</tbody>
      </table>
      <div className="text-[11px] uppercase tracking-wider text-[var(--muted)]">Section enders</div>
      <ol className="space-y-1 text-[12px] text-[var(--fg-dim)] list-decimal pl-4">{f.sectionEnders.map((s, i) => <li key={i}>{s}</li>)}</ol>
    </div>
  );
}

function Git() {
  const { say, openPath } = useStore();
  const qc = useQueryClient();
  const { data: s } = useQuery({ queryKey: ["git"], queryFn: api.git.status, refetchInterval: 8000 });
  const { data: log = [] } = useQuery({ queryKey: ["gitlog", openPath], queryFn: () => api.git.log(openPath!), enabled: !!openPath });
  const [msg, setMsg] = useState("");
  const run = async (fn: () => Promise<{ ok: boolean; out: string }>, label: string) => {
    const r = await fn(); say(`${label}: ${r.ok ? "ok" : "failed"}${r.out ? " · " + r.out.slice(0, 80) : ""}`);
    qc.invalidateQueries({ queryKey: ["git"] }); qc.invalidateQueries({ queryKey: ["tree"] }); qc.invalidateQueries({ queryKey: ["file"] });
  };
  const build = async () => { const r = await api.build(); say(`Manuscript built · ${r.words.toLocaleString()} words`); qc.invalidateQueries({ queryKey: ["git"] }); };
  if (!s) return null;
  return (
    <div className="space-y-3">
      <div className="text-xs"><span className="font-medium">{s.branch}</span>{s.ahead > 0 && <span className="text-[var(--add)]"> ↑{s.ahead}</span>}{s.behind > 0 && <span className="text-[var(--del)]"> ↓{s.behind}</span>}
        {s.last && <div className="text-[var(--muted)]">{s.last.hash} · {s.last.subject} · {s.last.when}</div>}</div>
      <div className="flex gap-2 flex-wrap"><button className="btn" onClick={() => run(api.git.pull, "Pull")}>Pull</button><button className="btn" onClick={() => run(api.git.push, "Push")}>Push</button><button className="btn" onClick={build}>Build manuscript</button></div>
      <div>
        <div className="text-[11px] uppercase tracking-wider text-[var(--muted)] mb-1">Changes ({s.dirty.length})</div>
        {s.dirty.length === 0 ? <div className="text-xs text-[var(--muted)]">Clean.</div> : <ul className="text-[12px] space-y-0.5">{s.dirty.map((d) => <li key={d.path}><span className="text-[var(--muted)] w-5 inline-block">{d.status}</span>{d.path}</li>)}</ul>}
      </div>
      {s.dirty.length > 0 && (
        <div className="flex gap-2">
          <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Commit message" className="flex-1 rounded-md bg-[var(--bg)] border border-[var(--line)] px-2 py-1 text-sm outline-none focus:border-[var(--accent)]" />
          <button className="btn" disabled={!msg.trim()} onClick={() => { run(() => api.git.commit(msg.trim()), "Commit"); setMsg(""); }}>Commit all</button>
        </div>
      )}
      {log.length > 0 && <div><div className="text-[11px] uppercase tracking-wider text-[var(--muted)] mb-1">History of this file</div><ul className="text-[12px] space-y-1">{log.map((l) => <li key={l.hash}><span className="text-[var(--muted)]">{l.hash}</span> {l.subject} <span className="text-[var(--muted)]">· {l.when}</span></li>)}</ul></div>}
    </div>
  );
}
