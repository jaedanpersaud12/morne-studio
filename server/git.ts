import { BOOK, writeText } from "./book";
import { getSettings } from "./settings";
import type { GitStatus, SyncResult, SyncState, Conflict } from "../shared/types";

export async function git(args: string[], opts: { raw?: boolean } = {}): Promise<{ ok: boolean; out: string; err: string }> {
  const p = Bun.spawn(["git", ...args], { cwd: BOOK, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_MERGE_AUTOEDIT: "no" } });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  return { ok: code === 0, out: opts.raw ? out : out.trim(), err: err.trim() };
}

// one git operation at a time: saves, pulls and pushes never interleave
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

export async function status(): Promise<GitStatus> {
  const sb = await git(["status", "--porcelain=v1", "-b"]);
  const lines = sb.out.split("\n");
  const head = lines.shift() ?? "";
  const branch = head.match(/^## (?:No commits yet on )?(\S+?)(?:\.\.\.|$)/)?.[1] ?? "?";
  const ahead = Number(head.match(/ahead (\d+)/)?.[1] ?? 0);
  const behind = Number(head.match(/behind (\d+)/)?.[1] ?? 0);
  const dirty = lines.filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim() || "M", path: l.slice(3) }));
  const lg = await git(["log", "-1", "--format=%h%x09%s%x09%cr"]);
  const [hash, subject, when] = lg.out.split("\t");
  return { branch, ahead, behind, dirty, last: hash ? { hash, subject, when } : null };
}

const state: SyncState = { lastPull: null, lastPush: null, pushPending: false };
export const syncState = () => state;

async function hasUpstream() { return (await git(["rev-parse", "--abbrev-ref", "@{u}"])).ok; }
async function identityHint(err: string) {
  return /Please tell me who you are|empty ident|user\.email/i.test(err)
    ? 'Git doesn\'t know who you are on this machine. Run: git config --global user.name "Your Name" and git config --global user.email you@example.com'
    : err;
}

// ---------- manual actions ----------
export const commitAll = (message: string) => serial(async () => {
  await git(["add", "-A"]);
  const r = await git(["commit", "-q", "-m", message]);
  return r.ok ? { ok: true, out: "committed" } : { ok: false, out: await identityHint(r.err || r.out) };
});
export const push = () => serial(doPush);
async function doPush() {
  state.pushPending = false;
  if (!(await hasUpstream())) {
    const r = await git(["push", "-q", "-u", "origin", "HEAD"]);
    state.lastPush = { at: Date.now(), ok: r.ok, message: r.ok ? "pushed" : r.err };
    return { ok: r.ok, out: state.lastPush.message };
  }
  const r = await git(["push", "-q"]);
  state.lastPush = { at: Date.now(), ok: r.ok, message: r.ok ? "pushed" : r.err };
  return { ok: r.ok, out: state.lastPush.message };
}
export async function fileLog(relPath: string) {
  const r = await git(["log", "--format=%h%x09%cr%x09%s", "-20", "--", relPath]);
  return r.out.split("\n").filter(Boolean).map((l) => { const [hash, when, subject] = l.split("\t"); return { hash, when, subject }; });
}
export async function showAt(hash: string, relPath: string) {
  const r = await git(["show", `${hash}:${relPath}`], { raw: true });
  return r.ok ? r.out : "";
}

// ---------- automatic: commit on save, debounced push ----------
let pushTimer: ReturnType<typeof setTimeout> | null = null;
export function schedulePush(ms = 45_000) {
  state.pushPending = true;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; push().catch(() => {}); }, ms);
}

/** After a save: commit that one file. Repeated saves of the same file within 15 minutes, not yet pushed, amend one commit. */
export const afterSave = (relPath: string, label: string, extra: string[] = []) => serial(async (): Promise<SyncResult | null> => {
  const s = await getSettings();
  if (!s.autoCommit) return null;
  const paths = [relPath, ...extra];
  await git(["add", "--", ...paths]);
  if ((await git(["diff", "--cached", "--quiet", "--", relPath])).ok) return null;
  const msg = `studio: edit ${label}`;
  const head = await git(["log", "-1", "--format=%s%x09%ct"]);
  const [subj, ct] = head.out.split("\t");
  let unpushed = true;
  if (await hasUpstream()) unpushed = !(await git(["merge-base", "--is-ancestor", "HEAD", "@{u}"])).ok;
  const amend = head.ok && subj === msg && unpushed && Date.now() / 1000 - Number(ct) < 900;
  const r = await git(["commit", "-q", "--only", ...(amend ? ["--amend", "--no-edit"] : ["-m", msg]), "--", ...paths]);
  if (!r.ok) return { ok: false, action: "error", message: await identityHint(r.err || r.out) };
  if (s.autoPush) schedulePush();
  return { ok: true, action: "committed", message: amend ? "amended" : "committed" };
});

