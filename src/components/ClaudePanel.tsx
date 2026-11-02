import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";
import { diffWords } from "diff";
import { api } from "../api";
import { goTo, useStore } from "../store";
import { replaceRange } from "../editorBridge";
import type { AiEvent, AiSource, Entity, Tree } from "../../shared/types";
import { getEditorView } from "../editorBridge";
import { EditorView } from "@codemirror/view";

type Step = { id: string; label: string; state: "running" | "done"; summary?: string; sources?: AiSource[] };
type Run = {
  id: number; action: string; question?: string; focus?: string[]; selection?: { from: number; to: number; text: string };
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
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });
  const [runs, setRuns] = useState<Run[]>(loadThread);
  useEffect(() => { saveThread(runs); }, [runs]);
  const [q, setQ] = useState("");
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = runs.some((r) => !r.done);
  const ch = tree?.chapters.find((c) => openPath === `chapters/${c.id}/LATEST.md`);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [runs]);

  const update = (id: number, f: (r: Run) => Run) => setRuns((rs) => rs.map((r) => (r.id === id ? f(r) : r)));

  const go = async (action: string, question?: string, opts: { replace?: number; selection?: Run["selection"] } = {}) => {
    if (busy) return;
    const focus = question ? mentionPaths(question, tree, entities) : undefined;
    if (action !== "ask" && !opts.selection && !selection?.text.trim()) { say("Select some text in the editor first."); return; }
    const id = Date.now();
    const sel = opts.selection ?? (action !== "ask" && selection ? { from: selection.from, to: selection.to, text: selection.text } : undefined);
    const prior = opts.replace ? runs.slice(0, runs.findIndex((r) => r.id === opts.replace)) : runs;
    const history = action === "ask" ? prior.filter((r) => r.action === "ask" && r.done && !r.error).slice(-4).map((r) => ({ q: r.question!, a: r.text })) : undefined;
    if (action !== "ask") setOpenEdit(null);
    const fresh: Run = { id, action, question, focus, selection: sel, status: "Thinking", steps: [], text: "", narration: [], done: false, sources: [] };
    setRuns((rs) => opts.replace ? rs.map((r) => (r.id === opts.replace ? fresh : r)) : [...rs, fresh]);
    abort.current = new AbortController();
    try {
      await api.claude(
        { action, selection: sel?.text ?? "", context: action === "ask" ? undefined : selection?.context, chapter: ch ? `${ch.number}. ${ch.title} (${ch.pov ?? "?"} POV)` : openPath ?? undefined, question, history, focus },
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
  const edits = runs.filter((r) => r.action !== "ask").reverse().slice(0, 6); // newest first
  const [openEdit, setOpenEdit] = useState<number | null>(null);
  const shownEdit = openEdit ?? edits[0]?.id ?? null;
  const decide = (edit: Run, d: "accepted" | "rejected", text?: string) => {
    if (d === "accepted" && edit.selection) {
      const ok = replaceRange(edit.selection.from, edit.selection.to, edit.selection.text, (text ?? edit.text).trim());
      say(ok ? "Replaced · Ctrl+Z to undo" : "The text moved; couldn't find the original selection.");
      if (!ok) return;
    }
    update(edit.id, (r) => ({ ...r, decided: d }));
  };

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
        {edits.length > 0 && (
          <div className="ai-edits">
            {edits.map((edit) => {
              const open = edit.id === shownEdit;
              return (
                <div key={edit.id} className="ai-edit" data-open={open || undefined}>
                  <div className="ai-edit-head">
                    <button className="ai-edit-title" onClick={() => setOpenEdit(open ? -1 : edit.id)} aria-expanded={open}>
                      <span className="ai-caret" data-open={open}>›</span>
                      <span className="ai-edit-action">{ACTIONS.find((a) => a.id === edit.action)?.label ?? edit.action}</span>
                      <span className="ai-edit-target">“{excerpt(edit.selection?.text)}”</span>
                    </button>
                    <span className="ai-edit-state" data-state={editState(edit)}>{editLabel(edit)}</span>
                    {edit.done && <button className="ai-edit-x" aria-label="Dismiss" title="Dismiss" onClick={() => { setRuns((rs) => rs.filter((r) => r.id !== edit.id)); if (openEdit === edit.id) setOpenEdit(null); }}>✕</button>}
                  </div>
                  {open && (
                    <div className="ai-edit-body">
                      <RunView run={edit} tree={tree} onStop={() => abort.current?.abort()} onRetry={() => go(edit.action, undefined, { replace: edit.id, selection: edit.selection })}
                        onUse={(text) => { if (!edit.selection) return; const ok = replaceRange(edit.selection.from, edit.selection.to, edit.selection.text, text); say(ok ? "Replaced · Ctrl+Z to undo" : "The text moved; couldn't find the original selection."); if (ok) update(edit.id, (r) => ({ ...r, decided: "accepted" })); }}
                        onDecide={(d, text) => decide(edit, d, text)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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
            <RunView run={r} tree={tree} onStop={() => abort.current?.abort()} onRetry={() => go("ask", r.question, { replace: r.id })} />
          </div>
        ))}
        <div ref={bottom} />
        <Composer value={q} onChange={setQ} busy={busy} tree={tree} entities={entities} placeholder={asks.length ? "Ask a follow-up…" : "Ask anything about the book…"}
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
function RunView({ run, tree, onStop, onDecide, onRetry, onUse }: { run: Run; tree?: Tree; onStop: () => void; onDecide?: (d: "accepted" | "rejected", text?: string) => void; onRetry?: () => void; onUse?: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const options = run.action === "describe" ? parseOptions(run.text) : [];
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
        : run.action === "describe" && run.done && options.length > 1 && onUse
          ? <div className="flex flex-col gap-1.5">{options.map((o, i) => (
              <button key={i} className="ai-option" onClick={() => onUse(o)} title="Replace the selection with this"><span className="ai-option-n num">{i + 1}</span><span className="flex-1">{o}</span><span className="ai-option-use">Use</span></button>
            ))}</div>
          : run.text && <Answer text={run.text} tree={tree} streaming={working} />}
      {run.error && <div className="ai-error" role="alert">{run.error}</div>}
      {run.done && !run.error && !run.text.trim() && <div className="ai-error" role="alert">Claude came back empty. Hit Retry.</div>}
      {run.done && !run.error && run.sources.length > 0 && run.action !== "tighten" && (
        <div className="flex flex-wrap gap-1 pt-1">
          {dedupe(run.sources).slice(0, 8).map((s) => <button key={`${s.file}:${s.line}`} className="ai-source" onClick={() => goTo(s.file, s.line)} title={s.file}>{s.label}</button>)}
        </div>
      )}
      {run.done && (run.text || run.error) && (
        <div className="ai-actions">
          {run.text && <button onClick={() => { navigator.clipboard?.writeText(run.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}>{copied ? "Copied" : "Copy"}</button>}
          {onRetry && <button onClick={onRetry}>Retry</button>}
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
    const quoted = text.replace(/(^|[\s(—–-])[“"]([^"”\n]{3,160})[”"]/g, (_m, pre: string, q: string) => `${pre}<q class="ai-quote" data-q="${q.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}">${q}</q>`);
    const raw = marked.parse(quoted, { gfm: true, async: false }) as string;
    return raw.replace(/\[((?:ch\s*\d+(?:\s*,?\s*L\d+(?:\s*[–-]\s*\d+)?)?)|(?:(?:bible\/)?(?:cast\/)?[\w.-]+\.md(?:\s*,?\s*L\d+(?:\s*[–-]\s*\d+)?)?))\]/gi, (m, inner: string) => {
      const target = resolveCite(inner, tree);
      if (!target) return m;
      const label = inner.replace(/^bible\//, "").replace(/\s*,\s*/, " ").replace(/\s*[–-]\s*/, "–");
      return `<button type="button" class="ai-cite" data-file="${target.file}" data-line="${target.line ?? ""}">${label}</button>`;
    });
  }, [text, tree]);
  return (
    <div className="ai-answer read-md" data-streaming={streaming}
      onMouseDown={(e) => { if ((e.target as HTMLElement).closest(".ai-quote")) e.preventDefault(); }}
      onClick={(e) => {
        const t = e.target as HTMLElement;
        const b = t.closest(".ai-cite") as HTMLElement | null; if (b) { goTo(b.dataset.file!, b.dataset.line ? Number(b.dataset.line) : undefined); return; }
        const q = t.closest(".ai-quote") as HTMLElement | null; if (q) findInEditor(q.dataset.q!);
      }}
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

type Mention = { key: string; label: string; hint: string; path: string };
function mentionables(tree?: Tree, entities: Entity[] = []): Mention[] {
  const chs = (tree?.chapters ?? []).map((c) => ({ key: `ch${c.number}`, label: `ch${c.number}`, hint: `${c.title}${c.pov ? ` · ${c.pov}` : ""}`, path: `chapters/${c.id}/LATEST.md` }));
  const people = entities.filter((e) => e.file).map((e) => ({ key: e.short.replace(/\s+/g, ""), label: e.short.replace(/\s+/g, ""), hint: e.name + (e.age ? ` · ${e.age}` : ""), path: e.file! }));
  return [...chs, ...people];
}
function mentionPaths(q: string, tree?: Tree, entities: Entity[] = []): string[] {
  const all = mentionables(tree, entities);
  return [...q.matchAll(/@([\w'-]+)/g)].map((m) => all.find((x) => x.key.toLowerCase() === m[1].toLowerCase())?.path).filter((p): p is string => !!p);
}

function Composer({ value, onChange, onSubmit, onStop, busy, placeholder, tree, entities }: { value: string; onChange: (v: string) => void; onSubmit: () => void; onStop: () => void; busy: boolean; placeholder: string; tree?: Tree; entities: Entity[] }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [hi, setHi] = useState(0);
  const pending = useRef<number | null>(null);
  useLayoutEffect(() => { if (pending.current != null && ref.current) { ref.current.setSelectionRange(pending.current, pending.current); setCaret(pending.current); pending.current = null; } }, [value]);
  const token = value.slice(0, caret).match(/@([\w'-]*)$/);
  const list = useMemo(() => {
    if (!token) return [];
    const t = token[1].toLowerCase();
    const all = mentionables(tree, entities);
    const pre = all.filter((m) => m.key.toLowerCase().startsWith(t));
    const rest = t.length >= 2 ? all.filter((m) => !pre.includes(m) && m.hint.toLowerCase().split(/[\s·]+/).some((w) => w.startsWith(t))) : [];
    return [...pre, ...rest].slice(0, 6);
  }, [token?.[1], tree, entities]);
  useEffect(() => setHi(0), [token?.[1]]);
  const pick = (m: Mention) => {
    const start = caret - token![0].length;
    const next = value.slice(0, start) + "@" + m.key + " " + value.slice(caret);
    onChange(next);
    pending.current = start + m.key.length + 2;
  };
  return (
    <div className="ai-composer-wrap">
      {list.length > 0 && (
        <div className="ai-mentions popover" role="listbox" aria-label="Mention a chapter or character">
          {list.map((m, i) => (
            <button key={m.key} role="option" aria-selected={i === hi} className="ai-mention" onMouseDown={(e) => { e.preventDefault(); pick(m); }} onMouseEnter={() => setHi(i)}>
              <span className="ai-mention-key">@{m.label}</span><span className="ai-mention-hint">{m.hint}</span>
            </button>
          ))}
        </div>
      )}
      <form className="ai-composer" onSubmit={(e) => { e.preventDefault(); onSubmit(); }} onClick={() => ref.current?.focus()}>
        <textarea ref={ref} rows={1} value={value} placeholder={placeholder} aria-label="Ask the book"
          onChange={(e) => { onChange(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={(e) => {
            if (list.length) {
              if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => (h + 1) % list.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => (h - 1 + list.length) % list.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(list[hi]); return; }
              if (e.key === "Escape") { e.preventDefault(); onChange(value.slice(0, caret - token![0].length) + value.slice(caret)); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
          }} />
        {busy
          ? <button type="button" className="ai-send" aria-label="Stop" onClick={onStop}>■</button>
          : <button type="submit" className="ai-send" aria-label="Send" disabled={!value.trim()}>↑</button>}
      </form>
    </div>
  );
}

/** "1. foo\n2. bar" → ["foo", "bar"] (Describe's alternatives). */
function parseOptions(t: string): string[] {
  return t.split("\n").map((l) => l.match(/^\s*\d+[.)]\s+(.*)$/)?.[1]?.replace(/^\*\*[^*]+\*\*:?\s*/, "").replace(/^\((sight|sound|touch|smell|taste)\)\s*/i, "").trim()).filter((x): x is string => !!x);
}

/** Select a quoted phrase in the open chapter. */
function findInEditor(phrase: string) {
  const v = getEditorView();
  const say = useStore.getState().say;
  if (!v) { say("Open the chapter to find that phrase."); return; }
  const doc = v.state.doc.toString();
  let at = doc.indexOf(phrase);
  if (at < 0) at = doc.toLowerCase().indexOf(phrase.toLowerCase());
  if (at < 0) { say("That phrase isn't in the open file."); return; }
  v.dispatch({ selection: { anchor: at, head: at + phrase.length }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
  v.focus();
}

const THREAD_KEY = "mbs-thread";
function loadThread(): Run[] {
  try { return (JSON.parse(localStorage.getItem(THREAD_KEY) ?? "[]") as Run[]).filter((r) => r.action === "ask" && r.done); } catch { return []; }
}
function saveThread(runs: Run[]) {
  try { localStorage.setItem(THREAD_KEY, JSON.stringify(runs.filter((r) => r.action === "ask" && r.done && !r.error).slice(-12))); } catch {}
}

const excerpt = (t?: string) => { const w = (t ?? "").trim().split(/\s+/); return w.slice(0, 7).join(" ") + (w.length > 7 ? "…" : ""); };
const editState = (r: Run) => (!r.done ? "working" : r.error ? "error" : r.decided ?? (r.action === "tighten" || r.action === "describe" ? "pending" : "done"));
const editLabel = (r: Run) => ({ working: "Working…", error: "Failed", accepted: "Applied", rejected: "Kept original", pending: "Not applied", done: r.ms ? fmtMs(r.ms) : "" } as Record<string, string>)[editState(r)];
const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
const dedupe = (s: AiSource[]) => s.filter((x, i) => s.findIndex((y) => y.file === x.file && y.line === x.line) === i);
