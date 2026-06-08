import { request } from "./bridge";
import type { Row } from "./types";

interface RebaseStep {
    sha: string;
    action: string;
    shortSha: string;
    summary: string;
}

let steps: RebaseStep[] = [];
let repoPath = "";

const modalEl = () => document.getElementById("rebase-modal") as HTMLElement;
const listEl = () => document.getElementById("rebase-list") as HTMLElement;
const infoEl = () => document.getElementById("rebase-info") as HTMLElement;
const errEl = () => document.getElementById("rebase-err") as HTMLElement;
const rebaseBtn = () => document.getElementById("do-rebase-btn") as HTMLButtonElement;

export function initRebaseModal(): void {
    document.getElementById("rebase-modal-close")!.addEventListener("click", close);
    document.getElementById("rebase-cancel-btn")!.addEventListener("click", close);
    modalEl().addEventListener("pointerdown", (e) => {
        if (e.target === modalEl()) close();
    });
    rebaseBtn().addEventListener("click", () => {
        errEl().textContent = "";
        void execute();
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
}

// rows: already filtered to non-WIP, ordered oldest-first (index 0 = oldest = closest to base)
export function openRebaseModal(rows: Row[], repo: string): void {
    if (rows.length === 0) return;
    repoPath = repo;
    steps = rows.map((r) => ({
        sha: r.sha,
        action: "pick",
        shortSha: r.shortSha,
        summary: r.summary,
    }));
    render();
    modalEl().hidden = false;
}

function close(): void {
    modalEl().hidden = true;
}

function render(): void {
    const baseNote =
        steps.length > 0
            ? `Rebasing ${steps.length} commit${steps.length === 1 ? "" : "s"} — oldest at top, newest at bottom`
            : "";
    infoEl().textContent = baseNote;

    listEl().innerHTML = steps
        .map((s, i) => {
            const drop = s.action === "drop";
            return (
                `<div class="ritem${drop ? " r-drop" : ""}" data-idx="${i}">` +
                `<div class="r-arrows">` +
                `<button class="r-up" data-idx="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>▲</button>` +
                `<button class="r-dn" data-idx="${i}" title="Move down" ${i === steps.length - 1 ? "disabled" : ""}>▼</button>` +
                `</div>` +
                `<select class="r-action" data-idx="${i}">` +
                (i === 0 ? ["pick", "drop"] : ["pick", "squash", "fixup", "drop"])
                    .map(
                        (a) =>
                            `<option value="${a}"${s.action === a ? " selected" : ""}>${a}</option>`,
                    )
                    .join("") +
                `</select>` +
                `<span class="r-sha">${esc(s.shortSha)}</span>` +
                `<span class="r-msg">${esc(s.summary)}</span>` +
                `</div>`
            );
        })
        .join("");

    listEl().onclick = (e) => {
        const up = (e.target as HTMLElement).closest<HTMLElement>(".r-up");
        const dn = (e.target as HTMLElement).closest<HTMLElement>(".r-dn");
        if (up) {
            const i = parseInt(up.dataset.idx!);
            if (i > 0) {
                swap(i, i - 1);
                render();
            }
        }
        if (dn) {
            const i = parseInt(dn.dataset.idx!);
            if (i < steps.length - 1) {
                swap(i, i + 1);
                render();
            }
        }
    };

    listEl().onchange = (e) => {
        const sel = (e.target as HTMLElement).closest<HTMLSelectElement>(".r-action");
        if (sel) {
            steps[parseInt(sel.dataset.idx!)].action = sel.value;
            render();
        }
    };
}

function swap(a: number, b: number): void {
    [steps[a], steps[b]] = [steps[b], steps[a]];
    // squash/fixup can't be the first effective step — clamp to pick if needed.
    if (steps[0].action === "squash" || steps[0].action === "fixup") steps[0].action = "pick";
}

async function execute(): Promise<void> {
    rebaseBtn().disabled = true;
    try {
        await request<null>("interactiveRebase", {
            repoPath,
            steps: steps.map((s) => ({ sha: s.sha, action: s.action })),
        });
        close();
    } catch (e) {
        errEl().textContent = e instanceof Error ? e.message : String(e);
    } finally {
        rebaseBtn().disabled = false;
    }
}

function esc(s: string): string {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}
