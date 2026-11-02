import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import Sidebar from "./components/Sidebar";
import Editor from "./components/Editor";
import RightPanel from "./components/RightPanel";
import { useStore } from "./store";
import { api } from "./api";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

export default function App() {
  const { openPath, dirty, focus, toggleFocus, toast } = useStore();
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const ch = tree?.chapters.find((c) => openPath === `chapters/${c.id}/LATEST.md`);
  const title = ch ? `${ch.number}. ${ch.title}` : openPath?.split("/").pop() ?? "";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); toggleFocus(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [toggleFocus]);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener("beforeunload", onUnload); return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);
  useEffect(() => { document.title = `${dirty ? "• " : ""}${title || "Morne Bay Studio"}`; }, [title, dirty]);

  return (
    <div className={`h-screen grid ${focus ? "grid-cols-[0_1fr_0]" : "grid-cols-[240px_1fr_320px] min-[1400px]:grid-cols-[260px_1fr_360px]"} bg-[var(--bg)] text-[var(--fg)]`}>
      <div className="overflow-hidden"><Sidebar /></div>
      <main className="relative min-w-0 flex flex-col">
        <header className="h-10 flex items-center justify-between px-5 text-xs num text-[var(--muted)] border-b border-[var(--line)]">
          <div className="truncate">{title}{dirty && <span className="text-[var(--accent)]"> · unsaved</span>}</div>
          <div className="flex items-center gap-3">
            {ch && <span>{ch.pov ? `${ch.pov} POV · ` : ""}{ch.words.toLocaleString()} w</span>}
            <button onClick={toggleFocus} className="hover:text-[var(--fg)]" title={`${MOD}\\`}>{focus ? "exit focus" : "focus"}</button>
            <span className="opacity-60">{MOD}S save</span>
          </div>
        </header>
        <div className="flex-1 min-h-0"><Editor /></div>
        {toast && <div role="status" className="toast absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-[var(--fg)] text-[var(--bg)] text-xs px-3 py-1.5 shadow">{toast}</div>}
      </main>
      <div className="overflow-hidden"><RightPanel /></div>
    </div>
  );
}
