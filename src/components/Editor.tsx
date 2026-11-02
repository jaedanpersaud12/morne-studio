import { useEffect, useMemo, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, Decoration, MatchDecorator, ViewPlugin, hoverTooltip, drawSelection, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useStore } from "../store";
import type { Entity } from "../../shared/types";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function entityExtension(entities: Entity[], onPick: (id: string) => void) {
  const byAlias = new Map<string, Entity>();
  for (const e of entities) for (const a of e.aliases) byAlias.set(a, e);
  const aliases = [...byAlias.keys()].sort((a, b) => b.length - a.length);
  if (!aliases.length) return [];
  const re = new RegExp(`(?<![A-Za-z])(?:${aliases.map(esc).join("|")})(?![A-Za-z])`, "g");
  const deco = new MatchDecorator({
    regexp: re,
    decoration: (m) => {
      const e = byAlias.get(m[0])!;
      return Decoration.mark({ class: `ent ent-${e.group}`, attributes: { "data-ent": e.id } });
    },
  });
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(v: EditorView) { this.decorations = deco.createDeco(v); }
      update(u: ViewUpdate) { this.decorations = deco.updateDeco(u, this.decorations); }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(ev) {
          const t = (ev.target as HTMLElement).closest?.("[data-ent]") as HTMLElement | null;
          if (t && (ev.metaKey || ev.ctrlKey || ev.altKey)) { ev.preventDefault(); onPick(t.dataset.ent!); return true; }
          return false;
        },
      },
    },
  );
  const tip = hoverTooltip((view, pos) => {
    const line = view.state.doc.lineAt(pos);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line.text))) {
      const from = line.from + m.index, to = from + m[0].length;
      if (pos >= from && pos <= to) {
        const e = byAlias.get(m[0])!;
        return {
          pos: from, end: to, above: true,
          create() {
            const dom = document.createElement("div");
            dom.className = "ent-tip";
            dom.innerHTML = `<div class="t-name">${e.name}${e.age ? `, ${e.age}` : ""}</div>` +
              (e.element ? `<div class="t-el">${e.element}</div>` : "") +
              (e.oneLine ? `<div class="t-line">${e.oneLine.slice(0, 160)}</div>` : "") +
              `<div class="t-hint">⌘/Ctrl-click to open</div>`;
            return { dom };
          },
        };
      }
    }
    return null;
  }, { hoverTime: 250 });
  return [plugin, tip];
}

const mdHighlight = HighlightStyle.define([
  { tag: tags.heading1, class: "md-h1" },
  { tag: tags.heading2, class: "md-h2" },
  { tag: tags.heading, class: "md-h" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.processingInstruction, class: "md-mark" },
  { tag: tags.contentSeparator, class: "md-hr" },
  { tag: tags.link, class: "md-link" },
  { tag: tags.url, class: "md-link" },
]);

export default function Editor() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const entComp = useMemo(() => new Compartment(), []);
  const qc = useQueryClient();
  const { openPath, setDirty, setEntity, jumpLine, setJumpLine, focus, say } = useStore();
  const { data: file } = useQuery({ queryKey: ["file", openPath], queryFn: () => api.file(openPath!), enabled: !!openPath, staleTime: Infinity });
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });

  const save = async () => {
    const v = view.current; if (!v || !openPath) return;
    const content = v.state.doc.toString();
    const r = await api.save(openPath, content);
    setDirty(false);
    qc.setQueryData(["file", openPath], { path: openPath, content });
    qc.invalidateQueries({ queryKey: ["tree"] });
    qc.invalidateQueries({ queryKey: ["fingerprint", openPath] });
    qc.invalidateQueries({ queryKey: ["git"] });
    say(`Saved · ${r.words.toLocaleString()} words`);
  };
  const saveRef = useRef(save); saveRef.current = save;

  // (re)create the editor when the file changes
  useEffect(() => {
    if (!host.current || !file) return;
    view.current?.destroy();
    const state = EditorState.create({
      doc: file.content,
      extensions: [
        lineNumbers({ formatNumber: (n) => (n % 10 === 0 ? String(n) : "") }),
        history(), drawSelection(), highlightActiveLine(), highlightSelectionMatches(),
        markdown(), syntaxHighlighting(mdHighlight),
        EditorView.lineWrapping,
        keymap.of([{ key: "Mod-s", run: () => { saveRef.current(); return true; } }, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        entComp.of(entityExtension(entities, setEntity)),
        EditorView.updateListener.of((u) => { if (u.docChanged) setDirty(true); }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "17px" },
          ".cm-scroller": { fontFamily: "var(--font-prose)", lineHeight: "1.75", padding: "2.5rem 0 40vh" },
          ".cm-content": { maxWidth: "68ch", margin: "0 auto", padding: "0 1.5rem", caretColor: "var(--accent)" },
          ".cm-gutters": { background: "transparent", border: "none", color: "var(--muted)", fontFamily: "var(--font-ui)", fontSize: "11px" },
          ".cm-activeLine": { background: "transparent" },
          ".cm-activeLineGutter": { background: "transparent" },
          "&.cm-focused": { outline: "none" },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "var(--sel) !important" },
          ".cm-tooltip": { background: "transparent", border: "none" },
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    setDirty(false);
    return () => { view.current?.destroy(); view.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path, file?.content === undefined]);

  // swap entity extension when entities load/change
  useEffect(() => { view.current?.dispatch({ effects: entComp.reconfigure(entityExtension(entities, setEntity)) }); }, [entities, entComp, setEntity]);

  // jump to a line (from backlinks/search)
  useEffect(() => {
    const v = view.current; if (!v || !jumpLine) return;
    const ln = Math.min(jumpLine, v.state.doc.lines);
    const pos = v.state.doc.line(ln).from;
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    v.focus(); setJumpLine(null);
  }, [jumpLine, file?.path, setJumpLine]);

  if (!openPath) return <div className="h-full grid place-items-center text-[var(--muted)]">Pick a chapter.</div>;
  return <div ref={host} className={`h-full ${focus ? "focus" : ""}`} />;
}
