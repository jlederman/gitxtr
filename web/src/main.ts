import "./style.css";
import { request } from "./bridge";
import { GraphRenderer } from "./graphRenderer";
import { showCommit, initDiffToolbar } from "./detail";
import { initSettings, applyAppearance, type Settings } from "./settings";
import { initSplitter } from "./splitter";
import { initRepos, getCurrentRepo } from "./repos";
import type { GraphView, Row } from "./types";

// getSettings also returns a resolved currentRepo (CLI arg ▸ lastRepo ▸ first repo) — transient.
type BootSettings = Settings & { currentRepo: string | null };

const canvas = document.getElementById("graph") as HTMLCanvasElement;
const viewport = document.getElementById("viewport") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;

const renderer = new GraphRenderer(canvas, viewport, (row: Row) => {
  statusEl.textContent = `${row.shortSha} — ${row.summary}`;
  void showCommit(row.sha);
});

const DEFAULT_SETTINGS: BootSettings = {
  theme: "mocha", fontFamily: "ui-monospace, monospace", fontSize: 13,
  detailHeight: 320, detailTopHeight: 200, detailMetaHeight: 120, diffView: "unified",
  repos: [], lastRepo: null, currentRepo: null,
};

function applyDetailHeight(px: number): void {
  document.documentElement.style.setProperty("--detail-height", `${px}px`);
}
function applyDetailTopHeight(px: number): void {
  document.documentElement.style.setProperty("--detail-top-height", `${px}px`);
}
function applyDetailMetaHeight(px: number): void {
  document.documentElement.style.setProperty("--detail-meta-height", `${px}px`);
}

async function boot(): Promise<void> {
  let settings: BootSettings;
  try {
    settings = await request<BootSettings>("getSettings");
  } catch {
    settings = DEFAULT_SETTINGS;
  }
  applyAppearance(settings, renderer);
  initSettings({ renderer, settings, getRepoPath: getCurrentRepo });
  applyDetailHeight(settings.detailHeight);
  applyDetailTopHeight(settings.detailTopHeight);
  applyDetailMetaHeight(settings.detailMetaHeight);

  const detailEl = document.getElementById("detail") as HTMLElement;
  const detailTopEl = document.getElementById("detail-top") as HTMLElement;
  // Outer divider: graph ↔ detail panel.
  initSplitter({
    handle: document.getElementById("vsplit") as HTMLElement,
    min: 90,
    max: () => window.innerHeight - 140,
    measure: (y) => window.innerHeight - y,
    onResize: applyDetailHeight,
    onCommit: (px) => void request("saveSettings", { settings: { detailHeight: px } }),
  });
  // Inner divider: (commit info + changed files) ↔ diff.
  initSplitter({
    handle: document.getElementById("dsplit") as HTMLElement,
    min: 60,
    max: () => detailEl.clientHeight - 80,
    measure: (y) => y - detailEl.getBoundingClientRect().top,
    onResize: applyDetailTopHeight,
    onCommit: (px) => void request("saveSettings", { settings: { detailTopHeight: px } }),
  });
  // Divider within the detail panel: commit message ↔ changed files.
  initSplitter({
    handle: document.getElementById("msplit") as HTMLElement,
    min: 40,
    max: () => detailTopEl.clientHeight - 50,
    measure: (y) => y - detailTopEl.getBoundingClientRect().top,
    onResize: applyDetailMetaHeight,
    onCommit: (px) => void request("saveSettings", { settings: { detailMetaHeight: px } }),
  });

  initRepos({
    repos: settings.repos,
    current: settings.currentRepo,
    onSwitch: (repo) => (repo ? void loadGraph(repo) : showEmpty()),
  });

  initDiffToolbar(settings.diffView, (m) => void request("saveSettings", { settings: { diffView: m } }));

  if (settings.currentRepo) await loadGraph(settings.currentRepo);
  else showEmpty();
}

async function loadGraph(repo: string): Promise<void> {
  statusEl.textContent = "loading…";
  try {
    const view = await request<GraphView>("loadGraph", { repoPath: repo });
    renderer.setView(view);
    statusEl.textContent = `${view.rows.length} commits${view.truncated ? " (truncated)" : ""}`;
  } catch (e) {
    statusEl.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function showEmpty(): void {
  renderer.setView({ rows: [], width: 0, truncated: false });
  statusEl.textContent = 'No repository — click "+ Repo" to add one';
}

void boot();
