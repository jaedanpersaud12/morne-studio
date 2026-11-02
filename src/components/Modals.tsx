import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { diffArrays } from "diff";
import { api } from "../api";
import { useStore } from "../store";
import type { Conflict } from "../../shared/types";
import { Modal } from "./ui";
import { toast } from "sonner";

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen, say } = useStore();
  const qc = useQueryClient();
  const { data: s } = useQuery({ queryKey: ["settings"], queryFn: api.settings, enabled: settingsOpen });
  const [key, setKey] = useState("");
  const [xiKey, setXiKey] = useState("");
  const { data: voices = [], error: voiceErr } = useQuery({ queryKey: ["voices", s?.hasElevenKey], queryFn: api.voices, enabled: settingsOpen && !!s?.hasElevenKey, retry: false });
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities, enabled: settingsOpen });
  if (!settingsOpen || !s) return null;
  const povs = ["default", "kit", "juno", "fen", "sol", "tock", "lonny", "lyra", "judge"];
  const patch = async (p: Parameters<typeof api.putSettings>[0]) => {
    try { await api.putSettings(p); qc.invalidateQueries({ queryKey: ["settings"] }); } catch (e: any) { say(e.message); }
  };
  return (
    <Modal title="Settings" onClose={() => setSettingsOpen(false)}>
      <div className="space-y-5 text-[13px]">
        <section className="space-y-2">
          <h3 className="label">Claude</h3>
          <label className="block space-y-1">
            <span>Anthropic API key {s.hasKey && <span className="text-[var(--add)]">· saved on this machine</span>}</span>
            <div className="flex gap-1.5">
              <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.hasKey ? "•••••••• (paste to replace)" : "sk-ant-…"} className="field flex-1" />
              <button className="btn" disabled={!key.trim()} onClick={async () => { await patch({ anthropicApiKey: key }); setKey(""); say("Key saved"); }}>Save</button>
            </div>
            <span className="text-xs text-[var(--muted)]">Kept in studio.local.json next to the app, which git ignores. Get one at console.anthropic.com.</span>
          </label>
          {s.hasKey && <button className="text-xs text-[var(--muted)] hover:text-[var(--del)]" onClick={() => patch({ anthropicApiKey: "" })}>Remove key</button>}
          <label className="flex items-center justify-between gap-3">
            <span>Model</span>
            <select value={s.model} onChange={(e) => patch({ model: e.target.value })} className="field w-auto">
              {s.models.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </section>
        <section className="space-y-2">
          <h3 className="label">Read aloud · ElevenLabs</h3>
          <label className="block space-y-1">
            <span>ElevenLabs API key {s.hasElevenKey && <span className="text-[var(--add)]">· saved on this machine</span>}</span>
            <div className="flex gap-1.5">
              <input type="password" autoComplete="off" value={xiKey} onChange={(e) => setXiKey(e.target.value)} placeholder={s.hasElevenKey ? "•••••••• (paste to replace)" : "xi-…"} className="field flex-1" />
              <button className="btn" disabled={!xiKey.trim()} onClick={async () => { await patch({ elevenLabsApiKey: xiKey }); setXiKey(""); say("Key saved"); }}>Save</button>
            </div>
          </label>
          {s.hasElevenKey && (
            <>
              {voiceErr ? <div className="text-xs text-[var(--del)]">{String((voiceErr as Error).message).slice(0, 160)}</div> : (
                <div className="grid grid-cols-[90px_1fr] gap-x-3 gap-y-1.5 items-center">
                  {povs.map((pv) => (
                    <label key={pv} className="contents">
                      <span className="text-xs">{pv === "default" ? "Narrator" : entities.find((e) => e.id === pv)?.short ?? pv}</span>
                      <select value={s.voices[pv] ?? ""} onChange={(e) => patch({ voices: { [pv]: e.target.value } })} className="field text-xs py-0.5">
                        <option value="">{pv === "default" ? "Pick a voice" : "Use narrator"}</option>
                        {voices.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <label className="flex items-center justify-between gap-3">
                <span>Model</span>
                <select value={s.ttsModel} onChange={(e) => patch({ ttsModel: e.target.value })} className="field w-auto text-xs">{s.ttsModels.map((m) => <option key={m}>{m}</option>)}</select>
              </label>
              <span className="text-xs text-[var(--muted)]">A chapter reads in its POV character's voice. ▶ read in the top bar starts from the cursor.</span>
            </>
          )}
        </section>
        <section className="space-y-2">
          <h3 className="label">Writing</h3>
          <label className="flex items-center justify-between gap-3"><span>Daily target (words)</span><input type="number" min={50} step={50} defaultValue={s.dailyTarget} onBlur={(e) => patch({ dailyTarget: Number(e.target.value) })} className="field w-24 num" /></label>
          <label className="flex items-center justify-between gap-3"><span>Book title</span><input defaultValue={s.bookTitle} onBlur={(e) => patch({ bookTitle: e.target.value })} className="field w-56" /></label>
          <label className="flex items-center justify-between gap-3"><span>Author (for exports)</span><input defaultValue={s.authorName} placeholder="from git if blank" onBlur={(e) => patch({ authorName: e.target.value })} className="field w-56" /></label>
        </section>
        <section className="space-y-2">
          <h3 className="label">Sync between your machines</h3>
          {([
            ["autoCommit", "Commit on save", "Each save commits that file. Saves of the same file within 15 minutes fold into one commit."],
            ["autoPush", "Push automatically", "45 seconds after the last commit."],
            ["autoPull", "Pull automatically", "When this window gets focus and every 2 minutes. Clean files reload in place."],
          ] as const).map(([k, label, hint]) => (
            <label key={k} className="flex items-start justify-between gap-3">
              <span><span className="block">{label}</span><span className="text-xs text-[var(--muted)]">{hint}</span></span>
              <input type="checkbox" className="mt-1 accent-[var(--accent)] w-4 h-4" checked={s[k]} onChange={(e) => patch({ [k]: e.target.checked })} />
            </label>
          ))}
        </section>
        <McpSection aiWrites={s.aiWrites} onToggle={(v) => patch({ aiWrites: v })} mcp={(s as any).mcp} />
      </div>
    </Modal>
  );
}

function McpSection({ aiWrites, onToggle, mcp }: { aiWrites: boolean; onToggle: (v: boolean) => void; mcp?: { command: string; args: string[] } }) {
  const [copied, setCopied] = useState(false);
  const snippet = JSON.stringify({ mcpServers: { "morne-bay-studio": mcp ?? { command: "bun", args: ["mcp.ts"] } } }, null, 2);
  return (
    <section className="space-y-2">
      <h3 className="label">Claude over MCP</h3>
      <label className="flex items-start justify-between gap-3">
        <span><span className="block">AI can edit the book</span><span className="text-xs text-[var(--muted)]">Lets Claude Desktop and Claude Code change chapters, notes and planning data. Every change is committed, so History can undo it. Off = read-only.</span></span>
        <input type="checkbox" className="mt-1 w-4 h-4" checked={aiWrites} onChange={(e) => onToggle(e.target.checked)} />
      </label>
      <div className="text-xs text-[var(--muted)]">Add this to Claude Desktop (Settings → Developer → Edit config), then restart Claude:</div>
      <div className="relative">
        <pre className="text-[11.5px] leading-relaxed bg-[var(--bg-0)] rounded-lg p-3 overflow-x-auto font-[var(--font-mono)] text-[var(--fg-dim)] shadow-[inset_0_0_0_1px_var(--line)]">{snippet}</pre>
        <button className="btn absolute top-2 right-2" onClick={() => navigator.clipboard?.writeText(snippet).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); }).catch(() => {})}>{copied ? "Copied" : "Copy"}</button>
      </div>
    </section>
  );
}

// ---------- conflicts: pick per paragraph ----------
type Block = { kind: "same"; text: string[] } | { kind: "diff"; mine: string[]; theirs: string[] };
const paras = (s: string) => s.replace(/\r\n/g, "\n").split(/\n{2,}/);
function blocks(mine: string, theirs: string): Block[] {
  const out: Block[] = [];
  let pending: { mine: string[]; theirs: string[] } | null = null;
  const flush = () => { if (pending) { out.push({ kind: "diff", ...pending }); pending = null; } };
  for (const part of diffArrays(paras(mine), paras(theirs))) {
    if (!part.added && !part.removed) { flush(); out.push({ kind: "same", text: part.value }); }
    else { pending ??= { mine: [], theirs: [] }; (part.removed ? pending.mine : pending.theirs).push(...part.value); }
  }
  flush();
  return out;
}

export function ConflictModal() {
  const { conflicts, setConflicts, say } = useStore();
  const qc = useQueryClient();
  const [fileIdx, setFileIdx] = useState(0);
  const [choices, setChoices] = useState<Record<string, ("mine" | "theirs" | "both")[]>>({});
  const [busy, setBusy] = useState(false);
  const all = useMemo(() => (conflicts ?? []).map((c) => ({ c, b: blocks(c.mine, c.theirs) })), [conflicts]);
  if (!conflicts?.length) return null;
  const cur = all[Math.min(fileIdx, all.length - 1)];
  const choice = (path: string, i: number) => choices[path]?.[i] ?? "mine";
  const setChoice = (path: string, i: number, v: "mine" | "theirs" | "both") => setChoices((s) => { const a = [...(s[path] ?? [])]; a[i] = v; return { ...s, [path]: a }; });
  const assemble = (c: Conflict, b: Block[]) => {
    let di = -1;
    const out: string[] = [];
    for (const blk of b) {
      if (blk.kind === "same") out.push(...blk.text);
      else { di++; const ch = choice(c.path, di); if (ch !== "theirs") out.push(...blk.mine); if (ch !== "mine") out.push(...blk.theirs); }
    }
    return out.join("\n\n");
  };
  const apply = async () => {
    setBusy(true);
    const resolutions: Record<string, string> = {};
    for (const { c, b } of all) resolutions[c.path] = assemble(c, b);
    try {
      const r = await api.git.resolve(resolutions);
      say(r.message);
      if (r.ok) { setConflicts(null); setChoices({}); ["file", "tree", "git", "meta", "knowledge", "ledger", "flags"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); }
    } catch (e: any) { say(e.message); } finally { setBusy(false); }
  };
  let di = -1;
  return (
    <Modal title="Both machines changed the same file" onClose={() => setConflicts(null)} wide>
      <div className="space-y-4 text-[13px]">
        <p className="text-[var(--fg-dim)]">Pick a side for each changed paragraph. Unchanged paragraphs are kept. Nothing is lost until you press Merge: close this and nothing happens.</p>
        {all.length > 1 && (
          <div className="flex flex-wrap gap-1">{all.map(({ c }, i) => <button key={c.path} className={`chip ${i === fileIdx ? "chip-on" : ""}`} onClick={() => setFileIdx(i)}>{c.path}</button>)}</div>
        )}
        <div className="space-y-3">
          {cur.b.map((blk, i) => {
            if (blk.kind === "same") return <div key={i} className="text-[var(--muted)] text-xs line-clamp-2 font-[var(--font-prose)]">{blk.text.join(" ¶ ")}</div>;
            di++;
            const idx = di, ch = choice(cur.c.path, idx);
            return (
              <div key={i} className="grid grid-cols-2 gap-2">
                {(["mine", "theirs"] as const).map((side) => (
                  <button key={side} onClick={() => setChoice(cur.c.path, idx, side)} aria-pressed={ch === side || ch === "both"}
                    className={`text-left rounded-md p-2.5 font-[var(--font-prose)] text-[14px] leading-relaxed whitespace-pre-wrap ${ch === side || ch === "both" ? "conflict-on" : "conflict-off"}`}>
                    <div className="label font-[var(--font-ui)] mb-1">{side === "mine" ? "This machine" : "Other machine"}</div>
                    {(side === "mine" ? blk.mine : blk.theirs).join("\n\n") || <em className="text-[var(--muted)]">(removed)</em>}
                  </button>
                ))}
                <div className="col-span-2 -mt-1 text-right"><button className="text-xs text-[var(--muted)] hover:text-[var(--fg)]" onClick={() => setChoice(cur.c.path, idx, "both")}>{ch === "both" ? "✓ keeping both" : "keep both"}</button></div>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 pt-2 border-t border-[var(--line)]">
          <button className="btn" onClick={() => setConflicts(null)}>Later</button>
          <button className="btn chip-on" disabled={busy} onClick={apply}>{busy ? "Merging…" : `Merge ${all.length} file${all.length === 1 ? "" : "s"}`}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Pulls on focus and every 2 minutes when autoPull is on. Opens the conflict modal when needed. */
export function SyncAgent() {
  const qc = useQueryClient();
  const { say, setConflicts } = useStore();
  const { data: s } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const running = useRef(false);
  useEffect(() => {
    if (!s?.autoPull) return;
    const pull = async () => {
      if (running.current || useStore.getState().conflicts) return;
      running.current = true;
      try {
        const r = await api.git.pull();
        if (r.action === "conflict" && r.conflicts) { setConflicts(r.conflicts); say(r.message); }
        else if (r.action === "ff" || r.action === "merged") {
          say(`Synced · ${r.message}`);
          ["file", "tree", "meta", "knowledge", "ledger", "flags", "presence", "outline", "entities", "notes", "progress", "graph", "numbers"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
        }
        if (!r.ok && r.action !== "blocked" && r.action !== "conflict") {
          const msg = friendlySyncError(r.message);
          if (useStore.getState().syncError !== msg) toast.error("Couldn't sync with GitHub", { description: msg, duration: 10000, action: { label: "Retry", onClick: () => pull() } });
          useStore.setState({ syncError: msg });
        } else if (r.ok) useStore.setState({ syncError: null });
        qc.invalidateQueries({ queryKey: ["git"] });
      } catch { /* offline */ } finally { running.current = false; }
    };
    pull();
    const onFocus = () => pull();
    window.addEventListener("focus", onFocus);
    const iv = setInterval(pull, 120_000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(iv); };
  }, [s?.autoPull, qc, say, setConflicts]);
  return null;
}

/** Git's raw stderr is noise to a writer; say what happened and what to do. */
export function friendlySyncError(raw: string): string {
  const m = raw || "";
  if (/unable to create temporary file|unpack-objects failed|failed to write object|Permission denied|\.lock': File exists/i.test(m)) return "Git couldn't write to the book folder. Another program (another git window, antivirus, or a sync app) may have had it busy. It retries on its own.";
  if (/could not resolve host|unable to access|timed out|network/i.test(m)) return "You look offline. Your work is saved here and will sync when you're back.";
  if (/authentication|403|401|could not read Username/i.test(m)) return "GitHub refused the login. Run any git push from a terminal once to sign in again.";
  if (/non-fast-forward|rejected/i.test(m)) return "The other machine pushed first. Studio will pull and merge on the next sync.";
  const first = m.split("\n").map((l) => l.replace(/^(fatal|error):\s*/i, "").trim()).find(Boolean) ?? "Unknown error";
  return first.length > 140 ? first.slice(0, 137) + "…" : first;
}