/** For Studio writes that touch several files (reorder, create) or data files: commit everything under the given paths. */
export const autoCommitPaths = (paths: string[], msg: string) => serial(async (): Promise<SyncResult | null> => {
  const s = await getSettings();
  if (!s.autoCommit) return null;
  await git(["add", "-A", "--", ...paths]);
  if ((await git(["diff", "--cached", "--quiet", "--", ...paths])).ok) return null;
  const head = await git(["log", "-1", "--format=%s%x09%ct"]);
  const [subj, ct] = head.out.split("\t");
  let unpushed = true;
  if (await hasUpstream()) unpushed = !(await git(["merge-base", "--is-ancestor", "HEAD", "@{u}"])).ok;
  const amend = head.ok && subj === msg && unpushed && Date.now() / 1000 - Number(ct) < 900;
  const r = await git(["commit", "-q", ...(amend ? ["--amend", "--no-edit"] : ["-m", msg]), "--", ...paths]);
  if (!r.ok) return { ok: false, action: "error", message: await identityHint(r.err || r.out) };
  if (s.autoPush) schedulePush();
  return { ok: true, action: "committed", message: amend ? "amended" : "committed" };
});

// ---------- pull, merge, conflicts ----------
async function collectConflicts(): Promise<Conflict[]> {
  const files = (await git(["diff", "--name-only", "--diff-filter=U"])).out.split("\n").filter(Boolean);
  const out: Conflict[] = [];
  for (const p of files) {
    // index stages during a merge: 1 = common base, 2 = ours (this machine), 3 = theirs (the other machine)
    const [base, mine, theirs] = await Promise.all([1, 2, 3].map((n) => git(["show", `:${n}:${p}`], { raw: true })));
    out.push({ path: p, mine: mine.ok ? mine.out : "", theirs: theirs.ok ? theirs.out : "", base: base.ok ? base.out : "" });
  }
  return out;
}

export const pull = () => serial(async (): Promise<SyncResult> => {
  const done = (result: SyncResult) => { state.lastPull = { at: Date.now(), result }; return result; };
  if (!(await hasUpstream())) return done({ ok: true, action: "none", message: "no remote branch to pull from" });
  let f = await git(["fetch", "-q"]);
  if (!f.ok && !/could not resolve host|unable to access/i.test(f.err)) { await Bun.sleep(1500); f = await git(["fetch", "-q"]); } // transient: a lock or a file another program held
  if (!f.ok) return done({ ok: false, action: "error", message: f.err || "fetch failed (offline?)" });
  let st = await status();
  if (st.behind === 0) return done({ ok: true, action: "none", message: st.ahead ? `up to date · ${st.ahead} to push` : "up to date" });
  const s = await getSettings();
  const dirtyTracked = st.dirty.filter((d) => d.status !== "??");
  if (dirtyTracked.length) {
    if (!s.autoCommit) return done({ ok: false, action: "blocked", message: `${dirtyTracked.length} uncommitted file(s); commit before pulling` });
    await git(["add", "-A"]);
    const c = await git(["commit", "-q", "-m", "studio: local changes before sync"]);
    if (!c.ok) return done({ ok: false, action: "error", message: await identityHint(c.err) });
    st = await status();
  }
  if (st.ahead === 0) {
    const r = await git(["merge", "--ff-only", "-q", "@{u}"]);
    return done(r.ok ? { ok: true, action: "ff", message: `pulled ${st.behind} commit${st.behind === 1 ? "" : "s"}` } : { ok: false, action: "error", message: r.err });
  }
  const m = await git(["merge", "--no-edit", "-q", "@{u}"]);
  if (m.ok) { if (s.autoPush) schedulePush(2000); return done({ ok: true, action: "merged", message: "merged changes from your other machine" }); }
  const conflicts = await collectConflicts();
  await git(["merge", "--abort"]);
  if (!conflicts.length) return done({ ok: false, action: "error", message: m.err || "merge failed" });
  return done({ ok: false, action: "conflict", message: `${conflicts.length} file${conflicts.length === 1 ? "" : "s"} changed on both machines`, conflicts });
});

/** Re-run the merge and write the author's chosen text for every conflicted file. */
export const resolve = (resolutions: Record<string, string>) => serial(async (): Promise<SyncResult> => {
  const m = await git(["merge", "--no-edit", "-q", "@{u}"]);
  if (m.ok) return { ok: true, action: "merged", message: "merged; nothing left to resolve" };
  const files = (await git(["diff", "--name-only", "--diff-filter=U"])).out.split("\n").filter(Boolean);
  const missing = files.filter((p) => !(p in resolutions));
  if (missing.length) { await git(["merge", "--abort"]); return { ok: false, action: "error", message: `no resolution for ${missing.join(", ")}` }; }
  for (const p of files) await writeText(p, resolutions[p]);
  await git(["add", "-A"]);
  const c = await git(["commit", "-q", "--no-edit"]);
  if (!c.ok) { await git(["merge", "--abort"]); return { ok: false, action: "error", message: await identityHint(c.err) }; }
  if ((await getSettings()).autoPush) schedulePush(2000);
  const result: SyncResult = { ok: true, action: "resolved", message: `resolved ${files.length} file${files.length === 1 ? "" : "s"}` };
  state.lastPull = { at: Date.now(), result };
  return result;
});
