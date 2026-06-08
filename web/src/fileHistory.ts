import { request } from "./bridge";
import { getCurrentRepo } from "./repos";
import { renderUnified } from "./detail";
import type { FileHistoryCommit, FileBlame } from "./types";

// Two-pane modal mirroring the commit modal: a persistent commit list on the left and a
// right pane that shows either the file's diff at the selected commit (History) or the
// file's blame as of that commit (Blame). Selecting only updates the right pane; Enter /
// double-click / "Show in graph" navigates to the commit in the main graph.
let commits: FileHistoryCommit[] = [];
let selectedSha = "";
let mode: "history" | "blame" = "history";
let currentPath = "";
let onNavigate: (sha: string) => void = () => {};
const diffCache = new Map<string, string>(); // sha -> this file's diff section
const blameCache = new Map<string, FileBlame>(); // sha -> blame as of that commit

const modalEl = () => document.getElementById("fh-modal") as HTMLElement;
const listEl = () => document.getElementById("fh-list") as HTMLElement;
const detailEl = () => document.getElementById("fh-detail") as HTMLElement;
const pathEl = () => document.getElementById("fh-path") as HTMLElement;
const hintEl = () => document.getElementById("fh-hint") as HTMLElement;

export function initFileHistory(navigate: (sha: string) => void): void {
    onNavigate = navigate;
    document.getElementById("fh-modal-close")!.addEventListener("click", close);
    document.getElementById("fh-goto-btn")!.addEventListener("click", gotoGraph);
    modalEl().addEventListener("pointerdown", (e) => {
        if (e.target === modalEl()) close();
    });
    document.addEventListener(
        "keydown",
        (e) => {
            if (e.key === "Escape" && !modalEl().hidden) {
                e.stopPropagation();
                close();
            }
        },
        true,
    );

    document.getElementById("fh-tabs")!.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]");
        if (btn) setMode(btn.dataset.tab as "history" | "blame");
    });

    // Commit list: click selects, double-click / Enter opens in graph, arrows navigate.
    listEl().addEventListener("click", (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>(".fh-row[data-sha]");
        if (row?.dataset.sha) select(row.dataset.sha);
    });
    listEl().addEventListener("dblclick", (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>(".fh-row[data-sha]");
        if (row?.dataset.sha) {
            select(row.dataset.sha);
            gotoGraph();
        }
    });
    listEl().addEventListener("keydown", (e) => {
        if (commits.length === 0) return;
        const i = commits.findIndex((c) => c.sha === selectedSha);
        if (e.key === "ArrowDown") {
            e.preventDefault();
            select(commits[Math.min(commits.length - 1, i + 1)].sha);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            select(commits[Math.max(0, i - 1)].sha);
        } else if (e.key === "Enter") {
            e.preventDefault();
            gotoGraph();
        }
    });

    // Clicking a blame SHA chip selects that commit in the list (and re-renders the right pane).
    detailEl().addEventListener("click", (e) => {
        const chip = (e.target as HTMLElement).closest<HTMLElement>(".fh-bsha[data-sha]");
        if (chip?.dataset.sha) select(chip.dataset.sha);
    });
}

export async function openFileHistory(path: string, tab: "history" | "blame"): Promise<void> {
    currentPath = path;
    mode = tab;
    pathEl().textContent = path;
    diffCache.clear();
    blameCache.clear();
    commits = [];
    selectedSha = "";
    syncTabs();
    modalEl().hidden = false;
    detailEl().innerHTML = "";
    listEl().innerHTML = `<div class="fh-msg">Loading…</div>`;

    const repo = getCurrentRepo();
    if (!repo) return;
    try {
        commits = await request<FileHistoryCommit[]>("getFileHistory", { repoPath: repo, path });
        if (commits.length === 0) {
            listEl().innerHTML = `<div class="fh-msg">No history for this file.</div>`;
            detailEl().innerHTML = "";
            return;
        }
        renderList();
        select(commits[0].sha);
        listEl().focus({ preventScroll: true });
    } catch (e) {
        listEl().innerHTML = `<div class="fh-msg err">${esc(errMsg(e))}</div>`;
    }
}

function close(): void {
    modalEl().hidden = true;
}

function gotoGraph(): void {
    if (selectedSha) {
        onNavigate(selectedSha);
        close();
    }
}

function setMode(m: "history" | "blame"): void {
    if (m === mode) return;
    mode = m;
    syncTabs();
    if (selectedSha) void renderDetail();
}

