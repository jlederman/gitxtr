import { request } from "./bridge";

interface FileChange { path: string; status: string; added: number; deleted: number; }
interface Ref { name: string; kind: string; }
interface CommitDetails {
  sha: string; shortSha: string; author: string; email: string; whenIso: string;
  message: string; refs: Ref[]; files: FileChange[]; diff: string; diffTruncated: boolean;
}

const metaEl = () => document.getElementById("detail-meta") as HTMLElement;
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
    renderDiff(d);
  } catch (e) {
    if (my !== token) return;
    metaEl().innerHTML = `<span class="when">error: ${esc(e instanceof Error ? e.message : String(e))}</span>`;
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

function renderDiff(d: CommitDetails): void {
  const files = d.files
    .map((f) => `<span class="f">${esc(f.path)}</span> <span style="color:#a6e3a1">+${f.added}</span> <span style="color:#f38ba8">-${f.deleted}</span>`)
    .join("  ·  ");
  const fileSummary = `<div class="files">${d.files.length} file(s): ${files || "—"}</div>`;

  const lines = d.diff.length ? d.diff.split("\n") : [];
  const out: string[] = [];
  for (const line of lines) {
    let cls = "line";
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) cls = "line fhdr";
    else if (line.startsWith("@@")) cls = "line hunk";
    else if (line.startsWith("+")) cls = "line add";
    else if (line.startsWith("-")) cls = "line del";
    out.push(`<div class="${cls}">${esc(line) || "&nbsp;"}</div>`);
  }
  if (d.diffTruncated) out.push(`<div class="trunc">… diff truncated (large commit)</div>`);

  diffEl().innerHTML = fileSummary + out.join("");
  diffEl().scrollTop = 0;
}
