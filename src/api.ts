import type { Tree, Entity, Backlink, SearchHit, VersionInfo, Fingerprint, GitStatus } from "../shared/types";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "content-type": "application/json" }, ...init });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}
const q = (o: Record<string, string>) => "?" + new URLSearchParams(o).toString();

export const api = {
  tree: () => j<Tree>("/api/tree"),
  entities: () => j<Entity[]>("/api/entities"),
  file: (path: string) => j<{ path: string; content: string }>("/api/file" + q({ path })),
  save: (path: string, content: string) => j<{ ok: true; words: number }>("/api/file", { method: "PUT", body: JSON.stringify({ path, content }) }),
  search: (query: string) => j<SearchHit[]>("/api/search" + q({ q: query })),
  backlinks: (id: string) => j<Backlink[]>(`/api/backlinks/${id}`),
  presence: () => j<{ chapters: string[]; rows: { id: string; short: string; counts: number[] }[] }>("/api/presence"),
  versions: (chapter: string) => j<VersionInfo[]>(`/api/versions/${chapter}`),
  snapshot: (chapter: string, note: string) => j<{ file: string; label: string }>("/api/snapshot", { method: "POST", body: JSON.stringify({ chapter, note }) }),
  build: () => j<{ words: number; chapters: number }>("/api/build", { method: "POST" }),
  fingerprint: (path: string) => j<Fingerprint>("/api/fingerprint" + q({ path })),
  git: {
    status: () => j<GitStatus>("/api/git/status"),
    commit: (message: string) => j<{ ok: boolean; out: string }>("/api/git/commit", { method: "POST", body: JSON.stringify({ message }) }),
    pull: () => j<{ ok: boolean; out: string }>("/api/git/pull", { method: "POST" }),
    push: () => j<{ ok: boolean; out: string }>("/api/git/push", { method: "POST" }),
    log: (path: string) => j<{ hash: string; when: string; subject: string }[]>("/api/git/log" + q({ path })),
    show: (hash: string, path: string) => j<{ content: string }>("/api/git/show" + q({ hash, path })),
  },
};
