import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useStore } from "../store";
import { getEditorView } from "../editorBridge";

// sequential single-hue ramp (dataviz blue, dark-surface steps): near zero recedes into the surface
const RAMP = ["var(--hover)", "#184f95", "#256abf", "#3987e5", "#6da7ec", "#9ec5f4"];
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Today's words vs target, as a ring. Click for the streak calendar and a sprint timer. */
export function ProgressBadge() {
  const { data: p } = useQuery({ queryKey: ["progress"], queryFn: api.progress, refetchInterval: 30_000 });
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!p) return null;
  const today = p.days[p.today]?.added ?? 0;
  const pct = Math.min(1, today / Math.max(1, p.target));
  const R = 7, C = 2 * Math.PI * R;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Today: ${today} of ${p.target} words. Streak ${p.streak} days.`}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[var(--muted)] hover:text-[var(--fg)] num whitespace-nowrap shrink-0">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
          <circle cx="9" cy="9" r={R} fill="none" stroke="var(--line)" strokeWidth="2.5" />
          <circle cx="9" cy="9" r={R} fill="none" stroke={pct >= 1 ? "var(--add)" : "var(--accent)"} strokeWidth="2.5" strokeLinecap="round"
            strokeDasharray={`${pct * C} ${C}`} transform="rotate(-90 9 9)" />
        </svg>
        <span><span className="text-[var(--fg-dim)]">{today.toLocaleString()}</span><span className="hidden min-[1500px]:inline"> / {p.target.toLocaleString()}</span></span>
        {p.streak > 0 && <span className="hidden min-[1500px]:inline" title={`${p.streak}-day streak`}>· {p.streak}d</span>}
      </button>
      {open && <ProgressPopover />}
    </div>
  );
}

function ProgressPopover() {
  const { data: p } = useQuery({ queryKey: ["progress"], queryFn: api.progress });
  const [hover, setHover] = useState<string | null>(null);
  const sprint = useSprint();
  const weeks = 16;
  const grid = useMemo(() => {
    const end = new Date(); const start = new Date(end); start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
    const cols: Date[][] = [];
    for (let w = 0; w < weeks; w++) { const col: Date[] = []; for (let d = 0; d < 7; d++) { const x = new Date(start); x.setDate(start.getDate() + w * 7 + d); col.push(x); } cols.push(col); }
    return cols;
  }, []);
  if (!p) return null;
  const step = (n: number) => (n <= 0 ? 0 : Math.min(5, 1 + Math.floor((n / Math.max(1, p.target)) * 4)));
  const total = Object.values(p.days).reduce((a, d) => a + d.added, 0);
  const todayD = new Date(); todayD.setHours(23, 59);
  const h = hover ? p.days[hover] : null;
  return (
    <div className="popover absolute right-0 top-full mt-1 w-[340px] rounded-lg bg-[var(--panel)] p-3 z-20 space-y-3 text-xs">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["today", (p.days[p.today]?.added ?? 0).toLocaleString()], ["streak", `${p.streak} day${p.streak === 1 ? "" : "s"}`], ["all time", total.toLocaleString()]].map(([k, v]) => (
          <div key={k} className="rounded-md bg-[var(--bg)] py-2"><div className="text-[15px] font-semibold num text-[var(--fg)]">{v}</div><div className="label">{k}</div></div>
        ))}
      </div>
      <figure className="space-y-1.5">
        <figcaption className="label">Words added, last {weeks} weeks</figcaption>
        <div className="flex gap-[3px]" role="img" aria-label="Calendar of words written per day">
          {grid.map((col, i) => (
            <div key={i} className="flex flex-col gap-[3px]">
              {col.map((d) => {
                const k = dayKey(d), n = p.days[k]?.added ?? 0, future = d > todayD;
                return <span key={k} onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} className="block w-[14px] h-[14px] rounded-[3px]"
                  style={{ background: future ? "transparent" : RAMP[step(n)], outline: k === p.today ? "1px solid var(--fg-dim)" : undefined }} />;
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between text-[var(--muted)] num h-4">
          <span>{hover ? <>{new Date(hover + "T12:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}: <span className="text-[var(--fg)]">{(h?.added ?? 0).toLocaleString()}</span> added{h?.removed ? `, ${h.removed.toLocaleString()} cut` : ""}</> : "Hover a day"}</span>
          <span className="flex items-center gap-1">less{RAMP.map((c, i) => <span key={i} className="inline-block w-2.5 h-2.5 rounded-[2px]" style={{ background: c }} />)}more</span>
        </div>
      </figure>
      <div className="space-y-1.5 pt-2 border-t border-[var(--line)]">
        <div className="label">Sprint</div>
        {sprint.running ? (
          <div className="flex items-center justify-between">
            <span className="num text-[15px] font-semibold text-[var(--fg)]">{sprint.left}</span>
            <span className="num text-[var(--fg-dim)]">+{sprint.words} words</span>
            <button className="btn" onClick={sprint.stop}>Stop</button>
          </div>
        ) : (
          <div className="flex gap-1.5">{[15, 25, 45].map((m) => <button key={m} className="btn" onClick={() => sprint.start(m)}>{m} min</button>)}</div>
        )}
        {sprint.last && !sprint.running && <div className="text-[var(--muted)]">Last sprint: +{sprint.last.words} words in {sprint.last.minutes} min</div>}
      </div>
      <div className="text-[var(--muted)]">Target {p.target}/day · change in Settings. Counts saved chapter words on every machine.</div>
    </div>
  );
}

// sprint: counts words added to today's total since it started (survives a reload via localStorage)
function useSprint() {
  const { data: p } = useQuery({ queryKey: ["progress"], queryFn: api.progress, refetchInterval: 15_000 });
  const say = useStore((s) => s.say);
  const read = () => { try { return JSON.parse(localStorage.getItem("mbs-sprint") ?? "null"); } catch { return null; } };
  const [s, setS] = useState<{ end: number; base: number; minutes: number } | null>(read);
  const [last, setLast] = useState<{ words: number; minutes: number } | null>(() => { try { return JSON.parse(localStorage.getItem("mbs-sprint-last") ?? "null"); } catch { return null; } });
  const [, tick] = useState(0);
  const added = p?.days[p.today]?.added ?? 0;
  useEffect(() => { if (!s) return; const iv = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(iv); }, [s]);
  const stop = () => {
    if (!s) return;
    const r = { words: Math.max(0, added - s.base), minutes: s.minutes };
    setLast(r); try { localStorage.setItem("mbs-sprint-last", JSON.stringify(r)); localStorage.removeItem("mbs-sprint"); } catch {}
    setS(null);
  };
  useEffect(() => { if (s && Date.now() >= s.end) { stop(); say(`Sprint done · +${Math.max(0, added - s.base)} words`); } });
  const ms = s ? Math.max(0, s.end - Date.now()) : 0;
  return {
    running: !!s, words: s ? Math.max(0, added - s.base) : 0, last,
    left: `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`,
    start: (m: number) => { const n = { end: Date.now() + m * 60000, base: added, minutes: m }; setS(n); try { localStorage.setItem("mbs-sprint", JSON.stringify(n)); } catch {} getEditorView()?.focus(); },
    stop,
  };
}

/** Read the open chapter aloud from the cursor's paragraph, one paragraph at a time, in the POV character's voice. */
export function ReadAloud({ pov }: { pov: string | null }) {
  const { data: s } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { setReadingLine, say, setSettingsOpen } = useStore();
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<() => void>(() => {});
  useEffect(() => () => stopRef.current(), []);
  if (!s) return null;

  const start = async () => {
    if (!s.hasElevenKey || !(s.voices[pov ?? ""] || s.voices.default)) { setSettingsOpen(true); say("Add an ElevenLabs key and pick a narration voice."); return; }
    const v = getEditorView(); if (!v) return;
    const doc = v.state.doc;
    // paragraphs from the cursor's paragraph to the end
    let ln = doc.lineAt(v.state.selection.main.head).number;
    while (ln > 1 && doc.line(ln - 1).text.trim() !== "") ln--;
    const paras: { line: number; text: string }[] = [];
    let buf: string[] = [], at = ln;
    for (let i = ln; i <= doc.lines; i++) {
      const t = doc.line(i).text;
      if (t.trim() === "") { if (buf.length) paras.push({ line: at, text: buf.join(" ") }); buf = []; at = i + 1; }
      else { if (!buf.length) at = i; buf.push(t); }
    }
    if (buf.length) paras.push({ line: at, text: buf.join(" ") });
    const queue = paras.filter((p) => !/^(#|---|<!--)/.test(p.text.trim()));
    if (!queue.length) return;
    const ctrl = new AbortController();
    let audio: HTMLAudioElement | null = null, stopped = false;
    stopRef.current = () => { stopped = true; ctrl.abort(); audio?.pause(); setPlaying(false); setReadingLine(null); };
    setPlaying(true);
    let next: Promise<Blob> | null = api.tts(queue[0].text, pov, ctrl.signal);
    for (let i = 0; i < queue.length && !stopped; i++) {
      let blob: Blob;
      try { blob = await next!; } catch (e: any) { if (!stopped) say(e.message.slice(0, 120)); break; }
      next = i + 1 < queue.length ? api.tts(queue[i + 1].text, pov, ctrl.signal) : null; // prefetch
      next?.catch(() => {});
      setReadingLine(queue[i].line);
      const url = URL.createObjectURL(blob);
      audio = new Audio(url);
      await new Promise<void>((res) => { audio!.onended = () => res(); audio!.onerror = () => res(); audio!.play().catch(() => res()); stopRef.current = () => { stopped = true; ctrl.abort(); audio?.pause(); res(); setPlaying(false); setReadingLine(null); }; });
      URL.revokeObjectURL(url);
    }
    setPlaying(false); setReadingLine(null);
  };
  return (
    <button onClick={() => (playing ? stopRef.current() : start())} className="shrink-0 hover:text-[var(--fg)]" title={playing ? "Stop reading" : `Read aloud from the cursor${pov ? ` in ${pov}'s voice` : ""}`} aria-pressed={playing}>
      {playing ? "■ stop" : "▶ read"}
    </button>
  );
}
