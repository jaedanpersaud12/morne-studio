/** Categorical slots from the dataviz reference palette, dark steps, validated on --panel #1b1914 (all checks pass).
 *  Colour follows the character, never their rank: fixed assignment, never cycled. */
const SLOTS: Record<string, string> = {
  juno: "#3987e5", fen: "#d95926", kit: "#199e70", tock: "#c98500",
  sol: "#d55181", lonny: "#008300", lyra: "#9085e9", judge: "#e66767",
};
const OTHER = "#7d7568";
export const povColor = (id: string | null | undefined) => (id && SLOTS[id.toLowerCase()]) || OTHER;
export const POV_ORDER = Object.keys(SLOTS);
