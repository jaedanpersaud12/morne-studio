import Anthropic from "@anthropic-ai/sdk";
import { readText, loadEntities, tree } from "./book";
import { searchAny } from "./index-db";
import { apiKey, getSettings } from "./settings";
import { getKnowledge } from "./studio-data";
import type { AiEvent } from "../shared/types";

export type ClaudeAction = "tighten" | "rewrite" | "check" | "cost" | "describe" | "ask";

/**
 * The Studio's AI. Every action runs the same agent: Claude gets the core bible (cached) and, for the actions that need
 * facts, tools to search the manuscript and bible and read any passage. It works in rounds (search → read → answer)
 * and streams typed events so the UI can show each step, the answer, and the sources it consulted.
 */

const TASKS: Record<ClaudeAction, { prompt: string; tools: boolean; maxTokens: number }> = {
  tighten: {
    tools: false, maxTokens: 16000,
    prompt: "Revise the SELECTED passage so it obeys the writing rules. Keep the voice, point of view, tense, dialect, every fact and every beat. Cut filter words, narrator explanation, simile that does not change what the reader sees, and and-and-and chains in quiet passages. Return ONLY the revised passage with the same paragraph breaks: no preamble, no quotes, no notes.",
  },
  rewrite: {
    tools: false, maxTokens: 16000,
    prompt: "Revise the SELECTED passage following the author's INSTRUCTION, within the writing rules. Keep the voice, point of view, tense, dialect and every fact unless the instruction says otherwise. It must still read seamlessly with the surrounding text. Return ONLY the revised passage with its paragraph breaks: no preamble, no quotes, no notes.",
  },
  check: {
    tools: true, maxTokens: 16000,
    prompt: "Check the SELECTED passage against the bible and the earlier chapters. Use the tools to verify facts you are not sure of (names, ages, numbers, days, who knows what by this chapter, how powers work and what they cost). Then list every contradiction and every writing-rule breach as a markdown list: the exact phrase in quotes, what it breaks, and a citation. If nothing is wrong, say so in one line. Terse; no praise.",
  },
  cost: {
    tools: true, maxTokens: 12000,
    prompt: "Apply bible/14 'Decisions cost' to the SELECTED passage. In at most 150 words: what decision does the POV character make, what did they choose it over, what does it cost, and has the book left them an out that turns cost into cover? Look up earlier chapters if the decision depends on them. End with one concrete suggestion if there is an out.",
  },
  describe: {
    tools: false, maxTokens: 8000,
    prompt: "Give three alternative versions of the SELECTED words, each grounded in a different sense (sight, sound, touch, smell or taste), in the book's register: plain words, close third, no simile. A numbered list, one line each, nothing else.",
  },
  ask: {
    tools: true, maxTokens: 16000,
    prompt: "Answer the QUESTION about the book. Search before you answer: start broad, then read the passages that matter. Check both the chapters (what is on the page) and the bible (what is planned); say which is which. Do not narrate your searching; call tools, then write the answer. Use markdown: a direct answer first, then short supporting points. If the book does not settle it, say exactly what is and isn't on the page.",
  },
};

const CITE = `Cite every claim inline in square brackets, exactly in one of these forms: [ch 4 L99], [ch 4 L99-112], [bible/14-writing-rules.md], [bible/cast/kit.md L15]. Line numbers come from the tools. Never cite something you have not read.`;

const SYSTEM_HEAD = `You are the editor and continuity keeper for "Morne Bay", a YA novel set on a Caribbean island where every adult has fallen into an unwakeable sleep. The author writes it; you serve the author's voice and the story bible, never your own taste. The bible is law: if the text contradicts it, say so. Close third, past tense, light island English in dialogue, "said" only. Never invent canon. Chapters are canon over the bible wherever they disagree.`;

const QUICK = new Set<ClaudeAction>(["tighten", "rewrite", "describe"]);

// ---------------- tools ----------------
const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_book",
    description: "Full-text search over every chapter and every bible file. Returns matching paragraphs with file and line. Use short keyword queries (names, objects, places), not full sentences. Run several searches with different words when the first is thin.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Keywords, e.g. \"Kit mother\" or \"steel box shotgun\"" }, scope: { type: "string", enum: ["all", "chapters", "bible"] }, limit: { type: "integer", minimum: 1, maximum: 30 } }, required: ["query"] },
  },
  {
    name: "read_passage",
    description: "Read lines of a chapter or bible file, with line numbers. Use it to read around a search hit before relying on it. Chapter files look like chapters/ch04-ice/LATEST.md; bible files like bible/cast/kit.md.",
    input_schema: { type: "object", properties: { file: { type: "string" }, start_line: { type: "integer", minimum: 1 }, end_line: { type: "integer", minimum: 1 } }, required: ["file"] },
  },
  {
    name: "list_files",
    description: "List every chapter (number, title, POV, words, file) and every bible file. Use it to find the right file to read.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "who_knows",
    description: "The author's who-knows-what table: for each secret, the chapter each character learns it.",
    input_schema: { type: "object", properties: {} },
  },
];

