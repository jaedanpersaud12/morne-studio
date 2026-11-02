import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Settings } from "../shared/types";

/** Per-machine settings. studio.local.json is gitignored: API keys never enter a repo. */
const FILE = path.resolve(import.meta.dir, "..", "studio.local.json");
type Stored = {
  anthropicApiKey?: string; model?: string;
  autoCommit?: boolean; autoPush?: boolean; autoPull?: boolean;
  elevenLabsApiKey?: string; voices?: Record<string, string>; ttsModel?: string;
  dailyTarget?: number; authorName?: string; bookTitle?: string;
  aiWrites?: boolean;
};

export const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-fable-5-1"];
export const TTS_MODELS = ["eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_turbo_v2_5"];

async function read(): Promise<Stored> {
  try { return JSON.parse(await readFile(FILE, "utf8")); } catch { return {}; }
}
export async function apiKey(): Promise<string | null> {
  return (await read()).anthropicApiKey || process.env.ANTHROPIC_API_KEY || null;
}
export async function elevenKey(): Promise<string | null> {
  return (await read()).elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || null;
}
export async function getSettings(): Promise<Settings> {
  const s = await read();
  return {
    hasKey: !!(s.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
    model: s.model || process.env.CLAUDE_MODEL || MODELS[0],
    autoCommit: s.autoCommit ?? true,
    autoPush: s.autoPush ?? true,
    autoPull: s.autoPull ?? true,
    hasElevenKey: !!(s.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY || process.env.TTS_MOCK === "1"),
    voices: s.voices ?? {},
    ttsModel: s.ttsModel || TTS_MODELS[0],
    dailyTarget: s.dailyTarget ?? 500,
    authorName: s.authorName ?? "",
    bookTitle: s.bookTitle ?? "Morne Bay",
    aiWrites: s.aiWrites ?? true,
  };
}
export async function putSettings(patch: Partial<Stored>) {
  const s = await read();
  const next: Stored = { ...s };
  for (const k of ["anthropicApiKey", "elevenLabsApiKey"] as const) if (typeof patch[k] === "string") next[k] = patch[k]!.trim() || undefined;
  if (typeof patch.model === "string" && MODELS.includes(patch.model)) next.model = patch.model;
  if (typeof patch.ttsModel === "string" && TTS_MODELS.includes(patch.ttsModel)) next.ttsModel = patch.ttsModel;
  for (const k of ["autoCommit", "autoPush", "autoPull", "aiWrites"] as const) if (typeof patch[k] === "boolean") next[k] = patch[k];
  if (typeof patch.dailyTarget === "number" && patch.dailyTarget > 0 && patch.dailyTarget < 100000) next.dailyTarget = Math.round(patch.dailyTarget);
  for (const k of ["authorName", "bookTitle"] as const) if (typeof patch[k] === "string") next[k] = patch[k]!.slice(0, 120);
  if (patch.voices && typeof patch.voices === "object") next.voices = { ...(s.voices ?? {}), ...patch.voices };
  await writeFile(FILE, JSON.stringify(next, null, 2) + "\n", "utf8");
  return getSettings();
}
