import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useStore } from "../store";

export default function Sidebar() {
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree, refetchInterval: 10000 });
  const { openPath, setOpenPath, setJumpLine, dirty } = useStore();
  const [q, setQ] = useState("");
  const [showBible, setShowBible] = useState(false);
  const { data: hits = [] } = useQuery({ queryKey: ["search", q], queryFn: () => api.search(q), enabled: q.trim().length > 1 });

  const open = (p: string, line?: number) => {
    if (dirty && openPath !== p && !confirm("Unsaved changes. Leave anyway?")) return;
    setOpenPath(p);
    if (line) setTimeout(() => setJumpLine(line), 50);
  };

  const total = tree?.chapters.reduce((n, c) => n + c.words, 0) ?? 0;

  return (
    <aside className="h-full flex flex-col bg-[var(--panel)] border-r border-[var(--line)]">
      <div className="px-4 pt-4 pb-3">
        <div className="font-semibold tracking-tight">Morne Bay</div>
        <div className="text-xs text-[var(--muted)]">{tree ? `${tree.chapters.length} chapters · ${total.toLocaleString()} words` : "…"}</div>
      </div>
      <div className="px-3 pb-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything…"
          className="w-full rounded-md bg-[var(--bg)] border border-[var(--line)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]" />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4 text-sm">
        {q.trim().length > 1 ? (
          <div className="space-y-1 px-1">
            <div className="text-xs text-[var(--muted)] px-1 py-1">{hits.length} hits</div>
            {hits.map((h, i) => (
              <button key={i} onClick={() => open(h.file, h.line)} className="block w-full text-left rounded-md px-2 py-1.5 hover:bg-[var(--hover)]">
                <div className="text-[11px] text-[var(--muted)]">{h.kind === "chapter" ? "ch " : ""}{h.title} · L{h.line}</div>
                <div className="line-clamp-2 text-[13px]">{h.text}</div>
              </button>
            ))}
          </div>
        ) : (
          <>
            <Section label="Chapters">
              {tree?.chapters.map((c) => (
                <Row key={c.id} active={openPath === `chapters/${c.id}/LATEST.md`} onClick={() => open(`chapters/${c.id}/LATEST.md`)}
                  left={<><span className="text-[var(--muted)] tabular-nums w-5 inline-block">{c.number}</span>{c.title}</>}
                  right={<span className="flex items-center gap-2"><span className="pov" data-pov={c.pov ?? ""}>{c.pov ?? "—"}</span><span className="tabular-nums">{(c.words / 1000).toFixed(1)}k</span></span>} />
              ))}
            </Section>
            <Section label="Bible" collapsed={!showBible} onToggle={() => setShowBible((s) => !s)}>
              {tree?.bible.map((b) => (
                <Row key={b.path} active={openPath === b.path} onClick={() => open(b.path)}
                  left={<span className="truncate">{b.title.replace(/^\d+\.\s*/, "")}</span>} right={<span className="text-[var(--muted)] text-[11px]">{b.path.includes("/cast/") ? "cast" : b.path.match(/bible\/(\d+)/)?.[1] ?? ""}</span>} />
              ))}
              {tree?.other.map((b) => (
                <Row key={b.path} active={openPath === b.path} onClick={() => open(b.path)} left={<span className="truncate">{b.path}</span>} right={null} />
              ))}
            </Section>
          </>
        )}
      </div>
    </aside>
  );
}

function Section({ label, children, collapsed, onToggle }: { label: string; children: React.ReactNode; collapsed?: boolean; onToggle?: () => void }) {
  return (
    <div className="mb-2">
      <button onClick={onToggle} className="w-full text-left text-[11px] uppercase tracking-wider text-[var(--muted)] px-2 py-1.5 flex items-center justify-between">
        {label}{onToggle && <span>{collapsed ? "+" : "–"}</span>}
      </button>
      {!collapsed && <div>{children}</div>}
    </div>
  );
}
function Row({ left, right, active, onClick }: { left: React.ReactNode; right: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left ${active ? "bg-[var(--active)] text-[var(--fg)]" : "hover:bg-[var(--hover)]"}`}>
      <span className="truncate">{left}</span><span className="text-xs text-[var(--muted)] shrink-0">{right}</span>
    </button>
  );
}
