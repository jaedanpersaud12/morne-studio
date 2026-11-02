import Anthropic from "@anthropic-ai/sdk";
import { readText, loadEntities } from "./book";
import { search } from "./index-db";
import { apiKey, getSettings } from "./settings";

export type ClaudeAction = "tighten" | "check" | "cost" | "describe" | "ask";

const TASKS: Record<ClaudeAction, string> = {
  tighten:
    "Revise the SELECTED passage so it obeys the writing rules. Keep the voice, point of view, tense, dialect, every fact and every beat. Cut filter words, narrator explanation, simile that does not change what the reader sees, and and-and-and chains in quiet passages. Return ONLY the revised passage, with the same paragraph breaks, and nothing else: no preamble, no quotes, no notes.",
  check:
    "Check the SELECTED passage against the bible. List every contradiction (names, ages, numbers, days, who knows what by this chapter, how powers work and what they cost) and every writing-rule breach, each as one line: the exact phrase in quotes, then what it breaks and where (bible file). If nothing is wrong, reply with one line saying so. Be terse; no praise.",
  cost:
    "Apply the rule from bible/14 'Decisions cost' to the SELECTED passage. In at most 120 words: what decision does the POV character make here, what did they choose it over, what does it cost them, and has the book left them an out that turns cost into cover? End with one concrete suggestion if there is an out.",
  describe:
    "Give three alternative versions of the SELECTED words, each grounded in a different sense (sight, sound, touch, smell or taste), in the book's register: plain words, close third, no simile. Numbered list, one line each, nothing else.",
  ask:
    "Answer the QUESTION about the book using only the bible and the manuscript excerpts provided. Cite chapter and line (e.g. 'ch 4 L99') or bible file for every claim. If the excerpts do not settle it, say what is missing. Be concise.",
};

async function bibleContext(selection: string): Promise<string> {
  const parts: string[] = [];
  for (const f of ["bible/14-writing-rules.md", "bible/19-imagery-and-threads.md", "bible/00-index.md"]) {
    try { parts.push(`<file path="${f}">\n${await readText(f)}\n</file>`); } catch {}
  }
  const ents = await loadEntities();
  const named = ents
    .filter((e) => e.file && e.file !== "bible/cast/supporting.md" && e.aliases.some((a) => new RegExp(`(?<![A-Za-z])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`).test(selection)))
    .slice(0, 5);
  for (const e of named) { try { parts.push(`<file path="${e.file}">\n${await readText(e.file!)}\n</file>`); } catch {} }
  return parts.join("\n\n");
}

const SYSTEM_HEAD = `You are the line editor for "Morne Bay", a YA novel set on a Caribbean island where every adult has fallen into an unwakeable sleep. The author writes it; you serve the author's voice and the story bible, never your own taste. The bible is law: if the text contradicts it, say so. Close third, past tense, light island English in dialogue, "said" only. Never invent canon.`;

export async function* run(opts: { action: ClaudeAction; selection: string; context?: string; chapter?: string; question?: string }): AsyncGenerator<string> {
  const { action } = opts;
  if (!(action in TASKS)) throw new Error("unknown action");

  if (process.env.CLAUDE_MOCK === "1") {
    const fake = action === "tighten" ? opts.selection.replace(/\b(had )?noticed that\b/gi, "noticed").replace(/\s{2,}/g, " ") : `Mock ${action} response for ${opts.selection.length} chars. ` + "Lorem ipsum dolor sit amet. ".repeat(6);
    for (const w of fake.match(/\S+\s*/g) ?? []) { await Bun.sleep(8); yield w; }
    return;
  }

  const key = await apiKey();
  if (!key) throw new Error("No Anthropic API key. Add one in Settings (gear icon).");
  const { model } = await getSettings();
  const client = new Anthropic({ apiKey: key });

  const bible = await bibleContext(`${opts.selection}\n${opts.context ?? ""}\n${opts.question ?? ""}`);
  let excerpts = "";
  if (action === "ask" && opts.question) {
    const hits = await search(opts.question, 30);
    excerpts = hits.map((h) => `<excerpt file="${h.file}" line="${h.line}">${h.text.replace(/[\u0001\u0002]/g, "")}</excerpt>`).join("\n");
  }
  const user = [
    opts.chapter ? `<chapter>${opts.chapter}</chapter>` : "",
    opts.context ? `<surrounding_text>\n${opts.context}\n</surrounding_text>` : "",
    opts.selection ? `<selected>\n${opts.selection}\n</selected>` : "",
    excerpts ? `<manuscript_excerpts>\n${excerpts}\n</manuscript_excerpts>` : "",
    opts.question ? `<question>${opts.question}</question>` : "",
    `<task>${TASKS[action]}</task>`,
  ].filter(Boolean).join("\n\n");

  const stream = client.messages.stream({
    model,
    max_tokens: action === "tighten" ? 4000 : 1500,
    system: [
      { type: "text", text: SYSTEM_HEAD },
      { type: "text", text: `<bible>\n${bible}\n</bible>`, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: user }],
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
  }
}
