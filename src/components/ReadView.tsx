import { useMemo } from "react";
import { marked } from "marked";
import { goTo, useStore } from "../store";

/** Fully rendered markdown (tables, lists, links). Relative .md links open inside the Studio. */
export default function ReadView({ path, content }: { path: string; content: string }) {
  const setMode = useStore((s) => s.setMode);
  const html = useMemo(() => {
    const src = content.replace(/<!--[\s\S]*?-->/g, (m) => `<div class="md-comment">${m.slice(4, -3).trim().replace(/</g, "&lt;")}</div>`);
    return marked.parse(src, { gfm: true, breaks: false, async: false }) as string;
  }, [content]);

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a") as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (/^[a-z]+:/i.test(href)) { a.target = "_blank"; a.rel = "noreferrer"; return; } // external
    e.preventDefault();
    const [file] = href.split("#");
    if (!file) return;
    // resolve relative to the current file's folder
    const parts = path.split("/").slice(0, -1);
    for (const seg of file.split("/")) { if (seg === "..") parts.pop(); else if (seg && seg !== ".") parts.push(seg); }
    goTo(parts.join("/"));
  };

  return (
    <div className="h-full overflow-y-auto overscroll-contain" onDoubleClick={() => setMode("live")}>
      <article className="read-md max-w-[72ch] mx-auto px-6 pt-10 pb-[30vh]" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
