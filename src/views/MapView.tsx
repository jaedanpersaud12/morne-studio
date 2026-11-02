import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { goTo, useStore } from "../store";
import { povColor } from "../povColors";
import type { GraphData } from "../../shared/types";

/** Fault lines (cast/_overview) and bonds (bible/09) between the cast. Click a person to see their lines. */
export default function MapView() {
  const { data: g } = useQuery({ queryKey: ["graph"], queryFn: api.graph });
  const setEntity = useStore((s) => s.setEntity);
  const [sel, setSel] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [show, setShow] = useState({ fault: true, bond: true });

  const layout = useMemo(() => {
    if (!g) return null;
    // people on an inner ring (by degree), ideas and groups on an outer ring
    const deg = new Map<string, number>();
    g.edges.forEach((e) => { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); });
    const people = g.nodes.filter((n) => n.entity).sort((a, b) => (deg.get(b.id) ?? 0) - (deg.get(a.id) ?? 0));
    const ideas = g.nodes.filter((n) => !n.entity);
    const W = 900, H = 640, cx = W / 2, cy = H / 2;
    const pos = new Map<string, { x: number; y: number; ring: 0 | 1 }>();
    people.forEach((n, i) => { const a = (i / people.length) * Math.PI * 2 - Math.PI / 2; pos.set(n.id, { x: cx + Math.cos(a) * 190, y: cy + Math.sin(a) * 175, ring: 0 }); });
    // place each idea near the people it connects to, pushed out to the outer ring
    ideas.forEach((n, i) => {
      const nbrs = g.edges.filter((e) => e.to === n.id || e.from === n.id).map((e) => pos.get(e.to === n.id ? e.from : e.to)).filter(Boolean) as { x: number; y: number }[];
      let a = (i / Math.max(1, ideas.length)) * Math.PI * 2;
      if (nbrs.length) { const mx = nbrs.reduce((s, p) => s + p.x, 0) / nbrs.length, my = nbrs.reduce((s, p) => s + p.y, 0) / nbrs.length; a = Math.atan2(my - cy, mx - cx); }
      pos.set(n.id, { x: cx + Math.cos(a) * 340, y: cy + Math.sin(a) * 280, ring: 1 });
    });
    // nudge outer nodes apart, clamping to the frame each pass so the spacing survives the edges
    const outer = ideas.map((n) => pos.get(n.id)!);
    const clamp = (v: { x: number; y: number }) => { v.x = Math.min(W - 90, Math.max(90, v.x)); v.y = Math.min(H - 34, Math.max(28, v.y)); };
    for (let k = 0; k < 120; k++) {
      for (let i = 0; i < outer.length; i++) for (let j = i + 1; j < outer.length; j++) {
        const a = outer[i], b = outer[j]; let dx = b.x - a.x, dy = b.y - a.y; let d = Math.hypot(dx, dy);
        if (d < 1) { dx = 1; dy = 0; d = 1; }
        if (d < 170) { const f = (170 - d) / 2 / d; a.x -= dx * f; a.y -= dy * f * 0.6; b.x += dx * f; b.y += dy * f * 0.6; }
      }
      outer.forEach(clamp);
    }
    for (const v of pos.values()) clamp(v);
    return { pos, W, H, deg };
  }, [g]);

  if (!g || !layout) return <div className="p-8 text-[var(--muted)]">Loading…</div>;
  const { pos, W, H } = layout;
  const nodeById = new Map(g.nodes.map((n) => [n.id, n]));
  const edges = g.edges.map((e, i) => ({ ...e, i })).filter((e) => show[e.kind]);
  const lit = (e: GraphData["edges"][number]) => !sel || e.from === sel || e.to === sel;
  const selEdges = sel ? edges.filter((e) => e.from === sel || e.to === sel) : edges;
  const name = (id: string) => nodeById.get(id)?.label ?? id;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 grid gap-6 grid-cols-1 xl:grid-cols-[1fr_340px]">
        <div className="space-y-3 min-w-0">
          <header className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Map</h1>
              <p className="text-xs text-[var(--muted)] mt-1">Fault lines from the cast overview, bonds from bible/09. Click a person to isolate their lines.</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              {(["fault", "bond"] as const).map((k) => (
                <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={show[k]} onChange={(e) => setShow((s) => ({ ...s, [k]: e.target.checked }))} />
                  <svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" stroke={k === "fault" ? "var(--del)" : "var(--fg-dim)"} strokeWidth="2" strokeDasharray={k === "fault" ? "5 3" : undefined} /></svg>
                  {k === "fault" ? "fault line" : "bond"}
                </label>
              ))}
              {sel && <button className="btn" onClick={() => setSel(null)}>Show all</button>}
            </div>
          </header>
          <div className="rounded-lg bg-[var(--panel)] overflow-hidden" style={{ boxShadow: "0 0 0 1px var(--line)" }}>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto block" role="img" aria-label="Relationship map" onClick={(e) => e.target === e.currentTarget && setSel(null)}>
              {edges.map((e) => {
                const a = pos.get(e.from)!, b = pos.get(e.to)!;
                const on = lit(e), hov = hoverEdge === e.i;
                const stroke = e.kind === "fault" ? "var(--del)" : "var(--fg-dim)";
                if (e.from === e.to) {
                  return (
                    <g key={e.i} opacity={on ? 1 : 0.12} onMouseEnter={() => setHoverEdge(e.i)} onMouseLeave={() => setHoverEdge(null)}>
                      <circle cx={a.x} cy={a.y - 30} r={18} fill="none" stroke={stroke} strokeWidth={hov ? 3 : 2} strokeDasharray="5 3" />
                      {(hov || sel === e.from) && <text x={a.x} y={a.y - 54} textAnchor="middle" className="map-edge-label">{e.label}</text>}
                    </g>
                  );
                }
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                // gentle curve so A–B bond and fault don't overlap
                const nx = -(b.y - a.y), ny = b.x - a.x, nl = Math.hypot(nx, ny) || 1, off = e.kind === "fault" ? 18 : -18;
                const qx = mx + (nx / nl) * off, qy = my + (ny / nl) * off;
                return (
                  <g key={e.i} opacity={on ? 1 : 0.1} onMouseEnter={() => setHoverEdge(e.i)} onMouseLeave={() => setHoverEdge(null)}>
                    <path d={`M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`} fill="none" stroke="transparent" strokeWidth={14} />
                    <path d={`M ${a.x} ${a.y} Q ${qx} ${qy} ${b.x} ${b.y}`} fill="none" stroke={stroke} strokeWidth={hov ? 3 : 2} strokeDasharray={e.kind === "fault" ? "6 4" : undefined} />
                    {(hov || (sel && on)) && (
                      <text x={qx} y={qy - 6} textAnchor="middle" className="map-edge-label">{e.label}</text>
                    )}
                  </g>
                );
              })}
              {g.nodes.map((n) => {
                const p = pos.get(n.id)!;
                const on = !sel || sel === n.id || edges.some((e) => (e.from === sel && e.to === n.id) || (e.to === sel && e.from === n.id));
                const r = n.entity ? 22 : 6;
                return (
                  <g key={n.id} opacity={on ? 1 : 0.25} className="cursor-pointer" onClick={() => setSel(sel === n.id ? null : n.id)}
                    role="button" tabIndex={0} aria-label={n.label} onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && setSel(sel === n.id ? null : n.id)}>
                    {n.entity ? (
                      <>
                        <circle cx={p.x} cy={p.y} r={r} fill="var(--bg)" stroke={povColor(n.id)} strokeWidth={sel === n.id ? 3 : 2} />
                        <text x={p.x} y={p.y + 4} textAnchor="middle" className="map-node-label">{n.label}</text>
                      </>
                    ) : (
                      <>
                        <rect x={p.x - 4} y={p.y - 4} width={8} height={8} rx={2} fill="var(--muted)" transform={`rotate(45 ${p.x} ${p.y})`} />
                        <text x={p.x} y={p.y + 20} textAnchor="middle" className="map-idea-label">{n.label.length > 26 ? n.label.slice(0, 25) + "…" : n.label}</text>
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <aside className="space-y-3 xl:pt-[52px]">
          <div className="label">{sel ? `${name(sel)} · ${selEdges.length} line${selEdges.length === 1 ? "" : "s"}` : `All lines · ${edges.length}`}</div>
          {sel && nodeById.get(sel)?.entity && <button className="btn" onClick={() => setEntity(sel)}>Open {name(sel)}'s card</button>}
          <ul className="space-y-1.5">
            {selEdges.map((e) => (
              <li key={e.i} onMouseEnter={() => setHoverEdge(e.i)} onMouseLeave={() => setHoverEdge(null)} className={`rounded-md p-2.5 text-[13px] ${hoverEdge === e.i ? "bg-[var(--active)]" : "bg-[var(--panel)]"}`}>
                <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                  <svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" stroke={e.kind === "fault" ? "var(--del)" : "var(--fg-dim)"} strokeWidth="2" strokeDasharray={e.kind === "fault" ? "5 3" : undefined} /></svg>
                  {e.kind === "fault" ? "fault line" : "bond"}
                </div>
                <div className="mt-0.5"><span className="font-medium">{name(e.from)}</span>{e.from !== e.to && <> — <span className="font-medium">{name(e.to)}</span></>}</div>
                <div className="text-[var(--fg-dim)]">{e.label}{e.note && e.from === e.to ? ` (${e.note})` : ""}</div>
                <button className="text-xs text-[var(--muted)] hover:text-[var(--fg)] mt-1 underline underline-offset-2" onClick={() => goTo(e.source)}>{e.source.replace(/^bible\//, "")}</button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}
