import { request } from "./bridge";
import { getCurrentRepo } from "./repos";
import { showContextMenu } from "./contextMenu";
import type { WorkingTreeView, WorkingTreeFile } from "./types";

interface FileChange { path: string; status: string; added: number; deleted: number; }
interface Ref { name: string; kind: string; }
interface CommitDetails {
  sha: string; shortSha: string; author: string; email: string; whenIso: string;
  message: string; refs: Ref[]; files: FileChange[]; diff: string; diffTruncated: boolean;
}

const metaEl = () => document.getElementById("detail-meta") as HTMLElement;
const filesEl = () => document.getElementById("detail-files") as HTMLElement;
const bodyEl = () => document.getElementById("diff-body") as HTMLElement; // diff scroll + content

// Guards against out-of-order responses when arrowing through commits quickly.
let seq = 0;
let diffMode: "unified" | "split" = "unified";
let lastDetails: CommitDetails | null = null;
let lastWipFiles: WorkingTreeFile[] | null = null;
let selectedFileIdx = -1;
let totalFiles = 0;

export function initFileNav(): void {
  const el = filesEl();
  el.addEventListener("keydown", (e) => {
    if (totalFiles === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); selectFile(Math.min(totalFiles - 1, selectedFileIdx + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selectFile(Math.max(0, selectedFileIdx - 1)); }
  });
}

function selectFile(idx: number): void {
  selectedFileIdx = idx;
  filesEl().querySelectorAll<HTMLElement>(".fitem[data-idx]").forEach((el) =>
    el.classList.toggle("sel", Number(el.dataset.idx) === idx),
  );
  filesEl().querySelector<HTMLElement>(`.fitem[data-idx="${idx}"]`)?.scrollIntoView({ block: "nearest" });
  activateFile(idx);
}

function activateFile(idx: number): void {
  if (lastWipFiles) {
    const f = lastWipFiles[idx];
    if (!f) return;
    renderPatchString(f.patch);
  } else {
    document.getElementById(`diffsec-${idx}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

function renderPatchString(patch: string): void {
  const html = diffMode === "split" ? renderSplit(patch) : `<div class="diff-wrap">${renderUnified(patch)}</div>`;
  bodyEl().innerHTML = html || `<div class="trunc">no textual diff</div>`;
  bodyEl().scrollTop = 0;
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

// Wire the Unified/Split toggle. onChange persists the choice.
export function initDiffToolbar(initial: string, onChange: (mode: string) => void): void {
  diffMode = initial === "split" ? "split" : "unified";
  const buttons = document.querySelectorAll<HTMLButtonElement>("#diff-toolbar .seg button");
  const sync = () => buttons.forEach((b) => b.classList.toggle("active", b.dataset.mode === diffMode));
  sync();
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      const m = b.dataset.mode === "split" ? "split" : "unified";
      if (m === diffMode) return;
      diffMode = m;
      sync();
      if (lastWipFiles && selectedFileIdx >= 0) activateFile(selectedFileIdx);
      else if (lastDetails) renderDiff(lastDetails);
      onChange(m);
    }),
  );
}

export async function showCommit(sha: string): Promise<void> {
  const my = ++seq;
  lastWipFiles = null;
  try {
    const d = await request<CommitDetails>("getCommitDetails", { sha, repoPath: getCurrentRepo() });
    if (my !== seq) return;
    lastDetails = d;
    renderMeta(d);
    renderFiles(d);
    renderDiff(d);
  } catch (e) {
    if (my !== seq) return;
    metaEl().innerHTML = `<span class="when">error: ${esc(e instanceof Error ? e.message : String(e))}</span>`;
    filesEl().innerHTML = "";
    bodyEl().innerHTML = "";
  }
}

export async function showWorkingTree(repo: string): Promise<void> {
  const my = ++seq;
  lastDetails = null;
  metaEl().innerHTML = `<span class="subject">Working tree changes</span>`;
  filesEl().innerHTML = "";
  bodyEl().innerHTML = "";
  try {
    const view = await request<WorkingTreeView>("getWorkingTree", { repoPath: repo });
    if (my !== seq) return;
    renderWipMeta(view);
    renderWipFiles(view);
  } catch (e) {
    if (my !== seq) return;
    metaEl().innerHTML = `<span class="when">error: ${esc(e instanceof Error ? e.message : String(e))}</span>`;
  }
}

function renderWipMeta(view: WorkingTreeView): void {
  const s = view.staged.length;
  const u = view.unstaged.length;
  metaEl().innerHTML =
    `<div class="subject">Working tree changes</div>` +
    (s > 0 ? `<div><span class="sha">${s} staged</span></div>` : "") +
    (u > 0 ? `<div><span class="when">${u} unstaged</span></div>` : "");
}

function renderWipFiles(view: WorkingTreeView): void {
  const allFiles = [...view.staged, ...view.unstaged];
  lastWipFiles = allFiles;
  totalFiles = allFiles.length;
  selectedFileIdx = -1;

  let html = "";
  if (view.staged.length > 0) {
    html += `<div class="fhead">Staged changes</div>`;
    html += view.staged.map((f, i) => wipFileItem(f, i)).join("");
  }
  if (view.unstaged.length > 0) {
    html += `<div class="fhead">Unstaged changes</div>`;
    const off = view.staged.length;
    html += view.unstaged.map((f, i) => wipFileItem(f, off + i)).join("");
  }
  if (allFiles.length === 0) {
    html = `<div class="fitem muted">No changes in working tree</div>`;
  }

  const el = filesEl();
  el.innerHTML = html;
  el.querySelectorAll<HTMLElement>(".fitem[data-idx]").forEach((item) => {
    item.addEventListener("click", () => {
      selectFile(parseInt(item.dataset.idx!));
      el.focus({ preventScroll: true });
    });
  });
}

function wipFileItem(f: WorkingTreeFile, idx: number): string {
  const cls = f.status === "A" ? "st-add" : f.status === "D" || f.status === "?" ? "st-del" : "st-mod";
  const indicator = f.staged
    ? `<span class="fnums adds" title="staged">●</span>`
    : `<span class="fnums dels" title="unstaged">○</span>`;
  return `<div class="fitem" data-idx="${idx}" title="${esc(f.path)}">` +
    `<span class="fstat ${cls}">${esc(f.status)}</span>` +
    `<span class="fpath">${esc(f.path)}</span>` +
    indicator +
    `</div>`;
}

function renderMeta(d: CommitDetails): void {
  const when = d.whenIso ? new Date(d.whenIso).toLocaleString() : "";
  const subject = d.message.split("\n", 1)[0];
  const body = d.message.slice(subject.length).trim();
  const chips = d.refs.map((r) => `<span class="chip">${esc(r.name)}</span>`).join("");
  metaEl().innerHTML =
    `<div>${chips}<span class="sha">${esc(d.sha)}</span></div>` +
    `<div class="who">${esc(d.author)} &lt;${esc(d.email)}&gt; <span class="when">· ${esc(when)}</span></div>` +
    `<div class="subject">${esc(subject)}</div>` +
    (body ? `<div>${esc(body)}</div>` : "");
}

function statusInfo(status: string): { glyph: string; cls: string } {
  switch (status) {
    case "Added": return { glyph: "A", cls: "st-add" };
    case "Deleted": return { glyph: "D", cls: "st-del" };
    case "Renamed": return { glyph: "R", cls: "st-ren" };
    case "Copied": return { glyph: "C", cls: "st-ren" };
    default: return { glyph: "M", cls: "st-mod" };
  }
}

// Vertical, clickable file list. Clicking a file scrolls the diff to its section (the diff's
// `diff --git` headers are tagged with matching ids, in the same order as files[]).
function renderFiles(d: CommitDetails): void {
  selectedFileIdx = -1;
  totalFiles = d.files.length;
  if (d.files.length === 0) {
    filesEl().innerHTML = `<div class="fitem muted">no file changes</div>`;
    return;
  }
  filesEl().innerHTML =
    `<div class="fhead">${d.files.length} file${d.files.length === 1 ? "" : "s"} changed</div>` +
    d.files.map((f, i) => {
      const s = statusInfo(f.status);
      return `<div class="fitem" data-idx="${i}" title="${esc(f.path)}">` +
        `<span class="fstat ${s.cls}">${s.glyph}</span>` +
        `<span class="fpath">${esc(f.path)}</span>` +
        `<span class="fnums"><span class="adds">+${f.added}</span> <span class="dels">-${f.deleted}</span></span>` +
        `</div>`;
    }).join("");

  filesEl().querySelectorAll<HTMLElement>(".fitem[data-idx]").forEach((el) => {
    el.addEventListener("click", () => {
      selectFile(Number(el.dataset.idx));
      activateFile(Number(el.dataset.idx));
      filesEl().focus({ preventScroll: true });
    });
  });
}

function renderDiff(d: CommitDetails): void {
  const html = diffMode === "split" ? renderSplit(d.diff) : `<div class="diff-wrap">${renderUnified(d.diff, d.diffTruncated)}</div>`;
  bodyEl().innerHTML = html || `<div class="trunc">no textual diff</div>`;
  bodyEl().scrollTop = 0;
}

function renderUnified(diff: string, truncated = false): string {
  const lines = diff.length ? diff.split("\n") : [];
  const out: string[] = [];
  let sec = -1;
  for (const line of lines) {
    let cls = "line";
    let attr = "";
    if (line.startsWith("diff --git")) { attr = ` id="diffsec-${++sec}"`; cls = "line fhdr"; }
    else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ")) cls = "line fhdr";
    else if (line.startsWith("@@")) cls = "line hunk";
    else if (line.startsWith("+")) cls = "line add";
    else if (line.startsWith("-")) cls = "line del";
    out.push(`<div class="${cls}"${attr}>${esc(line) || "&nbsp;"}</div>`);
  }
  if (truncated) out.push(`<div class="trunc">… diff truncated (large commit)</div>`);
  return out.join("");
}

// Side-by-side view: within each hunk, pair runs of removed/added lines (old left, new right);
// context lines appear on both sides. Line numbers track the hunk's -old/+new counters.
function renderSplit(diff: string): string {
  const lines = diff.length ? diff.split("\n") : [];
  const out: string[] = [];
  let sec = -1;
  let oldLn = 0;
  let newLn = 0;
  let dels: { no: number; text: string }[] = [];
  let adds: { no: number; text: string }[] = [];

  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const l = dels[i];
      const r = adds[i];
      out.push(srow(
        l ? l.no : null, l ? l.text : "", l ? "del" : "blank",
        r ? r.no : null, r ? r.text : "", r ? "add" : "blank",
      ));
    }
    dels = [];
    adds = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flush();
      out.push(`<div class="dhdr fhdr" id="diffsec-${++sec}">${esc(line)}</div>`);
    } else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ")) {
      flush();
      out.push(`<div class="dhdr fhdr">${esc(line)}</div>`);
    } else if (line.startsWith("@@")) {
      flush();
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) { oldLn = parseInt(m[1], 10); newLn = parseInt(m[2], 10); }
      out.push(`<div class="dhdr hunk">${esc(line)}</div>`);
    } else if (line.startsWith("-")) {
      dels.push({ no: oldLn++, text: line.slice(1) });
    } else if (line.startsWith("+")) {
      adds.push({ no: newLn++, text: line.slice(1) });
    } else {
      flush();
      const text = line.startsWith(" ") ? line.slice(1) : line;
      out.push(srow(oldLn, text, "ctx", newLn, text, "ctx"));
      oldLn++;
      newLn++;
    }
  }
  flush();
  return out.join("");
}

function srow(lno: number | null, ltext: string, lcls: string, rno: number | null, rtext: string, rcls: string): string {
  return `<div class="srow">` +
    `<span class="lno">${lno ?? ""}</span><span class="lc ${lcls}">${esc(ltext) || "&nbsp;"}</span>` +
    `<span class="rno">${rno ?? ""}</span><span class="rc ${rcls}">${esc(rtext) || "&nbsp;"}</span>` +
    `</div>`;
}

export function initDetailContextMenus(): void {
  // Files list: right-click a file row → copy path
  filesEl().addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const item = (e.target as HTMLElement).closest<HTMLElement>(".fitem[data-idx]");
    if (!item) return;
    showContextMenu(
      [{ label: "Copy path", action: "copy-path" }],
      { kind: "file", path: item.title },
      e.clientX, e.clientY,
    );
  });

  // Diff body: right-click a line → copy line text
  bodyEl().addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const line = (e.target as HTMLElement).closest<HTMLElement>(".line");
    if (!line) return;
    const text = line.textContent ?? "";
    showContextMenu(
      [{ label: "Copy line", action: "copy-line" }],
      { kind: "diff-line", text },
      e.clientX, e.clientY,
    );
  });
}
