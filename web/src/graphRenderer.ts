import type { GraphView, Row } from "./types";
import { type Theme, THEMES } from "./themes";

const ROW_H = 24;
const COL_W = 16;
const DOT_R = 4.5;
const PAD_L = 14;
const PAD_R = 24;
const SCROLLBAR_W = 10;

/**
 * Custom-drawn commit graph on a Canvas. The viewport is fixed-size; scrolling (both axes) is
 * managed in JS — wheel / keyboard / draggable scrollbars — and only the visible rows are drawn,
 * so it scales to very large histories. Content is panned via ctx.translate(-scrollLeft) so long
 * messages and ref chips are reachable horizontally. DPR-aware so it stays crisp on hi-dpi.
 */
export class GraphRenderer {
  private view: GraphView = { rows: [], width: 0, truncated: false };
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private scrollTop = 0;
  private scrollLeft = 0;
  private contentWidth = 0;
  private selected = -1;
  private dragging: "none" | "v" | "h" = "none";
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
    this.scrollLeft = 0;
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

  // ── geometry (content coordinates; scrollLeft applied at draw time) ───────
  private contentHeight(): number {
    return this.view.rows.length * ROW_H;
  }
  private maxScroll(): number {
    return Math.max(0, this.contentHeight() - this.vh);
  }
  private maxScrollX(): number {
    return Math.max(0, this.contentWidth - this.vw);
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
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.shiftKey && dx === 0) { dx = dy; dy = 0; } // shift+wheel → horizontal
    this.scrollBy(dx, dy);
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
    // Arrow keys move the selected commit (Git Extensions style); the wheel and scrollbars
    // still free-scroll without changing the selection.
    this.select(Math.max(0, Math.min(rows - 1, target)));
  }
  private scrollBy(dx: number, dy: number): void {
    const ny = Math.max(0, Math.min(this.maxScroll(), this.scrollTop + dy));
    const nx = Math.max(0, Math.min(this.maxScrollX(), this.scrollLeft + dx));
    if (ny !== this.scrollTop || nx !== this.scrollLeft) {
      this.scrollTop = ny;
      this.scrollLeft = nx;
      this.draw();
    }
  }

  private onPointerDown(e: PointerEvent): void {
    const h = this.hThumbRect();
    if (h && e.offsetY >= this.vh - SCROLLBAR_W) {
      this.dragging = "h";
      this.dragOffset = e.offsetX >= h.x && e.offsetX <= h.x + h.w ? e.offsetX - h.x : h.w / 2;
      this.dragHTo(e.offsetX);
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    const v = this.vThumbRect();
    if (v && e.offsetX >= this.vw - SCROLLBAR_W) {
      this.dragging = "v";
      this.dragOffset = e.offsetY >= v.y && e.offsetY <= v.y + v.h ? e.offsetY - v.y : v.h / 2;
      this.dragVTo(e.offsetY);
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    this.pressY = e.offsetY;
  }
  private onPointerMove(e: PointerEvent): void {
    if (this.dragging === "v") this.dragVTo(e.offsetY);
    else if (this.dragging === "h") this.dragHTo(e.offsetX);
  }
  private onPointerUp(e: PointerEvent): void {
    if (this.dragging !== "none") {
      this.dragging = "none";
      this.canvas.releasePointerCapture(e.pointerId);
      return;
    }
    if (this.pressY !== null && Math.abs(e.offsetY - this.pressY) < 4) {
      const i = Math.floor((e.offsetY + this.scrollTop) / ROW_H);
      if (i >= 0 && i < this.view.rows.length) this.select(i);
    }
    this.pressY = null;
  }
  private dragVTo(offsetY: number): void {
    const v = this.vThumbRect();
    if (!v) return;
    const travel = this.vh - v.h;
    const frac = travel > 0 ? Math.max(0, Math.min(1, (offsetY - this.dragOffset) / travel)) : 0;
    this.scrollTop = frac * this.maxScroll();
    this.draw();
  }
  private dragHTo(offsetX: number): void {
    const h = this.hThumbRect();
    if (!h) return;
    const travel = this.hTrack() - h.w;
    const frac = travel > 0 ? Math.max(0, Math.min(1, (offsetX - this.dragOffset) / travel)) : 0;
    this.scrollLeft = frac * this.maxScrollX();
    this.draw();
  }

  private vThumbRect(): { y: number; h: number } | null {
    const content = this.contentHeight();
    if (content <= this.vh) return null;
    const h = Math.max(24, (this.vh * this.vh) / content);
    const y = (this.scrollTop / this.maxScroll()) * (this.vh - h);
    return { y, h };
  }
  private hTrack(): number {
    return this.vw - (this.vThumbRect() ? SCROLLBAR_W : 0); // leave the corner if v-scrollbar shows
  }
  private hThumbRect(): { x: number; w: number } | null {
    if (this.contentWidth <= this.vw) return null;
    const track = this.hTrack();
    const w = Math.max(24, (track * this.vw) / this.contentWidth);
    const x = (this.scrollLeft / this.maxScrollX()) * (track - w);
    return { x, w };
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
    this.scrollLeft = Math.min(this.scrollLeft, this.maxScrollX());
    this.draw();
  }

  private draw(): void {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);

    const rows = this.view.rows;
    if (rows.length === 0) {
      this.contentWidth = 0;
      return;
    }

    const first = Math.max(0, Math.floor(this.scrollTop / ROW_H) - 1);
    const last = Math.min(rows.length - 1, Math.ceil((this.scrollTop + this.vh) / ROW_H) + 1);

    // selection highlight band — screen coords, spans the full viewport width
    if (this.selected >= 0) {
      const sy = this.selected * ROW_H - this.scrollTop;
      ctx.fillStyle = this.theme.selectionBg;
      ctx.fillRect(0, sy, this.vw, ROW_H);
    }

    // pan content horizontally
    ctx.save();
    ctx.translate(-this.scrollLeft, 0);

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
    let maxRight = 0;
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
      maxRight = Math.max(maxRight, tx + ctx.measureText(row.summary).width);
    }

    ctx.restore();

    // update horizontal extent (from visible rows) and keep scrollLeft in range
    this.contentWidth = maxRight + PAD_R;
    this.scrollLeft = Math.max(0, Math.min(this.maxScrollX(), this.scrollLeft));

    // scrollbars — screen coords
    const v = this.vThumbRect();
    if (v) {
      ctx.fillStyle = this.theme.muted;
      roundRect(ctx, this.vw - SCROLLBAR_W + 2, v.y, SCROLLBAR_W - 4, v.h, 3);
      ctx.fill();
    }
    const h = this.hThumbRect();
    if (h) {
      ctx.fillStyle = this.theme.muted;
      roundRect(ctx, h.x, this.vh - SCROLLBAR_W + 2, h.w, SCROLLBAR_W - 4, 3);
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
