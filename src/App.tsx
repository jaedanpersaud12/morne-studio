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
import MapView from "./views/MapView";
import { ProgressBadge, ReadAloud } from "./components/TopBarTools";
import { useStore, useMode, type View, type MdMode } from "./store";
import ReadView from "./components/ReadView";
import { getEditorView } from "./editorBridge";
import { Toaster } from "sonner";
import { PenLine, Kanban, CalendarRange, UsersRound, Scale, Network, Search, Focus, Minimize2, Type, Code, BookOpen } from "lucide-react";
import { IconButton, Segmented, TipProvider, Kbd } from "./components/ui";
import CommandPalette from "./components/CommandPalette";
import AgentIsland from "./components/AgentIsland";
import { useLiveEvents } from "./liveEvents";

const VIEWS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "write", label: "Write", icon: <PenLine size={14} /> }, { id: "board", label: "Board", icon: <Kanban size={14} /> },
  { id: "timeline", label: "Timeline", icon: <CalendarRange size={14} /> }, { id: "knowledge", label: "Who knows", icon: <UsersRound size={14} /> },
  { id: "ledger", label: "Ledger", icon: <Scale size={14} /> }, { id: "map", label: "Map", icon: <Network size={14} /> },
];
import { api } from "./api";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export default function App() {
  const { openPath, dirty, focus, toggleFocus, view, setPanel, setView } = useStore();
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  useLiveEvents();
  const ch = tree?.chapters.find((c) => openPath === `chapters/${c.id}/LATEST.md`);
  const title = ch ? `${ch.number}. ${ch.title}` : openPath?.split("/").pop() ?? "";
  const writing = view === "write";
  const mode = useMode();
  const setMode = useStore((s) => s.setMode);
  const { data: file } = useQuery({ queryKey: ["file", openPath], queryFn: () => api.file(openPath!), enabled: !!openPath, staleTime: Infinity });
  const reading = writing && mode === "read" && !!openPath;
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });
  const povId = ch?.pov ? entities.find((e) => e.short === ch.pov || e.aliases.includes(ch.pov!))?.id ?? null : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.defaultPrevented) return;
      if (e.key === "\\") { e.preventDefault(); toggleFocus(); }
      else if (e.key.toLowerCase() === "p" && !e.shiftKey) { e.preventDefault(); useStore.setState((s) => ({ paletteOpen: !s.paletteOpen })); }
      else if (e.key.toLowerCase() === "k") { e.preventDefault(); setView("write"); setPanel("claude"); }
      else if (e.key === "1") { e.preventDefault(); setView("write"); }
      else if (e.key === "2") { e.preventDefault(); setView("board"); }
      else if (e.key === "3") { e.preventDefault(); setView("timeline"); }
      else if (e.key === "4") { e.preventDefault(); setView("knowledge"); }
      else if (e.key === "5") { e.preventDefault(); setView("ledger"); }
      else if (e.key === "6") { e.preventDefault(); setView("map"); }
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocus, setPanel, setView]);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", onUnload); return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);
  useEffect(() => { document.title = `${dirty ? "• " : ""}${writing ? title || "Morne Bay Studio" : view[0].toUpperCase() + view.slice(1)}`; }, [title, dirty, view, writing]);

  const cols = focus && writing ? "grid-cols-[0_1fr_0]"
    : writing ? "grid-cols-[232px_1fr_340px] min-[1400px]:grid-cols-[252px_1fr_380px]"
    : "grid-cols-[232px_1fr_0] min-[1400px]:grid-cols-[252px_1fr_0]";
  const inset = focus && writing ? "" : "py-2 pr-2";

  return (
    <TipProvider>
    <div className={`shell h-dvh overflow-hidden grid grid-rows-[100dvh] ${cols} text-[var(--fg)]`}>
      <div className="min-h-0 overflow-hidden"><Sidebar /></div>
      <div className={`min-w-0 min-h-0 ${inset}`}>
      <main className="surface relative h-full min-w-0 min-h-0 flex flex-col overflow-hidden" data-bare={focus && writing ? "" : undefined}>
        <header className="h-12 shrink-0 flex items-center justify-between gap-3 pl-2.5 pr-3 text-xs">
          <Segmented label="Views" value={view} onChange={setView}
            items={VIEWS.map((v, i) => ({ ...v, tip: v.label, kbd: `${MOD}${i + 1}` }))} />
          <div className="flex items-center gap-1.5 min-w-0 num text-[var(--muted)]">
          {writing && (
            <>
              <span className="truncate min-w-0 text-[var(--fg-dim)] text-[13px] px-1">{title}{dirty && <span className="unsaved-dot" title="Unsaved changes" aria-label="unsaved" />}</span>
              {ch && <span className="shrink-0 hidden min-[1680px]:inline pr-1">{ch.pov ? `${ch.pov} · ` : ""}{ch.words.toLocaleString()} words</span>}
              {openPath && (
                <Segmented label="Markdown display" size="sm" value={mode} onChange={(m) => setMode(m as MdMode)} items={[
                  { id: "live", label: "Live", icon: <Type size={13} />, tip: "Rendered while you write" },
                  { id: "source", label: "Source", icon: <Code size={13} />, tip: "Raw markdown" },
                  { id: "read", label: "Read", icon: <BookOpen size={13} />, tip: "Read-only, fully rendered" },
                ]} />
              )}
              <ReadAloud pov={povId} />
              <IconButton label={focus ? "Exit focus" : "Focus mode"} kbd={`${MOD}\\`} onClick={toggleFocus} active={focus}>{focus ? <Minimize2 size={15} /> : <Focus size={15} />}</IconButton>
            </>
          )}
            <button className="ui-search-pill" onClick={() => useStore.setState({ paletteOpen: true })} aria-label="Open command palette">
              <Search size={13} aria-hidden /><span className="hidden min-[1300px]:inline">Search</span><Kbd>{MOD}P</Kbd>
            </button>
            <ProgressBadge />
          </div>
        </header>
        {/* the editor stays mounted across views so unsaved text and undo history survive a trip to the board */}
        <div className={writing && !reading ? "flex-1 min-h-0 overflow-hidden" : "hidden"}><Editor /></div>
        {reading && file && <div className="flex-1 min-h-0 overflow-hidden"><ReadView path={openPath!} content={dirty ? getEditorView()?.state.doc.toString() ?? file.content : file.content} /></div>}
        {!writing && (
          <div className="flex-1 min-h-0 overflow-hidden">
            {view === "board" && <BoardView />}
            {view === "timeline" && <TimelineView />}
            {view === "knowledge" && <KnowledgeView />}
            {view === "ledger" && <LedgerView />}
            {view === "map" && <MapView />}
          </div>
        )}
        <AgentIsland />
      </main>
      </div>
      <div className={`min-h-0 overflow-hidden ${writing && !focus ? "py-2 pr-2" : ""}`}>{writing && <RightPanel />}</div>
      <SettingsModal />
      <ConflictModal />
      <SyncAgent />
      <CommandPalette />
      <Toaster position="bottom-center" theme="dark" offset={20} toastOptions={{ className: "ui-toast", duration: 2800 }} />
    </div>
    </TipProvider>
  );
}
