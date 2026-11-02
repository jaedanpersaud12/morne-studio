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
