import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookMarked, ChevronRight, Search, Settings, Sparkles } from "lucide-react";
import { api } from "../api";
import { useStore, goTo } from "../store";
import { povColor } from "../povColors";
import { IconButton, Kbd } from "./ui";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";

export default function Sidebar() {
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree, refetchInterval: 10000 });
  const { openPath, view, setView, setSettingsOpen } = useStore();
  const { data: git } = useQuery({ queryKey: ["git"], queryFn: api.git.status, refetchInterval: 8000 });
  const [showBible, setShowBible] = useState(() => { try { return localStorage.getItem("mbs-bible-open") === "1"; } catch { return false; } });
  const toggleBible = () => setShowBible((s) => { try { localStorage.setItem("mbs-bible-open", s ? "0" : "1"); } catch {} return !s; });

  const syncError = useStore((s) => s.syncError);
  const syncTone = !git ? null : syncError ? "warn" : git.behind > 0 || git.sync.lastPush?.ok === false ? "warn" : git.ahead > 0 || git.dirty.some((d) => d.status !== "??") ? "pending" : "ok";
  const syncLabel = !git ? "" : syncError ? "Sync paused" : git.behind > 0 ? `${git.behind} to pull` : git.sync.lastPush?.ok === false ? "Push failed" : git.ahead > 0 ? `${git.ahead} to push` : "In sync";
  const total = tree?.chapters.reduce((n, c) => n + c.words, 0) ?? 0;
  const cast = tree?.bible.filter((b) => b.path.includes("/cast/")) ?? [];
  const pages = tree?.bible.filter((b) => !b.path.includes("/cast/")) ?? [];

  return (
    <aside className="h-full min-h-0 flex flex-col">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 px-1">
          <div className="brand-mark" aria-hidden>M</div>
          <div className="min-w-0 leading-tight">
            <div className="font-semibold tracking-tight text-[14px]">Morne Bay</div>
            <div className="text-[11.5px] text-[var(--muted)] num truncate">{tree ? `${tree.chapters.length} chapters · ${total.toLocaleString()} words` : "…"}</div>
          </div>
        </div>
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)}><Settings size={15} /></IconButton>
      </div>

      <div className="px-3 pb-3 pt-1 space-y-1">
        <button className="side-search" onClick={() => useStore.setState({ paletteOpen: true })}>
          <Search size={14} aria-hidden /><span className="flex-1 text-left">Search or jump to…</span><Kbd>{MOD}P</Kbd>
        </button>
        <button className="side-row" onClick={() => { setView("write"); useStore.getState().setPanel("claude"); setTimeout(() => (document.querySelector(".ai-composer textarea") as HTMLElement | null)?.focus(), 60); }}>
          <Sparkles size={14} className="text-[var(--accent)]" aria-hidden /><span className="flex-1 text-left">Ask the book</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 text-[13px]">
        <div className="side-label">Chapters</div>
        <div className="space-y-px">
          {tree?.chapters.map((c) => {
            const active = view === "write" && openPath === `chapters/${c.id}/LATEST.md`;
            return (
              <button key={c.id} onClick={() => goTo(`chapters/${c.id}/LATEST.md`)} className="side-row" data-active={active || undefined} aria-current={active ? "page" : undefined}>
                <span className="w-4 text-right num text-[var(--muted)] text-[12px]">{c.number}</span>
                <span className="flex-1 truncate text-left">{c.title}</span>
                {c.pov && <span className="pov-dot" style={{ ["--pov" as any]: povColor(c.pov) }} title={`${c.pov} POV`}><span className="sr-only">{c.pov} POV</span></span>}
                <span className="num text-[11.5px] text-[var(--muted)] w-8 text-right">{(c.words / 1000).toFixed(1)}k</span>
              </button>
            );
          })}
        </div>

        <button className="side-label side-label-btn mt-5" onClick={toggleBible} aria-expanded={showBible}>
          <ChevronRight size={12} className="side-caret" data-open={showBible || undefined} aria-hidden />Bible
          <span className="ml-auto num normal-case tracking-normal">{tree?.bible.length ?? ""}</span>
        </button>
        {showBible && (
          <div className="space-y-px">
            {pages.map((b) => <BibleRow key={b.path} path={b.path} title={b.title} active={view === "write" && openPath === b.path} />)}
            {cast.length > 0 && <div className="side-sublabel">Cast</div>}
            {cast.map((b) => <BibleRow key={b.path} path={b.path} title={b.title} active={view === "write" && openPath === b.path} />)}
            {tree?.other.map((b) => <BibleRow key={b.path} path={b.path} title={b.path} active={view === "write" && openPath === b.path} />)}
          </div>
        )}
      </div>

      {syncTone && (
        <div className="px-3 pb-3">
          <button className="side-sync" data-tone={syncTone} title={syncError ?? undefined} onClick={() => { setView("write"); useStore.getState().setPanel("history"); }}>
            <span className="side-sync-dot" aria-hidden />{syncLabel}<span className="ml-auto text-[var(--muted)]">GitHub</span>
          </button>
        </div>
      )}
    </aside>
  );
}

function BibleRow({ path, title, active }: { path: string; title: string; active: boolean }) {
  return (
    <button onClick={() => goTo(path)} className="side-row" data-active={active || undefined} title={title}>
      <BookMarked size={13} className="text-[var(--muted)] shrink-0" aria-hidden />
      <span className="flex-1 truncate text-left">{title.replace(/^\d+\.\s*/, "")}</span>
    </button>
  );
}

export function renderMarks(s: string) {
  return s.split(/(\u0001[^\u0002]*\u0002)/).map((part, i) => part.startsWith("\u0001") ? <mark key={i}>{part.slice(1, -1)}</mark> : part);
}
