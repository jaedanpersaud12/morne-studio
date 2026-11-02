import { useEffect, useMemo, useRef, useState } from "react";
import { diffWords } from "diff";
import { BookOpen, Check, ChevronDown, FilePen, Hammer, Kanban, LayoutList, Lightbulb, LocateFixed, MessageSquareText, RefreshCw, Scale, Search, ShieldCheck, Sparkles, StickyNote, Undo2, UsersRound, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { goTo, useStore } from "../store";
import type { AgentActivity } from "../../shared/types";

const ICON: Record<string, React.ReactNode> = {
  list_files: <LayoutList size={13} />, read_file: <BookOpen size={13} />, search: <Search size={13} />, ask_book: <Sparkles size={13} />,
  list_notes: <StickyNote size={13} />, edit_file: <FilePen size={13} />, write_file: <FilePen size={13} />, add_note: <MessageSquareText size={13} />,
  snapshot: <Check size={13} />, get_board: <Kanban size={13} />, update_board: <Kanban size={13} />, get_knowledge: <UsersRound size={13} />,
  update_knowledge: <UsersRound size={13} />, get_ledger: <Scale size={13} />, canon_checks: <ShieldCheck size={13} />, build_manuscript: <Hammer size={13} />,
  sync_status: <RefreshCw size={13} />, sync: <RefreshCw size={13} />, open_in_studio: <LocateFixed size={13} />,
};
const WRITES = new Set(["edit_file", "write_file", "add_note", "update_board", "update_knowledge", "snapshot", "sync", "build_manuscript"]);

/** A dynamic-island pill that shows what Claude is doing over MCP, live. Click it for the full feed. */
export default function AgentIsland() {
  const items = useStore((s) => s.agent);
  const follow = useStore((s) => s.agentFollow);
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const running = items.filter((a) => a.state === "running");
  const last = items[items.length - 1];
  const now = Date.now();
  // "active" lingers a few seconds after the last step so the pill doesn't flicker between calls
  const active = running.length > 0 || (last && now - (last.at + (last.ms ?? 0)) < 6000);
  const session = useMemo(() => sessionOf(items), [items]);
  const edits = session.filter((a) => WRITES.has(a.tool) && a.state === "done").length;

  useEffect(() => { const iv = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(iv); }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!items.length) return null;
  const current = running[running.length - 1] ?? last;
  const elapsed = session.length ? Math.max(0, Math.round(((running.length ? now : last.at + (last.ms ?? 0)) - session[0].at) / 1000)) : 0;

  return (
    <div ref={ref} className="agent-wrap" data-open={open || undefined}>
      {open && <AgentFeed items={items} onClose={() => setOpen(false)} />}
      <button className="agent-island" data-active={active || undefined} data-working={running.length > 0 || undefined} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Claude activity">
        <span className="agent-glyph" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ ["--i" as any]: i }} />)}</span>
        {active ? (
          <>
            <span className="agent-icon" aria-hidden>{ICON[current.tool] ?? <Sparkles size={13} />}</span>
            <span className="agent-label" key={current.id}>{current.label}</span>
            {current.state !== "running" && current.summary && <span className="agent-sub">{current.summary}</span>}
            <span className="agent-meta num">{session.length} · {fmtS(elapsed)}</span>
          </>
        ) : (
          <span className="agent-idle">Claude <span className="num text-[var(--muted)]">· {session.length} step{session.length === 1 ? "" : "s"}{edits ? ` · ${edits} change${edits === 1 ? "" : "s"}` : ""}</span></span>
        )}
        {follow && <span className="agent-follow-dot" title="Following Claude" aria-label="following" />}
      </button>
    </div>
  );
}

