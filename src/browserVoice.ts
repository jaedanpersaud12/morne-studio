import { useEffect, useState } from "react";

/** The computer's own speech voices (free, offline for most). Edge on Windows adds Microsoft's natural voices. */
export function useBrowserVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => (typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices() : []));
  useEffect(() => {
    if (typeof speechSynthesis === "undefined") return;
    const load = () => setVoices(speechSynthesis.getVoices());
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
    return () => speechSynthesis.removeEventListener("voiceschanged", load);
  }, []);
  // English first; natural/neural voices first within that
  const score = (v: SpeechSynthesisVoice) => (v.lang.startsWith("en") ? 0 : 10) + (/natural|neural|online/i.test(v.name) ? 0 : 1);
  return [...voices].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

export const findVoice = (uri: string | undefined) => (uri && typeof speechSynthesis !== "undefined" ? speechSynthesis.getVoices().find((v) => v.voiceURI === uri) : undefined);

const keep = new Set<SpeechSynthesisUtterance>();

/** Speak one paragraph; resolves when it finishes (or is cancelled). */
export function speak(text: string, voiceURI: string | undefined, rate: number): Promise<void> {
  return new Promise((res) => {
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#>`]/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"));
    const v = findVoice(voiceURI);
    if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = Number.isFinite(rate) && rate > 0 ? rate : 1;
    u.onend = () => res(); u.onerror = () => res();
    keep.add(u); // Chrome drops utterances that nothing references, and then never fires onend
    const done = () => keep.delete(u);
    u.addEventListener("end", done); u.addEventListener("error", done);
    try { speechSynthesis.resume(); speechSynthesis.speak(u); } catch { res(); }
  });
}
