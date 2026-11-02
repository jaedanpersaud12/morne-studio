import type { EditorView } from "@codemirror/view";

/** The live editor, for panels that need to read or change the text (Claude replace). */
let view: EditorView | null = null;
export const setEditorView = (v: EditorView | null) => { view = v; };
export const getEditorView = () => view;

/** Replace [from,to) only if it still holds `expected`. Returns false if the text moved. */
export function replaceRange(from: number, to: number, expected: string, next: string): boolean {
  if (!view) return false;
  if (view.state.sliceDoc(from, to) !== expected) {
    const at = view.state.doc.toString().indexOf(expected);
    if (at < 0) return false;
    from = at; to = at + expected.length;
  }
  view.dispatch({ changes: { from, to, insert: next }, selection: { anchor: from, head: from + next.length }, scrollIntoView: true });
  view.focus();
  return true;
}
