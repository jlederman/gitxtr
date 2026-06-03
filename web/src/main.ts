import "./style.css";
import { request } from "./bridge";
import { GraphRenderer } from "./graphRenderer";
import { showCommit } from "./detail";
import { initSettings, applyAppearance, type Settings } from "./settings";
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
  detailHeight: 320, repos: [], lastRepo: null,
};

async function boot(): Promise<void> {
  let settings: Settings;
  try {
    settings = await request<Settings>("getSettings");
  } catch {
    settings = DEFAULT_SETTINGS;
  }
  applyAppearance(settings, renderer);
  initSettings({ renderer, settings, getRepoPath: () => null });
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
