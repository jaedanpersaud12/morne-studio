import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { goTo, useStore } from "../store";
import { povColor } from "../povColors";
import type { Knowledge, Secret } from "../../shared/types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 24) || `s${Date.now()}`;

export default function KnowledgeView() {
  const qc = useQueryClient();
  const say = useStore((s) => s.say);
  const { data: remote } = useQuery({ queryKey: ["knowledge"], queryFn: api.knowledge });
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const { data: flags = [] } = useQuery({ queryKey: ["flags"], queryFn: api.knowledgeFlags });
  const [k, setK] = useState<Knowledge | null>(null);
  const dirtyRef = useRef(false);
  useEffect(() => { if (remote && !dirtyRef.current) setK(remote); }, [remote]);
  const maxCh = Math.max(1, ...(tree?.chapters.map((c) => c.number) ?? [1]));
  const [asOf, setAsOf] = useState<number>(maxCh);
  useEffect(() => setAsOf(maxCh), [maxCh]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = (next: Knowledge) => {
    setK(next); dirtyRef.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { await api.putKnowledge(next); qc.setQueryData(["knowledge"], next); qc.invalidateQueries({ queryKey: ["flags"] }); }
      catch (e: any) { say(`Couldn't save · ${e.message}`); }
      finally { dirtyRef.current = false; }
    }, 500);
  };
  if (!k) return <div className="p-8 text-[var(--muted)]">Loading…</div>;

  const name = (id: string) => entities.find((e) => e.id === id)?.short ?? id;
  const setSecret = (i: number, patch: Partial<Secret>) => save({ ...k, secrets: k.secrets.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setKnows = (i: number, who: string, v: string) => {
    const knows = { ...k.secrets[i].knows };
    if (v === "") delete knows[who]; else knows[who] = Math.max(0, Number(v));
    setSecret(i, { knows });
  };
  const addable = entities.filter((e) => !k.characters.includes(e.id)).sort((a, b) => (a.group === b.group ? a.short.localeCompare(b.short) : a.group === "supporting" ? 1 : -1));

  const flagsBySecret = new Map<string, number>();
  flags.forEach((f) => flagsBySecret.set(f.secret, (flagsBySecret.get(f.secret) ?? 0) + 1));

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Who knows what</h1>
            <p className="text-xs text-[var(--muted)] mt-1">Each cell is the chapter a character learns the secret. 0 = knew before the book. Blank = doesn't know.</p>
          </div>
          <label className="flex items-center gap-3 text-xs">
            <span className="text-[var(--muted)]">As of chapter</span>
            <input type="range" min={0} max={Math.max(maxCh, 30)} value={asOf} onChange={(e) => setAsOf(Number(e.target.value))} className="w-48 accent-[var(--accent)]" />
            <span className="num font-semibold w-6 text-right">{asOf}</span>
          </label>
        </header>

        <div className="overflow-x-auto rounded-lg" style={{ boxShadow: "0 0 0 1px var(--line)" }}>
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr className="bg-[var(--panel)]">
                <th scope="col" className="text-left font-normal label px-3 py-2 min-w-[260px]">Secret</th>
                {k.characters.map((c) => (
                  <th key={c} scope="col" className="font-medium px-1 py-2 w-[64px]">
                    <div className="flex flex-col items-center gap-1">
                      <span style={{ color: povColor(c) }}>{name(c)}</span>
                      <button className="text-[11px] text-[var(--muted)] hover:text-[var(--del)]" aria-label={`Remove ${name(c)} column`} onClick={() => confirm(`Remove ${name(c)} from the matrix?`) && save({ ...k, characters: k.characters.filter((x) => x !== c) })}>×</button>
                    </div>
                  </th>
                ))}
                <th className="px-2 py-2 w-[110px]">
                  <select aria-label="Add a character column" className="field text-xs py-0.5" value="" onChange={(e) => e.target.value && save({ ...k, characters: [...k.characters, e.target.value] })}>
                    <option value="">+ character</option>
                    {addable.map((e) => <option key={e.id} value={e.id}>{e.short}</option>)}
                  </select>
                </th>
              </tr>
            </thead>
            <tbody>
              {k.secrets.map((s, i) => (
                <tr key={s.id} className="border-t border-[var(--line)] align-top">
                  <th scope="row" className="text-left font-normal px-3 py-2">
                    <input aria-label="Secret" defaultValue={s.label} onBlur={(e) => e.target.value !== s.label && setSecret(i, { label: e.target.value })} className="field font-medium w-full" />
                    <input aria-label="Lint keywords, comma separated" defaultValue={s.keywords.join(", ")} placeholder="keywords for the lint, comma separated"
                      onBlur={(e) => setSecret(i, { keywords: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} className="field mt-1 w-full text-xs text-[var(--fg-dim)]" />
                    {s.note && <div className="text-xs text-[var(--muted)] mt-1">{s.note}</div>}
                    <div className="flex items-center gap-3 mt-1 text-xs">
                      {flagsBySecret.get(s.id) ? <a href="#flags" className="text-[var(--del)]">{flagsBySecret.get(s.id)} flag{flagsBySecret.get(s.id) === 1 ? "" : "s"} ↓</a> : <span className="text-[var(--muted)]">no flags</span>}
                      <button className="text-[var(--muted)] hover:text-[var(--del)]" onClick={() => confirm(`Delete "${s.label}"?`) && save({ ...k, secrets: k.secrets.filter((_, j) => j !== i) })}>delete</button>
                    </div>
                  </th>
                  {k.characters.map((c) => {
                    const v = s.knows[c];
                    const known = v !== undefined && v <= asOf;
                    return (
                      <td key={c} className="px-1 py-2 text-center">
                        <input aria-label={`${name(c)} learns "${s.label}" in chapter`} type="number" min={0} value={v ?? ""} onChange={(e) => setKnows(i, c, e.target.value)}
                          className={`cell num ${known ? "cell-known" : v !== undefined ? "cell-later" : ""}`} placeholder="·" />
                      </td>
                    );
                  })}
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-4">
          <button className="btn" onClick={() => { const label = prompt("New secret?"); if (label) save({ ...k, secrets: [...k.secrets, { id: slug(label), label, keywords: [], knows: {} }] }); }}>+ secret</button>
          <div className="flex items-center gap-4 text-xs text-[var(--muted)]">
            <span className="flex items-center gap-1.5"><span className="cell-swatch cell-known" aria-hidden />knows by ch {asOf}</span>
            <span className="flex items-center gap-1.5"><span className="cell-swatch cell-later" aria-hidden />learns later</span>
          </div>
        </div>

        <section id="flags" className="space-y-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[15px] font-semibold">Lint</h2>
            <span className="text-xs text-[var(--muted)]">Paragraphs in a POV chapter that touch a secret before the POV character learns it. Some are fine (someone else says it); each is worth a look.</span>
          </div>
          {flags.length === 0 ? <div className="text-sm text-[var(--muted)]">No flags.</div> : (
            <ul className="space-y-1">
              {flags.map((f, i) => {
                const s = k.secrets.find((x) => x.id === f.secret);
                const at = f.text.toLowerCase().indexOf(f.keyword.toLowerCase());
                const from = Math.max(0, at - 90);
                return (
                  <li key={i}>
                    <button onClick={() => goTo(`chapters/${f.chapter}/LATEST.md`, f.line)} className="row w-full text-left rounded-md px-3 py-2 hover:bg-[var(--hover)]">
                      <div className="text-xs text-[var(--muted)] num">ch {f.number} · L{f.line} · <span style={{ color: povColor(f.pov) }}>{name(f.pov)}</span> doesn't know <span className="text-[var(--fg-dim)]">"{s?.label ?? f.secret}"</span> yet</div>
                      <div className="text-[13px] leading-snug mt-0.5">
                        {from > 0 && "…"}{f.text.slice(from, at)}<mark>{f.text.slice(at, at + f.keyword.length)}</mark>{f.text.slice(at + f.keyword.length, at + f.keyword.length + 120)}{at + f.keyword.length + 120 < f.text.length && "…"}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
