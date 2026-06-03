import type { GraphView, Row } from "./types";
import { type Theme, THEMES } from "./themes";

const ROW_H = 24;
const COL_W = 16;
const DOT_R = 4.5;
const PAD_L = 14;
const SCROLLBAR_W = 10;

/**
 * Custom-drawn commit graph on a Canvas. The viewport is fixed-size; scrolling is managed in JS
 * (wheel / keyboard / draggable scrollbar) and only the visible rows are drawn, so it scales to
 * very large histories without a giant backing canvas. DPR-aware so it stays crisp on hi-dpi.
 */
export class GraphRenderer {
  private view: GraphView = { rows: [], width: 0, truncated: false };
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private scrollTop = 0;
  private selected = -1;
  private draggingThumb = false;
  private dragOffset = 0;
  private pressY: number | null = null;
  private theme: Theme = THEMES.mocha;
  private fontFamily = "ui-monospace, monospace";
  private fontSize = 13;

  constructor(
    private canvas: HTMLCanvasElement,
    private viewport: HTMLElement,
    private onSelect: (row: Row) => void,
  ) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(viewport);
    viewport.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    canvas.addEventListener("pointermove", (e) => this.onPointerMove(e));
    canvas.addEventListener("pointerup", (e) => this.onPointerUp(e));
    window.addEventListener("keydown", (e) => this.onKey(e));
    this.resize();
  }

  setView(view: GraphView): void {
    this.view = view;
    this.selected = -1;
    this.scrollTop = 0;
    if (view.rows.length > 0) this.select(0);
    else this.draw();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.draw();
  }

  setFont(family: string, size: number): void {
    this.fontFamily = family;
    this.fontSize = size;
    this.draw();
  }

  private select(i: number): void {
    this.selected = i;
    this.ensureVisible(i);
    this.draw();
    this.onSelect(this.view.rows[i]);
  }

  private ensureVisible(i: number): void {
    const top = i * ROW_H;
    const bottom = top + ROW_H;
    if (top < this.scrollTop) this.scrollTop = top;
    else if (bottom > this.scrollTop + this.vh) this.scrollTop = bottom - this.vh;
    this.scrollTop = Math.max(0, Math.min(this.maxScroll(), this.scrollTop));
  }

  // ── geometry ────────────────────────────────────────────────────────────
  private contentHeight(): number {
    return this.view.rows.length * ROW_H;
  }
  private maxScroll(): number {
    return Math.max(0, this.contentHeight() - this.vh);
  }
  private x(col: number): number {
    return PAD_L + col * COL_W + COL_W / 2;
  }
  private textStartX(): number {
    return PAD_L + (this.view.width + 1) * COL_W + 8;
  }

  // ── input ──────────────────────────────────────────────────────────────
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.scrollBy(e.deltaY);
  }
  private onKey(e: KeyboardEvent): void {
    const rows = this.view.rows.length;
    if (rows === 0) return;
    const page = Math.max(1, Math.floor(this.vh / ROW_H) - 1);
    let target: number;
    switch (e.key) {
      case "ArrowDown": target = this.selected + 1; break;
      case "ArrowUp": target = this.selected - 1; break;
      case "PageDown": target = this.selected + page; break;
      case "PageUp": target = this.selected - page; break;
      case "Home": target = 0; break;
      case "End": target = rows - 1; break;
      default: return;
    }
    e.preventDefault();
    // Arrow keys move the selected commit (Git Extensions style); the mouse wheel and
    // scrollbar still free-scroll the page without changing the selection.
    this.select(Math.max(0, Math.min(rows - 1, target)));
  }
  private scrollBy(dy: number): void {
    const next = Math.max(0, Math.min(this.maxScroll(), this.scrollTop + dy));
    if (next !== this.scrollTop) { this.scrollTop = next; this.draw(); }
  }

  private onPointerDown(e: PointerEvent): void {
    const t = this.thumbRect();
    if (t && e.offsetX >= this.vw - SCROLLBAR_W) {
      // start (or jump-then-) dragging the scrollbar thumb
      if (e.offsetY >= t.y && e.offsetY <= t.y + t.h) {
        this.draggingThumb = true;
        this.dragOffset = e.offsetY - t.y;
      } else {
        this.draggingThumb = true;
        this.dragOffset = t.h / 2;
        this.dragThumbTo(e.offsetY);
      }
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    this.pressY = e.offsetY;
  }
  private onPointerMove(e: PointerEvent): void {
    if (this.draggingThumb) this.dragThumbTo(e.offsetY);
  }
  private onPointerUp(e: PointerEvent): void {
    if (this.draggingThumb) {
      this.draggingThumb = false;
      this.canvas.releasePointerCapture(e.pointerId);
      return;
    }
    if (this.pressY !== null && Math.abs(e.offsetY - this.pressY) < 4) {
      const i = Math.floor((e.offsetY + this.scrollTop) / ROW_H);
      if (i >= 0 && i < this.view.rows.length) this.select(i);
    }
    this.pressY = null;
  }
  private dragThumbTo(offsetY: number): void {
    const t = this.thumbRect();
    if (!t) return;
    const travel = this.vh - t.h;
    const frac = travel > 0 ? Math.max(0, Math.min(1, (offsetY - this.dragOffset) / travel)) : 0;
    this.scrollTop = frac * this.maxScroll();
    this.draw();
  }
  private thumbRect(): { y: number; h: number } | null {
    const content = this.contentHeight();
    if (content <= this.vh) return null;
    const h = Math.max(24, (this.vh * this.vh) / content);
    const y = (this.scrollTop / this.maxScroll()) * (this.vh - h);
    return { y, h };
  }

  // ── rendering ────────────────────────────────────────────────────────────
  private resize(): void {
    const rect = this.viewport.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.vw = rect.width;
    this.vh = rect.height;
    this.canvas.style.width = `${this.vw}px`;
    this.canvas.style.height = `${this.vh}px`;
    this.canvas.width = Math.max(1, Math.floor(this.vw * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(this.vh * this.dpr));
    this.scrollTop = Math.min(this.scrollTop, this.maxScroll());
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);

    const rows = this.view.rows;
    if (rows.length === 0) return;

    const first = Math.max(0, Math.floor(this.scrollTop / ROW_H) - 1);
    const last = Math.min(rows.length - 1, Math.ceil((this.scrollTop + this.vh) / ROW_H) + 1);

    // selection highlight band
    if (this.selected >= 0) {
      const sy = this.selected * ROW_H - this.scrollTop;
      ctx.fillStyle = this.theme.selectionBg;
      ctx.fillRect(0, sy, this.vw, ROW_H);
    }

    // edges (drawn under the nodes)
    ctx.lineWidth = 2;
    for (let i = first; i <= last; i++) {
      const row = rows[i];
      const y = i * ROW_H - this.scrollTop + ROW_H / 2;
      const yNext = y + ROW_H;
      for (const e of row.edges) {
        const x1 = this.x(e.from);
        const x2 = this.x(e.to);
        ctx.strokeStyle = this.theme.lanes[e.color % this.theme.lanes.length];
        ctx.beginPath();
        ctx.moveTo(x1, y);
        if (x1 === x2) ctx.lineTo(x2, yNext);
        else ctx.bezierCurveTo(x1, y + ROW_H / 2, x2, y + ROW_H / 2, x2, yNext);
        ctx.stroke();
      }
    }

    // nodes + text
    ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = "middle";
    const textX = this.textStartX();
    for (let i = first; i <= last; i++) {
      const row = rows[i];
      const y = i * ROW_H - this.scrollTop + ROW_H / 2;
      const color = this.theme.lanes[row.color % this.theme.lanes.length];

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(this.x(row.column), y, DOT_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = this.theme.bg;
      ctx.stroke();

      let tx = textX;
      for (const r of row.refs) {
        const w = ctx.measureText(r.name).width + 10;
        ctx.fillStyle = this.theme.refBg;
        roundRect(ctx, tx, y - 9, w, 18, 4);
        ctx.fill();
        ctx.fillStyle = this.theme.refFg;
        ctx.fillText(r.name, tx + 5, y);
        tx += w + 5;
      }
      ctx.fillStyle = this.theme.sha;
      ctx.fillText(row.shortSha, tx, y);
      tx += ctx.measureText(row.shortSha).width + 10;
      ctx.fillStyle = this.theme.fg;
      ctx.fillText(row.summary, tx, y);
    }

    // scrollbar
    const thumb = this.thumbRect();
    if (thumb) {
      ctx.fillStyle = this.theme.muted;
      roundRect(ctx, this.vw - SCROLLBAR_W + 2, thumb.y, SCROLLBAR_W - 4, thumb.h, 3);
      ctx.fill();
    }
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
