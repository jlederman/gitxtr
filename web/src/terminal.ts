import "@xterm/xterm/css/xterm.css";
import "./terminal.css";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { send, onPush } from "./bridge";
import { getCurrentRepo } from "./repos";
import { initSplitter } from "./splitter";

// VS Code-style integrated terminal: a PTY-backed shell in a pane that slides up from the
// bottom. Output bytes arrive base64-encoded over the push channel and go straight to xterm
// (which decodes UTF-8 across writes — never decode a PTY chunk ourselves, it may split a
// multi-byte sequence). Keystrokes go back as base64 over the fire-and-forget term:* channel.

let term: Terminal | null = null;
let fit: FitAddon | null = null;
let opened = false; // xterm.open() has been called (only valid once the pane is visible)
let spawned = false; // a backend PTY session is alive
let isOpen = false;

const encoder = new TextEncoder();

// Toggle hotkey, stored as modifiers + a KeyboardEvent.code, e.g. "Ctrl+Backquote".
type Hotkey = { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; code: string };
let hotkey: Hotkey = parseHotkey("Ctrl+Backquote");

function parseHotkey(s: string): Hotkey {
    const parts = (s || "Ctrl+Backquote").split("+");
    const code = parts.pop() || "Backquote";
    return {
        ctrl: parts.includes("Ctrl"),
        alt: parts.includes("Alt"),
        shift: parts.includes("Shift"),
        meta: parts.includes("Meta"),
        code,
    };
}

function hotkeyMatches(e: KeyboardEvent): boolean {
    return (
        e.ctrlKey === hotkey.ctrl &&
        e.altKey === hotkey.alt &&
        e.shiftKey === hotkey.shift &&
        e.metaKey === hotkey.meta &&
        e.code === hotkey.code
    );
}

export function setTerminalHotkey(s: string): void {
    if (s) hotkey = parseHotkey(s);
}

// Build a hotkey string from a keydown for the settings capture widget, or null if it isn't a
// usable chord (a bare modifier press, or a plain key with no modifier that isn't a function key).
export function hotkeyFromEvent(e: KeyboardEvent): string | null {
    if (/^(Control|Alt|Shift|Meta|OS)/.test(e.code)) return null;
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    if (parts.length === 0 && !/^F\d{1,2}$/.test(e.code)) return null;
    parts.push(e.code);
    return parts.join("+");
}

export function prettyHotkey(s: string): string {
    const hk = parseHotkey(s);
    const out: string[] = [];
    if (hk.ctrl) out.push("Ctrl");
    if (hk.alt) out.push("Alt");
    if (hk.shift) out.push("Shift");
    if (hk.meta) out.push("Cmd");
    out.push(
        hk.code === "Backquote"
            ? "`"
            : hk.code.startsWith("Key")
              ? hk.code.slice(3)
              : hk.code.startsWith("Digit")
                ? hk.code.slice(5)
                : hk.code,
    );
    return out.join(" + ");
}

const pane = () => document.getElementById("terminal") as HTMLElement;
const host = () => document.getElementById("term-host") as HTMLElement;