function syncTabs(): void {
    document
        .querySelectorAll<HTMLElement>("#fh-tabs button")
        .forEach((b) => b.classList.toggle("active", b.dataset.tab === mode));
    hintEl().textContent =
        mode === "blame"
            ? "Blame as of the selected commit · ↑↓ select · Enter opens in graph"
            : "↑↓ select · Enter or double-click opens in graph";
}

function select(sha: string): void {
    if (sha === selectedSha) return;
    selectedSha = sha;
    listEl()
        .querySelectorAll<HTMLElement>(".fh-row[data-sha]")
        .forEach((r) => r.classList.toggle("sel", r.dataset.sha === sha));
    listEl()
        .querySelector<HTMLElement>(`.fh-row[data-sha="${CSS.escape(sha)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    void renderDetail();
}

function renderList(): void {
    listEl().innerHTML = commits
        .map(
            (c) =>
                `<div class="fh-row" data-sha="${esc(c.sha)}" title="${esc(c.summary)}">` +
                `<div class="fh-row-top">` +
                `<span class="fh-sha">${esc(c.shortSha)}</span>` +
                `<span class="fh-summary">${esc(c.summary)}</span>` +
                `</div>` +
                `<div class="fh-row-sub">${esc(c.author)} · ${fmtDate(c.whenIso)}</div>` +
                `</div>`,
        )
        .join("");
}

async function renderDetail(): Promise<void> {
    const sha = selectedSha;
    detailEl().innerHTML = `<div class="fh-msg">Loading…</div>`;
    detailEl().scrollTop = 0;
    const repo = getCurrentRepo();
    if (!repo) return;
    try {
        if (mode === "history") {
            let diff = diffCache.get(sha);
            if (diff === undefined) {
                const d = await request<{ diff: string }>("getCommitDetails", {
                    repoPath: repo,
                    sha,
                });
                diff = extractFileDiff(d.diff, currentPath);
                diffCache.set(sha, diff);
            }
            if (sha !== selectedSha) return; // a newer selection won the race
            detailEl().innerHTML = diff
                ? `<div class="diff-wrap">${renderUnified(diff)}</div>`
                : `<div class="fh-msg">No textual changes to this file in this commit.</div>`;
        } else {
            let blame = blameCache.get(sha);
            if (blame === undefined) {
                blame = await request<FileBlame>("getBlame", {
                    repoPath: repo,
                    path: currentPath,
                    sha,
                });
                blameCache.set(sha, blame);
            }
            if (sha !== selectedSha) return;
            renderBlame(blame);
        }
        detailEl().scrollTop = 0;
    } catch (e) {
        if (sha !== selectedSha) return;
        detailEl().innerHTML = `<div class="fh-msg err">${esc(errMsg(e))}</div>`;
    }
}

function renderBlame(blame: FileBlame): void {
    if (blame.lines.length === 0) {
        detailEl().innerHTML = `<div class="fh-msg">Empty file.</div>`;
        return;
    }
    let html = `<div id="fh-blame">`;
    let prev = "";
    for (const l of blame.lines) {
        // Only the first line of a run of same-commit lines shows the chip.
        const chip =
            l.sha !== prev
                ? `<span class="fh-bsha${l.sha === selectedSha ? " cur" : ""}" data-sha="${esc(l.sha)}" ` +
                  `title="${esc(l.summary)}\n${esc(l.author)} · ${fmtDate(l.whenIso)}">${esc(l.shortSha)}</span>`
                : `<span class="fh-bsha empty"></span>`;
        prev = l.sha;
        html +=
            `<div class="fh-bline">` +
            chip +
            `<span class="fh-blno">${l.lineNumber}</span>` +
            `<span class="fh-bcode">${esc(l.content) || "&nbsp;"}</span>` +
            `</div>`;
    }
    if (blame.truncated)
        html += `<div class="fh-msg">Truncated — file too large to blame fully.</div>`;
    html += `</div>`;
    detailEl().innerHTML = html;
}

// Pulls just the section for `path` out of a multi-file unified diff. Each file's section
// begins with `diff --git a/<path> b/<path>` and runs until the next such header.
function extractFileDiff(fullDiff: string, path: string): string {
    const out: string[] = [];
    let capturing = false;
    for (const line of fullDiff.split("\n")) {
        if (line.startsWith("diff --git")) capturing = line.includes(` b/${path}`);
        if (capturing) out.push(line);
    }
    return out.join("\n");
}

function fmtDate(iso: string): string {
    return iso ? new Date(iso).toLocaleDateString() : "";
}

function errMsg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

function esc(s: string): string {
    return s.replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
    );
}
