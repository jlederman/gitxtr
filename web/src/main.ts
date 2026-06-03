import "./style.css";
import { request } from "./bridge";
import { GraphRenderer } from "./graphRenderer";
import { showCommit } from "./detail";
import { initSettings, applyAppearance, type Settings } from "./settings";
import { initSplitter } from "./splitter";
import type { GraphView, Row } from "./types";

const canvas = document.getElementById("graph") as HTMLCanvasElement;
const viewport = document.getElementById("viewport") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;

const renderer = new GraphRenderer(canvas, viewport, (row: Row) => {
  statusEl.textContent = `${row.shortSha} — ${row.summary}`;
  void showCommit(row.sha);
});

const DEFAULT_SETTINGS: Settings = {
  theme: "mocha", fontFamily: "ui-monospace, monospace", fontSize: 13,
  detailHeight: 320, detailTopHeight: 200, repos: [], lastRepo: null,
};

function applyDetailHeight(px: number): void {
  document.documentElement.style.setProperty("--detail-height", `${px}px`);
}

function applyDetailTopHeight(px: number): void {
  document.documentElement.style.setProperty("--detail-top-height", `${px}px`);
}

async function boot(): Promise<void> {
  let settings: Settings;
  try {
    settings = await request<Settings>("getSettings");
  } catch {
    settings = DEFAULT_SETTINGS;
  }
  applyAppearance(settings, renderer);
  initSettings({ renderer, settings, getRepoPath: () => null });
  applyDetailHeight(settings.detailHeight);
  applyDetailTopHeight(settings.detailTopHeight);
  const detailEl = document.getElementById("detail") as HTMLElement;
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
  await loadGraph();
}

async function loadGraph(): Promise<void> {
  statusEl.textContent = "loading…";
  try {
    const view = await request<GraphView>("loadGraph");
    renderer.setView(view);
    statusEl.textContent = `${view.rows.length} commits${view.truncated ? " (truncated)" : ""}`;
  } catch (e) {
    statusEl.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

void boot();
