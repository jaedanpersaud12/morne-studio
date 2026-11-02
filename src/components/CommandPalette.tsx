import { useEffect, useState } from "react";
import { Command } from "cmdk";
import { Dialog } from "@base-ui/react/dialog";
import { useQuery } from "@tanstack/react-query";
import { BookMarked, BookOpen, CalendarRange, Focus, Hammer, Kanban, Network, PenLine, Scale, Search, Settings, Sparkles, UsersRound, FileText, CornerDownLeft } from "lucide-react";
import { api } from "../api";
import { goTo, openWiki, useStore, type View } from "../store";
import { renderMarks } from "./Sidebar";

const VIEW_ITEMS: { id: View; label: string; icon: React.ReactNode }[] = [
  { id: "write", label: "Write", icon: <PenLine size={15} /> },
  { id: "board", label: "Board", icon: <Kanban size={15} /> },
  { id: "timeline", label: "Timeline", icon: <CalendarRange size={15} /> },
  { id: "knowledge", label: "Who knows what", icon: <UsersRound size={15} /> },
  { id: "ledger", label: "Ledger", icon: <Scale size={15} /> },
  { id: "map", label: "Map", icon: <Network size={15} /> },
  { id: "wiki", label: "Wiki", icon: <BookMarked size={15} /> },
];

/** Ctrl+P: jump to any chapter, bible page, character or view, run an action, or search the full text. */
export default function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = (o: boolean) => useStore.setState({ paletteOpen: o });
  const [q, setQ] = useState("");
  const { data: tree } = useQuery({ queryKey: ["tree"], queryFn: api.tree });
  const { data: entities = [] } = useQuery({ queryKey: ["entities"], queryFn: api.entities });
  const { data: hits = [] } = useQuery({ queryKey: ["search", q], queryFn: () => api.search(q), enabled: open && q.trim().length > 2 });
  useEffect(() => { if (!open) setQ(""); }, [open]);

  const run = (f: () => void) => { setOpen(false); requestAnimationFrame(f); };
  const st = useStore.getState;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ui-backdrop ui-backdrop-light" />
        <Dialog.Popup className="ui-palette" aria-label="Command palette">
          <Command loop label="Command palette" shouldFilter>
            <div className="ui-palette-input">
              <Search size={16} aria-hidden />
              <Command.Input value={q} onValueChange={setQ} placeholder="Jump to a chapter, character or view… or search the text" autoFocus />
              <kbd className="ui-kbd">Esc</kbd>
            </div>
            <Command.List className="ui-palette-list">
              <Command.Empty className="ui-palette-empty">Nothing matches. Keep typing to search the full text.</Command.Empty>
              <Command.Group heading="Chapters">
                {tree?.chapters.map((c) => (
                  <Command.Item key={c.id} value={`ch ${c.number} ${c.title} ${c.pov ?? ""}`} onSelect={() => run(() => goTo(`chapters/${c.id}/LATEST.md`))}>
                    <span className="ui-palette-num num">{c.number}</span><span className="flex-1 truncate">{c.title}</span>
                    {c.pov && <span className="pov" data-pov={c.pov}>{c.pov}</span>}<span className="ui-palette-meta num">{(c.words / 1000).toFixed(1)}k</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Characters">
                {entities.filter((e) => e.file).map((e) => (
                  <Command.Item key={e.id} value={`character ${e.name} ${e.aliases.join(" ")}`} onSelect={() => run(() => { if (e.file) openWiki(e.file); else { st().setView("write"); st().setPanel("cast"); st().setEntity(e.id); } })}>
                    <UsersRound size={15} aria-hidden /><span className="flex-1 truncate">{e.name}</span><span className="ui-palette-meta">{e.element ?? e.group}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Bible">
                {tree?.bible.map((b) => (
                  <Command.Item key={b.path} value={`bible wiki ${b.title} ${b.path}`} onSelect={() => run(() => openWiki(b.path))}>
                    <BookMarked size={15} aria-hidden /><span className="flex-1 truncate">{b.title.replace(/^\d+\.\s*/, "")}</span><span className="ui-palette-meta">{b.path.includes("/cast/") ? "cast" : "bible"}</span>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Go to">
                {VIEW_ITEMS.map((v, i) => (
                  <Command.Item key={v.id} value={`view ${v.label}`} onSelect={() => run(() => st().setView(v.id))}>
                    {v.icon}<span className="flex-1">{v.label}</span><kbd className="ui-kbd">Ctrl {i + 1}</kbd>
                  </Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions">
                <Command.Item value="ask claude about the book" onSelect={() => run(() => { st().setView("write"); st().setPanel("claude"); setTimeout(() => (document.querySelector(".ai-composer textarea") as HTMLElement | null)?.focus(), 60); })}><Sparkles size={15} aria-hidden /><span className="flex-1">Ask the book</span></Command.Item>
                <Command.Item value="focus mode toggle" onSelect={() => run(() => st().toggleFocus())}><Focus size={15} aria-hidden /><span className="flex-1">Toggle focus mode</span><kbd className="ui-kbd">Ctrl \</kbd></Command.Item>
                <Command.Item value="build manuscript full.md" onSelect={() => run(async () => { const r = await api.build(); st().say(`Built manuscript/full.md · ${r.words.toLocaleString()} words`); })}><Hammer size={15} aria-hidden /><span className="flex-1">Build manuscript</span></Command.Item>
                <Command.Item value="read print export pdf epub docx" onSelect={() => run(() => window.open("/api/export/print", "_blank"))}><BookOpen size={15} aria-hidden /><span className="flex-1">Print / export the book</span></Command.Item>
                <Command.Item value="settings api key model voices" onSelect={() => run(() => st().setSettingsOpen(true))}><Settings size={15} aria-hidden /><span className="flex-1">Settings</span></Command.Item>
              </Command.Group>
              {hits.length > 0 && (
                <Command.Group heading={`In the text · ${hits.length}`} forceMount>
                  {hits.slice(0, 12).map((h, i) => (
                    <Command.Item key={`${h.file}:${h.line}:${i}`} value={`hit ${i} ${q}`} forceMount onSelect={() => run(() => goTo(h.file, h.line))} className="ui-palette-hit">
                      <FileText size={15} aria-hidden className="mt-0.5" />
                      <span className="flex-1 min-w-0">
                        <span className="ui-palette-meta block">{h.kind === "chapter" ? "ch" : "bible"} · {h.title.replace(/^\d+\.\s*/, "")} · L{h.line}</span>
                        <span className="line-clamp-2 text-[13px] leading-snug text-[var(--fg-dim)]">{renderMarks(h.text)}</span>
                      </span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
            <div className="ui-palette-foot"><span><kbd className="ui-kbd">↑↓</kbd> move</span><span><kbd className="ui-kbd"><CornerDownLeft size={10} /></kbd> open</span><span className="ml-auto">Ctrl P</span></div>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
