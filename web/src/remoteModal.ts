import "./remoteModal.css";
import { request } from "./bridge";

export type RemoteMode = "fetch" | "pull" | "push";

interface RemoteDto {
    name: string;
    url: string;
}

interface RemoteContext {
    repo: string;
    branches: { name: string; isHead: boolean; upstreamName?: string | null }[];
    onDone: () => void;
}

let mode: RemoteMode = "fetch";
let ctx: RemoteContext | null = null;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const modalEl = () => el("remote-modal");

export function initRemoteModal(): void {
    el("remote-modal-close").addEventListener("click", close);
    el("remote-cancel-btn").addEventListener("click", close);
    modalEl().addEventListener("pointerdown", (e) => {
        if (e.target === modalEl()) close();
    });
    el<HTMLButtonElement>("do-remote-btn").addEventListener("click", () => void execute());

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

export function openRemoteModal(m: RemoteMode, c: RemoteContext): void {
    mode = m;
    ctx = c;
    el("remote-title").textContent = { fetch: "Fetch", pull: "Pull", push: "Push" }[m];
    el<HTMLButtonElement>("do-remote-btn").textContent = el("remote-title").textContent!;
    el("remote-msg").textContent = "";
    msgErr(false);
    hideOutput();

    // Row visibility per mode.
    show("rf-branch-row", m === "push");
    show("rf-mode-row", m === "pull");
    show("rf-prune-row", m === "fetch");
    show("rf-force-row", m === "push");
    show("rf-upstream-row", m === "push");

    const head = c.branches.find((b) => b.isHead);
    populateBranches(head?.name);

    // Defaults
    el<HTMLInputElement>("rf-prune").checked = false;
    el<HTMLInputElement>("rf-force").checked = false;
    // Auto-check "set upstream" when the current branch has no tracking branch yet.
    el<HTMLInputElement>("rf-upstream").checked = m === "push" && !head?.upstreamName;
    const merge = document.querySelector<HTMLInputElement>(
        'input[name="rf-pullmode"][value="merge"]',
    );
    if (merge) merge.checked = true;

    modalEl().hidden = false;
    void loadRemotes(head?.upstreamName);
}

function close(): void {
    modalEl().hidden = true;
    ctx = null;
}

async function loadRemotes(upstreamName?: string | null): Promise<void> {
    const sel = el<HTMLSelectElement>("rf-remote");
    sel.innerHTML = "<option disabled selected>loading…</option>";
    try {
        const remotes = await request<RemoteDto[]>("getRemotes", { repoPath: ctx!.repo });
        // Prefer the current branch's upstream remote (e.g. "origin/main" → "origin"), else "origin", else first.
        const upstreamRemote = upstreamName?.includes("/") ? upstreamName.split("/")[0] : undefined;
        const preferred =
            upstreamRemote ??
            (remotes.some((r) => r.name === "origin") ? "origin" : remotes[0]?.name);

        const allOpt = mode === "fetch" ? '<option value="">All remotes</option>' : "";
        sel.innerHTML =
            allOpt +
            remotes
                .map(
                    (r) =>
                        `<option value="${esc(r.name)}"${r.name === preferred ? " selected" : ""}>${esc(r.name)}</option>`,
                )
                .join("");
        if (remotes.length === 0 && mode !== "fetch")
            setMsg("This repository has no remotes.", true);
    } catch (e) {
        sel.innerHTML = "";
        setMsg(e instanceof Error ? e.message : String(e), true);
    }
}

function populateBranches(current?: string): void {
    const sel = el<HTMLSelectElement>("rf-branch");
    sel.innerHTML = (ctx?.branches ?? [])
        .map(
            (b) =>
                `<option value="${esc(b.name)}"${b.name === current ? " selected" : ""}>${esc(b.name)}</option>`,
        )
        .join("");
}

async function execute(): Promise<void> {
    if (!ctx) return;
    const btn = el<HTMLButtonElement>("do-remote-btn");
    const remote = el<HTMLSelectElement>("rf-remote").value;
    const payload: Record<string, unknown> = { repoPath: ctx.repo, op: mode, remote };

    if (mode === "fetch") payload.prune = el<HTMLInputElement>("rf-prune").checked;
    if (mode === "pull")
        payload.rebase =
            document.querySelector<HTMLInputElement>('input[name="rf-pullmode"]:checked')?.value ===
            "rebase";
    if (mode === "push") {
        payload.branch = el<HTMLSelectElement>("rf-branch").value;
        payload.force = el<HTMLInputElement>("rf-force").checked;
        payload.setUpstream = el<HTMLInputElement>("rf-upstream").checked;
    }

    btn.disabled = true;
    hideOutput();
    setMsg("working…", false);
    try {
        const res = await request<{ output: string }>("remoteOp", payload);
        ctx.onDone();
        setMsg("Done.", false);
        showOutput(res.output || "(no output — already up to date)", false);
    } catch (e) {
        setMsg("Failed.", true);
        showOutput(e instanceof Error ? e.message : String(e), true);
    } finally {
        btn.disabled = false;
    }
}

function showOutput(text: string, isErr: boolean): void {
    const out = el("remote-output");
    out.textContent = text;
    out.classList.toggle("err", isErr);
    out.hidden = false;
}

function hideOutput(): void {
    const out = el("remote-output");
    out.hidden = true;
    out.textContent = "";
}

function setMsg(text: string, isErr: boolean): void {
    el("remote-msg").textContent = text;
    msgErr(isErr);
}

function msgErr(on: boolean): void {
    el("remote-msg").classList.toggle("err", on);
}

function show(id: string, on: boolean): void {
    el(id).hidden = !on;
}

function esc(s: string): string {
    return s.replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
    );
}