function b64encode(bytes: Uint8Array): string {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function b64decode(b64: string): Uint8Array {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
}

// Map the active app theme (CSS vars) onto an xterm palette so the terminal matches the UI.
function themeFromCss(): ITheme {
    const css = getComputedStyle(document.documentElement);
    const v = (n: string) => css.getPropertyValue(n).trim();
    return {
        background: v("--bg"),
        foreground: v("--fg"),
        cursor: v("--accent"),
        cursorAccent: v("--bg"),
        selectionBackground: v("--sel"),
        black: v("--surface2"),
        red: v("--del-fg"),
        green: v("--add-fg"),
        yellow: v("--lane-2"),
        blue: v("--lane-0"),
        magenta: v("--lane-4"),
        cyan: v("--lane-5"),
        white: v("--fg"),
        brightBlack: v("--muted"),
        brightRed: v("--del-fg"),
        brightGreen: v("--add-fg"),
        brightYellow: v("--lane-2"),
        brightBlue: v("--lane-0"),
        brightMagenta: v("--lane-4"),
        brightCyan: v("--lane-5"),
        brightWhite: v("--fg"),
    };
}

function applyAppearance(): void {
    if (!term) return;
    const css = getComputedStyle(document.documentElement);
    term.options.theme = themeFromCss();
    term.options.fontFamily = css.getPropertyValue("--font-family").trim() || "monospace";
    term.options.fontSize = parseInt(css.getPropertyValue("--font-size")) || 13;
}

function ensureTerm(): Terminal {
    if (term) return term;
    term = new Terminal({
        cursorBlink: true,
        allowProposedApi: true,
        fontFamily:
            getComputedStyle(document.documentElement).getPropertyValue("--font-family").trim() ||
            "monospace",
        fontSize:
            parseInt(getComputedStyle(document.documentElement).getPropertyValue("--font-size")) ||
            13,
        theme: themeFromCss(),
        scrollback: 5000,
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.onData((d) => send("term:input", { data: b64encode(encoder.encode(d)) }));

    onPush("term:data", (m) => term?.write(b64decode(m.data as string)));
    onPush("term:exit", () => {
        spawned = false;
        term?.write("\r\n\x1b[2m[process exited — reopen to start a new shell]\x1b[0m\r\n");
    });
    onPush("term:error", (m) =>
        term?.write(`\r\n\x1b[31m${String(m.message ?? "terminal error")}\x1b[0m\r\n`),
    );

    return term;
}

function fitAndSync(open: boolean): void {
    if (!term) return;
    // fit() can throw before xterm has measured its cell size (notably on first open in
    // WebKit); fall back to the current cols/rows so we still spawn/resize the shell.
    try {
        fit?.fit();
    } catch {
        /* keep going with whatever dimensions xterm has */
    }
    const cols = term.cols || 80;
    const rows = term.rows || 24;
    if (open && !spawned) {
        spawned = true;
        const repo = getCurrentRepo();
        send("term:open", { cols, rows, cwd: repo ?? "" });
    } else if (spawned) {
        send("term:resize", { cols, rows });
    }
}

export function openTerminal(): void {
    if (isOpen) {
        term?.focus();
        return;
    }
    isOpen = true;
    const t = ensureTerm();
    pane().classList.add("open");
    applyAppearance();

    // xterm must be opened into a VISIBLE, laid-out host: opening it while the pane is still
    // off-screen makes WebKit mis-measure the cell size, which leaves the rows (and the input
    // textarea) positioned wrong. So open it now that the pane has the `.open` class, and re-fit
    // whenever the host resizes or the web font finishes loading.
    if (!opened) {
        opened = true;
        t.open(host());
        new ResizeObserver(() => {
            if (isOpen) fitAndSync(true);
        }).observe(host());
        document.fonts?.ready.then(() => {
            if (isOpen) fitAndSync(true);
        });
    }
    requestAnimationFrame(() => {
        fitAndSync(true);
        t.focus();
    });
}

export function closeTerminal(): void {
    const p = pane();
    if (!isOpen && !p.classList.contains("open")) return;
    isOpen = false;
    p.classList.remove("open");
    // Keep the shell session alive (VS Code-style) — just hide the pane.
    document.getElementById("viewport")?.focus();
}

export function toggleTerminal(): void {
    isOpen ? closeTerminal() : openTerminal();
}

// Re-skin the terminal when the app theme/font changes (called from settings apply).
export function refreshTerminalAppearance(): void {
    applyAppearance();
}

export function initTerminal(initialHotkey: string): void {
    setTerminalHotkey(initialHotkey);
    document.getElementById("term-close")?.addEventListener("click", closeTerminal);
    document.getElementById("open-terminal")?.addEventListener("click", toggleTerminal);

    // Capture phase so the toggle fires before app shortcuts and before xterm — and works even
    // while the terminal is focused (to close it).
    window.addEventListener(
        "keydown",
        (e) => {
            if (hotkeyMatches(e)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                toggleTerminal();
            }
        },
        true,
    );

    // Drag the top edge to resize. measure() converts pointer Y to a height from the window bottom.
    initSplitter({
        handle: document.getElementById("term-resize") as HTMLElement,
        min: 120,
        max: () => window.innerHeight - 120,
        measure: (clientY) => window.innerHeight - clientY,
        onResize: (px) => {
            document.documentElement.style.setProperty("--term-height", `${px}px`);
            if (isOpen) fitAndSync(false);
        },
        onCommit: () => {},
    });

    // Keep the terminal fitted when the OS window resizes.
    window.addEventListener("resize", () => {
        if (isOpen) fitAndSync(false);
    });
}
