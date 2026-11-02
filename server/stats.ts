import type { Fingerprint } from "../shared/types";

/** The tic list from bible/14-writing-rules.md ("Tics to count before saving a version"). Pure regex, no AI. */
const TICS: Record<string, RegExp> = {
  "and…and…and (3+ in a sentence)": /\b(?:[^.!?\n]*?\band\b){3,}[^.!?\n]*[.!?]/g,
  "the way X did": /\bthe way (?:\w+ ){1,4}(?:did|had|would|does|do|said|used to)\b/gi,
  "nobody said anything / moved": /\bNobody (?:said anything|moved|spoke)\b/g,
  "filter words (saw/heard/felt/noticed/realised/thought)": /\b(?:saw|heard|felt|noticed|realised|realized|thought|wondered)\b/gi,
  "adverb on said": /\bsaid \w+ly\b/g,
  "Juno's glasses": /\bglasses\b/gi,
  "Lonny eating": /\bLonny\b[^.]{0,80}\b(?:eat|eating|ate|chew|chewing|mouthful|tin|cereal|rice|bread|loaf)\b/g,
  "Okay. Okay.": /\bOkay\. Okay\b/g,
  "adding-up look": /\badding[- ]up\b/gi,
  "one-line section enders": /(?:^|\n)[^\n]{1,80}\n+(?:---|\n#)/g,
};

export function fingerprint(text: string): Fingerprint {
  const body = text.replace(/^#.*$/gm, "");
  const wordsN = (body.match(/\S+/g) ?? []).length;
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const sentences = (body.match(/[^.!?]+[.!?]+["”']?/g) ?? []).length || 1;
  const counts: Record<string, number> = {};
  const per1k: Record<string, number> = {};
  for (const [k, re] of Object.entries(TICS)) {
    const n = (body.match(re) ?? []).length;
    counts[k] = n;
    per1k[k] = Math.round((n / Math.max(wordsN, 1)) * 10000) / 10;
  }
  const sections = body.split(/\n---\n/);
  const sectionEnders = sections.map((s) => s.trim().split(/\n/).filter(Boolean).at(-1) ?? "").map((l) => l.slice(0, 120));
  return { words: wordsN, paragraphs, sentences, avgSentence: Math.round((wordsN / sentences) * 10) / 10, counts, per1k, sectionEnders };
}
