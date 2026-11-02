import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useStore, goTo } from "../store";



export default function Sidebar() {
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree, refetchInterval: 10000 });
  const { openPath, view, setView, setSettingsOpen } = useStore();
  const { data: git } = useQuery({ queryKey: ["git"], queryFn: api.git.status, refetchInterval: 8000 });
  const [q, setQ] = useState("");
  const [showBible, setShowBible] = useState(false);
  const { data: hits = [] } = useQuery({ queryKey: ["search", q], queryFn: () => api.search(q), enabled: q.trim().length > 1 });

  const open = (p: string, line?: number) => goTo(p, line);
  const syncDot = !git ? null : git.behind > 0 || git.sync.lastPush?.ok === false ? "var(--del)" : git.ahead > 0 || git.dirty.some((d) => d.status !== "??") ? "var(--accent)" : "var(--add)";
  const syncLabel = !git ? "" : git.behind > 0 ? `${git.behind} to pull` : git.sync.lastPush?.ok === false ? "push failed" : git.ahead > 0 ? `${git.ahead} to push` : "in sync";

  const total = tree?.chapters.reduce((n, c) => n + c.words, 0) ?? 0;

  return (
    <aside className="h-full min-h-0 flex flex-col bg-[var(--panel)] border-r border-[var(--line)]">
      <div className="px-4 pt-4 pb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold tracking-tight">Morne Bay</div>
          <div className="text-xs text-[var(--muted)] num">{tree ? `${tree.chapters.length} chapters · ${total.toLocaleString()} words` : "…"}</div>
          {syncDot && <button onClick={() => { setView("write"); useStore.getState().setPanel("history"); }} className="text-xs text-[var(--muted)] flex items-center gap-1.5 mt-0.5 hover:text-[var(--fg)]"><span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: syncDot }} aria-hidden />{syncLabel}</button>}
        </div>
        <button aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)} className="btn px-1.5 py-1 shrink-0">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
      <div className="px-3 pb-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything…" aria-label="Search the book and bible"
          className="field w-full px-2.5 py-1.5 text-sm" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4 text-sm">
        {q.trim().length > 1 ? (
          <div className="space-y-1 px-1">
            <div className="text-xs text-[var(--muted)] px-1 py-1">{hits.length} hits</div>
            {hits.map((h, i) => (
              <button key={i} onClick={() => open(h.file, h.line)} className="row block w-full text-left rounded-md px-2 py-1.5 hover:bg-[var(--hover)]">
                <div className="text-xs text-[var(--muted)]"><span className={`kind kind-${h.kind}`}>{h.kind === "chapter" ? "ch" : "bible"}</span> {h.title.replace(/^\d+\.\s*/, "")} · L{h.line}</div>
                <div className="line-clamp-3 text-[13px] leading-snug">{renderMarks(h.text)}</div>
              </button>
            ))}
          </div>
        ) : (
          <>
            <Section label="Chapters">
              {tree?.chapters.map((c) => (
                <Row key={c.id} active={view === "write" && openPath === `chapters/${c.id}/LATEST.md`} onClick={() => open(`chapters/${c.id}/LATEST.md`)}
                  left={<><span className="text-[var(--muted)] num w-5 inline-block">{c.number}</span>{c.title}</>}
                  right={<span className="flex items-center gap-2"><span className="pov" data-pov={c.pov ?? ""}>{c.pov ?? "—"}</span><span className="num">{(c.words / 1000).toFixed(1)}k</span></span>} />
              ))}
            </Section>
            <Section label="Bible" collapsed={!showBible} onToggle={() => setShowBible((s) => !s)}>
              {tree?.bible.map((b) => (
                <Row key={b.path} active={view === "write" && openPath === b.path} onClick={() => open(b.path)}
                  left={<span className="truncate" title={b.title}>{b.title.replace(/^\d+\.\s*/, "")}</span>} right={<span className="text-[var(--muted)] text-xs">{b.path.includes("/cast/") ? "cast" : b.path.match(/bible\/(\d+)/)?.[1] ?? ""}</span>} />
              ))}
              {tree?.other.map((b) => (
                <Row key={b.path} active={view === "write" && openPath === b.path} onClick={() => open(b.path)} left={<span className="truncate">{b.path}</span>} right={null} />
              ))}
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}

export function renderMarks(s: string) {
  return s.split(/(\u0001[^\u0002]*\u0002)/).map((part, i) => part.startsWith("\u0001") ? <mark key={i}>{part.slice(1, -1)}</mark> : part);
}

function Section({ label, children, collapsed, onToggle }: { label: string; children: React.ReactNode; collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div className="mb-2">
      <button onClick={onToggle} className="w-full text-left label px-2 py-1.5 flex items-center justify-between">
        {label}{onToggle && <span>{collapsed ? "+" : "–"}</span>}
      </button>
      {!collapsed && <div>{children}</div>}
    </div>
  );
}
function Row({ left, right, active, onClick }: { left: React.ReactNode; right: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`row w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left ${active ? "bg-[var(--active)] text-[var(--fg)]" : "hover:bg-[var(--hover)]"}`}>
      <span className="truncate">{left}</span><span className="text-xs text-[var(--muted)] shrink-0">{right}</span>
    </button>
  );
}
