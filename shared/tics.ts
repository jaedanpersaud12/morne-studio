/** The tic list from bible/14-writing-rules.md ("Tics to count before saving a version"). Pure regex, no AI.
 *  Shared by the server (counts) and the client (highlighting). Every pattern is global. */
export const TICS: { id: string; label: string; source: string; flags: string }[] = [
  { id: "and", label: "and…and…and (3+ in a sentence)", source: String.raw`\b(?:[^.!?\n]*?\band\b){3,}[^.!?\n]*[.!?]`, flags: "g" },
  { id: "theway", label: "the way X did", source: String.raw`\bthe way (?:\w+ ){1,4}(?:did|had|would|does|do|said|used to)\b`, flags: "gi" },
  { id: "nobody", label: "nobody said anything / moved", source: String.raw`\bNobody (?:said anything|moved|spoke)\b`, flags: "g" },
  { id: "filter", label: "filter words (saw/heard/felt/noticed/realised/thought)", source: String.raw`\b(?:saw|heard|felt|noticed|realised|realized|thought|wondered)\b`, flags: "gi" },
  { id: "adverb", label: "adverb on said", source: String.raw`\bsaid \w+ly\b`, flags: "g" },
  { id: "glasses", label: "Juno's glasses", source: String.raw`\bglasses\b`, flags: "gi" },
  { id: "lonny", label: "Lonny eating", source: String.raw`\bLonny\b[^.]{0,80}\b(?:eat|eating|ate|chew|chewing|mouthful|tin|cereal|rice|bread|loaf)\b`, flags: "g" },
  { id: "okay", label: "Okay. Okay.", source: String.raw`\bOkay\. Okay\b`, flags: "g" },
  { id: "adding", label: "adding-up look", source: String.raw`\badding[- ]up\b`, flags: "gi" },
  { id: "enders", label: "one-line section enders", source: String.raw`(?:^|\n)[^\n]{1,80}\n+(?:---|\n#)`, flags: "g" },
];
export const ticRegex = (t: { source: string; flags: string }) => new RegExp(t.source, t.flags.includes("g") ? t.flags : t.flags + "g");
