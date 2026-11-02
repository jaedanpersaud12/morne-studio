import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { goTo, useStore } from "./store";
import type { AgentActivity, StudioEvent } from "../shared/types";

const DATA_KEYS: Record<string, string[][]> = {
  chapters: [["meta"], ["tree"]], knowledge: [["knowledge"], ["flags"]], ledger: [["ledger"]], notes: [["notes"]],
};
/** Claude did something over MCP: record it, and in Follow mode take the author to it. */
function onAgent(a: AgentActivity) {
  useStore.setState((s) => {
    const i = s.agent.findIndex((x) => x.id === a.id);
    const agent = i >= 0 ? s.agent.map((x, j) => (j === i ? { ...x, ...a } : x)) : [...s.agent, a].slice(-200);
    return { agent };
  });
  const st = useStore.getState();
  if (!a.path || !a.path.endsWith(".md")) return;
  const showable = (a.tool === "read_file" && a.state === "running") || (a.tool === "read_file" && a.state === "done") || ((a.tool === "edit_file" || a.tool === "add_note" || a.tool === "write_file") && a.state === "done") || (a.tool === "open_in_studio" && a.state === "running");
  if (!showable) return;
  if (st.agentFollow && (st.openPath !== a.path || st.view !== "write") && !st.dirty) goTo(a.path, a.from);
  if (st.agentFollow || st.openPath === a.path) {
    const kind = a.tool === "read_file" ? "read" : a.tool === "open_in_studio" ? "point" : "edit";
    useStore.setState({ agentMark: { path: a.path, from: a.from ?? 1, to: a.to ?? a.from ?? 1, kind, key: `${a.id}:${a.state}`, live: a.state === "running" } });
  }
}

const nice = (p: string) => p.match(/^chapters\/ch0?(\d+)-([^/]+)\//)?.slice(1).join(" · ").replace(/-/g, " ") ?? p.replace(/^bible\//, "");

/** Listens to Studio's server: edits from Claude over MCP, the other machine, or another window appear here live. */
export function useLiveEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    let es: EventSource | null = null, retry: ReturnType<typeof setTimeout> | undefined, gone = false;
    const connect = () => {
      es = new EventSource("/api/events");
      es.onmessage = (m) => {
        let e: StudioEvent; try { e = JSON.parse(m.data); } catch { return; }
        if (e.t === "changed") {
          qc.invalidateQueries({ queryKey: ["file", e.path] });
          ["tree", "search", "git", "numbers", "flags", "presence", "backlinks", "wikiIndex", "wikiPage"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
          qc.invalidateQueries({ queryKey: ["fingerprint", e.path] });
          if (e.source === "mcp" && useStore.getState().openPath === e.path && useStore.getState().dirty)
            toast.warning("You have unsaved changes here, so Claude's edit wasn't loaded. Save keeps yours; reopen the file to see Claude's.");
        } else if (e.t === "data") {
          (DATA_KEYS[e.key] ?? [[e.key]]).forEach((k) => qc.invalidateQueries({ queryKey: k }));

        } else if (e.t === "goto") goTo(e.path, e.line);
        else if (e.t === "agent") onAgent(e.a);
      };
      es.onerror = () => { es?.close(); if (!gone) retry = setTimeout(connect, 3000); };
    };
    fetch("/api/agent/activity").then((r) => r.json()).then((items: AgentActivity[]) => useStore.setState((s) => ({ agent: s.agent.length ? s.agent : items }))).catch(() => {});
    connect();
    // the server and this page must come from the same build; an older server (e.g. one Claude's MCP started) gets flagged
    fetch("/api/health").then((r) => r.json()).then((h: { build: string }) => {
      if (h.build !== "dev" && h.build !== __BUILD_ID__) toast.warning("Studio's server is older than this page", { description: "Close Studio and run Start Studio again. It will replace the old server.", duration: 20000 });
    }).catch(() => {});
    return () => { gone = true; clearTimeout(retry); es?.close(); };
  }, [qc]);
}