type ToolOut = { text: string; summary: string; sources: { file: string; line?: number; label: string }[] };

async function chapterLabel(file: string) {
  const t = await tree();
  const c = t.chapters.find((x) => file === `chapters/${x.id}/LATEST.md`);
  return c ? `ch ${c.number} ${c.title}` : file.replace(/^bible\//, "");
}

async function runTool(name: string, input: any): Promise<ToolOut> {
  if (name === "search_book") {
    const hits = await searchAny(String(input.query ?? ""), { scope: input.scope, limit: Math.min(30, input.limit ?? 12) });
    if (!hits.length) return { text: "No matches. Try other words (synonyms, a name, an object).", summary: "no matches", sources: [] };
    const t = await tree();
    const label = (f: string) => { const c = t.chapters.find((x) => f === `chapters/${x.id}/LATEST.md`); return c ? `ch ${c.number}` : f; };
    const text = hits.map((h) => `[${label(h.file)} L${h.line}] (${h.file})\n${h.full}`).join("\n\n");
    return { text, summary: `${hits.length} passage${hits.length === 1 ? "" : "s"}`, sources: await Promise.all(hits.slice(0, 8).map(async (h) => ({ file: h.file, line: h.line, label: `${await chapterLabel(h.file)} L${h.line}` }))) };
  }
  if (name === "read_passage") {
    const file = String(input.file ?? "").replace(/^\/+/, "");
    if (!/^(chapters|bible)\/[\w./-]+\.md$/.test(file) || file.includes("..")) return { text: "Unknown file. Use list_files.", summary: "unknown file", sources: [] };
    let src: string;
    try { src = await readText(file); } catch { return { text: "File not found. Use list_files.", summary: "not found", sources: [] }; }
    const lines = src.split(/\r?\n/);
    const a = Math.max(1, Number(input.start_line) || 1);
    const b = Math.min(lines.length, Number(input.end_line) || a + 79, a + 199);
    const body = lines.slice(a - 1, b).map((l, i) => `${a + i}\t${l}`).join("\n");
    return { text: `${file} lines ${a}-${b} of ${lines.length}\n${body}`, summary: `${b - a + 1} lines`, sources: [{ file, line: a, label: `${await chapterLabel(file)} L${a}–${b}` }] };
  }
  if (name === "list_files") {
    const t = await tree();
    const text = ["CHAPTERS", ...t.chapters.map((c) => `ch ${c.number} "${c.title}" · POV ${c.pov ?? "?"} · ${c.words} words · chapters/${c.id}/LATEST.md`), "", "BIBLE", ...t.bible.map((b) => `${b.path} · ${b.title}`)].join("\n");
    return { text, summary: `${t.chapters.length} chapters, ${t.bible.length} bible files`, sources: [] };
  }
  if (name === "who_knows") {
    const k = await getKnowledge();
    const ents = await loadEntities();
    const nm = (id: string) => ents.find((e) => e.id === id)?.short ?? id;
    const text = k.secrets.map((s) => `${s.label}: ${Object.entries(s.knows).map(([w, ch]) => `${nm(w)} ch ${ch}`).join(", ") || "nobody yet"}${s.note ? ` (${s.note})` : ""}`).join("\n");
    return { text: text || "No secrets recorded.", summary: `${k.secrets.length} secrets`, sources: [{ file: "studio/knowledge.json", label: "Who knows" }] };
  }
  return { text: `Unknown tool ${name}`, summary: "unknown tool", sources: [] };
}

function stepLabel(name: string, input: any): string {
  if (name === "search_book") return `Searching “${((q: string) => (q.length > 60 ? q.slice(0, 58).trimEnd() + "…" : q))(String(input.query ?? ""))}”${input.scope && input.scope !== "all" ? ` in ${input.scope}` : ""}`;
  if (name === "read_passage") return `Reading ${String(input.file ?? "").replace(/^chapters\/ch0?(\d+)-[^/]+\/LATEST\.md$/, "ch $1").replace(/^bible\//, "")}${input.start_line ? ` L${input.start_line}${input.end_line ? `–${input.end_line}` : ""}` : ""}`;
  if (name === "list_files") return "Listing chapters and bible";
  if (name === "who_knows") return "Checking who knows what";
  return name;
}

// ---------------- context ----------------
async function coreBible(): Promise<string> {
  const parts: string[] = [];
  for (const f of ["bible/00-index.md", "bible/14-writing-rules.md", "bible/19-imagery-and-threads.md", "bible/cast/_overview.md"]) {
    try { parts.push(`<file path="${f}">\n${(await readText(f)).split(/\r?\n/).map((l, i) => `${i + 1}\t${l}`).join("\n")}\n</file>`); } catch {}
  }
  return parts.join("\n\n");
}
/** Files the author @-mentioned: read in full (numbered), capped so a long chapter can't crowd out the rest. */
async function focusFiles(paths: string[]): Promise<string> {
  const out: string[] = [];
  for (const p of [...new Set(paths)].slice(0, 4)) {
    if (!/^(chapters|bible)\/[\w./-]+\.md$/.test(p) || p.includes("..")) continue;
    const t = await readText(p).catch(() => null); if (t == null) continue;
    const lines = t.split("\n").slice(0, 700).map((l, i) => `${i + 1}\t${l}`).join("\n");
    out.push(`<file path="${p}">\n${lines.slice(0, 40000)}\n</file>`);
  }
  return out.join("\n");
}

async function castFor(text: string): Promise<string> {
  const ents = await loadEntities();
  const named = ents.filter((e) => e.file && e.file !== "bible/cast/supporting.md" && e.aliases.some((a) => new RegExp(`(?<![A-Za-z])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z])`).test(text))).slice(0, 4);
  const out: string[] = [];
  for (const e of named) { try { out.push(`<file path="${e.file}">\n${(await readText(e.file!)).split(/\r?\n/).map((l, i) => `${i + 1}\t${l}`).join("\n")}\n</file>`); } catch {} }
  return out.join("\n\n");
}

export type RunOpts = { action: ClaudeAction; selection: string; context?: string; chapter?: string; question?: string; instruction?: string; focus?: string[]; history?: { q: string; a: string }[] };

export async function* run(opts: RunOpts): AsyncGenerator<AiEvent> {
  const task = TASKS[opts.action];
  if (!task) throw new Error("unknown action");
  const started = Date.now();
  yield { t: "status", label: opts.action === "ask" ? "Thinking" : opts.action === "tighten" || opts.action === "rewrite" ? "Rewriting" : "Reading" };

  if (process.env.CLAUDE_MOCK === "1") { yield* mock(opts, task.tools, started); return; }

  const key = await apiKey();
  if (!key) throw new Error("No Anthropic API key. Add one in Settings (gear icon).");
  const { model } = await getSettings();
  const client = new Anthropic({ apiKey: key });

  const cast = await castFor(`${opts.selection}\n${opts.question ?? ""}\n${(opts.history ?? []).map((h) => h.q).join("\n")}`);
  const focus = await focusFiles(opts.focus ?? []);
  const userParts = [
    opts.chapter ? `<chapter>${opts.chapter}</chapter>` : "",
    cast ? `<cast_files>\n${cast}\n</cast_files>` : "",
    opts.context ? `<surrounding_text>\n${opts.context}\n</surrounding_text>` : "",
    opts.selection ? `<selected>\n${opts.selection}\n</selected>` : "",
    opts.question ? `<question>${opts.question}</question>` : "",
    opts.instruction ? `<instruction>${opts.instruction}</instruction>` : "",
    focus ? `<focus_files note="the author pointed at these with @">\n${focus}\n</focus_files>` : "",
    `<task>${task.prompt}${task.tools || opts.action === "ask" ? `\n${CITE}` : ""}</task>`,
  ].filter(Boolean).join("\n\n");

  const messages: Anthropic.MessageParam[] = [];
  for (const h of (opts.history ?? []).slice(-6)) { messages.push({ role: "user", content: `<question>${h.q}</question>` }, { role: "assistant", content: h.a }); }
  messages.push({ role: "user", content: userParts });

  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: SYSTEM_HEAD },
    { type: "text", text: `<bible_core>\n${await coreBible()}\n</bible_core>`, cache_control: { type: "ephemeral" } },
  ];
  const seen = new Map<string, { file: string; line?: number; label: string }>();
  let usage = { input: 0, output: 0, cached: 0 };

  let effortOk = true, wrote = false;
  for (let turn = 0; turn < 8; turn++) {
    const last = turn === 7;
    const params: any = { model, max_tokens: task.maxTokens, system, messages, ...(task.tools ? { tools: TOOLS, ...(last ? { tool_choice: { type: "none" as const } } : {}) } : {}) };
    // quick edits (tighten, rewrite, describe) don't need deep reasoning: ask for low effort so they come back fast
    if (QUICK.has(opts.action) && effortOk) params.output_config = { effort: "low" };
    let stream = client.messages.stream(params);
    yield { t: "turn" };
    let thinking = false;
    try {
      for await (const ev of stream) {
        if (ev.type === "content_block_start" && (ev.content_block.type === "thinking" || ev.content_block.type === "redacted_thinking") && !thinking) { thinking = true; yield { t: "status", label: "Thinking" }; }
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { if (ev.delta.text.trim()) wrote = true; yield { t: "text", d: ev.delta.text }; }
      }
    } catch (e: any) {
      // a model that rejects the effort setting: drop it and retry this turn once
      if (params.output_config && /effort|output_config/i.test(String(e?.message))) { effortOk = false; turn--; continue; }
      throw e;
    }
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "max_tokens" && !msg.content.some((b) => b.type === "text" && b.text.trim())) throw new Error("Claude ran out of room before writing an answer. Try a shorter selection, or pick a different model in Settings.");
    if (msg.stop_reason === "refusal") throw new Error("Claude declined this one. Try rephrasing.");
    usage = { input: usage.input + msg.usage.input_tokens, output: usage.output + msg.usage.output_tokens, cached: usage.cached + (msg.usage.cache_read_input_tokens ?? 0) };
    messages.push({ role: "assistant", content: msg.content });
    if (msg.stop_reason !== "tool_use") break;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of msg.content) {
      if (b.type !== "tool_use") continue;
      yield { t: "step", id: b.id, label: stepLabel(b.name, b.input), state: "running" };
      const out = await runTool(b.name, b.input).catch((e) => ({ text: `Tool error: ${e.message}`, summary: "error", sources: [] } as ToolOut));
      out.sources.forEach((s) => seen.set(`${s.file}:${s.line ?? ""}`, s));
      yield { t: "step", id: b.id, label: stepLabel(b.name, b.input), state: "done", summary: out.summary, sources: out.sources };
      results.push({ type: "tool_result", tool_use_id: b.id, content: out.text });
    }
    messages.push({ role: "user", content: results });
  }
  if (!wrote) throw new Error("Claude finished without writing anything. Try again.");
  yield { t: "done", ms: Date.now() - started, usage, sources: [...seen.values()].slice(0, 12) };
}

