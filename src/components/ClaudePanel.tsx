import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";
import { diffWords } from "diff";
import { api } from "../api";
import { goTo, useStore } from "../store";
import { replaceRange } from "../editorBridge";
import type { AiEvent, AiSource, Tree } from "../../shared/types";

type Step = { id: string; label: string; state: "running" | "done"; summary?: string; sources?: AiSource[] };
type Run = {
  id: number; action: string; question?: string; selection?: { from: number; to: number; text: string };
  status: string; steps: Step[]; text: string; narration: string[]; done: boolean; error?: string;
  ms?: number; usage?: { input: number; output: number; cached: number }; sources: AiSource[];
  decided?: "accepted" | "rejected";
};

const ACTIONS = [
  { id: "tighten", label: "Tighten", hint: "Rewrite to the writing rules, then accept or reject the diff" },
  { id: "check", label: "Check canon", hint: "Contradictions with the bible and earlier chapters" },
  { id: "cost", label: "What does it cost?", hint: "The decisions-cost test from bible/14" },
  { id: "describe", label: "Describe", hint: "Three sensory alternatives" },
] as const;

const SUGGESTIONS = [
  "Where is Kit's mother mentioned, on the page and in the bible?",
  "Who knows the ship is a quarantine by chapter 8?",
  "Which chapters mention the corbeaux, and does every death get them?",
  "What has Lonny said yes to without asking the others?",
];

export default function ClaudePanel() {
  const { selection, openPath, setSettingsOpen, say } = useStore();
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const [runs, setRuns] = useState<Run[]>([]);
  const [q, setQ] = useState("");
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = runs.some((r) => !r.done);
  const ch = tree?.chapters.find((c) => openPath === `chapters/${c.id}/LATEST.md`);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [runs]);

  const update = (id: number, f: (r: Run) => Run) => setRuns((rs) => rs.map((r) => (r.id === id ? f(r) : r)));

  const go = async (action: string, question?: string) => {
    if (busy) return;
    if (action !== "ask" && !selection?.text.trim()) { say("Select some text in the editor first."); return; }
    const id = Date.now();
    const sel = action !== "ask" && selection ? { from: selection.from, to: selection.to, text: selection.text } : undefined;
    const history = action === "ask" ? runs.filter((r) => r.action === "ask" && r.done && !r.error).slice(-4).map((r) => ({ q: r.question!, a: r.text })) : undefined;
    setRuns((rs) => [...(action === "ask" ? rs : rs.filter((r) => r.action === "ask")), { id, action, question, selection: sel, status: "Thinking", steps: [], text: "", narration: [], done: false, sources: [] }]);
    abort.current = new AbortController();
    try {
      await api.claude(
        { action, selection: sel?.text ?? "", context: action === "ask" ? undefined : selection?.context, chapter: ch ? `${ch.number}. ${ch.title} (${ch.pov ?? "?"} POV)` : openPath ?? undefined, question, history },
        (ev: AiEvent) => update(id, (r) => apply(r, ev)),
        abort.current.signal,
      );
    } catch (e: any) {
      update(id, (r) => ({ ...r, done: true, error: e.name === "AbortError" ? "Stopped." : e.message }));
    } finally {
      update(id, (r) => (r.done ? r : { ...r, done: true }));
    }
  };

  if (settings && !settings.hasKey) {
    return (
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed">Claude edits with your bible as its rulebook and can search every chapter and bible file before it answers.</p>
        <p className="text-[13px] text-[var(--fg-dim)]">It needs an Anthropic API key, stored only on this machine.</p>
        <button className="btn" onClick={() => setSettingsOpen(true)}>Add API key</button>
      </div>
    );
  }

  const asks = runs.filter((r) => r.action === "ask");
  const edit = runs.find((r) => r.action !== "ask");

  return (
    <div className="flex flex-col min-h-full gap-4">
      {/* ---- selection actions ---- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="label">Selection</div>
          {selection?.text.trim() && <span className="text-xs text-[var(--muted)] num">{(selection.text.match(/\S+/g) ?? []).length} words</span>}
        </div>
        {selection?.text.trim()
          ? <blockquote className="text-[13px] leading-snug text-[var(--fg-dim)] border-l-2 border-[var(--accent)] pl-2 line-clamp-3 font-[var(--font-prose)]">{selection.text}</blockquote>
          : <div className="text-xs text-[var(--muted)]">Select text in the editor to tighten, check or describe it.</div>}
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.map((a) => (
            <button key={a.id} className="ai-chip" title={a.hint} disabled={busy || !selection?.text.trim()} onClick={() => go(a.id)}>{a.label}</button>
          ))}
        </div>
        {edit && <RunView run={edit} tree={tree} onStop={() => abort.current?.abort()} onDecide={(d, text) => {
          if (d === "accepted" && edit.selection) {
            const ok = replaceRange(edit.selection.from, edit.selection.to, edit.selection.text, (text ?? edit.text).trim());
            say(ok ? "Replaced · Ctrl+Z to undo" : "The text moved; couldn't find the original selection.");
            if (!ok) return;
          }
          update(edit.id, (r) => ({ ...r, decided: d }));
        }} />}
      </section>

      {/* ---- ask the book ---- */}
      <section className="flex-1 flex flex-col gap-3 pt-3 border-t border-[var(--line)]">
        <div className="flex items-center justify-between">
          <div className="label">Ask the book</div>
          {asks.length > 0 && !busy && <button className="text-xs text-[var(--muted)] hover:text-[var(--fg)]" onClick={() => setRuns((rs) => rs.filter((r) => r.action !== "ask"))}>New thread</button>}
        </div>
        {asks.length === 0 && (
          <div className="flex flex-col gap-1.5">
            {SUGGESTIONS.map((s) => <button key={s} className="ai-suggestion" disabled={busy} onClick={() => go("ask", s)}>{s}</button>)}
          </div>
        )}
        {asks.map((r) => (
          <div key={r.id} className="space-y-2">
            <div className="ai-question">{r.question}</div>
            <RunView run={r} tree={tree} onStop={() => abort.current?.abort()} />
          </div>
        ))}
        <div ref={bottom} />
        <Composer value={q} onChange={setQ} busy={busy} placeholder={asks.length ? "Ask a follow-up…" : "Ask anything about the book…"}
          onSubmit={() => { if (q.trim()) { go("ask", q.trim()); setQ(""); } }} onStop={() => abort.current?.abort()} />
        <div className="text-xs text-[var(--muted)]">{settings?.model} · searches chapters and bible before answering · <button className="underline underline-offset-2" onClick={() => setSettingsOpen(true)}>settings</button></div>
      </section>
    </div>
  );
}

