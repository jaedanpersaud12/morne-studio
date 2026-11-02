import { create } from "zustand";
import type { Conflict } from "../shared/types";

export type Panel = "entity" | "backlinks" | "versions" | "stats" | "git" | "cast" | "claude" | "notes" | "history";
export type View = "write" | "board" | "timeline" | "knowledge" | "ledger" | "map";
export type Selection = { from: number; to: number; text: string; context: string };

type S = {
  view: View; setView: (v: View) => void;
  openPath: string | null; setOpenPath: (p: string | null) => void;
  dirty: boolean; setDirty: (d: boolean) => void;
  entityId: string | null; setEntity: (id: string | null) => void;
  panel: Panel; setPanel: (p: Panel) => void;
  jumpLine: number | null; setJumpLine: (n: number | null) => void;
  focus: boolean; toggleFocus: () => void;
  toast: string | null; say: (m: string | null) => void;
  highlightTic: string | null; setHighlightTic: (id: string | null) => void;
  selection: Selection | null; setSelection: (s: Selection | null) => void;
  settingsOpen: boolean; setSettingsOpen: (o: boolean) => void;
  conflicts: Conflict[] | null; setConflicts: (c: Conflict[] | null) => void;
  activeNote: string | null; setActiveNote: (id: string | null) => void;
  readingLine: number | null; setReadingLine: (n: number | null) => void;
};

const saved = (() => { try { return JSON.parse(localStorage.getItem("mbs") ?? "{}"); } catch { return {}; } })();
const persist = (patch: Record<string, unknown>) => { try { Object.assign(saved, patch); localStorage.setItem("mbs", JSON.stringify(saved)); } catch {} };

export const useStore = create<S>((set, get) => ({
  view: saved.view ?? "write",
  setView: (view) => { set({ view }); persist({ view }); },
  openPath: saved.openPath ?? null,
  setOpenPath: (p) => { set({ openPath: p, jumpLine: null, selection: null, view: "write" }); persist({ openPath: p, view: "write" }); },
  dirty: false, setDirty: (dirty) => set({ dirty }),
  entityId: null, setEntity: (id) => set({ entityId: id, panel: id ? "cast" : get().panel, view: "write" }),
  panel: (["entity", "backlinks"].includes(saved.panel) ? "cast" : ["versions", "git"].includes(saved.panel) ? "history" : saved.panel) ?? "cast", setPanel: (panel) => { set({ panel }); persist({ panel }); },
  jumpLine: null, setJumpLine: (jumpLine) => set({ jumpLine }),
  focus: false, toggleFocus: () => set({ focus: !get().focus }),
  toast: null,
  say: (toast) => { set({ toast }); if (toast) setTimeout(() => set((s) => (s.toast === toast ? { toast: null } : {})), 2800); },
  highlightTic: null, setHighlightTic: (highlightTic) => set({ highlightTic }),
  selection: null, setSelection: (selection) => set({ selection }),
  settingsOpen: false, setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  conflicts: null, setConflicts: (conflicts) => set({ conflicts }),
  activeNote: null, setActiveNote: (activeNote) => set({ activeNote, ...(activeNote ? { panel: "notes" as Panel } : {}) }),
  readingLine: null, setReadingLine: (readingLine) => set({ readingLine }),
}));

/** Jump to a line in a file from anywhere (board, knowledge flags, backlinks). */
export function goTo(file: string, line?: number) {
  const s = useStore.getState();
  if (s.dirty && s.openPath !== file && !confirm("Unsaved changes. Leave anyway?")) return;
  const same = s.openPath === file;
  if (!same) s.setOpenPath(file); else s.setView("write");
  if (line) setTimeout(() => useStore.getState().setJumpLine(line), same ? 0 : 150);
}
