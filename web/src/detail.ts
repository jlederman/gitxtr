import { request } from "./bridge";
import { getCurrentRepo } from "./repos";
import { showContextMenu } from "./contextMenu";
import type { WorkingTreeView, WorkingTreeFile } from "./types";

interface FileChange { path: string; status: string; added: number; deleted: number; }
interface Ref { name: string; kind: string; }
interface CommitDetails {
  sha: string; shortSha: string; author: string; email: string; whenIso: string;
  message: string; refs: Ref[]; files: FileChange[]; diff: string; diffTruncated: boolean;
  parents: string[];
}

// For a merge: which parent the shown diff is against — a 0-based index, or "combined".
type ParentSel = number | "combined";

const metaEl = () => document.getElementById("detail-meta") as HTMLElement;
const filesEl = () => document.getElementById("detail-files") as HTMLElement;
const bodyEl = () => document.getElementById("diff-body") as HTMLElement; // diff scroll + content

// Guards against out-of-order responses when arrowing through commits quickly.
let seq = 0;
let diffMode: "unified" | "split" = "unified";
let lastDetails: CommitDetails | null = null;
let parentSel: ParentSel = 0; // current merge-parent selection for the shown commit
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
  syncSplitScroll(bodyEl());
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

export function showCommit(sha: string): Promise<void> {
  // Fresh commit selection always starts on the first parent (combined is opt-in via the
  // selector — a conflict-free merge's combined diff is empty and would look broken).
  return loadDetails(sha, 0);
}

async function loadDetails(sha: string, parent: ParentSel): Promise<void> {
  const my = ++seq;
  lastWipFiles = null;
  parentSel = parent;
  try {
    const d = await request<CommitDetails>("getCommitDetails", { sha, repoPath: getCurrentRepo(), parent });
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
    `<div class="subject">Working tree</div>` +
    (s > 0 ? `<div><span class="sha">● ${s} staged</span></div>` : `<div style="color:var(--muted)">nothing staged</div>`) +
    (u > 0 ? `<div><span class="when">○ ${u} unstaged</span></div>` : "") +
    `<div style="margin-top:8px;font-size:11px;color:var(--muted)">Ctrl+Space to open commit dialog</div>`;
}

function renderWipFiles(view: WorkingTreeView): void {
  const allFiles = [...view.staged, ...view.unstaged];
  lastWipFiles = allFiles;
  totalFiles = allFiles.length;
  selectedFileIdx = -1;

  let html = "";
  if (view.staged.length > 0) {
    html += `<div class="fhead">Staged changes` +
      `<button class="fop-all" data-op="unstageAll" title="Unstage all">Unstage all</button></div>`;
    html += view.staged.map((f, i) => wipFileItem(f, i)).join("");
  }
  if (view.unstaged.length > 0) {
    html += `<div class="fhead">Unstaged changes` +
      `<button class="fop-all" data-op="stageAll" title="Stage all">Stage all</button>` +
      `<button class="fop-all discard" data-op="discardAll" title="Discard all unstaged">Discard all</button></div>`;
    const off = view.staged.length;
    html += view.unstaged.map((f, i) => wipFileItem(f, off + i)).join("");
  }
  if (allFiles.length === 0) {
    html = `<div class="fitem muted">No changes in working tree</div>`;
  }

  const el = filesEl();
  el.innerHTML = html;

  // Delegated handler: covers both action buttons and file selection.
  // Assigning to onclick replaces the previous handler on each render (no stacking).
  el.onclick = (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-op]");
    if (btn) {
      e.stopPropagation();
      void handleWipOp(btn.dataset.op!, btn.dataset.path ?? "");
      return;
    }
    const item = (e.target as HTMLElement).closest<HTMLElement>(".fitem[data-idx]");
    if (item) {
      selectFile(parseInt(item.dataset.idx!));
      el.focus({ preventScroll: true });
    }
  };
}

async function handleWipOp(op: string, filePath: string): Promise<void> {
  if (op === "discard" && !confirm(`Discard all changes to ${filePath}?`)) return;
  if (op === "discardAll" && !confirm("Discard all unstaged changes? This cannot be undone.")) return;
  const repo = getCurrentRepo();
  if (!repo) return;
  try {
    await request<null>("workingTreeOp", { repoPath: repo, op, path: filePath });
    void showWorkingTree(repo);
  } catch (e) {
    console.warn("Working tree op failed:", op, filePath, e);
  }
}

