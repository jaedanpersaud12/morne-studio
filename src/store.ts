import { create } from "zustand";

export type Panel = "entity" | "backlinks" | "versions" | "stats" | "git" | "cast";

type S = {
  openPath: string | null;
  setOpenPath: (p: string | null) => void;
  dirty: boolean;
  setDirty: (d: boolean) => void;
  entityId: string | null;
  setEntity: (id: string | null) => void;
  panel: Panel;
  setPanel: (p: Panel) => void;
  jumpLine: number | null;
  setJumpLine: (n: number | null) => void;
  focus: boolean;
  toggleFocus: () => void;
  toast: string | null;
  say: (m: string | null) => void;
  highlightTic: string | null;
  setHighlightTic: (id: string | null) => void;
};

const saved = (() => { try { return JSON.parse(localStorage.getItem("mbs") ?? "{}"); } catch { return {}; } })();

export const useStore = create<S>((set, get) => ({
  openPath: saved.openPath ?? null,
  setOpenPath: (p) => { set({ openPath: p, jumpLine: null }); try { localStorage.setItem("mbs", JSON.stringify({ ...saved, openPath: p })); } catch {} },
  dirty: false,
  setDirty: (dirty) => set({ dirty }),
  entityId: null,
  setEntity: (id) => set({ entityId: id, panel: id ? "entity" : get().panel }),
  panel: "cast",
  setPanel: (panel) => set({ panel }),
  jumpLine: null,
  setJumpLine: (jumpLine) => set({ jumpLine }),
  focus: false,
  toggleFocus: () => set({ focus: !get().focus }),
  highlightTic: null,
  setHighlightTic: (highlightTic) => set({ highlightTic }),
  toast: null,
  say: (toast) => { set({ toast }); if (toast) setTimeout(() => set((s) => (s.toast === toast ? { toast: null } : {})), 2500); },
}));
