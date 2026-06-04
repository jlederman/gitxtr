import { request } from "./bridge";
import { getCurrentRepo } from "./repos";

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
let token = 0;
let diffMode: "unified" | "split" = "unified";
let lastDetails: CommitDetails | null = null;
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
  document.getElementById(`diffsec-${idx}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
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
      if (lastDetails) renderDiff(lastDetails);
      onChange(m);
    }),
  );
}

export async function showCommit(sha: string): Promise<void> {
  const my = ++token;
  try {
    const d = await request<CommitDetails>("getCommitDetails", { sha, repoPath: getCurrentRepo() });
    if (my !== token) return;
    lastDetails = d;
    renderMeta(d);
    renderFiles(d);
    renderDiff(d);
  } catch (e) {
    if (my !== token) return;
    metaEl().innerHTML = `<span class="when">error: ${esc(e instanceof Error ? e.message : String(e))}</span>`;
    filesEl().innerHTML = "";
    bodyEl().innerHTML = "";
  }
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
  const html = diffMode === "split" ? renderSplit(d) : renderUnified(d);
  bodyEl().innerHTML = html || `<div class="trunc">no textual diff</div>`;
  bodyEl().scrollTop = 0;
}

function renderUnified(d: CommitDetails): string {
  const lines = d.diff.length ? d.diff.split("\n") : [];
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
  if (d.diffTruncated) out.push(`<div class="trunc">… diff truncated (large commit)</div>`);
  return `<div class="diff-wrap">${out.join("")}</div>`;
}

// Side-by-side view: within each hunk, pair runs of removed/added lines (old left, new right);
// context lines appear on both sides. Line numbers track the hunk's -old/+new counters.
function renderSplit(d: CommitDetails): string {
  const lines = d.diff.length ? d.diff.split("\n") : [];
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
  if (d.diffTruncated) out.push(`<div class="trunc">… diff truncated (large commit)</div>`);
  return out.join("");
}

function srow(lno: number | null, ltext: string, lcls: string, rno: number | null, rtext: string, rcls: string): string {
  return `<div class="srow">` +
    `<span class="lno">${lno ?? ""}</span><span class="lc ${lcls}">${esc(ltext) || "&nbsp;"}</span>` +
    `<span class="rno">${rno ?? ""}</span><span class="rc ${rcls}">${esc(rtext) || "&nbsp;"}</span>` +
    `</div>`;
}
