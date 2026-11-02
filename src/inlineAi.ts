import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";
import { Prec, StateEffect, StateField, type Range } from "@codemirror/state";
import { diffWords } from "diff";

/**
 * Inline Claude: the rewrite of a selection appears inside the prose as a ghost diff
 * (cut words struck through, new words in place). Tab accepts, Esc rejects.
 * The field is the source of truth; positions map through edits, and typing inside the range cancels it.
 */
export type Inline = {
  phase: "prompt" | "streaming" | "ready" | "error";
  from: number; to: number; original: string; proposed: string; instruction: string; error?: string;
};

export const setInline = StateEffect.define<Inline | null>();
let onCancel: (() => void) | null = null;
export const setCancel = (f: (() => void) | null) => { onCancel = f; };

export const inlineField = StateField.define<Inline | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setInline)) return e.value;
    if (!v || !tr.docChanged) return v;
    let touched = false;
    tr.changes.iterChangedRanges((fa, ta) => { if (fa < v.to && ta > v.from) touched = true; });
    if (touched) { queueMicrotask(() => onCancel?.()); return null; }
    return { ...v, from: tr.changes.mapPos(v.from, 1), to: tr.changes.mapPos(v.to, -1) };
  },
  provide: (f) => EditorView.decorations.from(f, decorate),
});

class Ins extends WidgetType {
  constructor(readonly text: string) { super(); }
  toDOM() { const s = document.createElement("span"); s.className = "ai-ghost-ins"; s.textContent = this.text; return s; }
  eq(o: Ins) { return o.text === this.text; }
  updateDOM(dom: HTMLElement) { dom.textContent = this.text; return true; }
  ignoreEvent() { return false; }
}
const pending = Decoration.mark({ class: "ai-ghost-pending" });
const focused = Decoration.mark({ class: "ai-ghost-target" });
const del = Decoration.mark({ class: "ai-ghost-del" });

function decorate(v: Inline | null): DecorationSet {
  if (!v || v.to <= v.from) return Decoration.none;
  if (v.phase === "prompt" || v.phase === "error") return Decoration.set([focused.range(v.from, v.to)]);
  if (v.phase === "streaming") {
    // while it streams: the original shimmers, and the new text grows after it
    const out: Range<Decoration>[] = [pending.range(v.from, v.to)];
    if (v.proposed) out.push(Decoration.widget({ widget: new Ins(v.proposed.trimEnd()), side: 1 }).range(v.to));
    return Decoration.set(out);
  }
  // ready: word-level diff laid into the text
  const out: Range<Decoration>[] = [];
  let pos = v.from;
  for (const p of diffWords(v.original, v.proposed.trim())) {
    if (p.added) out.push(Decoration.widget({ widget: new Ins(p.value), side: 1 }).range(pos));
    else if (p.removed) { if (p.value.length) out.push(del.range(pos, pos + p.value.length)); pos += p.value.length; }
    else pos += p.value.length;
  }
  return Decoration.set(out, true);
}

export function acceptInline(view: EditorView): boolean {
  const v = view.state.field(inlineField, false);
  if (!v || v.phase !== "ready") return false;
  const insert = v.proposed.trim();
  view.dispatch({ changes: { from: v.from, to: v.to, insert }, selection: { anchor: v.from + insert.length }, effects: setInline.of(null) });
  view.focus();
  return true;
}
export function rejectInline(view: EditorView): boolean {
  const v = view.state.field(inlineField, false);
  if (!v) return false;
  onCancel?.();
  view.dispatch({ effects: setInline.of(null), selection: { anchor: v.from, head: v.to } });
  view.focus();
  return true;
}

export const inlineKeymap = Prec.highest(keymap.of([
  { key: "Tab", run: acceptInline },
  { key: "Mod-Enter", run: acceptInline },
  { key: "Escape", run: rejectInline },
]));

export const inlineExtension = [inlineField, inlineKeymap];
