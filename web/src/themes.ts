// Theme presets. Each theme drives both the HTML chrome (via CSS variables) and the
// Canvas graph (the GraphRenderer reads the Theme object directly, since a canvas can't use
// CSS variables). Defaults in style.css mirror "mocha" so the first paint looks right before
// settings load.

export interface Theme {
  name: string;
  label: string;
  light: boolean;
  bg: string;        // app background / canvas clear / node ring
  surface: string;   // header, detail panel
  surface2: string;  // settings sidebar, inputs
  border: string;
  fg: string;        // primary text
  muted: string;     // secondary text / scrollbar
  accent: string;    // title / highlights
  sha: string;       // commit sha
  refBg: string;     // ref chip background
  refFg: string;     // ref chip text
  selectionBg: string;
  lanes: string[];   // 8 graph lane colors
  addBg: string; addFg: string;
  delBg: string; delFg: string;
  hunk: string; fhdr: string;
}

const mocha: Theme = {
  name: "mocha", label: "Catppuccin Mocha", light: false,
  bg: "#1e1e2e", surface: "#181825", surface2: "#11111b", border: "#313244",
  fg: "#cdd6f4", muted: "#9399b2", accent: "#f5c2e7", sha: "#89b4fa",
  refBg: "rgba(166,227,161,0.18)", refFg: "#a6e3a1", selectionBg: "rgba(137,180,250,0.13)",
  lanes: ["#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8", "#cba6f7", "#94e2d5", "#fab387", "#eba0ac"],
  addBg: "rgba(166,227,161,0.13)", addFg: "#a6e3a1",
  delBg: "rgba(243,139,168,0.13)", delFg: "#f38ba8", hunk: "#89dceb", fhdr: "#cba6f7",
};

const macchiato: Theme = {
  name: "macchiato", label: "Catppuccin Macchiato", light: false,
  bg: "#24273a", surface: "#1e2030", surface2: "#181926", border: "#363a4f",
  fg: "#cad3f5", muted: "#939ab7", accent: "#f5bde6", sha: "#8aadf4",
  refBg: "rgba(166,218,149,0.18)", refFg: "#a6da95", selectionBg: "rgba(138,173,244,0.14)",
  lanes: ["#8aadf4", "#a6da95", "#eed49f", "#ed8796", "#c6a0f6", "#8bd5ca", "#f5a97f", "#ee99a0"],
  addBg: "rgba(166,218,149,0.13)", addFg: "#a6da95",
  delBg: "rgba(237,135,150,0.13)", delFg: "#ed8796", hunk: "#91d7e3", fhdr: "#c6a0f6",
};

const latte: Theme = {
  name: "latte", label: "Catppuccin Latte (light)", light: true,
  bg: "#eff1f5", surface: "#e6e9ef", surface2: "#dce0e8", border: "#ccd0da",
  fg: "#4c4f69", muted: "#6c6f85", accent: "#ea76cb", sha: "#1e66f5",
  refBg: "rgba(64,160,43,0.16)", refFg: "#40a02b", selectionBg: "rgba(30,102,245,0.12)",
  lanes: ["#1e66f5", "#40a02b", "#df8e1d", "#d20f39", "#8839ef", "#179299", "#fe640b", "#e64553"],
  addBg: "rgba(64,160,43,0.14)", addFg: "#40a02b",
  delBg: "rgba(210,15,57,0.12)", delFg: "#d20f39", hunk: "#209fb5", fhdr: "#8839ef",
};

const dracula: Theme = {
  name: "dracula", label: "Dracula", light: false,
  bg: "#282a36", surface: "#21222c", surface2: "#191a21", border: "#44475a",
  fg: "#f8f8f2", muted: "#6272a4", accent: "#ff79c6", sha: "#8be9fd",
  refBg: "rgba(80,250,123,0.16)", refFg: "#50fa7b", selectionBg: "rgba(189,147,249,0.18)",
  lanes: ["#bd93f9", "#50fa7b", "#f1fa8c", "#ff79c6", "#8be9fd", "#ffb86c", "#ff5555", "#6272a4"],
  addBg: "rgba(80,250,123,0.12)", addFg: "#50fa7b",
  delBg: "rgba(255,85,85,0.13)", delFg: "#ff5555", hunk: "#8be9fd", fhdr: "#bd93f9",
};

export const THEMES: Record<string, Theme> = { mocha, macchiato, latte, dracula };

export function getTheme(name: string): Theme {
  return THEMES[name] ?? mocha;
}

/** Push a theme's colors into CSS variables on :root (drives all HTML chrome). */
export function applyThemeCss(theme: Theme): void {
  const s = document.documentElement.style;
  const set: Record<string, string> = {
    "--bg": theme.bg, "--surface": theme.surface, "--surface2": theme.surface2,
    "--border": theme.border, "--fg": theme.fg, "--muted": theme.muted,
    "--accent": theme.accent, "--sha": theme.sha, "--ref-bg": theme.refBg, "--ref-fg": theme.refFg,
    "--sel": theme.selectionBg, "--add-bg": theme.addBg, "--add-fg": theme.addFg,
    "--del-bg": theme.delBg, "--del-fg": theme.delFg, "--hunk": theme.hunk, "--fhdr": theme.fhdr,
  };
  for (const [k, v] of Object.entries(set)) s.setProperty(k, v);
  theme.lanes.forEach((c, i) => s.setProperty(`--lane-${i}`, c));
  s.colorScheme = theme.light ? "light" : "dark";
}

export function applyFontCss(family: string, size: number): void {
  const s = document.documentElement.style;
  s.setProperty("--font-family", family);
  s.setProperty("--font-size", `${size}px`);
}
