import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { diffWords } from "diff";
import { api } from "../api";
import { useStore } from "../store";
import { getEditorView } from "../editorBridge";
import { acceptInline, inlineField, rejectInline, setCancel, setInline, type Inline } from "../inlineAi";

const QUICK = [
  { label: "Tighten", instruction: "" },
  { label: "Shorter", instruction: "Cut it by about a third. Keep every beat that matters." },
  { label: "More tension", instruction: "Raise the tension: shorter sentences, sharper verbs, withhold one thing." },
  { label: "Plainer", instruction: "Plainer words. No figurative language. Say exactly what happens." },
  { label: "Sensory", instruction: "Ground it in one concrete sensory detail the POV character would actually notice." },
  { label: "Fix dialogue", instruction: "Make the dialogue sound like these characters: light island English, said only, no speeches." },
];

/** The floating Claude bar under a selection (Ctrl+K in the editor). */
export default function InlineBar({ chapter, host }: { chapter: string; host: React.RefObject<HTMLDivElement | null> }) {
  const inline = useStore((s) => s.inline);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // follow the paragraph as the editor scrolls or reflows
  useLayoutEffect(() => {
    const v = getEditorView();
    if (!inline || !v || !host.current) { setPos(null); return; }
    const place = () => {
      const h = host.current!.getBoundingClientRect();
      const c = v.contentDOM.getBoundingClientRect();
      const block = v.lineBlockAt(Math.min(inline.to, v.state.doc.length));
      const top = block.bottom + v.documentTop - h.top + 8;
      const width = Math.min(560, c.width - 48);
      setPos({ top, left: c.left - h.left + 24, width });
    };
    place();
    const sc = v.scrollDOM; sc.addEventListener("scroll", place, { passive: true });
    const ro = new ResizeObserver(place); ro.observe(sc);
    return () => { sc.removeEventListener("scroll", place); ro.disconnect(); };
  }, [inline, host]);

  useEffect(() => { if (inline?.phase === "prompt") { setText(""); requestAnimationFrame(() => input.current?.focus()); } }, [inline?.phase === "prompt", inline?.from]);

  if (!inline || !pos) return null;

  const run = (instruction: string) => {
    const v = getEditorView(); if (!v) return;
    const cur = v.state.field(inlineField); if (!cur) return;
    const doc = v.state.doc;
    const a = doc.lineAt(cur.from), b = doc.lineAt(cur.to);
    const context = doc.sliceString(doc.line(Math.max(1, a.number - 6)).from, doc.line(Math.min(doc.lines, b.number + 6)).to);
    const ctrl = new AbortController();
    setCancel(() => ctrl.abort());
    let out = "";
    const patch = (p: Partial<Inline>) => { const now = v.state.field(inlineField); if (now) v.dispatch({ effects: setInline.of({ ...now, ...p }) }); };
    v.dispatch({ selection: { anchor: cur.to } });
    patch({ phase: "streaming", proposed: "", instruction, error: undefined });
    v.focus();
    api.claude(
      { action: instruction ? "rewrite" : "tighten", selection: cur.original, context, chapter, instruction: instruction || undefined },
      (ev) => {
        if (ev.t === "text") { out += ev.d; patch({ proposed: out }); }
        else if (ev.t === "error") patch({ phase: "error", error: ev.message });
      },
      ctrl.signal,
    ).then(() => {
      const now = v.state.field(inlineField);
      if (now?.phase === "streaming") patch(out.trim() ? { phase: "ready", proposed: out } : { phase: "error", error: "Claude returned nothing." });
    }).catch((e) => { if (e.name !== "AbortError") patch({ phase: "error", error: e.message }); })
      .finally(() => setCancel(null));
  };

  const view = getEditorView()!;
  return (
    <div className="ai-inline popover" style={{ top: pos.top, left: pos.left, width: pos.width }} role="dialog" aria-label="Claude inline edit"
      onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== "INPUT") e.preventDefault(); }}>
      {inline.phase === "prompt" && (
        <>
          <form className="ai-inline-row" onSubmit={(e) => { e.preventDefault(); run(text.trim()); }}>
            <span className="ai-inline-mark" aria-hidden>✦</span>
            <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Tell Claude what to change, or press Enter to tighten"
              onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); rejectInline(view); } }} aria-label="Instruction for Claude" />
            <kbd>↵</kbd>
          </form>
          <div className="ai-inline-quick">
            {QUICK.map((q) => <button key={q.label} className="ai-chip" onClick={() => run(q.instruction)}>{q.label}</button>)}
          </div>
        </>
      )}
      {inline.phase === "streaming" && (
        <div className="ai-inline-row">
          <span className="ai-matrix" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ ["--i" as any]: i }} />)}</span>
          <span className="ai-thinking-label flex-1">{inline.instruction ? clip(inline.instruction) : "Tightening"}…</span>
          <button className="ai-inline-btn" onClick={() => rejectInline(view)}>Stop <kbd>Esc</kbd></button>
        </div>
      )}
      {inline.phase === "ready" && <Ready inline={inline} onRefine={(t) => run([inline.instruction, t].filter(Boolean).join(". Then: "))} onRetry={() => run(inline.instruction)} />}
      {inline.phase === "error" && (
        <div className="ai-inline-row">
          <span className="flex-1 text-[var(--del)] text-xs">{inline.error}</span>
          <button className="ai-inline-btn" onClick={() => run(inline.instruction)}>Retry</button>
          <button className="ai-inline-btn" onClick={() => rejectInline(view)}>Close</button>
        </div>
      )}
    </div>
  );
}

function Ready({ inline, onRefine, onRetry }: { inline: Inline; onRefine: (t: string) => void; onRetry: () => void }) {
  const [refine, setRefine] = useState("");
  const view = getEditorView()!;
  const { cut, added } = useMemo(() => {
    const parts = diffWords(inline.original, inline.proposed.trim());
    const n = (f: (p: (typeof parts)[number]) => boolean | undefined) => parts.filter(f).reduce((s, p) => s + (p.value.match(/\S+/g) ?? []).length, 0);
    return { cut: n((p) => p.removed), added: n((p) => p.added) };
  }, [inline.original, inline.proposed]);
  return (
    <div className="space-y-2">
      <div className="ai-inline-row">
        <span className="num text-xs text-[var(--muted)]"><span className="text-[var(--del)]">−{cut}</span> <span className="text-[var(--add)]">+{added}</span></span>
        <form className="flex-1 min-w-0" onSubmit={(e) => { e.preventDefault(); if (refine.trim()) onRefine(refine.trim()); }}>
          <input value={refine} onChange={(e) => setRefine(e.target.value)} placeholder="Refine…" aria-label="Refine the rewrite"
            onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); view.focus(); } }} className="w-full" />
        </form>
        <button className="ai-inline-btn" onClick={onRetry} title="Another version">↻</button>
        <div className="ai-decide" role="group" aria-label="Apply this rewrite">
          <button className="ai-decide-accept" onClick={() => acceptInline(view)}>Accept <kbd>Tab</kbd></button>
          <button onClick={() => rejectInline(view)} title="Reject (Esc)" aria-label="Reject">✕</button>
        </div>
      </div>
    </div>
  );
}

const clip = (s: string) => (s.length > 48 ? s.slice(0, 46).trimEnd() + "…" : s);
