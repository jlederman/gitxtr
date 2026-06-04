import type { Row } from "./types";

type ActionHandler = (action: string, row: Row) => void;

let activeRow: Row | null = null;
let onAction: ActionHandler = () => {};

const menuEl = () => document.getElementById("ctx-menu") as HTMLElement;

export function initContextMenu(handler: ActionHandler): void {
  onAction = handler;

  menuEl().addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (btn?.dataset.action && activeRow) {
      onAction(btn.dataset.action, activeRow);
      hide();
    }
  });

  document.addEventListener("pointerdown", (e) => {
    if (!menuEl().contains(e.target as Node)) hide();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}

export function showContextMenu(row: Row, clientX: number, clientY: number): void {
  activeRow = row;
  const menu = menuEl();
  menu.hidden = false;
  // Nudge inside viewport
  const { offsetWidth: w, offsetHeight: h } = menu;
  menu.style.left = `${Math.min(clientX, window.innerWidth  - w - 4)}px`;
  menu.style.top  = `${Math.min(clientY, window.innerHeight - h - 4)}px`;
}

function hide(): void {
  menuEl().hidden = true;
  activeRow = null;
}
