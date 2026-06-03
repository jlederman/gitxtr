import { request } from "./bridge";

interface FileChange { path: string; status: string; added: number; deleted: number; }
interface Ref { name: string; kind: string; }
interface CommitDetails {
  sha: string; shortSha: string; author: string; email: string; whenIso: string;
  message: string; refs: Ref[]; files: FileChange[]; diff: string; diffTruncated: boolean;
}

const metaEl = () => document.getElementById("detail-meta") as HTMLElement;
const filesEl = () => document.getElementById("detail-files") as HTMLElement;
const diffEl = () => document.getElementById("detail-diff") as HTMLElement;

// Guards against out-of-order responses when arrowing through commits quickly:
// only the most recent request is allowed to render.
let token = 0;

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

export async function showCommit(sha: string): Promise<void> {
  const my = ++token;
  try {
    const d = await request<CommitDetails>("getCommitDetails", { sha });
    if (my !== token) return;
    renderMeta(d);
    renderFiles(d);
    renderDiff(d);
  } catch (e) {
    if (my !== token) return;
    metaEl().innerHTML = `<span class="when">error: ${esc(e instanceof Error ? e.message : String(e))}</span>`;
    filesEl().innerHTML = "";
    diffEl().innerHTML = "";
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
      document.getElementById(`diffsec-${el.dataset.idx}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
      filesEl().querySelectorAll(".fitem.sel").forEach((x) => x.classList.remove("sel"));
      el.classList.add("sel");
    });
  });
}

function renderDiff(d: CommitDetails): void {
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
  diffEl().innerHTML = out.join("") || `<div class="trunc">no textual diff</div>`;
  diffEl().scrollTop = 0;
}