function wipFileItem(f: WorkingTreeFile, idx: number): string {
  const cls = f.status === "A" ? "st-add" : f.status === "D" || f.status === "?" ? "st-del" : "st-mod";
  const ops = f.staged
    ? `<span class="fops"><button class="fop" data-op="unstage" data-path="${esc(f.path)}" title="Unstage">−</button></span>`
    : `<span class="fops">` +
      `<button class="fop" data-op="stage"   data-path="${esc(f.path)}" title="Stage">+</button>` +
      `<button class="fop discard" data-op="discard" data-path="${esc(f.path)}" title="Discard">×</button>` +
      `</span>`;
  return `<div class="fitem" data-idx="${idx}" title="${esc(f.path)}">` +
    `<span class="fstat ${cls}">${esc(f.status)}</span>` +
    `<span class="fpath">${esc(f.path)}</span>` +
    ops +
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
    (body ? `<div>${esc(body)}</div>` : "") +
    renderParentSelector(d);
  wireParentSelector(d.sha);
}

// Merge commits only: pick which parent the diff is against, or a combined (--cc) diff.
function renderParentSelector(d: CommitDetails): string {
  if (d.parents.length < 2) return "";
  const opt = (val: string, label: string) =>
    `<option value="${val}"${String(parentSel) === val ? " selected" : ""}>${esc(label)}</option>`;
  const options = d.parents
    .map((p, i) => opt(String(i), `Parent ${i + 1} (${p})`))
    .concat(opt("combined", "Combined (all parents)"))
    .join("");
  return `<div class="parent-sel">Diff against <select id="parent-select">${options}</select></div>`;
}

function wireParentSelector(sha: string): void {
  const sel = document.getElementById("parent-select") as HTMLSelectElement | null;
  if (!sel) return;
  sel.addEventListener("change", () => {
    const v: ParentSel = sel.value === "combined" ? "combined" : Number(sel.value);
    void loadDetails(sha, v);
  });
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

  const el = filesEl();
  el.onclick = (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>(".fitem[data-idx]");
    if (item) {
      const idx = Number(item.dataset.idx);
      selectFile(idx);
      activateFile(idx);
      el.focus({ preventScroll: true });
    }
  };
}

function renderDiff(d: CommitDetails): void {
  const combined = parentSel === "combined";
  if (combined && !d.diff) {
    bodyEl().innerHTML = `<div class="trunc">No combined changes — this merge resolved cleanly against all parents.</div>`;
    bodyEl().scrollTop = 0;
    return;
  }
  // Combined (--cc) diffs have a multi-column format the split renderer can't pair; force unified.
  const html = (!combined && diffMode === "split")
    ? renderSplit(d.diff)
    : `<div class="diff-wrap">${renderUnified(d.diff, d.diffTruncated)}</div>`;
  bodyEl().innerHTML = html || `<div class="trunc">no textual diff</div>`;
  bodyEl().scrollTop = 0;
  syncSplitScroll(bodyEl());
}

// ── Inline word-level diff (#9) ───────────────────────────────────────────
// Token-level LCS between a removed line and its paired added line; tokens unique to each
// side get a stronger highlight so only the actual change stands out. Returns escaped HTML.
function tokenize(s: string): string[] {
  return s.match(/\s+|\w+|[^\w\s]+/g) ?? [];
}

