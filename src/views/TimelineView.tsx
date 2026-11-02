import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { goTo } from "../store";
import { povColor } from "../povColors";

const stripMd = (s: string) => s.replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

export default function TimelineView() {
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const { data: outline } = useQuery({ queryKey: ["outline"], queryFn: api.outline });
  const { data: meta } = useQuery({ queryKey: ["meta"], queryFn: api.chaptersMeta });
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });
  if (!tree || !outline || !meta) return <div className="p-8 text-[var(--muted)]">Loading…</div>;

  const povId = (n: string | null) => (n ? entities.find((e) => e.short === n || e.aliases.includes(n))?.id ?? n.toLowerCase() : null);
  const written = new Map(tree.chapters.map((c) => [c.number, c]));
  const mvs = outline.movements;
  const grid = outline.grid;
  const gridRowFor = (i: number) => grid?.rows.find((r) => r.movement.startsWith(`${mvs[i].index}.`))?.cells ?? [];
  const sixSee = grid?.rows.find((r) => /what the six see/i.test(r.movement))?.cells ?? [];

  // day track for the written chapters
  const days = tree.chapters.map((c) => meta.chapters[c.id]).filter(Boolean);
  const maxDay = Math.max(1, ...days.map((d) => d!.dayEnd ?? d!.dayStart ?? 0));

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-6 space-y-8">
        <header className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-semibold tracking-tight">Timeline</h1>
          <span className="text-xs text-[var(--muted)]">Days from the board · parallel stories from bible/17</span>
        </header>

        {/* ---- day track: one lane per POV ---- */}
        <section aria-labelledby="days-h" className="space-y-2">
          <h2 id="days-h" className="label">Days covered by written chapters</h2>
          <div className="relative rounded-lg bg-[var(--panel)] p-3" style={{ boxShadow: "0 0 0 1px var(--line)" }}>
            <div className="grid gap-y-1.5" style={{ gridTemplateColumns: `72px repeat(${maxDay + 1}, minmax(36px, 1fr))` }}>
              <div />
              {Array.from({ length: maxDay + 1 }, (_, d) => <div key={d} className="text-xs text-[var(--muted)] num text-center">D{d}</div>)}
              {[...new Set(tree.chapters.map((c) => povId(c.pov)))].map((p) => (
                <Lane key={p ?? "x"} pov={p} name={entities.find((e) => e.id === p)?.short ?? p ?? "—"} chapters={tree.chapters.filter((c) => povId(c.pov) === p).map((c) => ({ c, m: meta.chapters[c.id] }))} maxDay={maxDay} />
              ))}
            </div>
          </div>
        </section>

        {/* ---- movements × factions ---- */}
        <section aria-labelledby="mv-h" className="space-y-2">
          <h2 id="mv-h" className="label">The book by movement, and the world moving off-page</h2>
          <div className="overflow-x-auto pb-2">
            <div className="grid gap-px rounded-lg overflow-hidden bg-[var(--line)] min-w-[1060px]" style={{ gridTemplateColumns: `112px repeat(${mvs.length}, minmax(188px, 1fr))` }}>
              <div className="bg-[var(--panel)]" />
              {mvs.map((m) => (
                <div key={m.index} className="bg-[var(--panel)] p-3">
                  <div className="font-semibold">{m.index}. {m.name}</div>
                  <div className="text-xs text-[var(--muted)]">{m.span}</div>
                </div>
              ))}
              <div className="bg-[var(--bg)] p-3 label self-stretch">Chapters</div>
              {mvs.map((m) => (
                <div key={m.index} className="bg-[var(--bg)] p-2 flex flex-wrap gap-1 content-start">
                  {outline.rows.filter((r) => r.movementIndex === m.index).map((r) => {
                    const w = written.get(r.number);
                    const pid = povId(w?.pov ?? r.pov.replace(/\*\*/g, "").split(/[ ,(]/)[0]);
                    const label = w ? w.title : stripMd(r.title ?? r.beats).split(/[.;:]/)[0];
                    return (
                      <button key={r.number} disabled={!w} onClick={() => w && goTo(`chapters/${w.id}/LATEST.md`)} title={stripMd(r.beats)}
                        className={`ch-chip ${w ? "" : "ch-chip-planned"}`} style={{ ["--pov" as any]: povColor(pid) }}>
                        <span className="num">{r.number}</span> {label}
                      </button>
                    );
                  })}
                </div>
              ))}
              {grid?.columns.map((col, ci) => (
                <Row key={col} label={col} cells={mvs.map((_, i) => gridRowFor(i)[ci] ?? "")} />
              ))}
              {sixSee.length > 0 && <Row label="What the six see" cells={sixSee} emphasis />}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Lane({ pov, name, chapters, maxDay }: { pov: string | null; name: string; chapters: { c: { id: string; number: number; title: string }; m?: { dayStart?: number | null; dayEnd?: number | null } }[]; maxDay: number }) {
  return (
    <>
      <div className="text-xs self-center truncate" style={{ color: povColor(pov) }}>{name}</div>
      <div className="relative h-7" style={{ gridColumn: `2 / span ${maxDay + 1}` }}>
        {chapters.map(({ c, m }) => {
          if (m?.dayStart == null) return null;
          const a = m.dayStart, b = m.dayEnd ?? a;
          const left = (a / (maxDay + 1)) * 100, width = ((b - a + 1) / (maxDay + 1)) * 100;
          return (
            <button key={c.id} onClick={() => goTo(`chapters/${c.id}/LATEST.md`)} title={`${c.number}. ${c.title} · Day ${a}${b !== a ? `–${b}` : ""}`}
              className="day-bar absolute top-0.5 bottom-0.5 rounded-[4px] text-xs px-1.5 truncate text-left"
              style={{ left: `calc(${left}% + 1px)`, width: `calc(${width}% - 2px)`, background: `color-mix(in oklab, ${povColor(pov)} 30%, var(--panel))`, boxShadow: `inset 2px 0 0 ${povColor(pov)}` }}>
              <span className="num">{c.number}</span> {c.title}
            </button>
          );
        })}
      </div>
    </>
  );
}

function Row({ label, cells, emphasis }: { label: string; cells: string[]; emphasis?: boolean }) {
  return (
    <>
      <div className={`p-3 text-xs font-medium ${emphasis ? "bg-[var(--active)]" : "bg-[var(--panel)]"}`}>{label}</div>
      {cells.map((t, i) => (
        <div key={i} className={`p-3 text-[13px] leading-snug ${emphasis ? "bg-[var(--active)] text-[var(--fg)]" : "bg-[var(--bg)] text-[var(--fg-dim)]"}`}>{stripMd(t)}</div>
      ))}
    </>
  );
}