// ---------------- mock (CLAUDE_MOCK=1): real tools, scripted model ----------------
async function* mock(opts: RunOpts, tools: boolean, started: number): AsyncGenerator<AiEvent> {
  const words = async function* (s: string) { for (const w of s.match(/\S+\s*/g) ?? []) { await Bun.sleep(6); yield { t: "text", d: w } as AiEvent; } };
  if (opts.action === "tighten" || opts.action === "rewrite") { yield { t: "turn" }; yield* words(opts.selection.replace(/\bvery /gi, "").replace(/\b(had )?noticed that\b/gi, "noticed").replace(/\s{2,}/g, " ")); yield { t: "done", ms: Date.now() - started, usage: { input: 0, output: 0, cached: 0 }, sources: [] }; return; }
  if (opts.action === "describe") { yield { t: "turn" }; yield* words(`1. The light went thin and grey over the yard.\n2. Somewhere below, the generator coughed once and kept on.\n3. The rail was cold enough to sting her palm.\n`); yield { t: "done", ms: Date.now() - started, usage: { input: 0, output: 0, cached: 0 }, sources: [] }; return; }
  const seen: { file: string; line?: number; label: string }[] = [];
  let firstHit: { file: string; line: number } | null = null;
  if (tools) {
    const q = opts.question ?? opts.selection.split(/\s+/).slice(0, 4).join(" ");
    for (const [i, call] of [["search_book", { query: q }], ["read_passage", null]].entries()) {
      const [name, inp] = call as [string, any];
      let input = inp;
      if (name === "read_passage") { if (!firstHit) break; input = { file: firstHit.file, start_line: Math.max(1, firstHit.line - 3), end_line: firstHit.line + 12 }; }
      const id = `mock${i}`;
      yield { t: "turn" };
      yield { t: "step", id, label: stepLabel(name, input), state: "running" };
      await Bun.sleep(120);
      const out = await runTool(name, input);
      if (name === "search_book") { const m = out.text.match(/\((\S+\.md)\)/); const l = out.text.match(/ L(\d+)\]/); if (m && l) firstHit = { file: m[1], line: Number(l[1]) }; }
      seen.push(...out.sources);
      yield { t: "step", id, label: stepLabel(name, input), state: "done", summary: out.summary, sources: out.sources };
    }
  }
  yield { t: "turn" };
  const cite = seen[0] ? `[${seen[0].label.replace(/^ch (\d+) .*? (L\d+).*$/, "ch $1 $2")}]` : "";
  const quote = opts.selection ? `\n- "${opts.selection.split(/\s+/).slice(0, 4).join(" ")}" is quoted from the selection.` : "";
  const focusNote = opts.focus?.length ? `\n- Focus files: ${opts.focus.join(", ")}.` : "";
  yield* words(`**Mock answer.** The first passage the search found is the place to start ${cite}.\n\n- It was read in full before answering.\n- Citations link back to the text.${quote}${focusNote}\n`);
  yield { t: "done", ms: Date.now() - started, usage: { input: 0, output: 0, cached: 0 }, sources: seen.slice(0, 12) };
}
