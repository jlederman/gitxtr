import "./settings.css";
import { request } from "./bridge";
import { THEMES, getTheme, applyThemeCss, applyFontCss } from "./themes";
import { addRepo, renderManager } from "./repos";
import type { GraphRenderer } from "./graphRenderer";

export interface Settings {
    theme: string;
    fontFamily: string;
    fontSize: number;
    detailHeight: number;
    detailTopHeight: number;
    detailMetaHeight: number;
    diffView: string;
    viewMode: "simple" | "complex";
    repos: string[];
    lastRepo: string | null;
}

interface GitIdentity {
    globalName: string | null;
    globalEmail: string | null;
    localName: string | null;
    localEmail: string | null;
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const input = (id: string) => document.getElementById(id) as HTMLInputElement;

let current: Settings;
let renderer: GraphRenderer;
let getRepoPath: () => string | null;
let loadedIdentity: GitIdentity | null = null;

/** Apply theme + font to both the HTML chrome and the canvas renderer. */
export function applyAppearance(s: Settings, r: GraphRenderer): void {
    const theme = getTheme(s.theme);
    applyThemeCss(theme);
    applyFontCss(s.fontFamily, s.fontSize);
    r.setTheme(theme);
    r.setFont(s.fontFamily, s.fontSize);
}

export function initSettings(opts: {
    renderer: GraphRenderer;
    settings: Settings;
    getRepoPath: () => string | null;
}): void {
    current = opts.settings;
    renderer = opts.renderer;
    getRepoPath = opts.getRepoPath;

    const themeSel = input("set-theme") as unknown as HTMLSelectElement;
    themeSel.innerHTML = Object.values(THEMES)
        .map((t) => `<option value="${t.name}">${t.label}</option>`)
        .join("");
    themeSel.value = current.theme;
    input("set-font").value = current.fontFamily;
    input("set-fontsize").value = String(current.fontSize);

    const onAppearance = () => {
        current = {
            ...current,
            theme: themeSel.value,
            fontFamily: input("set-font").value || current.fontFamily,
            fontSize: clampInt(input("set-fontsize").value, 9, 28, current.fontSize),
        };
        applyAppearance(current, renderer);
        checkFontStatus();
        void request("saveSettings", {
            settings: {
                theme: current.theme,
                fontFamily: current.fontFamily,
                fontSize: current.fontSize,
            },
        });
    };
    themeSel.addEventListener("change", onAppearance);
    // Prevent the native macOS popup from opening on arrow keys; cycle themes manually instead.
    themeSel.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const next = themeSel.selectedIndex + (e.key === "ArrowDown" ? 1 : -1);
        const clamped = Math.max(0, Math.min(themeSel.options.length - 1, next));
        if (clamped !== themeSel.selectedIndex) {
            themeSel.selectedIndex = clamped;
            onAppearance();
        }
    });
    input("set-font").addEventListener("change", onAppearance);
    input("set-fontsize").addEventListener("change", onAppearance);

    $("open-settings").addEventListener("click", () => void open());
    $("settings-close").addEventListener("click", () => {
        $("settings").hidden = true;
    });
    document.addEventListener(
        "keydown",
        (e) => {
            if (e.key === "Escape" && !$("settings").hidden) {
                e.stopPropagation();
                $("settings").hidden = true;
            }
        },
        true,
    );
    document
        .querySelectorAll<HTMLButtonElement>("#settings-cats button")
        .forEach((btn) => btn.addEventListener("click", () => selectCat(btn.dataset.cat!)));
    $("git-save").addEventListener("click", () => void saveGitIdentity());
    $("add-repo-settings").addEventListener("click", () => void addRepo());
}

function clampInt(v: string, lo: number, hi: number, fallback: number): number {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

function selectCat(cat: string): void {
    document
        .querySelectorAll<HTMLElement>("#settings-cats button")
        .forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
    document.querySelectorAll<HTMLElement>("#settings-panes section").forEach((p) => {
        p.hidden = p.dataset.pane !== cat;
    });
    if (cat === "repos") renderManager();
}

async function open(): Promise<void> {
    $("settings").hidden = false;
    selectCat("appearance");
    checkFontStatus();
    $("git-status").textContent = "";
    try {
        const repoPath = getRepoPath();
        const id = await request<GitIdentity>("getGitIdentity", repoPath ? { repoPath } : {});
        loadedIdentity = id;
        input("git-global-name").value = id.globalName ?? "";
        input("git-global-email").value = id.globalEmail ?? "";
        input("git-local-name").value = id.localName ?? "";
        input("git-local-email").value = id.localEmail ?? "";
    } catch (e) {
        $("git-status").textContent = "could not read git config: " + msg(e);
    }
}

async function saveGitIdentity(): Promise<void> {
    const gn = input("git-global-name").value.trim();
    const ge = input("git-global-email").value.trim();
    const ln = input("git-local-name").value.trim();
    const le = input("git-local-email").value.trim();
    const repoPath = getRepoPath();
    const repoArg = repoPath ? { repoPath } : {};
    try {
        // An emptied field is sent through too, so the backend can UNSET it (clearing the override).
        const globalChanged =
            gn !== (loadedIdentity?.globalName ?? "") || ge !== (loadedIdentity?.globalEmail ?? "");
        const localChanged =
            ln !== (loadedIdentity?.localName ?? "") || le !== (loadedIdentity?.localEmail ?? "");
        if (globalChanged)
            await request("setGitIdentity", { scope: "global", name: gn, email: ge, ...repoArg });
        if (localChanged)
            await request("setGitIdentity", { scope: "local", name: ln, email: le, ...repoArg });
        loadedIdentity = { globalName: gn, globalEmail: ge, localName: ln, localEmail: le };
        $("git-status").textContent = globalChanged || localChanged ? "saved ✓" : "no changes";
    } catch (e) {
        $("git-status").textContent = "error: " + msg(e);
    }
}

function checkFontStatus(): void {
    const fam = input("set-font").value;
    const first = fam
        .split(",")[0]
        .trim()
        .replace(/^["']|["']$/g, "");
    $("appearance-status").textContent = isFontAvailable(fam)
        ? ""
        : `Font “${first}” not found — using fallback`;
}

const GENERIC_FONTS = new Set([
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-monospace",
    "ui-sans-serif",
    "ui-serif",
    "ui-rounded",
    "math",
    "emoji",
    "fangsong",
]);

// Detect whether the primary font in a family string is actually installed: render a sample
// in `"<font>", <generic>` and compare its width to the generic alone, across several generics.
// If it never differs, the named font didn't take effect (it fell back). Generics always pass.
function isFontAvailable(family: string): boolean {
    const first = family
        .split(",")[0]
        .trim()
        .replace(/^["']|["']$/g, "");
    if (!first || GENERIC_FONTS.has(first.toLowerCase())) return true;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return true;
    const sample = "mmmmmmmmmmlliWMQ 0123456789";
    const size = 72;
    for (const base of ["monospace", "sans-serif", "serif"]) {
        ctx.font = `${size}px ${base}`;
        const baseW = ctx.measureText(sample).width;
        ctx.font = `${size}px "${first}", ${base}`;
        if (Math.abs(ctx.measureText(sample).width - baseW) > 0.5) return true;
    }
    return false;
}

function msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
