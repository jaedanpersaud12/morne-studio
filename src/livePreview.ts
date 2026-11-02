import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";
import { openLink } from "./store";

/**
 * Live preview: markdown syntax disappears and renders in place (headings, *italics*, **bold**, --- scene breaks,
 * [links](...), <!-- comments -->, list bullets). The raw syntax reappears only on lines the cursor touches,
 * so editing is never fighting hidden characters. The file on disk stays plain markdown.
 */
class SceneBreak extends WidgetType {
  toDOM() { const d = document.createElement("span"); d.className = "md-scene-break"; d.textContent = "*   *   *"; d.setAttribute("aria-label", "scene break"); return d; }
  eq() { return true; }
}
class Bullet extends WidgetType {
  toDOM() { const s = document.createElement("span"); s.className = "md-bullet"; s.textContent = "•"; return s; }
  eq() { return true; }
}
const hide = Decoration.replace({});

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const doc = state.doc;
  const active = new Set<number>();
  // raw syntax shows only on the line you're editing, and only while the editor has focus
  if (view.hasFocus) for (const r of state.selection.ranges) for (let l = doc.lineAt(r.from).number; l <= doc.lineAt(r.to).number; l++) active.add(l);
  const isActive = (from: number, to: number) => { for (let l = doc.lineAt(from).number; l <= doc.lineAt(to).number; l++) if (active.has(l)) return true; return false; };
  const out: Range<Decoration>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from, to,
      enter(node) {
        const name = node.name;
        if (name === "Table") return false; // tables stay as source in Live (Read mode renders them)
        const act = isActive(node.from, node.to);
        if (name === "HeaderMark" && !act) {
          // "# " → hide the hashes and the space after them
          const end = doc.sliceString(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          out.push(hide.range(node.from, end));
        } else if (name === "EmphasisMark" && !act) {
          out.push(hide.range(node.from, node.to));
        } else if (name === "HorizontalRule" && !act) {
          out.push(Decoration.replace({ widget: new SceneBreak() }).range(node.from, node.to));
        } else if (name === "Link" && !act) {
          // [text](url) → text, styled as a link; the brackets and url vanish
          const marks: { from: number; to: number }[] = [];
          let url: { from: number; to: number } | null = null;
          const c = node.node.cursor();
          if (c.firstChild()) do { if (c.name === "LinkMark") marks.push({ from: c.from, to: c.to }); if (c.name === "URL") url = { from: c.from, to: c.to }; } while (c.nextSibling());
          if (marks.length >= 2) {
            out.push(hide.range(marks[0].from, marks[0].to));
            out.push(Decoration.mark({ class: "md-link-live", attributes: url ? { "data-href": doc.sliceString(url.from, url.to) } : {} }).range(marks[0].to, marks[1].from));
            out.push(hide.range(marks[1].from, node.to));
          }
          return false;
        } else if (name === "ListMark" && !act) {
          const t = doc.sliceString(node.from, node.to);
          if (t === "-" || t === "*" || t === "+") out.push(Decoration.replace({ widget: new Bullet() }).range(node.from, node.to));
        } else if (name === "CommentBlock") {
          // writer's notes inside the prose: keep them, but quiet
          for (let l = doc.lineAt(node.from).number; l <= doc.lineAt(node.to).number; l++) out.push(Decoration.line({ class: "md-comment-line" }).range(doc.line(l).from));
        } else if (name === "ATXHeading1" || name === "ATXHeading2" || name === "ATXHeading3") {
          out.push(Decoration.line({ class: `md-line-${name.slice(-1)}` }).range(doc.lineAt(node.from).from));
        }
      },
    });
  }
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(v: EditorView) { this.decorations = build(v); }
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged) this.decorations = build(u.view); }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      mousedown(ev) {
        const el = (ev.target as HTMLElement).closest?.("[data-href]") as HTMLElement | null;
        if (el && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); openLink(el.dataset.href!); return true; }
        return false;
      },
    },
  },
);
