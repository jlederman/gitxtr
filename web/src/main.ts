import "./style.css";
import { request, onPush } from "./bridge";
import { GraphRenderer } from "./graphRenderer";
import { showCommit, showWorkingTree, initDiffToolbar, initFileNav, initDetailContextMenus } from "./detail";
import { initCommitModal, openCommitModal } from "./commitModal";
import { initRebaseModal, openRebaseModal } from "./rebaseModal";
import { initSettings, applyAppearance, type Settings } from "./settings";
import { initSplitter } from "./splitter";
import { initRepos, getCurrentRepo } from "./repos";
import { initContextMenu, showContextMenu } from "./contextMenu";
import type { GraphView, Row } from "./types";

// getSettings also returns a resolved currentRepo (CLI arg ▸ lastRepo ▸ first repo) — transient.
type BootSettings = Settings & { currentRepo: string | null };

const canvas     = document.getElementById("graph") as HTMLCanvasElement;
const viewport   = document.getElementById("viewport") as HTMLElement;
const statusEl   = document.getElementById("status") as HTMLElement;
const searchEl   = document.getElementById("search") as HTMLInputElement;
const branchSel  = document.getElementById("branch-select") as HTMLSelectElement;

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
  (row, x, y) => {
    const items: { label: string; action: string }[] = [];
    const localBranches = row.refs.filter(r => r.kind === "LocalBranch");
    for (const ref of localBranches) {
      items.push({ label: `Checkout ${ref.name}`, action: `branch:checkout:${ref.name}` });
    }
    for (const ref of localBranches) {
      items.push({ label: `Delete ${ref.name}`, action: `branch:delete:${ref.name}` });
    }
    for (const ref of localBranches) {
      items.push({ label: `Rename ${ref.name}…`, action: `branch:rename:${ref.name}` });
    }
    items.push({ label: "Create branch here…", action: "branch:create" });
    if (row.sha !== "WIP") {
      items.push(
        { label: "Revert commit",              action: "commit:revert" },
        { label: "Cherry-pick commit",         action: "commit:cherry-pick" },
        { label: "Interactive rebase from here…", action: "commit:irebase" },
      );
    }
    items.push(
      { label: "Copy short SHA", action: "copy-sha" },
      { label: "Copy full SHA",  action: "copy-full-sha" },
      { label: "Copy message",   action: "copy-message" },
    );
    showContextMenu(items, { kind: "commit", row }, x, y);
  },
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
  // Minimum visible heights for each pane (excluding splitter handles):
  //   diff ≥ 80px, file list ≥ 60px, meta ≥ 60px
  // → detail-top min = 60 (meta) + 6 (msplit) + 60 (files) = 126 → 130
  // → detail min     = 130 (top) + 6 (dsplit) + 80 (diff)  = 216 → 220
  const DETAIL_MIN   = 220;
  const TOP_MIN      = 130;
  const META_MIN     = 60;
  const DIFF_RESERVE = 86;  // 6px dsplit + 80px diff
  const FILE_RESERVE = 66;  // 6px msplit + 60px files

  // Clamp all three sizes on boot: each inner pane must fit inside its container.
  const maxDetail = window.innerHeight - 140;
  let curDetailHeight     = Math.max(DETAIL_MIN, Math.min(maxDetail, settings.detailHeight));
  let curDetailTopHeight  = Math.max(TOP_MIN,    Math.min(curDetailHeight - DIFF_RESERVE, settings.detailTopHeight));
  let curDetailMetaHeight = Math.max(META_MIN,   Math.min(curDetailTopHeight - FILE_RESERVE, settings.detailMetaHeight));
  applyDetailHeight(curDetailHeight);
  applyDetailTopHeight(curDetailTopHeight);
  applyDetailMetaHeight(curDetailMetaHeight);

  const detailEl = document.getElementById("detail") as HTMLElement;
  const detailTopEl = document.getElementById("detail-top") as HTMLElement;
  // Outer divider: graph ↔ detail panel.
  initSplitter({
    handle: document.getElementById("vsplit") as HTMLElement,
    min: DETAIL_MIN,
    max: () => window.innerHeight - 140,
    measure: (y) => window.innerHeight - y,
    onResize: (px) => {
      curDetailHeight = px;
      applyDetailHeight(px);
      // Cascade: shrink inner panes if they no longer fit.
      const cappedTop = Math.min(curDetailTopHeight, px - DIFF_RESERVE);
      if (cappedTop < curDetailTopHeight) {
        curDetailTopHeight = Math.max(TOP_MIN, cappedTop);
        applyDetailTopHeight(curDetailTopHeight);
        const cappedMeta = Math.min(curDetailMetaHeight, curDetailTopHeight - FILE_RESERVE);
        if (cappedMeta < curDetailMetaHeight) {
          curDetailMetaHeight = Math.max(META_MIN, cappedMeta);
          applyDetailMetaHeight(curDetailMetaHeight);
        }
      }
    },
    onCommit: (px) => void request("saveSettings", { settings: { detailHeight: px } }),
  });
  // Inner divider: (commit info + changed files) ↔ diff.
  initSplitter({
    handle: document.getElementById("dsplit") as HTMLElement,
    min: TOP_MIN,
    max: () => curDetailHeight - DIFF_RESERVE,
    measure: (y) => y - detailEl.getBoundingClientRect().top,
    onResize: (px) => {
      curDetailTopHeight = px;
      applyDetailTopHeight(px);
      // Cascade: shrink meta pane if it no longer fits.
      const cappedMeta = Math.min(curDetailMetaHeight, px - FILE_RESERVE);
      if (cappedMeta < curDetailMetaHeight) {
        curDetailMetaHeight = Math.max(META_MIN, cappedMeta);
        applyDetailMetaHeight(curDetailMetaHeight);
      }
    },
    onCommit: (px) => void request("saveSettings", { settings: { detailTopHeight: px } }),
  });
  // Divider within the detail panel: commit message ↔ changed files.
  initSplitter({
    handle: document.getElementById("msplit") as HTMLElement,
    min: META_MIN,
    max: () => curDetailTopHeight - FILE_RESERVE,
    measure: (y) => y - detailTopEl.getBoundingClientRect().top,
    onResize: (px) => { curDetailMetaHeight = px; applyDetailMetaHeight(px); },
    onCommit: (px) => void request("saveSettings", { settings: { detailMetaHeight: px } }),
  });

  initRepos({
    repos: settings.repos,
    current: settings.currentRepo,
    onSwitch: (repo) => (repo ? void loadGraph(repo) : showEmpty()),
  });

  branchSel.hidden = true;
  branchSel.addEventListener("change", () => {
    const name = branchSel.value;
    const repo = getCurrentRepo();
    if (repo && name) void branchOp(repo, "checkout", { name });
  });

  initDiffToolbar(settings.diffView, (m) => void request("saveSettings", { settings: { diffView: m } }));
  initFileNav();
  initCommitModal();
  initRebaseModal();

  initContextMenu((action, payload) => {
    const p = payload as Record<string, unknown>;
    if (p.kind === "commit") {
      const row = p.row as Row;
      const repo = getCurrentRepo();
      if (action === "copy-sha")           void navigator.clipboard.writeText(row.shortSha);
      else if (action === "copy-full-sha") void navigator.clipboard.writeText(row.sha);
      else if (action === "copy-message")  void navigator.clipboard.writeText(row.summary);
      else if (action.startsWith("branch:checkout:")) {
        const name = action.slice("branch:checkout:".length);
        if (repo) void branchOp(repo, "checkout", { name });
      } else if (action.startsWith("branch:delete:")) {
        const name = action.slice("branch:delete:".length);
        if (repo && confirm(`Delete branch "${name}"?`)) void branchOp(repo, "delete", { name });
      } else if (action.startsWith("branch:rename:")) {
        const oldName = action.slice("branch:rename:".length);
        const newName = prompt(`Rename "${oldName}" to:`)?.trim();
        if (repo && newName) void branchOp(repo, "rename", { oldName, newName });
      } else if (action === "branch:create") {
        const name = prompt("New branch name:")?.trim();
        if (repo && name) void branchOp(repo, "create", { name, sha: row.sha, checkout: true });
      } else if (action === "commit:revert") {
        if (repo && confirm(`Revert "${row.summary}"?\n\nA new commit will be created that undoes these changes.`))
          void commitOp(repo, "revert", row.sha);
      } else if (action === "commit:cherry-pick") {
        if (repo && confirm(`Cherry-pick "${row.summary}" onto the current branch?`))
          void commitOp(repo, "cherryPick", row.sha);
      } else if (action === "commit:irebase") {
        if (repo) {
          const toRebase = firstParentChain(fullView.rows, row.sha);
          if (!toRebase) {
            alert(`"${row.summary}" is not on the current branch's linear history and cannot be used as a rebase base.`);
          } else {
            openRebaseModal(toRebase, repo);
          }
        }
      }
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

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

// Walk the first-parent chain from HEAD to targetSha. Returns commits oldest-first
// (matching git rebase -i convention), or null if targetSha is not on the chain.
function firstParentChain(rows: Row[], targetSha: string): Row[] | null {
  const bysha = new Map(rows.map(r => [r.sha, r]));
  const head = rows.find(r => r.sha !== "WIP");
  if (!head) return null;
  const chain: Row[] = [];
  let cur: Row | undefined = head;
  while (cur) {
    chain.push(cur);
    if (cur.sha === targetSha) return chain.reverse();
    cur = bysha.get(cur.parents[0] ?? "");
  }
  return null;
}

function textMatchesSha(q: string, row: Row): boolean {
  return row.sha.toLowerCase().startsWith(q) ||
    row.shortSha.toLowerCase().startsWith(q) ||
    row.summary.toLowerCase().includes(q) ||
    row.author.toLowerCase().includes(q) ||
    row.refs.some(ref => ref.name.toLowerCase().includes(q));
}

function applyFilter(): void {
  const raw = searchEl.value.trim();

  if (!raw) {
    renderer.setFilter(null);
    const display: GraphView = fullView.hasUncommittedChanges
      ? { ...fullView, rows: [makeWipRow(fullView.rows[0]), ...fullView.rows] }
      : fullView;
    renderer.setView(display);
    statusEl.textContent = `${fullView.rows.length} commits${fullView.truncated ? " (truncated)" : ""}`;
    return;
  }

  if (raw.startsWith("path:")) {
    const filePath = raw.slice(5).trim();
    if (!filePath) return;
    const repo = getCurrentRepo();
    if (!repo) return;
    void applyPathFilter(repo, filePath);
    return;
  }

  if (raw.startsWith("date:")) {
    applyDateFilter(raw.slice(5).trim());
    return;
  }

  // Text search: dim non-matching rows in the graph to preserve structure.
  const q = raw.toLowerCase();
  const matchSet = new Set(fullView.rows.filter(r => textMatchesSha(q, r)).map(r => r.sha));
  renderer.setFilter(matchSet);
  renderer.setView(fullView);
  statusEl.textContent = `${matchSet.size} of ${fullView.rows.length} commits match`;
}

async function applyPathFilter(repo: string, filePath: string): Promise<void> {
  statusEl.textContent = "searching…";
  try {
    const shas = await request<string[]>("getCommitsByPath", { repoPath: repo, path: filePath });
    const shaSet = new Set(shas);
    const matched = fullView.rows.filter(r => shaSet.has(r.sha));
    const display: GraphView = { rows: matched.map(r => ({ ...r, column: 0, edges: [] })), width: 0, truncated: fullView.truncated };
    renderer.setFilter(null);
    renderer.setView(display);
    statusEl.textContent = `${matched.length} commits touch ${filePath}`;
  } catch (e) {
    statusEl.textContent = `path filter error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function applyDateFilter(spec: string): void {
  let from: Date | null = null;
  let to: Date | null = null;

  if (spec.includes("..")) {
    const idx = spec.indexOf("..");
    const fromStr = spec.slice(0, idx).trim();
    const toStr   = spec.slice(idx + 2).trim();
    if (fromStr) from = new Date(fromStr + "T00:00:00");
    if (toStr)   to   = new Date(toStr   + "T23:59:59");
  } else if (spec) {
    from = new Date(spec + "T00:00:00");
    to   = new Date(spec + "T23:59:59");
  }

  if (!from && !to) return;

  const matched = fullView.rows.filter(r => {
    if (!r.whenIso) return false;
    const d = new Date(r.whenIso);
    if (from && d < from) return false;
    if (to   && d > to)   return false;
    return true;
  });

  const display: GraphView = {
    rows: matched.map(r => ({ ...r, column: 0, edges: [] })),
    width: 0,
    truncated: fullView.truncated,
  };
  renderer.setFilter(null);
  renderer.setView(display);
  statusEl.textContent = `${matched.length} commits in date range`;
}

async function branchOp(repo: string, op: string, params: Record<string, unknown>): Promise<void> {
  try {
    await request<null>("branchOp", { repoPath: repo, op, ...params });
    void loadGraph(repo);
  } catch (e) {
    alert(`Branch operation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function commitOp(repo: string, op: string, sha: string): Promise<void> {
  try {
    await request<null>("commitOp", { repoPath: repo, op, sha });
    void loadGraph(repo);
  } catch (e) {
    alert(`Operation failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function loadGraph(repo: string): Promise<void> {
  statusEl.textContent = "loading…";
  try {
    const [graph] = await Promise.all([
      request<GraphView>("loadGraph", { repoPath: repo }),
      loadBranches(repo),
    ]);
    fullView = graph;
    applyFilter();
  } catch (e) {
    statusEl.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function loadBranches(repo: string): Promise<void> {
  try {
    const list = await request<{ name: string; isHead: boolean }[]>("getBranches", { repoPath: repo });
    const hasCurrent = list.some(b => b.isHead);
    branchSel.innerHTML =
      (!hasCurrent ? '<option value="" disabled selected>(detached HEAD)</option>' : "") +
      list.map(b =>
        `<option value="${esc(b.name)}"${b.isHead ? " selected" : ""}>${esc(b.name)}</option>`
      ).join("");
    branchSel.hidden = false;
  } catch {
    branchSel.hidden = true;
  }
}

function showEmpty(): void {
  renderer.setView({ rows: [], width: 0, truncated: false });
  statusEl.textContent = 'No repository — click "+ Repo" to add one';
  branchSel.hidden = true;
  branchSel.innerHTML = "";
}

void boot();
