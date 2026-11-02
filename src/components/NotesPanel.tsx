import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { goTo, useStore } from "../store";
import type { Note } from "../../shared/types";
import { getEditorView } from "../editorBridge";

/** Margin notes: anchored to a quote, never written into the prose. Stored in studio/notes.json in the book repo. */
export default function NotesPanel() {
  const qc = useQueryClient();
  const { openPath, selection, activeNote, setActiveNote, say } = useStore();
  const { data: notes = [] } = useQuery({ queryKey: ["notes"], queryFn: api.notes });
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const [body, setBody] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  const [scope, setScope] = useState<"file" | "all">("file");
  const refs = useRef<Record<string, HTMLLIElement | null>>({});

  useEffect(() => { if (activeNote) refs.current[activeNote]?.scrollIntoView({ block: "nearest" }); }, [activeNote]);

  const titleOf = (file: string) => { const c = tree?.chapters.find((x) => file === `chapters/${x.id}/LATEST.md`); return c ? `${c.number}. ${c.title}` : file.split("/").pop(); };
  const shown = notes
    .filter((n) => (scope === "all" || n.file === openPath) && (showResolved || !n.resolved))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const openCount = notes.filter((n) => !n.resolved && n.file === openPath).length;

  const add = async () => {
    if (!openPath || !selection?.text.trim() || !body.trim()) return;
    const v = getEditorView();
    const line = v ? v.state.doc.lineAt(Math.min(selection.from, v.state.doc.length)).number : 1;
    try {
      const n = await api.addNote({ file: openPath, quote: selection.text.trim(), line, body: body.trim() });
      setBody(""); setActiveNote(n.id); qc.invalidateQueries({ queryKey: ["notes"] }); say("Note added");
    } catch (e: any) { say(e.message); }
  };
  const patch = async (n: Note, p: Partial<Note>) => { qc.setQueryData<Note[]>(["notes"], (all = []) => all.map((x) => (x.id === n.id ? { ...x, ...p } : x))); try { await api.patchNote(n.id, p); } catch (e: any) { say(e.message); qc.invalidateQueries({ queryKey: ["notes"] }); } };
  const remove = async (n: Note) => { if (!confirm("Delete this note?")) return; qc.setQueryData<Note[]>(["notes"], (all = []) => all.filter((x) => x.id !== n.id)); await api.deleteNote(n.id).catch(() => qc.invalidateQueries({ queryKey: ["notes"] })); };

  return (
    <div className="space-y-4">
      <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <div className="label">New note</div>
        {selection?.text.trim()
          ? <blockquote className="text-[13px] leading-snug text-[var(--fg-dim)] border-l-2 border-[var(--accent)] pl-2 line-clamp-2 font-[var(--font-prose)]">{selection.text}</blockquote>
          : <div className="text-xs text-[var(--muted)]">Select the words the note is about (Ctrl+Alt+M).</div>}
        <textarea id="note-new" rows={2} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="What's wrong, what to check, what to come back to…" className="field w-full resize-none text-[13px]" disabled={!selection?.text.trim()} />
        <div className="flex justify-end"><button className="btn" disabled={!selection?.text.trim() || !body.trim()}>Add note</button></div>
      </form>

      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="seg flex rounded-md bg-[var(--bg)] p-0.5">
          {(["file", "all"] as const).map((s) => <button key={s} onClick={() => setScope(s)} className={`rounded px-2 py-0.5 ${scope === s ? "bg-[var(--active)] text-[var(--fg)]" : "text-[var(--muted)]"}`}>{s === "file" ? `This file${openCount ? ` · ${openCount}` : ""}` : "All files"}</button>)}
        </div>
        <label className="flex items-center gap-1.5 text-[var(--muted)]"><input type="checkbox" className="accent-[var(--accent)]" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />resolved</label>
      </div>

      {shown.length === 0 ? <div className="text-xs text-[var(--muted)]">No {showResolved ? "" : "open "}notes{scope === "file" ? " in this file" : ""}.</div> : (
        <ul className="space-y-2">
          {shown.map((n) => (
            <li key={n.id} ref={(el) => { refs.current[n.id] = el; }} className={`rounded-md p-2.5 space-y-1.5 ${activeNote === n.id ? "note-active" : "bg-[var(--bg)]"} ${n.resolved ? "opacity-60" : ""}`}>
              <button className="block w-full text-left" onClick={() => { setActiveNote(n.id); goTo(n.file, n.line); }}>
                {scope === "all" && <div className="text-xs text-[var(--muted)]">{titleOf(n.file)}</div>}
                <div className="text-xs text-[var(--fg-dim)] line-clamp-2 font-[var(--font-prose)] border-l-2 border-[var(--line)] pl-2">{n.quote}</div>
              </button>
              <textarea defaultValue={n.body} rows={Math.min(6, Math.max(1, Math.ceil(n.body.length / 40)))} onBlur={(e) => e.target.value.trim() !== n.body && patch(n, { body: e.target.value.trim() })} className="field w-full resize-none text-[13px] bg-transparent border-transparent px-0 note-body" aria-label="Note" />
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span className="num">{new Date(n.created).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{n.machine ? ` · ${n.machine}` : ""}</span>
                <span className="flex gap-3">
                  <button className="hover:text-[var(--fg)]" onClick={() => patch(n, { resolved: !n.resolved })}>{n.resolved ? "Reopen" : "Resolve"}</button>
                  <button className="hover:text-[var(--del)]" onClick={() => remove(n)}>Delete</button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

