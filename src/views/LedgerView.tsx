import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { goTo, useStore } from "../store";
import type { Ledger, Resource, LedgerEntry } from "../../shared/types";

const SERIES = "#3987e5"; // dataviz slot 1, dark step; single-series sparklines use one hue
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || `r${Date.now()}`;

export default function LedgerView() {
  const qc = useQueryClient();
  const say = useStore((s) => s.say);
  const { data: remote } = useQuery({ queryKey: ["ledger"], queryFn: api.ledger });
  const { data: locked = [] } = useQuery({ queryKey: ["locked"], queryFn: api.locked });
  const [L, setL] = useState<Ledger | null>(null);
  const dirtyRef = useRef(false);
  useEffect(() => { if (remote && !dirtyRef.current) setL(remote); }, [remote]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (next: Ledger) => {
    setL(next); dirtyRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => api.putLedger(next).then(() => qc.setQueryData(["ledger"], next)).catch((e) => say(`Couldn't save · ${e.message}`)).finally(() => { dirtyRef.current = false; }), 500);
  };
  if (!L) return <div className="p-8 text-[var(--muted)]">Loading…</div>;

  const maxDay = Math.max(8, ...L.resources.flatMap((r) => r.entries.map((e) => e.day)));
  const setRes = (i: number, r: Resource) => save({ resources: L.resources.map((x, j) => (j === i ? r : x)) });

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-8">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Ledger</h1>
          <p className="text-xs text-[var(--muted)] mt-1">The book runs on arithmetic. A count only changes because someone paid (bible/19).</p>
        </header>

        {locked.length > 0 && (
          <section aria-labelledby="locked-h" className="space-y-2">
            <h2 id="locked-h" className="label">Locked numbers · bible/00</h2>
            <dl className="grid gap-px rounded-lg overflow-hidden bg-[var(--line)] grid-cols-1 md:grid-cols-2">
              {locked.map((n) => (
                <div key={n.thing} className="bg-[var(--panel)] px-3 py-2">
                  <dt className="text-xs text-[var(--muted)]">{n.thing}</dt>
                  <dd className="text-[13px] leading-snug">{n.value}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <NumbersInProse />

        <section aria-labelledby="res-h" className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 id="res-h" className="label">Resources by day</h2>
            <button className="btn" onClick={() => { const label = prompt("Resource name?"); if (label) save({ resources: [...L.resources, { id: slug(label), label, unit: "", entries: [] }] }); }}>+ resource</button>
          </div>
          <div className="space-y-3">
            {L.resources.map((r, i) => <ResourceRow key={r.id} r={r} maxDay={maxDay} onChange={(n) => setRes(i, n)} onDelete={() => confirm(`Delete "${r.label}"?`) && save({ resources: L.resources.filter((_, j) => j !== i) })} />)}
          </div>
        </section>
      </div>
    </div>
  );
}

function ResourceRow({ r, maxDay, onChange, onDelete }: { r: Resource; maxDay: number; onChange: (r: Resource) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const entries = [...r.entries].sort((a, b) => a.day - b.day);
  const last = entries.at(-1);
  const setEntry = (i: number, patch: Partial<LedgerEntry>) => onChange({ ...r, entries: entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) });
  return (
    <article className="rounded-lg bg-[var(--panel)] p-3" style={{ boxShadow: "0 0 0 1px var(--line)" }}>
      <div className="grid grid-cols-[200px_1fr_auto] items-center gap-4">
        <div className="min-w-0">
          <div className="font-medium truncate">{r.label}</div>
          <div className="text-xs text-[var(--muted)] num">{last ? <>Day {last.day}: <span className="text-[var(--fg)] font-semibold">{last.value.toLocaleString()}</span> {r.unit}</> : "no entries"}</div>
        </div>
        <Spark entries={entries} maxDay={maxDay} unit={r.unit} label={r.label} />
        <button className="btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? "Done" : "Edit"}</button>
      </div>
      {open && (
        <div className="mt-3 space-y-2">
          <table className="w-full text-[13px]">
            <thead><tr className="label"><th className="text-left font-normal py-1 w-20">Day</th><th className="text-left font-normal py-1 w-28">Value</th><th className="text-left font-normal py-1">Note (who paid)</th><th className="w-8" /></tr></thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.day}-${i}`} className="border-t border-[var(--line)]">
                  <td className="py-1 pr-2"><input aria-label="Day" type="number" min={0} defaultValue={e.day} onBlur={(ev) => setEntry(i, { day: Number(ev.target.value) })} className="field w-16 num" /></td>
                  <td className="py-1 pr-2"><input aria-label="Value" type="number" defaultValue={e.value} onBlur={(ev) => setEntry(i, { value: Number(ev.target.value) })} className="field w-24 num" /></td>
                  <td className="py-1 pr-2"><input aria-label="Note" defaultValue={e.note ?? ""} onBlur={(ev) => setEntry(i, { note: ev.target.value || undefined })} className="field w-full" /></td>
                  <td className="py-1 text-right"><button aria-label="Remove entry" className="text-[var(--muted)] hover:text-[var(--del)]" onClick={() => onChange({ ...r, entries: entries.filter((_, j) => j !== i) })}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3">
            <button className="btn" onClick={() => onChange({ ...r, entries: [...entries, { day: (last?.day ?? -1) + 1, value: last?.value ?? 0 }] })}>+ entry</button>
            <label className="text-xs text-[var(--muted)] flex items-center gap-1">unit <input defaultValue={r.unit} onBlur={(e) => onChange({ ...r, unit: e.target.value })} className="field w-24 text-xs" /></label>
            <button className="text-xs text-[var(--muted)] hover:text-[var(--del)] ml-auto" onClick={onDelete}>delete resource</button>
          </div>
        </div>
      )}
    </article>
  );
}

/** Step sparkline: the value holds until something changes it. Shared day axis across rows so days line up. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function Spark({ entries, maxDay, unit, label }: { entries: LedgerEntry[]; maxDay: number; unit: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, measured] = useWidth<HTMLElement>();
  const W = Math.max(120, measured), H = 44, P = 6;
  if (!entries.length) return <figure ref={ref} className="h-11 min-w-0" />;
  const vmax = Math.max(1, ...entries.map((e) => e.value));
  const x = (d: number) => P + (d / maxDay) * (W - 2 * P);
  const y = (v: number) => H - P - (v / vmax) * (H - 2 * P);
  let d = `M ${x(entries[0].day)} ${y(entries[0].value)}`;
  for (let i = 1; i < entries.length; i++) d += ` H ${x(entries[i].day)} V ${y(entries[i].value)}`;
  d += ` H ${x(maxDay)}`;
  const h = hover != null ? entries[hover] : null;
  return (
    <figure ref={ref} className="min-w-0">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block overflow-visible" role="img" aria-label={`${label}: ${entries.map((e) => `day ${e.day} ${e.value}`).join(", ")}`}>
        <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="var(--line)" strokeWidth={1} />
        <path d={d} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
        {entries.map((e, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(e.day)} cy={y(e.value)} r={12} fill="transparent" />
            <circle cx={x(e.day)} cy={y(e.value)} r={4} fill={SERIES} stroke="var(--panel)" strokeWidth={2} pointerEvents="none" />
          </g>
        ))}
      </svg>
      <figcaption className="text-xs text-[var(--muted)] h-4 truncate num">
        {h ? <>Day {h.day}: <span className="text-[var(--fg)]">{h.value.toLocaleString()} {unit}</span>{h.note ? ` · ${h.note}` : ""}</> : `day 0 – ${maxDay}`}
      </figcaption>
    </figure>
  );
}

/** Every "N noun" in the chapters whose noun appears in the locked numbers, grouped by noun. Differences are prompts, not errors. */
function NumbersInProse() {
  const { data } = useQuery({ queryKey: ["numbers"], queryFn: api.numbers });
  const [open, setOpen] = useState<string | null>(null);
  if (!data || !data.locked.length) return null;
  return (
    <section aria-labelledby="num-h" className="space-y-2">
      <div className="flex items-baseline gap-3">
        <h2 id="num-h" className="label">Numbers in the prose</h2>
        <span className="text-xs text-[var(--muted)]">Counts of locked nouns in the chapters. A different number is a prompt to check (other places, other days), not an error.</span>
      </div>
      <div className="rounded-lg overflow-hidden" style={{ boxShadow: "0 0 0 1px var(--line)" }}>
        {data.locked.map((l) => {
          const hits = data.hits.filter((h) => h.noun === l.noun);
          const diff = hits.filter((h) => !h.matches);
          const isOpen = open === l.noun;
          return (
            <div key={l.noun} className="border-t border-[var(--line)] first:border-t-0 bg-[var(--panel)]">
              <button className="row w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--hover)]" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.noun)}>
                <span className="text-[13px]"><span className="font-medium">{l.noun}</span> <span className="text-[var(--muted)]">locked {l.values.length > 3 ? `${l.values[0]}–${l.values.at(-1)}` : l.values.join(", ")} · {l.source}</span></span>
                <span className="text-xs num shrink-0">{hits.length - diff.length} match{diff.length ? <> · <span className="text-[var(--accent)]">{diff.length} differ</span></> : ""} {isOpen ? "▴" : "▾"}</span>
              </button>
              {isOpen && (
                <ul className="pb-2">
                  {hits.sort((a, b) => Number(a.matches) - Number(b.matches) || a.number - b.number).map((h, i) => (
                    <li key={i}>
                      <button onClick={() => goTo(`chapters/${h.chapter}/LATEST.md`, h.line)} className="row w-full text-left px-3 py-1.5 hover:bg-[var(--hover)] grid grid-cols-[80px_1fr] gap-3 text-[13px]">
                        <span className={`text-xs num ${h.matches ? "text-[var(--muted)]" : "text-[var(--accent)]"}`}>{h.matches ? "✓" : "≠"} ch {h.number} L{h.line}</span>
                        <span className="leading-snug text-[var(--fg-dim)]">…{h.context.split(h.phrase)[0]}<mark>{h.phrase}</mark>{h.context.split(h.phrase).slice(1).join(h.phrase)}…</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
