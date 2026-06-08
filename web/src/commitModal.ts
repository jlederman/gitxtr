import { request } from "./bridge";
import { getCurrentRepo } from "./repos";
import { renderUnified } from "./detail";
import type { WorkingTreeView, WorkingTreeFile } from "./types";

let currentView: WorkingTreeView | null = null;
let selectedPath: string | null = null;

const modalEl = () => document.getElementById("commit-modal") as HTMLElement;
const filesPane = () => document.getElementById("commit-files-pane") as HTMLElement;
const diffPane = () => document.getElementById("commit-diff-pane") as HTMLElement;
const msgInput = () => document.getElementById("commit-msg-input") as HTMLTextAreaElement;
const amendChk = () => document.getElementById("commit-amend-chk") as HTMLInputElement;
const commitBtn = () => document.getElementById("do-commit-btn") as HTMLButtonElement;
const errSpan = () => document.getElementById("commit-msg-err") as HTMLElement;

export function initCommitModal(): void {
    document.getElementById("commit-modal-close")!.addEventListener("click", close);
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
    msgInput().addEventListener("input", updateBtn);
    amendChk().addEventListener("change", () => {
        if (amendChk().checked && msgInput().value.trim() === "")
            msgInput().value = currentView?.lastCommitMessage ?? "";
        updateBtn();
    });
    commitBtn().addEventListener("click", () => {
        errSpan().textContent = "";
        void performCommit();
    });

    filesPane().addEventListener("keydown", (e) => {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const items = Array.from(filesPane().querySelectorAll<HTMLElement>(".citem[data-path]"));
        if (items.length === 0) return;
        const cur = items.findIndex((i) => i.classList.contains("sel"));
        const next =
            cur < 0
                ? 0
                : e.key === "ArrowDown"
                  ? Math.min(items.length - 1, cur + 1)
                  : Math.max(0, cur - 1);
        items.forEach((i) => i.classList.remove("sel"));
        items[next].classList.add("sel");
        items[next].scrollIntoView({ block: "nearest" });
        selectedPath = items[next].dataset.path!;
        const all = [...(currentView?.unstaged ?? []), ...(currentView?.staged ?? [])];
        const f = all.find((f) => f.path === selectedPath);
        if (f) showDiff(f);
    });
}

export async function openCommitModal(repo: string): Promise<void> {
    if (!modalEl().hidden) {
        msgInput().focus();
        return;
    }
    modalEl().hidden = false;
    diffPane().innerHTML = "";
    filesPane().innerHTML = `<div style="padding:12px;color:var(--muted)">Loading…</div>`;
    await reload(repo);
    msgInput().focus();
}

function close(): void {
    modalEl().hidden = true;
}

async function reload(repo: string): Promise<void> {
    try {
        const view = await request<WorkingTreeView>("getWorkingTree", { repoPath: repo });
        currentView = view;
        renderFiles(view);
        updateBtn();
        if (selectedPath) {
            const all = [...view.unstaged, ...view.staged];
            const f = all.find((f) => f.path === selectedPath);
            if (f) showDiff(f);
            else {
                selectedPath = null;
                diffPane().innerHTML = "";
            }
        }
    } catch (e) {
        filesPane().innerHTML = `<div style="padding:12px;color:var(--del-fg)">Error: ${esc(e instanceof Error ? e.message : String(e))}</div>`;
    }
}

function updateBtn(): void {
    const hasMsg = msgInput().value.trim().length > 0;
    const hasStaged = (currentView?.staged.length ?? 0) > 0 || amendChk().checked;
    commitBtn().disabled = !hasMsg || !hasStaged;
}

function renderFiles(view: WorkingTreeView): void {
    const el = filesPane();
    let html = "";

    if (view.unstaged.length > 0) {
        html += `<div class="chead">Unstaged <button class="fop-all" data-op="stageAll">Stage all</button></div>`;
        html += view.unstaged.map((f) => citem(f)).join("");
    }
    if (view.staged.length > 0) {
        html += `<div class="chead">Staged <button class="fop-all" data-op="unstageAll">Unstage all</button></div>`;
        html += view.staged.map((f) => citem(f)).join("");
    }
    if (!html) {
        html = `<div style="padding:12px;color:var(--muted)">Nothing to commit</div>`;
    }

    el.innerHTML = html;
    el.onclick = (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-op]");
        if (btn) {
            e.stopPropagation();
            void handleOp(btn.dataset.op!, btn.dataset.path ?? "");
            return;
        }
        const item = (e.target as HTMLElement).closest<HTMLElement>(".citem[data-path]");
        if (item) {
            el.querySelectorAll(".citem").forEach((ci) => ci.classList.remove("sel"));
            item.classList.add("sel");
            selectedPath = item.dataset.path!;
            const all = [...(currentView?.unstaged ?? []), ...(currentView?.staged ?? [])];
            const f = all.find((f) => f.path === selectedPath);
            if (f) showDiff(f);
            el.focus({ preventScroll: true });
        }
    };
}

function citem(f: WorkingTreeFile): string {
    const cls =
        f.status === "A" ? "st-add" : f.status === "D" || f.status === "?" ? "st-del" : "st-mod";
    const sel = f.path === selectedPath ? " sel" : "";
    const ops = f.staged
        ? `<span class="fops"><button class="fop" data-op="unstage" data-path="${esc(f.path)}" title="Unstage">−</button></span>`
        : `<span class="fops">` +
          `<button class="fop" data-op="stage"   data-path="${esc(f.path)}" title="Stage">+</button>` +
          `<button class="fop discard" data-op="discard" data-path="${esc(f.path)}" title="Discard">×</button>` +
          `</span>`;
    return (
        `<div class="citem${sel}" data-path="${esc(f.path)}" title="${esc(f.path)}">` +
        `<span class="fstat ${cls}">${esc(f.status)}</span>` +
        `<span class="fpath">${esc(f.path)}</span>` +
        ops +
        `</div>`
    );
}

function showDiff(f: WorkingTreeFile): void {
    if (!f.patch) {
        diffPane().innerHTML = `<div style="padding:12px;color:var(--muted)">${f.status === "?" ? "Untracked file" : "No diff available"}</div>`;
        return;
    }
    diffPane().innerHTML = `<div class="diff-wrap">${renderUnified(f.patch)}</div>`;
    diffPane().scrollTop = 0;
}

async function handleOp(op: string, filePath: string): Promise<void> {
    if (op === "discard" && !confirm(`Discard all changes to ${filePath}?`)) return;
    const repo = getCurrentRepo();
    if (!repo) return;
    try {
        await request<null>("workingTreeOp", { repoPath: repo, op, path: filePath });
        await reload(repo);
    } catch (e) {
        console.warn("Working tree op failed:", op, filePath, e);
    }
}

async function performCommit(): Promise<void> {
    const repo = getCurrentRepo();
    if (!repo) return;
    const message = msgInput().value.trim();
    const amend = amendChk().checked;
    commitBtn().disabled = true;
    try {
        await request<null>("createCommit", { repoPath: repo, message, amend });
        // Reset form state for next use
        msgInput().value = "";
        amendChk().checked = false;
        selectedPath = null;
        currentView = null;
        close();
    } catch (e) {
        errSpan().textContent = e instanceof Error ? e.message : String(e);
        commitBtn().disabled = false;
    }
}

function esc(s: string): string {
    return s.replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
    );
}
