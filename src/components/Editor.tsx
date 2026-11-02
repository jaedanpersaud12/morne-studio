import { useEffect, useMemo, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { inlineExtension, inlineField, setInline } from "../inlineAi";
import InlineBar from "./InlineBar";
import { EditorView, keymap, highlightActiveLine, Decoration, MatchDecorator, ViewPlugin, hoverTooltip, drawSelection, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { livePreview } from "../livePreview";
import { useMode } from "../store";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useStore } from "../store";
import type { Entity } from "../../shared/types";
import { TICS, ticRegex } from "../../shared/tics";
import { setEditorView } from "../editorBridge";
import type { Note } from "../../shared/types";
import { RangeSetBuilder } from "@codemirror/state";

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

function ticExtension(id: string | null) {
  const tic = TICS.find((t) => t.id === id);
  if (!tic) return [];
  const deco = new MatchDecorator({ regexp: ticRegex(tic), decoration: Decoration.mark({ class: "tic-hit" }) });
  return ViewPlugin.fromClass(class { decorations: DecorationSet; constructor(v: EditorView) { this.decorations = deco.createDeco(v); } update(u: ViewUpdate) { this.decorations = deco.updateDeco(u, this.decorations); } }, { decorations: (v) => v.decorations });
}

/** Find each note's quote in the doc (nearest to its stored line) and mark it. Click a mark to open the note. */
function notesExtension(notes: Note[], onPick: (id: string) => void) {
  if (!notes.length) return [];
  const build = (v: EditorView) => {
    const doc = v.state.doc.toString();
    const found: { from: number; to: number; id: string; resolved: boolean }[] = [];
    for (const n of notes) {
      if (!n.quote) continue;
      let best = -1, bestDist = Infinity, at = doc.indexOf(n.quote);
      while (at >= 0) {
        const d = Math.abs(v.state.doc.lineAt(at).number - n.line);
        if (d < bestDist) { best = at; bestDist = d; }
        at = doc.indexOf(n.quote, at + 1);
      }
      if (best >= 0) found.push({ from: best, to: best + n.quote.length, id: n.id, resolved: n.resolved });
    }
    found.sort((a, b) => a.from - b.from || a.to - b.to);
    const b = new RangeSetBuilder<Decoration>();
    let lastTo = -1;
    for (const f of found) { if (f.from < lastTo) continue; b.add(f.from, f.to, Decoration.mark({ class: f.resolved ? "note-mark note-resolved" : "note-mark", attributes: { "data-note": f.id } })); lastTo = f.to; }
    return b.finish();
  };
  return ViewPlugin.fromClass(class { decorations: DecorationSet; constructor(v: EditorView) { this.decorations = build(v); } update(u: ViewUpdate) { if (u.docChanged) this.decorations = build(u.view); } }, {
    decorations: (v) => v.decorations,
    eventHandlers: { mousedown(ev) { const el = (ev.target as HTMLElement).closest?.("[data-note]") as HTMLElement | null; if (el && !(ev.metaKey || ev.ctrlKey)) { onPick(el.dataset.note!); } return false; } },
  });
}

/** Paragraph being read aloud. */
function readingExtension(line: number | null) {
  if (!line) return [];
  return EditorView.decorations.compute(["doc"], (state) => {
    const b = new RangeSetBuilder<Decoration>();
    if (line > state.doc.lines) return b.finish();
    let l = line;
    while (l <= state.doc.lines && state.doc.line(l).text.trim() !== "") { const ln = state.doc.line(l); b.add(ln.from, ln.from, Decoration.line({ class: "reading-line" })); l++; }
    return b.finish();
  });
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
  const wrap = useRef<HTMLDivElement>(null);
  const entComp = useMemo(() => new Compartment(), []);
  const ticComp = useMemo(() => new Compartment(), []);
  const noteComp = useMemo(() => new Compartment(), []);
  const readComp = useMemo(() => new Compartment(), []);
  const liveComp = useMemo(() => new Compartment(), []);
  const mode = useMode();
  const qc = useQueryClient();
  const { openPath, setDirty, setEntity, jumpLine, setJumpLine, focus, say, highlightTic, setSelection } = useStore();
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const { data: allNotes = [] } = useQuery({ queryKey: ["notes"], queryFn: api.notes });
  const notes = useMemo(() => allNotes.filter((n) => n.file === openPath), [allNotes, openPath]);
  const setActiveNote = useStore((s) => s.setActiveNote);
  const readingLine = useStore((s) => s.readingLine);
  const label = (() => { const c = tree?.chapters.find((x) => openPath === `chapters/${x.id}/LATEST.md`); return c ? `ch ${c.number} ${c.title}` : openPath ?? ""; })();
  const labelRef = useRef(label); labelRef.current = label;
  const { data: file } = useQuery({ queryKey: ["file", openPath], queryFn: () => api.file(openPath!), enabled: !!openPath, staleTime: Infinity });
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });

  const save = async () => {
    const v = view.current; if (!v || !openPath) return;
    const content = v.state.doc.toString();
    let r;
    try { r = await api.save(openPath, content, labelRef.current); }
    catch (e: any) { say(`Save failed · ${e.message}`); return; }
    setDirty(false);
    qc.setQueryData(["file", openPath], { path: openPath, content });
    qc.invalidateQueries({ queryKey: ["tree"] });
    qc.invalidateQueries({ queryKey: ["fingerprint", openPath] });
    qc.invalidateQueries({ queryKey: ["git"] });
    qc.invalidateQueries({ queryKey: ["flags"] });
    qc.invalidateQueries({ queryKey: ["progress"] });
    qc.invalidateQueries({ queryKey: ["numbers"] });
    const sync = r.sync && !r.sync.ok ? ` · ${r.sync.message}` : r.sync?.ok ? " · committed" : "";
    say(`Saved · ${r.words.toLocaleString()} words${sync}`);
  };
  const saveRef = useRef(save); saveRef.current = save;

  // (re)create the editor when the file changes
  useEffect(() => {
    if (!host.current || !file) return;
    view.current?.destroy();
    const state = EditorState.create({
      doc: file.content,
      extensions: [
        history(), drawSelection(), highlightActiveLine(), highlightSelectionMatches(),
        markdown({ base: markdownLanguage }), syntaxHighlighting(mdHighlight),
        liveComp.of(mode === "source" ? [] : livePreview),
        EditorView.lineWrapping,
        keymap.of([
          { key: "Mod-s", run: () => { saveRef.current(); return true; } },
          { key: "Mod-k", run: (v) => {
            const sel = v.state.selection.main;
            if (sel.empty || v.state.field(inlineField)) return false;
            v.dispatch({ effects: [setInline.of({ phase: "prompt", from: sel.from, to: sel.to, original: v.state.sliceDoc(sel.from, sel.to), proposed: "", instruction: "" }), EditorView.scrollIntoView(sel.to, { y: "nearest", yMargin: 140 })] });
            return true;
          } },
          { key: "Mod-Alt-m", run: () => { const st = useStore.getState(); if (st.selection?.text.trim()) { st.setPanel("notes"); setTimeout(() => document.getElementById("note-new")?.focus(), 50); } else st.say("Select the words the note is about."); return true; } },
          ...defaultKeymap, ...historyKeymap, ...searchKeymap,
        ]),
        entComp.of(entityExtension(entities, setEntity)),
        ticComp.of(ticExtension(highlightTic)),
        noteComp.of(notesExtension(notes, setActiveNote)),
        readComp.of(readingExtension(readingLine)),
        inlineExtension,
        EditorView.updateListener.of((u) => {
          const il = u.state.field(inlineField);
          if (il !== u.startState.field(inlineField)) useStore.setState({ inline: il });
          if (u.docChanged) setDirty(true);
          if (u.selectionSet || u.docChanged) {
            const sel = u.state.selection.main;
            if (sel.empty) { setSelection(null); return; }
            const a = u.state.doc.lineAt(sel.from), b = u.state.doc.lineAt(sel.to);
            const ctxFrom = u.state.doc.line(Math.max(1, a.number - 6)).from, ctxTo = u.state.doc.line(Math.min(u.state.doc.lines, b.number + 6)).to;
            setSelection({ from: sel.from, to: sel.to, text: u.state.sliceDoc(sel.from, sel.to), context: u.state.sliceDoc(ctxFrom, ctxTo) });
          }
        }),
        EditorView.theme({
          "&": { height: "100%", fontSize: "17px" },
          ".cm-scroller": { overflow: "auto", overscrollBehavior: "contain", fontFamily: "var(--font-prose)", lineHeight: "1.75", padding: "2.5rem 0 40vh" },
          ".cm-content": { maxWidth: "68ch", margin: "0 auto", padding: "0 1.5rem", caretColor: "var(--accent)" },
          ".cm-activeLine": { background: "transparent" },
          ".cm-activeLineGutter": { background: "transparent" },
          "&.cm-focused": { outline: "none" },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "var(--sel) !important" },
          ".cm-tooltip": { background: "transparent", border: "none" },
        }),
      ],
    });
    view.current = new EditorView({ state, parent: host.current });
    setEditorView(view.current);
    setDirty(false);
    return () => { view.current?.destroy(); view.current = null; setEditorView(null); useStore.setState({ inline: null }); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.path, file?.content === undefined]);

  useEffect(() => { view.current?.dispatch({ effects: ticComp.reconfigure(ticExtension(highlightTic)) }); }, [highlightTic, ticComp]);

  useEffect(() => { view.current?.dispatch({ effects: liveComp.reconfigure(mode === "source" ? [] : livePreview) }); }, [mode, liveComp]);
  useEffect(() => { view.current?.dispatch({ effects: noteComp.reconfigure(notesExtension(notes, setActiveNote)) }); }, [notes, noteComp, setActiveNote]);
  useEffect(() => {
    const v = view.current; if (!v) return;
    v.dispatch({ effects: readComp.reconfigure(readingExtension(readingLine)) });
    if (readingLine && readingLine <= v.state.doc.lines) v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(readingLine).from, { y: "center" }) });
  }, [readingLine, readComp]);

  // the file changed underneath us (pull from the other machine, Claude replace elsewhere): reload if clean, warn if not
  useEffect(() => {
    const v = view.current; if (!v || !file) return;
    const cur = v.state.doc.toString();
    if (cur === file.content) return;
    if (useStore.getState().dirty) { say("This file changed on your other machine. Save keeps your version; reopen to load theirs."); return; }
    const pos = Math.min(v.state.selection.main.head, file.content.length);
    v.dispatch({ changes: { from: 0, to: cur.length, insert: file.content }, selection: { anchor: pos } });
    setDirty(false);
  }, [file?.content, say, setDirty]);
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
  return (
    <div ref={wrap} className="relative h-full">
      <div ref={host} className={`h-full ${focus ? "focus" : ""}`} />
      <InlineBar chapter={label} host={wrap} />
    </div>
  );
}
