import "./repos.css";
import { request } from "./bridge";

// Owns the active-repo state + the header repo dropdown and the Settings "Repositories" list.
let current: string | null = null;
let repos: string[] = [];
let onSwitch: (repo: string | null) => void = () => {};

export function getCurrentRepo(): string | null {
    return current;
}

function esc(s: string): string {
    return s.replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
    );
}
function basename(p: string): string {
    const t = p.replace(/[/\\]+$/, "");
    return t.split(/[/\\]/).pop() || t;
}

export function initRepos(opts: {
    repos: string[];
    current: string | null;
    onSwitch: (repo: string | null) => void;
}): void {
    repos = opts.repos;
    current = opts.current;
    onSwitch = opts.onSwitch;
    renderDropdown();

    document.getElementById("add-repo")!.addEventListener("click", () => void addRepo());
    (document.getElementById("repo-select") as HTMLSelectElement).addEventListener("change", (e) =>
        switchTo((e.target as HTMLSelectElement).value || null),
    );
}

function renderDropdown(): void {
    const sel = document.getElementById("repo-select") as HTMLSelectElement;
    if (repos.length === 0) {
        sel.innerHTML = `<option value="">— no repositories —</option>`;
        sel.value = "";
        return;
    }
    sel.innerHTML = repos
        .map((r) => `<option value="${esc(r)}" title="${esc(r)}">${esc(basename(r))}</option>`)
        .join("");
    sel.value = current ?? repos[0];
}

function switchTo(repo: string | null): void {
    current = repo;
    const sel = document.getElementById("repo-select") as HTMLSelectElement | null;
    if (sel) sel.value = repo ?? ""; // keep the dropdown's shown selection in sync (e.g. after Add)
    onSwitch(repo);
    if (repo) void request("saveSettings", { settings: { lastRepo: repo } });
}

// Exported so the Settings "Repositories" pane can offer an Add button too.
export async function addRepo(): Promise<void> {
    try {
        const res = await request<{ added: string | null; repos: string[] }>("addRepo");
        repos = res.repos;
        renderDropdown();
        renderManager();
        if (res.added) switchTo(res.added);
    } catch (e) {
        const s = document.getElementById("status");
        if (s) s.textContent = e instanceof Error ? e.message : String(e);
    }
}

async function removeRepo(path: string): Promise<void> {
    const res = await request<{ repos: string[] }>("removeRepo", { repoPath: path });
    repos = res.repos;
    renderDropdown();
    renderManager();
    if (current === path) switchTo(repos[0] ?? null);
}

// Renders the Settings → Repositories management list (called when that category opens).
export function renderManager(): void {
    const el = document.getElementById("repo-list");
    if (!el) return;
    if (repos.length === 0) {
        el.innerHTML = `<div class="muted">No repositories yet.</div>`;
        return;
    }
    el.innerHTML = repos
        .map(
            (r) =>
                `<div class="repo-row"><span class="rp" title="${esc(r)}">${esc(r)}</span>` +
                `<button class="rm" data-path="${esc(r)}">Remove</button></div>`,
        )
        .join("");
    el.querySelectorAll<HTMLButtonElement>(".rm").forEach((b) =>
        b.addEventListener("click", () => void removeRepo(b.dataset.path!)),
    );
}
