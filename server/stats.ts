import type { Fingerprint } from "../shared/types";
import { TICS, ticRegex } from "../shared/tics";

export function fingerprint(text: string): Fingerprint {
  const body = text.replace(/^#.*$/gm, "");
  const wordsN = (body.match(/\S+/g) ?? []).length;
  const paragraphs = body.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const sentences = (body.match(/[^.!?]+[.!?]+["”']?/g) ?? []).length || 1;
  const counts: Record<string, number> = {};
  const per1k: Record<string, number> = {};
  for (const t of TICS) {
    const n = (body.match(ticRegex(t)) ?? []).length;
    counts[t.id] = n;
    per1k[t.id] = Math.round((n / Math.max(wordsN, 1)) * 10000) / 10;
  }
  const sections = body.split(/\n---\n/);
  const sectionEnders = sections.map((s) => s.trim().split(/\n/).filter(Boolean).at(-1) ?? "").map((l) => (l.length > 140 ? l.slice(0, 140).replace(/\s+\S*$/, "") + "…" : l));
  return { words: wordsN, paragraphs, sentences, avgSentence: Math.round((wordsN / sentences) * 10) / 10, counts, per1k, sectionEnders };
}
