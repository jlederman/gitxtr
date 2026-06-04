import "./style.css";
import { request, onPush } from "./bridge";
import { GraphRenderer } from "./graphRenderer";
import { showCommit, showWorkingTree, initDiffToolbar, initFileNav, initDetailContextMenus } from "./detail";
import { initCommitModal, openCommitModal } from "./commitModal";
import { initSettings, applyAppearance, type Settings } from "./settings";
import { initSplitter } from "./splitter";
import { initRepos, getCurrentRepo } from "./repos";
import { initContextMenu, showContextMenu } from "./contextMenu";
import type { GraphView, Row } from "./types";

// getSettings also returns a resolved currentRepo (CLI arg ▸ lastRepo ▸ first repo) — transient.
type BootSettings = Settings & { currentRepo: string | null };

const canvas   = document.getElementById("graph") as HTMLCanvasElement;
const viewport  = document.getElementById("viewport") as HTMLElement;
const statusEl  = document.getElementById("status") as HTMLElement;
const searchEl  = document.getElementById("search") as HTMLInputElement;

const renderer = new GraphRenderer(
  canvas,
  viewport,
  (row: Row) => {
    statusEl.textContent = row.sha === "WIP" ? row.summary : `${row.shortSha} — ${row.summary}`;
    if (row.sha === "WIP") {
      const repo = getCurrentRepo();
      if (repo) void showWorkingTree(repo);
    } else {
      void showCommit(row.sha);
    }
  },
  (row, x, y) => showContextMenu(
    [
      { label: "Copy short SHA", action: "copy-sha" },
      { label: "Copy full SHA",  action: "copy-full-sha" },
      { label: "Copy message",   action: "copy-message" },
    ],
    { kind: "commit", row },
    x, y,
  ),
);

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
  } catch (e) {
    console.warn("Failed to load settings from host — using defaults:", e);
    settings = DEFAULT_SETTINGS;
  }
  applyAppearance(settings, renderer);
  initSettings({ renderer, settings, getRepoPath: getCurrentRepo });
  // Clamp persisted sizes to the current window so a value saved at a larger window
  // size never collapses the graph pane or the diff pane to zero on boot.
  const maxDetail = window.innerHeight - 140;
  applyDetailHeight(Math.max(90, Math.min(maxDetail, settings.detailHeight)));
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
  initFileNav();
  initCommitModal();

  initContextMenu((action, payload) => {
    const p = payload as Record<string, unknown>;
    if (p.kind === "commit") {
      const row = p.row as { sha: string; shortSha: string; summary: string };
      if (action === "copy-sha")       void navigator.clipboard.writeText(row.shortSha);
      else if (action === "copy-full-sha") void navigator.clipboard.writeText(row.sha);
      else if (action === "copy-message")  void navigator.clipboard.writeText(row.summary);
    } else if (p.kind === "file") {
      if (action === "copy-path") void navigator.clipboard.writeText(p.path as string);
    } else if (p.kind === "diff-line") {
      if (action === "copy-line") void navigator.clipboard.writeText(p.text as string);
    }
  });
  initDetailContextMenus();

  // Auto-refresh: backend pushes repoChanged when .git changes on disk.
  onPush("repoChanged", (payload) => {
    if (payload.repoPath === getCurrentRepo()) void loadGraph(payload.repoPath as string);
  });

  // Manual refresh: F5 or Cmd/Ctrl+R.
  // Shortcuts panel toggle: ? key or the ? button.
  const shortcutsEl = document.getElementById("shortcuts") as HTMLElement;
  const toggleShortcuts = () => { shortcutsEl.hidden = !shortcutsEl.hidden; };
  document.getElementById("open-shortcuts")!.addEventListener("click", toggleShortcuts);
  document.getElementById("shortcuts-close")!.addEventListener("click", () => { shortcutsEl.hidden = true; });
  shortcutsEl.addEventListener("pointerdown", (e) => { if (e.target === shortcutsEl) shortcutsEl.hidden = true; });

  searchEl.addEventListener("input", applyFilter);
  searchEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchEl.value = "";
      applyFilter();
      searchEl.blur();
      renderer.focus();
      e.stopPropagation();
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "F5" || ((e.metaKey || e.ctrlKey) && e.key === "r")) {
      e.preventDefault();
      const repo = getCurrentRepo();
      if (repo) void loadGraph(repo);
    }
    if (e.key === "/" && !e.metaKey && !e.ctrlKey && document.activeElement !== searchEl) {
      e.preventDefault();
      searchEl.focus();
      searchEl.select();
    }
    if (e.key === "?" && !e.metaKey && !e.ctrlKey) toggleShortcuts();
    if (e.ctrlKey && e.code === "Space") {
      e.preventDefault();
      const repo = getCurrentRepo();
      if (repo) void openCommitModal(repo);
    }
    if (e.key === "Escape") shortcutsEl.hidden = true;
  });

  if (settings.currentRepo) await loadGraph(settings.currentRepo);
  else showEmpty();
  renderer.focus();
}

let fullView: GraphView = { rows: [], width: 0, truncated: false };

function makeWipRow(firstReal: Row | undefined): Row {
  return {
    index: -1, sha: "WIP", shortSha: "WIP",
    summary: "Working tree changes",
    author: "", whenIso: "",
    column: 0, color: 0,
    edges: firstReal ? [{ from: 0, to: firstReal.column, color: firstReal.color }] : [],
    refs: [{ name: "WIP", kind: "wip" }],
  };
}

function filterView(view: GraphView, query: string): GraphView {
  const q = query.trim().toLowerCase();
  if (!q) return view;
  const rows = view.rows.filter(r =>
    r.sha.toLowerCase().startsWith(q) ||
    r.shortSha.toLowerCase().startsWith(q) ||
    r.summary.toLowerCase().includes(q) ||
    r.author.toLowerCase().includes(q) ||
    r.refs.some(ref => ref.name.toLowerCase().includes(q))
  );
  return { rows: rows.map(r => ({ ...r, column: 0, edges: [] })), width: 0, truncated: view.truncated };
}

function applyFilter(): void {
  const q = searchEl.value.trim();
  const filtered = filterView(fullView, q);
  // Prepend the WIP row only when not filtering — it doesn't make sense as a search result.
  const display: GraphView = (!q && fullView.hasUncommittedChanges)
    ? { ...filtered, rows: [makeWipRow(fullView.rows[0]), ...filtered.rows] }
    : filtered;
  renderer.setView(display);
  if (q) statusEl.textContent = `${filtered.rows.length} of ${fullView.rows.length} commits match`;
  else statusEl.textContent = `${fullView.rows.length} commits${fullView.truncated ? " (truncated)" : ""}`;
}

async function loadGraph(repo: string): Promise<void> {
  statusEl.textContent = "loading…";
  try {
    fullView = await request<GraphView>("loadGraph", { repoPath: repo });
    applyFilter();
  } catch (e) {
    statusEl.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function showEmpty(): void {
  renderer.setView({ rows: [], width: 0, truncated: false });
  statusEl.textContent = 'No repository — click "+ Repo" to add one';
}

void boot();
