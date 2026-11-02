export type ChapterMeta = {
  id: string; // folder name e.g. ch01-dust
  number: number;
  slug: string;
  title: string; // from first heading
  pov: string | null; // first capitalised name in first body line, if it matches an entity
  words: number;
  versions: number;
  mtime: number;
};

export type BibleFile = {
  path: string; // relative to book dir, e.g. bible/03-power-system.md
  title: string;
  words: number;
};

export type Tree = {
  bookDir: string;
  chapters: ChapterMeta[];
  bible: BibleFile[];
  other: BibleFile[];
};

export type Entity = {
  id: string; // slug, e.g. juno
  name: string; // "Juno Vale"
  short: string; // "Juno"
  aliases: string[]; // all matchable surface forms incl. name and short
  age: string | null;
  element: string | null;
  tier: string | null;
  oneLine: string | null;
  file: string | null; // bible path if it has its own cast file
  group: "main" | "antagonist" | "supporting";
};

export type Backlink = {
  file: string; // relative path
  kind: "chapter" | "bible";
  title: string;
  line: number; // 1-based line of the paragraph start
  text: string; // paragraph text
};

export type SearchHit = Backlink & { score: number };

export type VersionInfo = { file: string; label: string; stamp: string; words: number };

export type Fingerprint = {
  words: number;
  paragraphs: number;
  sentences: number;
  avgSentence: number;
  counts: Record<string, number>;
  per1k: Record<string, number>;
  sectionEnders: string[]; // last line of each --- section
};

export type GitStatus = {
  branch: string;
  ahead: number;
  behind: number;
  dirty: { status: string; path: string }[];
  last: { hash: string; subject: string; when: string } | null;
};

// ---------- studio data (lives in the book repo under studio/) ----------
export type ChapterStatus = "idea" | "outline" | "draft" | "revised" | "done";
export type ChapterExtra = { dayStart?: number | null; dayEnd?: number | null; beat?: string; turn?: string; endsWorse?: boolean | null; status?: ChapterStatus };
export type StudioChapters = { chapters: Record<string, ChapterExtra> };

export type Movement = { index: number; name: string; span: string; chapters: [number, number] | null };
export type OutlineRow = { number: number; pov: string; title: string | null; beats: string; movementIndex: number };
export type ParallelGrid = { columns: string[]; rows: { movement: string; cells: string[] }[] };
export type Outline = { movements: Movement[]; rows: OutlineRow[]; grid: ParallelGrid | null };
export type LockedNumber = { thing: string; value: string };

export type Secret = { id: string; label: string; keywords: string[]; knows: Record<string, number>; note?: string };
export type Knowledge = { characters: string[]; secrets: Secret[] };
export type KnowledgeFlag = { chapter: string; number: number; pov: string; secret: string; line: number; text: string; keyword: string };

export type LedgerEntry = { day: number; value: number; note?: string };
export type Resource = { id: string; label: string; unit: string; entries: LedgerEntry[] };
export type Ledger = { resources: Resource[] };

export type Settings = { hasKey: boolean; model: string; autoCommit: boolean; autoPush: boolean; autoPull: boolean; hasElevenKey: boolean; voices: Record<string, string>; ttsModel: string; dailyTarget: number; authorName: string; bookTitle: string; aiWrites: boolean; ttsProvider: "browser" | "elevenlabs"; browserVoices: Record<string, string>; browserRate: number };
export type Conflict = { path: string; mine: string; theirs: string; base: string };
export type SyncResult = { ok: boolean; action: "none" | "ff" | "merged" | "blocked" | "conflict" | "error" | "resolved" | "pushed" | "committed"; message: string; conflicts?: Conflict[] };
export type SyncState = { lastPull: { at: number; result: SyncResult } | null; lastPush: { at: number; ok: boolean; message: string } | null; pushPending: boolean };

export type Note = { id: string; file: string; quote: string; line: number; body: string; resolved: boolean; created: string; machine?: string };
export type Progress = { days: Record<string, { added: number; removed: number }>; today: string; target: number; streak: number; machines: string[] };
export type GraphData = {
  nodes: { id: string; label: string; entity: boolean; group: string }[];
  edges: { from: string; to: string; label: string; kind: "fault" | "bond"; note?: string; source: string }[];
};
export type NumberHit = { chapter: string; number: number; line: number; phrase: string; value: number; noun: string; matches: boolean; context: string };

export type AiSource = { file: string; line?: number; label: string };
export type AiEvent =
  | { t: "status"; label: string }
  | { t: "turn" }
  | { t: "text"; d: string }
  | { t: "step"; id: string; label: string; state: "running" | "done"; summary?: string; sources?: AiSource[] }
  | { t: "done"; ms: number; usage: { input: number; output: number; cached: number }; sources: AiSource[] }
  | { t: "error"; message: string };

export type StudioEvent = { t: "changed"; path: string; source: "studio" | "mcp" | "disk"; label?: string } | { t: "data"; key: string; source: "studio" | "mcp" } | { t: "goto"; path: string; line?: number } | { t: "agent"; a: AgentActivity } | { t: "hello" };
export type AgentActivity = {
  id: string; tool: string; state: "running" | "done" | "error"; label: string; at: number; ms?: number;
  path?: string; from?: number; to?: number; summary?: string; diff?: { old: string; new: string };
};
export type WikiIndex = { categories: { id: string; label: string }[]; pages: { path: string; title: string; words: number; category: string; edited: number; entity?: { id: string; short: string; age: string | null; element: string | null; group: string; oneLine: string | null } }[] };
export type WikiPage = {
  path: string; title: string; content: string; words: number; category: string;
  linksHere: { file: string; title: string; kind: "bible" | "chapter"; line: number; text: string }[];
  seeAlso: { path: string; title: string }[];
  entity?: { id: string; name: string; short: string; age: string | null; element: string | null; tier: string | null; group: string; oneLine: string | null; aliases: string[] };
  appears?: { counts: { number: number; title: string; path: string; count: number; pov: boolean }[]; first: { file: string; line: number; text: string } | null; samples: { file: string; title: string; line: number; text: string }[] };
  edited: { when: string; subject: string } | null;
};
