import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { goTo, useStore } from "./store";
import type { StudioEvent } from "../shared/types";

const DATA_KEYS: Record<string, string[][]> = {
  chapters: [["meta"], ["tree"]], knowledge: [["knowledge"], ["flags"]], ledger: [["ledger"]], notes: [["notes"]],
};
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
          ["tree", "search", "git", "numbers", "flags", "presence", "backlinks"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
          qc.invalidateQueries({ queryKey: ["fingerprint", e.path] });
          if (e.source === "mcp") {
            const open = useStore.getState().openPath === e.path;
            toast(`Claude edited ${nice(e.path)}`, { description: e.label?.replace(/^AI:\s*/, "") || undefined, action: open ? undefined : { label: "Show", onClick: () => goTo(e.path) } });
            if (open && useStore.getState().dirty) toast.warning("You have unsaved changes here, so Claude's edit wasn't loaded. Save keeps yours; reopen the file to see Claude's.");
          }
        } else if (e.t === "data") {
          (DATA_KEYS[e.key] ?? [[e.key]]).forEach((k) => qc.invalidateQueries({ queryKey: k }));
          if (e.source === "mcp") toast(`Claude updated ${e.key === "chapters" ? "the board" : e.key === "knowledge" ? "who knows what" : e.key}`);
        } else if (e.t === "goto") goTo(e.path, e.line);
      };
      es.onerror = () => { es?.close(); if (!gone) retry = setTimeout(connect, 3000); };
    };
    connect();
    return () => { gone = true; clearTimeout(retry); es?.close(); };
  }, [qc]);
}
