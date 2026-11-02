import type { Note, Progress, GraphData, NumberHit, Tree, Entity, Backlink, SearchHit, VersionInfo, Fingerprint, GitStatus, Outline, LockedNumber, StudioChapters, Knowledge, KnowledgeFlag, Ledger, Settings, SyncResult, SyncState } from "../shared/types";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  if (!r.ok) {
    const t = await r.text();
    let msg = t; try { msg = JSON.parse(t).error ?? t; } catch {}
    throw new Error(msg);
  }
  return r.json();
}
const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();
const put = (body: unknown) => ({ method: "PUT", body: JSON.stringify(body) });
const post = (body?: unknown) => ({ method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  tree: () => j<Tree>("/api/tree"),
  entities: () => j<Entity[]>("/api/entities"),
  file: (path: string) => j<{ path: string; content: string }>("/api/file" + q({ path })),
  save: (path: string, content: string, label?: string) => j<{ ok: true; words: number; sync: SyncResult | null }>("/api/file", put({ path, content, label })),
  search: (query: string) => j<SearchHit[]>("/api/search" + q({ q: query })),
  backlinks: (id: string) => j<Backlink[]>(`/api/backlinks/${id}`),
  presence: () => j<{ chapters: string[]; rows: { id: string; short: string; counts: number[] }[] }>("/api/presence"),
  versions: (chapter: string) => j<VersionInfo[]>(`/api/versions/${chapter}`),
  snapshot: (chapter: string, note: string) => j<{ file: string; label: string }>("/api/snapshot", post({ chapter, note })),
  build: () => j<{ words: number; chapters: number }>("/api/build", post()),
  fingerprint: (path: string) => j<Fingerprint>("/api/fingerprint" + q({ path })),
  outline: () => j<Outline>("/api/outline"),
  locked: () => j<LockedNumber[]>("/api/locked"),
  chaptersMeta: () => j<StudioChapters>("/api/meta/chapters"),
  putChaptersMeta: (d: StudioChapters) => j<{ ok: true }>("/api/meta/chapters", put(d)),
  patchChapterMeta: (id: string, patch: Record<string, unknown>) => j<StudioChapters>(`/api/meta/chapters/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  knowledge: () => j<Knowledge>("/api/knowledge"),
  putKnowledge: (d: Knowledge) => j<{ ok: true }>("/api/knowledge", put(d)),
  knowledgeFlags: () => j<KnowledgeFlag[]>("/api/knowledge/flags"),
  ledger: () => j<Ledger>("/api/ledger"),
  putLedger: (d: Ledger) => j<{ ok: true }>("/api/ledger", put(d)),
  createChapter: (number: number, title: string, pov: string) => j<{ id: string }>("/api/chapters/create", post({ number, title, pov })),
  reorder: (ids: string[]) => j<{ changed: number }>("/api/chapters/reorder", post({ ids })),
  settings: () => j<Settings & { models: string[]; ttsModels: string[] }>("/api/settings"),
  putSettings: (s: Partial<{ anthropicApiKey: string; model: string; autoCommit: boolean; autoPush: boolean; autoPull: boolean; elevenLabsApiKey: string; voices: Record<string, string>; ttsModel: string; dailyTarget: number; authorName: string; bookTitle: string; aiWrites: boolean }>) => j<Settings>("/api/settings", put(s)),
  notes: () => j<Note[]>("/api/notes"),
  addNote: (n: { file: string; quote: string; line: number; body: string }) => j<Note>("/api/notes", post(n)),
  patchNote: (id: string, patch: Partial<Pick<Note, "body" | "resolved" | "line">>) => j<Note>(`/api/notes/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteNote: (id: string) => j<{ ok: true }>(`/api/notes/${id}`, { method: "DELETE" }),
  progress: () => j<Progress>("/api/progress"),
  graph: () => j<GraphData>("/api/graph"),
  numbers: () => j<{ locked: { noun: string; values: number[]; source: string }[]; hits: NumberHit[] }>("/api/numbers"),
  voices: () => j<{ voice_id: string; name: string }[]>("/api/tts/voices"),
  tts: async (text: string, pov: string | null, signal?: AbortSignal) => {
    const r = await fetch("/api/tts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, pov }), signal });
    if (!r.ok) throw new Error(await r.text());
    return r.blob();
  },
  git: {
    status: () => j<GitStatus & { sync: SyncState }>("/api/git/status"),
    commit: (message: string) => j<{ ok: boolean; out: string }>("/api/git/commit", post({ message })),
    pull: () => j<SyncResult>("/api/git/pull", post()),
    push: () => j<{ ok: boolean; out: string }>("/api/git/push", post()),
    resolve: (resolutions: Record<string, string>) => j<SyncResult>("/api/git/resolve", post({ resolutions })),
    log: (path: string) => j<{ hash: string; when: string; subject: string }[]>("/api/git/log" + q({ path })),
    show: (hash: string, path: string) => j<{ content: string }>("/api/git/show" + q({ hash, path })),
  },
  wikiIndex: () => j<import("../shared/types").WikiIndex>("/api/wiki/index"),
  wikiPage: (path: string) => j<import("../shared/types").WikiPage>("/api/wiki/page" + q({ path })),
  wikiCreate: (title: string, category: string) => j<{ path: string }>("/api/wiki/create", post({ title, category })),
  /** Streams newline-delimited AiEvents from the agent. */
  claude: async (body: { action: string; selection: string; context?: string; chapter?: string; question?: string; instruction?: string; focus?: string[]; history?: { q: string; a: string }[] }, onEvent: (e: import("../shared/types").AiEvent) => void, signal?: AbortSignal) => {
    const r = await fetch("/api/claude", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
    if (!r.ok || !r.body) throw new Error(await r.text());
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    const flush = (line: string) => { if (!line.trim()) return; try { onEvent(JSON.parse(line)); } catch {} };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i; while ((i = buf.indexOf("\n")) >= 0) { flush(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    flush(buf);
  },
};