function wordDiff(oldText: string, newText: string): [string, string] {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const m = a.length, n = b.length;
  // Guard against pathological lines (e.g. minified) where O(m·n) LCS would blow up.
  if (m > 400 || n > 400) return [esc(oldText), esc(newText)];

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  let oldHtml = "", newHtml = "";
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { oldHtml += esc(a[i]); newHtml += esc(b[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { oldHtml += `<span class="wd-del">${esc(a[i++])}</span>`; }
    else { newHtml += `<span class="wd-add">${esc(b[j++])}</span>`; }
  }
  while (i < m) oldHtml += `<span class="wd-del">${esc(a[i++])}</span>`;
  while (j < n) newHtml += `<span class="wd-add">${esc(b[j++])}</span>`;
  return [oldHtml, newHtml];
}

// Pair buffered removed/added lines by index; modified pairs get a word-diff, lone lines
// keep whole-line colouring. Returns [oldLineHtml[], newLineHtml[]] (content after prefix).
function pairWordDiffs(dels: string[], adds: string[]): [string[], string[]] {
  const oldH: string[] = [];
  const newH: string[] = [];
  const n = Math.max(dels.length, adds.length);
  for (let i = 0; i < n; i++) {
    const d = dels[i];
    const a = adds[i];
    if (d !== undefined && a !== undefined) {
      const [oh, ah] = wordDiff(d, a);
      oldH.push(oh); newH.push(ah);
    } else if (d !== undefined) oldH.push(esc(d));
    else newH.push(esc(a));
  }
  return [oldH, newH];
}

export function renderUnified(diff: string, truncated = false): string {
  const lines = diff.length ? diff.split("\n") : [];
  const out: string[] = [];
  let sec = -1;
  let dels: string[] = [];
  let adds: string[] = [];

  // Unified keeps the removed-block-then-added-block ordering, with word highlights.
  const flush = () => {
    const [oldH, newH] = pairWordDiffs(dels, adds);
    for (const oh of oldH) out.push(`<div class="line del">-${oh || "&nbsp;"}</div>`);
    for (const ah of newH) out.push(`<div class="line add">+${ah || "&nbsp;"}</div>`);
    dels = [];
    adds = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --")) { flush(); out.push(`<div class="line fhdr" id="diffsec-${++sec}">${esc(line) || "&nbsp;"}</div>`); }
    else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ")) { flush(); out.push(`<div class="line fhdr">${esc(line) || "&nbsp;"}</div>`); }
    else if (line.startsWith("@@")) { flush(); out.push(`<div class="line hunk">${esc(line) || "&nbsp;"}</div>`); }
    else if (line.startsWith("+")) adds.push(line.slice(1));
    else if (line.startsWith("-")) dels.push(line.slice(1));
    else { flush(); out.push(`<div class="line">${esc(line) || "&nbsp;"}</div>`); }
  }
  flush();
  if (truncated) out.push(`<div class="trunc">… diff truncated (large commit)</div>`);
  return out.join("");
}

// Side-by-side view: within each hunk, pair runs of removed/added lines (old left, new right);
// context lines appear on both sides. Line numbers track the hunk's -old/+new counters.
// Two independently-scrollable columns (old/new) sharing synchronised vertical scroll —
// the VS Code / Git Extensions model. Headers are duplicated into both columns so the rows
// stay aligned; the file-anchor id (#diffsec-N) lives on the left copy only.
function renderSplit(diff: string): string {
  const lines = diff.length ? diff.split("\n") : [];
  const L: string[] = [];
  const R: string[] = [];
  let sec = -1;
  let oldLn = 0;
  let newLn = 0;
  let dels: { no: number; text: string }[] = [];
  let adds: { no: number; text: string }[] = [];

  const hdr = (cls: string, text: string, id = "") => {
    const e = esc(text);
    L.push(`<div class="dhdr ${cls}"${id ? ` id="${id}"` : ""}>${e}</div>`);
    R.push(`<div class="dhdr ${cls}">${e}</div>`);
  };

  const flush = () => {
    const n = Math.max(dels.length, adds.length);
    for (let i = 0; i < n; i++) {
      const l = dels[i];
      const r = adds[i];
      let lh = l ? esc(l.text) : "";
      let rh = r ? esc(r.text) : "";
      if (l && r) [lh, rh] = wordDiff(l.text, r.text); // modified pair → highlight changed words
      L.push(srow(l ? l.no : null, lh, l ? "del" : "blank"));
      R.push(srow(r ? r.no : null, rh, r ? "add" : "blank"));
    }
    dels = [];
    adds = [];
  };

  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      flush();
      hdr("fhdr", line, `diffsec-${++sec}`);
    } else if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("index ")) {
      flush();
      hdr("fhdr", line);
    } else if (line.startsWith("@@")) {
      flush();
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) { oldLn = parseInt(m[1], 10); newLn = parseInt(m[2], 10); }
      hdr("hunk", line);
    } else if (line.startsWith("-")) {
      dels.push({ no: oldLn++, text: line.slice(1) });
    } else if (line.startsWith("+")) {
      adds.push({ no: newLn++, text: line.slice(1) });
    } else {
      flush();
      const text = esc(line.startsWith(" ") ? line.slice(1) : line);
      L.push(srow(oldLn, text, "ctx"));
      R.push(srow(newLn, text, "ctx"));
      oldLn++;
      newLn++;
    }
  }
  flush();
  return `<div class="split2">` +
    `<div class="split-col"><div class="col-inner">${L.join("")}</div></div>` +
    `<div class="split-col"><div class="col-inner">${R.join("")}</div></div>` +
    `</div>`;
}

// One side of a split row. Content is pre-escaped HTML (may carry word-diff spans).
function srow(lno: number | null, html: string, cls: string): string {
  return `<div class="srow2"><span class="lno">${lno ?? ""}</span>` +
    `<span class="lc ${cls}">${html || "&nbsp;"}</span></div>`;
}

// Mirror vertical scroll between the two split columns (horizontal stays independent).
// No-op for unified diffs. Re-run after each render — innerHTML replacement drops listeners.
function syncSplitScroll(container: HTMLElement): void {
  const cols = container.querySelectorAll<HTMLElement>(".split-col");
  if (cols.length !== 2) return;
  const [a, b] = [cols[0], cols[1]];
  let lock = false;
  const link = (src: HTMLElement, dst: HTMLElement) =>
    src.addEventListener("scroll", () => {
      if (lock) return;
      lock = true;
      dst.scrollTop = src.scrollTop;
      lock = false;
    });
  link(a, b);
  link(b, a);
}

export function initDetailContextMenus(): void {
  // Files list: right-click a file row → copy path
  filesEl().addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const item = (e.target as HTMLElement).closest<HTMLElement>(".fitem[data-idx]");
    if (!item) return;
    showContextMenu(
      [
        { label: "File history", action: "file-history" },
        { label: "Blame",        action: "blame" },
        { label: "Copy path",    action: "copy-path" },
      ],
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
