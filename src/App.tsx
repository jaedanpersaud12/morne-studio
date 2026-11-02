import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";
import RightPanel from "./components/RightPanel";
import { SettingsModal, ConflictModal, SyncAgent } from "./components/Modals";
import BoardView from "./views/BoardView";
import TimelineView from "./views/TimelineView";
import KnowledgeView from "./views/KnowledgeView";
import LedgerView from "./views/LedgerView";
import { useStore, type View } from "./store";

const VIEWS: { id: View; label: string }[] = [
  { id: "write", label: "Write" }, { id: "board", label: "Board" }, { id: "timeline", label: "Timeline" },
  { id: "knowledge", label: "Who knows" }, { id: "ledger", label: "Ledger" },
];
import { api } from "./api";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export default function App() {
  const { openPath, dirty, focus, toggleFocus, toast, view, setPanel, setView } = useStore();
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const ch = tree?.chapters.find((c) => openPath === `chapters/${c.id}/LATEST.md`);
  const title = ch ? `${ch.number}. ${ch.title}` : openPath?.split("/").pop() ?? "";
  const writing = view === "write";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "\\") { e.preventDefault(); toggleFocus(); }
      else if (e.key.toLowerCase() === "k") { e.preventDefault(); setView("write"); setPanel("claude"); }
      else if (e.key === "1") { e.preventDefault(); setView("write"); }
      else if (e.key === "2") { e.preventDefault(); setView("board"); }
      else if (e.key === "3") { e.preventDefault(); setView("timeline"); }
      else if (e.key === "4") { e.preventDefault(); setView("knowledge"); }
      else if (e.key === "5") { e.preventDefault(); setView("ledger"); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocus, setPanel, setView]);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", onUnload); return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);
  useEffect(() => { document.title = `${dirty ? "• " : ""}${writing ? title || "Morne Bay Studio" : view[0].toUpperCase() + view.slice(1)}`; }, [title, dirty, view, writing]);

  const cols = focus && writing ? "grid-cols-[0_1fr_0]"
    : writing ? "grid-cols-[240px_1fr_320px] min-[1400px]:grid-cols-[260px_1fr_360px]"
    : "grid-cols-[240px_1fr_0] min-[1400px]:grid-cols-[260px_1fr_0]";

  return (
    <div className={`h-dvh overflow-hidden grid grid-rows-[100dvh] ${cols} bg-[var(--bg)] text-[var(--fg)]`}>
      <div className="min-h-0 overflow-hidden"><Sidebar /></div>
      <main className="relative min-w-0 min-h-0 flex flex-col overflow-hidden">
        <header className="h-10 shrink-0 flex items-center justify-between gap-4 pl-3 pr-5 text-xs border-b border-[var(--line)]">
          <nav aria-label="Views" className="flex items-center gap-0.5 shrink-0">
            {VIEWS.map((v, i) => (
              <button key={v.id} aria-current={view === v.id ? "page" : undefined} onClick={() => setView(v.id)} title={`${v.label} (${MOD}${i + 1})`}
                className={`tab rounded-md px-2.5 py-1 ${view === v.id ? "bg-[var(--active)] text-[var(--fg)]" : "text-[var(--muted)] hover:text-[var(--fg)]"}`}>{v.label}</button>
            ))}
          </nav>
          {writing && (
            <div className="flex items-center gap-3 min-w-0 num text-[var(--muted)]">
              <span className="truncate text-[var(--fg-dim)]">{title}{dirty && <span className="text-[var(--accent)]"> · unsaved</span>}</span>
              {ch && <span className="shrink-0 hidden min-[1200px]:inline">{ch.pov ? `${ch.pov} POV · ` : ""}{ch.words.toLocaleString()} w</span>}
              <button onClick={toggleFocus} className="shrink-0 hover:text-[var(--fg)]" title={`${MOD}\\`}>{focus ? "exit focus" : "focus"}</button>
            </div>
          )}
        </header>
        {/* the editor stays mounted across views so unsaved text and undo history survive a trip to the board */}
        <div className={writing ? "flex-1 min-h-0 overflow-hidden" : "hidden"}><Editor /></div>
        {!writing && (
          <div className="flex-1 min-h-0 overflow-hidden">
            {view === "board" && <BoardView />}
            {view === "timeline" && <TimelineView />}
            {view === "knowledge" && <KnowledgeView />}
            {view === "ledger" && <LedgerView />}
          </div>
        )}
        {toast && <div role="status" className="toast absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-[var(--fg)] text-[var(--bg)] text-xs px-3 py-1.5 shadow max-w-[80%] truncate">{toast}</div>}
      </main>
      <div className="min-h-0 overflow-hidden">{writing && <RightPanel />}</div>
      <SettingsModal />
      <ConflictModal />
      <SyncAgent />
    </div>
  );
}