function apply(r: Run, ev: AiEvent): Run {
  switch (ev.t) {
    case "status": return { ...r, status: ev.label };
    case "turn": return r.text.trim() && r.action !== "tighten" ? { ...r, narration: [...r.narration, r.text.trim()], text: "" } : { ...r, text: "" };
    case "text": return { ...r, text: r.text + ev.d, status: "Writing" };
    case "step": {
      const steps = r.steps.some((s) => s.id === ev.id) ? r.steps.map((s) => (s.id === ev.id ? { ...s, ...ev } : s)) : [...r.steps, { id: ev.id, label: ev.label, state: ev.state, summary: ev.summary, sources: ev.sources }];
      return { ...r, steps, status: ev.state === "running" ? ev.label : r.status };
    }
    case "done": return { ...r, done: true, ms: ev.ms, usage: ev.usage, sources: ev.sources };
    case "error": return { ...r, done: true, error: ev.message };
  }
}

// ---------------- a single run: thinking pill, steps, answer, sources ----------------
function RunView({ run, tree, onStop, onDecide }: { run: Run; tree?: Tree; onStop: () => void; onDecide?: (d: "accepted" | "rejected", text?: string) => void }) {
  const [open, setOpen] = useState(false);
  const working = !run.done;
  const showSteps = run.steps.length > 0;
  return (
    <div className="ai-run space-y-2" aria-busy={working}>
      {working && (
        <div className="flex items-center justify-between gap-2">
          <ThinkingPill label={run.status} />
          <button className="text-xs text-[var(--muted)] hover:text-[var(--fg)]" onClick={onStop}>Stop</button>
        </div>
      )}
      {showSteps && (
        <div className="ai-steps">
          {!working && (
            <button className="ai-steps-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              <span className="ai-caret" data-open={open}>›</span>
              Worked for {fmtMs(run.ms ?? 0)} · {run.steps.length} step{run.steps.length === 1 ? "" : "s"}
            </button>
          )}
          {(working || open) && (
            <ol className="ai-steps-list">
              {run.steps.map((s) => (
                <li key={s.id} className="ai-step" data-state={s.state}>
                  <span className="ai-step-dot" aria-hidden />
                  <span className="min-w-0">
                    <span className="ai-step-label">{s.label}</span>
                    {s.summary && <span className="ai-step-summary"> · {s.summary}</span>}
                  </span>
                </li>
              ))}
              {run.narration.map((n, i) => <li key={`n${i}`} className="ai-step ai-step-note"><span className="ai-step-dot" aria-hidden /><span className="text-[var(--fg-dim)]">{n}</span></li>)}
            </ol>
          )}
        </div>
      )}
      {run.action === "tighten" && run.selection && run.text
        ? <TightenDiff original={run.selection.text} proposed={run.text} working={working} decided={run.decided} onDecide={onDecide!} />
        : run.text && <Answer text={run.text} tree={tree} streaming={working} />}
      {run.error && <div className="ai-error" role="alert">{run.error}</div>}
      {run.done && !run.error && run.sources.length > 0 && run.action !== "tighten" && (
        <div className="flex flex-wrap gap-1 pt-1">
          {dedupe(run.sources).slice(0, 8).map((s) => <button key={`${s.file}:${s.line}`} className="ai-source" onClick={() => goTo(s.file, s.line)} title={s.file}>{s.label}</button>)}
        </div>
      )}
      {run.done && run.usage && run.usage.input > 0 && (
        <div className="text-[11px] text-[var(--muted)] num">{fmtMs(run.ms ?? 0)} · {(run.usage.input / 1000).toFixed(1)}k in{run.usage.cached ? ` (${Math.round((run.usage.cached / Math.max(1, run.usage.input + run.usage.cached)) * 100)}% cached)` : ""} · {run.usage.output} out</div>
      )}
    </div>
  );
}

