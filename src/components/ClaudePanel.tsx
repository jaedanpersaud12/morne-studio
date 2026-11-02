import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useStore } from "../store";
import { replaceRange } from "../editorBridge";

const ACTIONS = [
  { id: "tighten", label: "Tighten", hint: "Rewrite to the writing rules; replace in place" },
  { id: "check", label: "Check against bible", hint: "Contradictions and rule breaches" },
  { id: "cost", label: "What does this cost?", hint: "The decisions-cost test" },
  { id: "describe", label: "Describe", hint: "Three sensory alternatives" },
] as const;

export default function ClaudePanel() {
  const { selection, openPath, setSettingsOpen, say } = useStore();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const snap = useRef<typeof selection>(null);
  const abort = useRef<AbortController | null>(null);
  const ch = tree?.chapters.find((c) => openPath === `chapters/${c.id}/LATEST.md`);

  const go = async (action: string, question?: string) => {
    if (busy) return;
    if (action !== "ask" && !selection?.text.trim()) { say("Select some text in the editor first."); return; }
    abort.current = new AbortController();
    snap.current = selection;
    setOut(""); setBusy(action); setLastAction(action);
    try {
      await api.claude({ action, selection: action === "ask" ? "" : selection!.text, context: action === "ask" ? undefined : selection!.context, chapter: ch ? `${ch.number}. ${ch.title} (${ch.pov ?? "?"} POV)` : openPath ?? undefined, question },
        (t) => setOut((o) => o + t), abort.current.signal);
    } catch (e: any) {
      if (e.name !== "AbortError") setOut((o) => o + `\n\n⚠︎ ${e.message}`);
    } finally { setBusy(null); }
  };

  const replace = () => {
    const s = snap.current;
    if (!s) return;
    const ok = replaceRange(s.from, s.to, s.text, out.trim());
    say(ok ? "Replaced. Ctrl+Z to undo." : "The text moved; couldn't find the original selection.");
  };

  if (settings && !settings.hasKey) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed">Claude edits with your bible as its rulebook: tighten a passage, check it against canon, run the decisions-cost test, or ask anything about the book.</p>
        <p className="text-[13px] text-[var(--fg-dim)]">It needs an Anthropic API key, stored only on this machine (never in either repo).</p>
        <button className="btn" onClick={() => setSettingsOpen(true)}>Add API key</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="label mb-1">Selection</div>
        {selection?.text.trim() ? (
          <blockquote className="text-[13px] leading-snug text-[var(--fg-dim)] border-l-2 border-[var(--line)] pl-2 line-clamp-4 font-[var(--font-prose)]">{selection.text}</blockquote>
        ) : <div className="text-xs text-[var(--muted)]">Select text in the editor.</div>}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {ACTIONS.map((a) => (
          <button key={a.id} className="btn text-left py-1.5" title={a.hint} disabled={!!busy || !selection?.text.trim()} onClick={() => go(a.id)}>
            {busy === a.id ? "…" : a.label}
          </button>
        ))}
      </div>
      <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); if (q.trim()) go("ask", q.trim()); }}>
        <label className="label" htmlFor="ask">Ask the book</label>
        <div className="flex gap-1.5">
          <input id="ask" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Has anyone mentioned Kit's mother since ch 1?" className="field flex-1" />
          <button className="btn" disabled={!!busy || !q.trim()}>{busy === "ask" ? "…" : "Ask"}</button>
        </div>
      </form>
      {(out || busy) && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="label">{lastAction === "ask" ? "Answer" : ACTIONS.find((a) => a.id === lastAction)?.label}</div>
            <div className="flex gap-1.5">
              {busy && <button className="btn" onClick={() => abort.current?.abort()}>Stop</button>}
              {!busy && lastAction === "tighten" && out.trim() && <button className="btn chip-on" onClick={replace}>Replace selection</button>}
              {!busy && out && <button className="btn" onClick={() => { navigator.clipboard?.writeText(out); say("Copied"); }}>Copy</button>}
            </div>
          </div>
          <div className={`text-[13px] leading-relaxed whitespace-pre-wrap rounded-md bg-[var(--bg)] p-2.5 ${lastAction === "tighten" ? "font-[var(--font-prose)] text-[14px]" : ""}`} aria-live="polite">{out}{busy && <span className="caret" aria-hidden>▍</span>}</div>
        </div>
      )}
      <div className="text-xs text-[var(--muted)]">Model: {settings?.model} · <button className="underline underline-offset-2" onClick={() => setSettingsOpen(true)}>settings</button> · Ctrl+K opens this tab</div>
    </div>
  );
}
