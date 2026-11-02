import { zipSync, strToU8 } from "fflate";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak } from "docx";
import { readText, tree } from "./book";

// ---------- markdown → blocks (only what the chapters use: headings, paragraphs, scene breaks, *em*, **strong**) ----------
type Run = { text: string; em?: boolean; strong?: boolean };
type Block = { t: "p" | "break"; runs: Run[]; first: boolean };
export type Chapter = { label: string; title: string; blocks: Block[] };

function runs(text: string): Run[] {
  const out: Run[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[2]) out.push({ text: m[2], strong: true }); else out.push({ text: m[3] ?? m[4], em: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.map((r) => ({ ...r, text: smart(r.text) }));
}
/** Typographic quotes and dashes for print. */
function smart(s: string) {
  return s
    .replace(/(^|[\s(\[—–-])"/g, "$1“").replace(/"/g, "”")
    .replace(/(^|[\s(\[—–-])'/g, "$1‘").replace(/'/g, "’")
    .replace(/\.\.\./g, "…").replace(/ -- /g, " — ");
}

export async function chapters(): Promise<Chapter[]> {
  const t = await tree();
  const out: Chapter[] = [];
  for (const c of t.chapters) {
    const md = (await readText(`chapters/${c.id}/LATEST.md`)).replace(/<!--[\s\S]*?-->/g, "");
    let label = `Chapter ${c.number}`, title = c.title;
    const blocks: Block[] = [];
    let first = true;
    for (const raw of md.split(/\r?\n\s*\r?\n/)) {
      const s = raw.trim();
      if (!s) continue;
      const h = s.match(/^#\s+(.+)$/);
      if (h) { const m = h[1].match(/^(Chapter\s+\d+)\s*[—–-]\s*(.+)$/i); if (m) { label = m[1]; title = m[2]; } else title = h[1]; continue; }
      if (/^#{2,}\s/.test(s)) continue;
      if (/^(-{3,}|\*{3,}|_{3,}|\*\s\*\s\*)$/.test(s)) { blocks.push({ t: "break", runs: [], first: false }); first = true; continue; }
      blocks.push({ t: "p", runs: runs(s.replace(/\s*\r?\n\s*/g, " ")), first });
      first = false;
    }
    out.push({ label, title, blocks });
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const html = (r: Run[]) => r.map((x) => (x.strong ? `<strong>${esc(x.text)}</strong>` : x.em ? `<em>${esc(x.text)}</em>` : esc(x.text))).join("");

// ---------- print view (Save as PDF from the browser) ----------
export async function printHtml(title: string, author: string) {
  const chs = await chapters();
  const body = chs.map((c) => `
<section class="chapter">
  <header><p class="label">${esc(c.label)}</p><h1>${esc(c.title)}</h1></header>
  ${c.blocks.map((b) => (b.t === "break" ? `<p class="break" aria-hidden="true">*&nbsp;&nbsp;*&nbsp;&nbsp;*</p>` : `<p${b.first ? ' class="first"' : ""}>${html(b.runs)}</p>`)).join("\n  ")}
</section>`).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&display=swap" rel="stylesheet">
<style>
  @page { size: 5.5in 8.5in; margin: 0.8in 0.65in 0.85in; }
  @page :first { margin-top: 2.5in; }
  :root { color-scheme: light; }
  html { background: #e9e6df; }
  body { font-family: "Literata", "Iowan Old Style", Georgia, serif; font-size: 10.5pt; line-height: 1.5; color: #141210; background: #fff; max-width: 5.5in; margin: 2rem auto; padding: 0.8in 0.65in; box-shadow: 0 2px 24px rgba(0,0,0,.12); hyphens: auto; -webkit-hyphens: auto; text-rendering: optimizeLegibility; font-variant-ligatures: common-ligatures; }
  .title { text-align: center; padding: 2in 0 0; break-after: page; }
  .title h1 { font-size: 26pt; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 0.6em; }
  .title p { font-size: 11pt; margin: 0; }
  .chapter { break-before: page; }
  .chapter header { text-align: center; margin: 1.4in 0 0.5in; }
  .label { font-size: 8.5pt; letter-spacing: 0.18em; text-transform: uppercase; margin: 0 0 0.5em; color: #5d5850; }
  h1 { font-size: 18pt; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  p { margin: 0; text-indent: 1.4em; text-align: justify; orphans: 2; widows: 2; }
  p.first { text-indent: 0; }
  p.break { text-align: center; text-indent: 0; margin: 0.9em 0; letter-spacing: 0.2em; }
  .title p, p.label { text-align: center; text-indent: 0; }
  .bar { position: fixed; top: 0; left: 0; right: 0; display: flex; gap: .75rem; justify-content: center; align-items: center; padding: .5rem; background: #15130f; color: #ece6da; font: 13px system-ui, sans-serif; }
  .bar button { font: inherit; padding: .3rem .8rem; border-radius: 6px; border: 1px solid #e0a458; background: transparent; color: inherit; cursor: pointer; }
  @media print { html { background: none; } body { margin: 0; padding: 0; max-width: none; box-shadow: none; } .bar { display: none; } }
</style></head><body>
<div class="bar"><span>Print view · trim 5.5 × 8.5 in</span><button onclick="print()">Save as PDF</button></div>
<section class="title"><h1>${esc(title)}</h1><p>${esc(author)}</p></section>
${body}
</body></html>`;
}

// ---------- EPUB 3 ----------
export async function epub(title: string, author: string): Promise<Uint8Array> {
  const chs = await chapters();
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const xhtml = (t: string, inner: string) => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en"><head><meta charset="utf-8"/><title>${esc(t)}</title><link rel="stylesheet" href="style.css"/></head><body>${inner}</body></html>`;
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": [strToU8(`<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`), { level: 6 }],
    "OEBPS/style.css": [strToU8(`body{font-family:serif;line-height:1.5;margin:0 5%}h1{text-align:center;font-weight:600;margin:3em 0 .3em}p.label{text-align:center;text-transform:uppercase;letter-spacing:.15em;font-size:.75em;margin:0;text-indent:0}p{margin:0;text-indent:1.4em}p.first{text-indent:0;margin-top:2em}p.break{text-align:center;text-indent:0;margin:1em 0}.title{text-align:center;margin-top:30%}.title p{text-indent:0}`), { level: 6 }],
    "OEBPS/title.xhtml": [strToU8(xhtml(title, `<section class="title" epub:type="titlepage"><h1>${esc(title)}</h1><p>${esc(author)}</p></section>`)), { level: 6 }],
  };
  chs.forEach((c, i) => {
    const inner = `<section epub:type="chapter"><p class="label">${esc(c.label)}</p><h1>${esc(c.title)}</h1>${c.blocks.map((b) => (b.t === "break" ? `<p class="break">* * *</p>` : `<p${b.first ? ' class="first"' : ""}>${html(b.runs)}</p>`)).join("")}</section>`;
    files[`OEBPS/ch${i + 1}.xhtml`] = [strToU8(xhtml(c.title, inner)), { level: 6 }];
  });
  const nav = `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chs.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${esc(c.label)}: ${esc(c.title)}</a></li>`).join("")}</ol></nav>`;
  files["OEBPS/nav.xhtml"] = [strToU8(xhtml("Contents", nav)), { level: 6 }];
  const manifest = [`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`, `<item id="css" href="style.css" media-type="text/css"/>`, `<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`, ...chs.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)].join("");
  const spine = [`<itemref idref="title"/>`, ...chs.map((_, i) => `<itemref idref="ch${i + 1}"/>`)].join("");
  files["OEBPS/content.opf"] = [strToU8(`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${id}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">${now}</meta></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`), { level: 6 }];
  return zipSync(files);
}

// ---------- DOCX (standard manuscript-ish: Georgia 12, 1.5 spacing, first-line indent, chapter per page) ----------
export async function docx(title: string, author: string): Promise<Uint8Array> {
  const chs = await chapters();
  const children: Paragraph[] = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 3600, after: 240 }, children: [new TextRun({ text: title, size: 48, bold: true })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: author, size: 24 })] }),
  ];
  for (const c of chs) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2400, after: 120 }, children: [new TextRun({ text: c.label.toUpperCase(), size: 18, characterSpacing: 40 })] }));
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: c.title, size: 36, bold: true })] }));
    for (const b of c.blocks) {
      if (b.t === "break") { children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 240 }, children: [new TextRun("*   *   *")] })); continue; }
      children.push(new Paragraph({
        indent: b.first ? undefined : { firstLine: 720 },
        spacing: { line: 360 },
        children: b.runs.map((r) => new TextRun({ text: r.text, italics: r.em, bold: r.strong })),
      }));
    }
  }
  const doc = new Document({
    creator: author, title,
    styles: { default: { document: { run: { font: "Georgia", size: 24 } } } },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}