function ThinkingPill({ label }: { label: string }) {
  return (
    <div className="ai-thinking" role="status" aria-live="polite">
      <span className="ai-matrix" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ ["--i" as any]: i }} />)}</span>
      <span className="ai-thinking-label">{label}</span>
    </div>
  );
}

/** Markdown answer; [ch 4 L99] and [bible/x.md L12] become citation chips that jump to the line. */
function Answer({ text, tree, streaming }: { text: string; tree?: Tree; streaming: boolean }) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { gfm: true, async: false }) as string;
    return raw.replace(/\[((?:ch\s*\d+(?:\s*,?\s*L\d+(?:\s*[–-]\s*\d+)?)?)|(?:(?:bible\/)?(?:cast\/)?[\w.-]+\.md(?:\s*,?\s*L\d+(?:\s*[–-]\s*\d+)?)?))\]/gi, (m, inner: string) => {
      const target = resolveCite(inner, tree);
      if (!target) return m;
      const label = inner.replace(/^bible\//, "").replace(/\s*,\s*/, " ").replace(/\s*[–-]\s*/, "–");
      return `<button type="button" class="ai-cite" data-file="${target.file}" data-line="${target.line ?? ""}">${label}</button>`;
    });
  }, [text, tree]);
  return (
    <div className="ai-answer read-md" data-streaming={streaming}
      onClick={(e) => { const b = (e.target as HTMLElement).closest(".ai-cite") as HTMLElement | null; if (b) goTo(b.dataset.file!, b.dataset.line ? Number(b.dataset.line) : undefined); }}
      dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function resolveCite(inner: string, tree?: Tree): { file: string; line?: number } | null {
  const line = Number(inner.match(/L(\d+)/)?.[1]) || undefined;
  const ch = inner.match(/^ch\s*(\d+)/i);
  if (ch) { const c = tree?.chapters.find((x) => x.number === Number(ch[1])); return c ? { file: `chapters/${c.id}/LATEST.md`, line } : null; }
  let f = inner.replace(/\s*,?\s*L\d+.*$/, "").trim();
  if (!f.startsWith("bible/")) f = f.startsWith("cast/") ? `bible/${f}` : tree?.bible.find((b) => b.path.endsWith("/" + f))?.path ?? `bible/${f}`;
  return { file: f, line };
}

/** Word diff of a Tighten proposal with a single Accept / Edit / Reject control. */
function TightenDiff({ original, proposed, working, decided, onDecide }: { original: string; proposed: string; working: boolean; decided?: "accepted" | "rejected"; onDecide: (d: "accepted" | "rejected", text?: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(proposed);
  useEffect(() => { if (!editing) setDraft(proposed); }, [proposed, editing]);
  const parts = useMemo(() => diffWords(original, proposed), [original, proposed]);
  const cut = parts.filter((p) => p.removed).reduce((n, p) => n + (p.value.match(/\S+/g) ?? []).length, 0);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + (p.value.match(/\S+/g) ?? []).length, 0);
  return (
    <div className="space-y-2">
      {editing
        ? <textarea className="field w-full text-[14px] leading-relaxed font-[var(--font-prose)] resize-y min-h-32" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
        : <div className="diff ai-diff">{parts.map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}</div>}
      {!working && (
        decided ? <div className="text-xs text-[var(--muted)]">{decided === "accepted" ? "✓ Applied to the chapter" : "Kept the original"}</div> : (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-[var(--muted)] num"><span className="text-[var(--del)]">−{cut}</span> <span className="text-[var(--add)]">+{added}</span> words</span>
            <div className="ai-decide" role="group" aria-label="Apply this revision">
              <button className="ai-decide-accept" onClick={() => onDecide("accepted", editing ? draft : undefined)}>✓ {editing ? "Apply edit" : "Accept"}</button>
              {!editing && <button title="Edit before applying" aria-label="Edit before applying" onClick={() => setEditing(true)}>✎</button>}
              <button title="Reject" aria-label="Reject" onClick={() => onDecide("rejected")}>✕</button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

function Composer({ value, onChange, onSubmit, onStop, busy, placeholder }: { value: string; onChange: (v: string) => void; onSubmit: () => void; onStop: () => void; busy: boolean; placeholder: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="ai-composer-wrap"><form className="ai-composer" onSubmit={(e) => { e.preventDefault(); onSubmit(); }} onClick={() => ref.current?.focus()}>
      <textarea ref={ref} rows={1} value={value} placeholder={placeholder} aria-label="Ask the book" onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }} />
      {busy
        ? <button type="button" className="ai-send" aria-label="Stop" onClick={onStop}>■</button>
        : <button type="submit" className="ai-send" aria-label="Send" disabled={!value.trim()}>↑</button>}
    </form></div>
  );
}

const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
const dedupe = (s: AiSource[]) => s.filter((x, i) => s.findIndex((y) => y.file === x.file && y.line === x.line) === i);