function AgentFeed({ items, onClose }: { items: AgentActivity[]; onClose: () => void }) {
  const follow = useStore((s) => s.agentFollow);
  const list = [...items].reverse().slice(0, 60);
  const setFollow = (v: boolean) => { useStore.setState({ agentFollow: v }); try { localStorage.setItem("mbs-follow", v ? "1" : "0"); } catch {} };
  return (
    <div className="agent-feed popover" role="dialog" aria-label="Claude activity">
      <div className="agent-feed-head">
        <div>
          <div className="text-[13px] font-medium">Claude, live</div>
          <div className="text-[11.5px] text-[var(--muted)]">Everything Claude does in your book over MCP</div>
        </div>
        <label className="agent-switch" title="Open whatever Claude reads or edits, and highlight the lines">
          <span>Follow</span>
          <input type="checkbox" role="switch" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          <span className="agent-switch-track" aria-hidden><span /></span>
        </label>
        <button className="ui-icon-btn" aria-label="Close" onClick={onClose}><X size={14} /></button>
      </div>
      <ol className="agent-list">
        {list.map((a, i) => {
          const gap = i > 0 && list[i - 1].at - (a.at + (a.ms ?? 0)) > 5 * 60_000;
          return (
            <li key={a.id}>
              {gap && <div className="agent-gap">earlier</div>}
              <FeedItem a={a} />
            </li>
          );
        })}
      </ol>
      <div className="agent-feed-foot">
        <Lightbulb size={12} aria-hidden /> Every change is a git commit. Undo here, or from History.
        <button className="ml-auto hover:text-[var(--fg)]" onClick={() => useStore.setState({ agent: [] })}>Clear</button>
      </div>
    </div>
  );
}

function FeedItem({ a }: { a: AgentActivity }) {
  const [showDiff, setShowDiff] = useState(a.tool === "edit_file");
  const undone = useStore((s) => s.agentUndone.includes(a.id));
  const qc = useQueryClient();
  const say = useStore((s) => s.say);
  const undo = async () => {
    if (!a.diff || !a.path) return;
    try {
      const { content } = await api.file(a.path);
      if (content.split(a.diff.new).length - 1 !== 1) { say("That passage has changed since, so it can't be undone here. Use History."); return; }
      await api.save(a.path, content.replace(a.diff.new, a.diff.old), "Undo Claude's edit");
      useStore.setState((s) => ({ agentUndone: [...s.agentUndone, a.id] }));
      qc.invalidateQueries({ queryKey: ["file", a.path] });
      say("Undone · committed");
    } catch (e: any) { say(`Undo failed · ${e.message}`); }
  };
  return (
    <div className="agent-item" data-state={a.state} data-write={WRITES.has(a.tool) || undefined}>
      <span className="agent-item-icon" aria-hidden>{a.state === "running" ? <span className="agent-spin" /> : ICON[a.tool] ?? <Sparkles size={13} />}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <button className="agent-item-label" disabled={!a.path} onClick={() => a.path && goTo(a.path, a.from)}>{a.label}</button>
          <span className="agent-item-time num">{a.state === "running" ? "now" : ago(a.at)}</span>
        </div>
        {a.summary && <div className="agent-item-sub" data-error={a.state === "error" || undefined}>{a.summary}</div>}
        {a.diff && (
          <div className="mt-1.5 space-y-1.5">
            {showDiff && <div className="agent-diff">{diffWords(a.diff.old, a.diff.new).map((p, i) => (p.added ? <ins key={i}>{p.value}</ins> : p.removed ? <del key={i}>{p.value}</del> : <span key={i}>{p.value}</span>))}</div>}
            <div className="flex items-center gap-1">
              <button className="agent-mini" onClick={() => setShowDiff((s) => !s)}><ChevronDown size={12} style={{ rotate: showDiff ? "180deg" : "0deg" }} />{showDiff ? "Hide" : "Diff"}</button>
              <button className="agent-mini" onClick={() => a.path && goTo(a.path, a.from)}><LocateFixed size={12} />Show</button>
              {undone ? <span className="agent-mini text-[var(--muted)]">Undone</span> : <button className="agent-mini" onClick={undo}><Undo2 size={12} />Undo</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Steps since the last quiet gap of 5 minutes: "this session". */
function sessionOf(items: AgentActivity[]) {
  let i = items.length - 1;
  while (i > 0 && items[i].at - (items[i - 1].at + (items[i - 1].ms ?? 0)) < 5 * 60_000) i--;
  return items.slice(Math.max(0, i));
}
const fmtS = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);
const ago = (t: number) => { const s = Math.round((Date.now() - t) / 1000); return s < 5 ? "just now" : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };
