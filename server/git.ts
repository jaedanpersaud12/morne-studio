import { BOOK } from "./book";
import type { GitStatus } from "../shared/types";

async function git(args: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const p = Bun.spawn(["git", ...args], { cwd: BOOK, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  return { ok: code === 0, out: out.trim(), err: err.trim() };
}

export async function status(): Promise<GitStatus> {
  const sb = await git(["status", "--porcelain=v1", "-b"]);
  const lines = sb.out.split("\n");
  const head = lines.shift() ?? "";
  const branch = head.match(/^## (\S+?)(?:\.\.\.|$)/)?.[1] ?? "?";
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0);
  const dirty = lines.filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim() || "M", path: l.slice(3) }));
  const lg = await git(["log", "-1", "--format=%h%x09%s%x09%cr"]);
  const [hash, subject, when] = lg.out.split("\t");
  return { branch, ahead, behind, dirty, last: hash ? { hash, subject, when } : null };
}

export async function commitAll(message: string) {
  await git(["add", "-A"]);
  const r = await git(["commit", "-q", "-m", message]);
  return r.ok ? { ok: true, out: r.out } : { ok: false, out: r.err || r.out };
}
export async function pull() {
  const r = await git(["pull", "--ff-only", "-q"]);
  return r.ok ? { ok: true, out: r.out || "up to date" } : { ok: false, out: r.err || r.out };
}
export async function push() {
  const r = await git(["push", "-q"]);
  return r.ok ? { ok: true, out: r.out || "pushed" } : { ok: false, out: r.err || r.out };
}
export async function fileLog(relPath: string) {
  const r = await git(["log", "--format=%h%x09%cr%x09%s", "-20", "--", relPath]);
  return r.out.split("\n").filter(Boolean).map((l) => { const [hash, when, subject] = l.split("\t"); return { hash, when, subject }; });
}
export async function showAt(hash: string, relPath: string) {
  const r = await git(["show", `${hash}:${relPath}`]);
  return r.ok ? r.out : "";
}
