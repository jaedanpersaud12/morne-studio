import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { StateEffect, StateField, type Range } from "@codemirror/state";

/** Lines Claude is reading (a quiet accent bar) or just edited (a green wash that fades). */
export type Mark = { from: number; to: number; kind: "read" | "edit" | "point"; live: boolean } | null;
export const setAgentMark = StateEffect.define<Mark>();

export const agentMarkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) if (e.is(setAgentMark)) {
      const m = e.value;
      if (!m) return Decoration.none;
      const doc = tr.state.doc;
      const a = Math.max(1, Math.min(m.from, doc.lines)), b = Math.max(a, Math.min(m.to, doc.lines, a + 400));
      const out: Range<Decoration>[] = [];
      for (let l = a; l <= b; l++) {
        const cls = `agent-line agent-${m.kind}${m.live ? " agent-live" : ""}${l === a ? " agent-first" : ""}${l === b ? " agent-last" : ""}`;
        out.push(Decoration.line({ class: cls }).range(doc.line(l).from));
      }
      return Decoration.set(out);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
