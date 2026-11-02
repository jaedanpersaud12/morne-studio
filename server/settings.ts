import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Settings } from "../shared/types";

/** Per-machine settings. studio.local.json is gitignored: the API key never enters a repo. */
const FILE = path.resolve(import.meta.dir, "..", "studio.local.json");
type Stored = { anthropicApiKey?: string; model?: string; autoCommit?: boolean; autoPush?: boolean; autoPull?: boolean };

export const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"];

async function read(): Promise<Stored> {
  try { return JSON.parse(await readFile(FILE, "utf8")); } catch { return {}; }
}
export async function apiKey(): Promise<string | null> {
  return (await read()).anthropicApiKey || process.env.ANTHROPIC_API_KEY || null;
}
export async function getSettings(): Promise<Settings> {
  const s = await read();
  return {
    hasKey: !!(s.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    model: s.model || process.env.CLAUDE_MODEL || MODELS[0],
    autoCommit: s.autoCommit ?? true,
    autoPush: s.autoPush ?? true,
    autoPull: s.autoPull ?? true,
  };
}
export async function putSettings(patch: Partial<Stored>) {
  const s = await read();
  const next: Stored = { ...s };
  if (typeof patch.anthropicApiKey === "string") next.anthropicApiKey = patch.anthropicApiKey.trim() || undefined;
  if (typeof patch.model === "string" && MODELS.includes(patch.model)) next.model = patch.model;
  for (const k of ["autoCommit", "autoPush", "autoPull"] as const) if (typeof patch[k] === "boolean") next[k] = patch[k];
  await writeFile(FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  return getSettings();
}
