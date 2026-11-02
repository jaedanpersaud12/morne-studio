import { getSettings, elevenKey } from "./settings";

/** ElevenLabs text-to-speech, proxied so the key stays on the server. TTS_MOCK=1 returns silent WAV for tests. */
export async function voices(): Promise<{ voice_id: string; name: string }[]> {
  if (process.env.TTS_MOCK === "1") return [{ voice_id: "mock-a", name: "Mock A" }, { voice_id: "mock-b", name: "Mock B" }];
  const key = await elevenKey();
  if (!key) throw new Error("No ElevenLabs API key. Add one in Settings.");
  const r = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": key } });
  if (!r.ok) throw new Error(`ElevenLabs: ${r.status} ${await r.text()}`);
  const j = (await r.json()) as { voices: { voice_id: string; name: string }[] };
  return j.voices.map((v) => ({ voice_id: v.voice_id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));
}

function silentWav(seconds: number) {
  const rate = 8000, n = Math.max(1, Math.round(rate * seconds));
  const buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const s = (o: number, str: string) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  s(0, "RIFF"); v.setUint32(4, 36 + n, true); s(8, "WAVE"); s(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
  return new Uint8Array(buf);
}

export async function speak(text: string, pov: string | null): Promise<Response> {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "").replace(/[#*_`>]/g, "").trim().slice(0, 4500);
  if (!clean) return new Response("nothing to read", { status: 400 });
  if (process.env.TTS_MOCK === "1") return new Response(new Blob([silentWav(Math.min(3, clean.split(/\s+/).length / 12)) as BlobPart]), { headers: { "content-type": "audio/wav" } });
  const key = await elevenKey();
  if (!key) return new Response("No ElevenLabs API key. Add one in Settings.", { status: 400 });
  const s = await getSettings();
  const voice = (pov && s.voices[pov]) || s.voices.default;
  if (!voice) return new Response("Pick a narration voice in Settings.", { status: 400 });
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: clean, model_id: s.ttsModel }),
  });
  if (!r.ok || !r.body) return new Response(`ElevenLabs: ${r.status} ${await r.text()}`, { status: 502 });
  return new Response(r.body, { headers: { "content-type": "audio/mpeg" } });
}
