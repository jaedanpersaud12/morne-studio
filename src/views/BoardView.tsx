import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { goTo, useStore } from "../store";
import { povColor } from "../povColors";
import type { ChapterExtra, ChapterMeta, ChapterStatus, OutlineRow, StudioChapters } from "../../shared/types";

const STATUSES: ChapterStatus[] = ["idea", "outline", "draft", "revised", "done"];
const stripMd = (s: string) => s.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

export default function BoardView() {
  const qc = useQueryClient();
  const say = useStore((s) => s.say);
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const { data: outline } = useQuery({ queryKey: ["outline"], queryFn: api.outline });
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.chaptersMeta });

  // optimistic local update, then a per-chapter patch on the server (never the whole file)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pending = useRef<Record<string, ChapterExtra>>({});
  const update = (id: string, patch: ChapterExtra) => {
    qc.setQueryData<StudioChapters>(["meta"], (m) => ({ chapters: { ...(m?.chapters ?? {}), [id]: { ...(m?.chapters[id] ?? {}), ...patch } } }));
    pending.current[id] = { ...(pending.current[id] ?? {}), ...patch };
    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      const body = pending.current[id]; delete pending.current[id];
      api.patchChapterMeta(id, body).catch((e) => { say(`Couldn't save · ${e.message}`); qc.invalidateQueries({ queryKey: ["meta"] }); });
    }, 400);
  };

  const povId = (name: string | null) => (name ? entities.find((e) => e.short === name || e.aliases.includes(name))?.id ?? name.toLowerCase() : null);
  const chapters = tree?.chapters ?? [];
  const byNumber = new Map(chapters.map((c) => [c.number, c]));
  const plannedRows = (outline?.rows ?? []).filter((r) => !byNumber.has(r.number));
  const outlineByNumber = new Map((outline?.rows ?? []).map((r) => [r.number, r]));

  // ---- POV distribution (words per POV) ----
  const dist = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of chapters) { const id = povId(c.pov) ?? "other"; m.set(id, (m.get(id) ?? 0) + c.words); }
    const total = [...m.values()].reduce((a, b) => a + b, 0) || 1;
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id, w]) => ({ id, w, pct: w / total, name: entities.find((e) => e.id === id)?.short ?? id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, entities]);

  // ---- drag to reorder ----
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const drop = async (targetId: string) => {
    const from = drag; setDrag(null); setOver(null);
    if (!from || from === targetId) return;
    const ids = chapters.map((c) => c.id).filter((i) => i !== from);
    ids.splice(ids.indexOf(targetId), 0, from);
    const moved = chapters.find((c) => c.id === from)!;
    if (!confirm(`Move "${moved.title}" before "${chapters.find((c) => c.id === targetId)!.title}"?\n\nChapters will be renumbered: folders renamed and "# Chapter N" headings updated. Versions and changelogs move with them.`)) return;
    try {
      const r = await api.reorder(ids);
      say(`Renumbered ${r.changed} chapter${r.changed === 1 ? "" : "s"}`);
      ["tree", "meta", "file", "presence", "flags"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      // the open chapter may have been renamed: close it without leaving the board
      useStore.setState({ openPath: null, dirty: false });
    } catch (e: any) { say(`Reorder failed · ${e.message}`); }
  };

  const create = async (row: OutlineRow) => {
    const title = prompt(`Title for chapter ${row.number} (${row.pov} POV)?`, row.title ?? "");
    if (!title) return;
    try {
      const r = await api.createChapter(row.number, title.trim(), row.pov);
      await qc.invalidateQueries({ queryKey: ["tree"] });
      qc.invalidateQueries({ queryKey: ["meta"] });
      goTo(`chapters/${r.id}/LATEST.md`);
    } catch (e: any) { say(e.message); }
  };

  if (!tree || !outline || !meta) return <div className="p-8 text-[var(--muted)]">Loading the board…</div>;

  const movements = outline.movements.length ? outline.movements : [{ index: 0, name: "Chapters", span: "", chapters: null }];
  const inMovement = (n: number, mv: (typeof movements)[number]) => (mv.chapters ? n >= mv.chapters[0] && n <= mv.chapters[1] : true);
  const unplaced = chapters.filter((c) => !movements.some((mv) => mv.chapters && inMovement(c.number, mv)));

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-8">
        <header className="space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <h1 className="text-xl font-semibold tracking-tight">Board</h1>
            <div className="text-xs text-[var(--muted)] num">{chapters.length} written · {plannedRows.length} planned · drag a card onto another to move it before that one</div>
          </div>
          <PovBar dist={dist} />
        </header>

        {movements.map((mv) => {
          const written = chapters.filter((c) => mv.chapters ? inMovement(c.number, mv) : true);
          const planned = plannedRows.filter((r) => r.movementIndex === mv.index);
          if (!written.length && !planned.length) return null;
          return (
            <section key={mv.index} aria-labelledby={`mv-${mv.index}`}>
              <div className="flex items-baseline gap-3 mb-3">
                <h2 id={`mv-${mv.index}`} className="text-[15px] font-semibold">{mv.index ? `${mv.index}. ` : ""}{mv.name}</h2>
                <span className="text-xs text-[var(--muted)]">{mv.span}</span>
              </div>
              <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
                {written.map((c) => (
                  <Card key={c.id} c={c} extra={meta.chapters[c.id] ?? {}} plan={outlineByNumber.get(c.number)} pov={povId(c.pov)}
                    onChange={(p) => update(c.id, p)} dragging={drag === c.id} over={over === c.id && drag !== c.id}
                    onDragStart={() => setDrag(c.id)} onDragEnd={() => { setDrag(null); setOver(null); }}
                    onDragOver={() => drag && setOver(c.id)} onDrop={() => drop(c.id)} />
                ))}
                {planned.map((r) => <Ghost key={r.number} r={r} pov={povId(r.pov)} onCreate={() => create(r)} />)}
              </div>
            </section>
          );
        })}
        {unplaced.length > 0 && movements.some((m) => m.chapters) && (
          <section>
            <h2 className="text-[15px] font-semibold mb-3">Outside the outline</h2>
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
              {unplaced.map((c) => <Card key={c.id} c={c} extra={meta.chapters[c.id] ?? {}} plan={undefined} pov={povId(c.pov)} onChange={(p) => update(c.id, p)} dragging={false} over={false} onDragStart={() => setDrag(c.id)} onDragEnd={() => setDrag(null)} onDragOver={() => setOver(c.id)} onDrop={() => drop(c.id)} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function PovBar({ dist }: { dist: { id: string; w: number; pct: number; name: string }[] }) {
  const [hover, setHover] = useState<string | null>(null);
  return (
    <figure className="space-y-2" aria-label="Words written per point-of-view character">
      <figcaption className="label">Words by POV</figcaption>
      <div className="flex h-3 gap-[2px] rounded-[4px] overflow-hidden" role="img" aria-label={dist.map((d) => `${d.name} ${Math.round(d.pct * 100)}%`).join(", ")}>
        {dist.map((d) => (
          <div key={d.id} className="h-full relative" style={{ width: `${d.pct * 100}%`, background: povColor(d.id), opacity: hover && hover !== d.id ? 0.4 : 1 }}
            onMouseEnter={() => setHover(d.id)} onMouseLeave={() => setHover(null)} title={`${d.name}: ${d.w.toLocaleString()} words (${Math.round(d.pct * 100)}%)`} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--fg-dim)]">
        {dist.map((d) => (
          <li key={d.id} className="flex items-center gap-1.5 num" onMouseEnter={() => setHover(d.id)} onMouseLeave={() => setHover(null)}>
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: povColor(d.id) }} aria-hidden />
            {d.name} <span className="text-[var(--muted)]">{Math.round(d.pct * 100)}% · {(d.w / 1000).toFixed(1)}k</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

type CardProps = {
  c: ChapterMeta; extra: ChapterExtra; plan: OutlineRow | undefined; pov: string | null;
  onChange: (p: ChapterExtra) => void; dragging: boolean; over: boolean;
  onDragStart: () => void; onDragEnd: () => void; onDragOver: () => void; onDrop: () => void;
};
function Card({ c, extra, plan, pov, onChange, dragging, over, onDragStart, onDragEnd, onDragOver, onDrop }: CardProps) {
  const ew = extra.endsWorse;
  const day = extra.dayStart == null ? "" : extra.dayEnd != null && extra.dayEnd !== extra.dayStart ? `Day ${extra.dayStart}–${extra.dayEnd}` : `Day ${extra.dayStart}`;
  return (
    <article
      draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); onDragStart(); }} onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); onDragOver(); }} onDrop={(e) => { e.preventDefault(); onDrop(); }}
      className={`card group relative rounded-lg bg-[var(--panel)] p-3 flex flex-col gap-2 ${dragging ? "opacity-40" : ""} ${over ? "card-over" : ""}`}
      style={{ boxShadow: `inset 3px 0 0 ${povColor(pov)}, 0 0 0 1px var(--line)` }}
    >
      <div className="flex items-start justify-between gap-2">
        <button className="text-left min-w-0" onClick={() => goTo(`chapters/${c.id}/LATEST.md`)}>
          <div className="text-xs text-[var(--muted)] num">{c.number}{day && ` · ${day}`}</div>
          <div className="font-semibold leading-tight truncate" title={c.title}>{c.title}</div>
        </button>
        <span className="pov shrink-0" style={{ color: povColor(pov) }}>{c.pov ?? "—"}</span>
      </div>
      <textarea
        aria-label={`Beat for chapter ${c.number}`} rows={3} defaultValue={extra.beat ?? ""} placeholder={plan ? stripMd(plan.beats) : "One-line beat"}
        onBlur={(e) => e.target.value !== (extra.beat ?? "") && onChange({ beat: e.target.value })}
        className="field resize-none text-[13px] leading-snug"
      />
      <textarea aria-label={`Turn for chapter ${c.number}`} rows={2} defaultValue={extra.turn ?? ""} placeholder="The turn it ends on"
        onBlur={(e) => e.target.value !== (extra.turn ?? "") && onChange({ turn: e.target.value })} className="field resize-none text-[13px] leading-snug turn" />
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1 num">
          <span className="text-[var(--muted)] mr-0.5">Days</span>
          <label className="sr-only" htmlFor={`d1-${c.id}`}>Day start</label>
          <input id={`d1-${c.id}`} type="number" min={0} defaultValue={extra.dayStart ?? ""} placeholder="day" className="field day w-10 text-xs py-0.5 text-center"
            onBlur={(e) => onChange({ dayStart: e.target.value === "" ? null : Number(e.target.value) })} />
          <span className="text-[var(--muted)]">–</span>
          <label className="sr-only" htmlFor={`d2-${c.id}`}>Day end</label>
          <input id={`d2-${c.id}`} type="number" min={0} defaultValue={extra.dayEnd ?? ""} placeholder="end" className="field day w-10 text-xs py-0.5 text-center"
            onBlur={(e) => onChange({ dayEnd: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <button className={`chip ${ew === true ? "chip-on" : ""}`} aria-pressed={ew === true}
          onClick={() => onChange({ endsWorse: ew === true ? false : ew === false ? null : true })}
          title="Every scene ends worse than it started (bible/14)">
          {ew === true ? "✓ ends worse" : ew === false ? "✗ ends flat" : "ends worse?"}
        </button>
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--muted)] num">
        <select aria-label={`Status of chapter ${c.number}`} value={extra.status ?? "draft"} onChange={(e) => onChange({ status: e.target.value as ChapterStatus })} className="field text-xs py-0.5 w-auto">
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <span>{c.words.toLocaleString()} w · {c.versions} v</span>
      </div>
    </article>
  );
}

function Ghost({ r, pov, onCreate }: { r: OutlineRow; pov: string | null; onCreate: () => void }) {
  return (
    <article className="rounded-lg p-3 flex flex-col gap-2 border border-dashed border-[var(--line)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-[var(--muted)] num">{r.number} · planned</div>
          <div className="font-semibold leading-tight text-[var(--fg-dim)] truncate">{r.title ?? `Chapter ${r.number}`}</div>
        </div>
        <span className="pov shrink-0" style={{ color: povColor(pov) }}>{r.pov.replace(/\*\*/g, "").split(/[ ,(]/)[0]}</span>
      </div>
      <p className="text-[13px] leading-snug text-[var(--fg-dim)] line-clamp-4">{stripMd(r.beats)}</p>
      <div><button className="btn" onClick={onCreate}>Create chapter</button></div>
    </article>
  );
}
