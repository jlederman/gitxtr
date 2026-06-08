import "./splitter.css";

// A draggable horizontal divider. `measure` maps the pointer's clientY to the desired size (px)
// of the region being resized; the result is clamped to [min, max()]. onResize fires live during
// the drag; onCommit fires once on release (to persist).
export function initSplitter(opts: {
    handle: HTMLElement;
    min: number;
    max: () => number;
    measure: (clientY: number) => number;
    onResize: (px: number) => void;
    onCommit: (px: number) => void;
}): void {
    let dragging = false;
    let latest = 0;

    opts.handle.addEventListener("pointerdown", (e) => {
        dragging = true;
        latest = 0;
        opts.handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    opts.handle.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        // Round to whole px: avoids sub-pixel rendering and a fractional value that the host's
        // integer settings parser would reject (which silently dropped persisted sizes).
        latest = Math.round(Math.max(opts.min, Math.min(opts.max(), opts.measure(e.clientY))));
        opts.onResize(latest);
    });
    opts.handle.addEventListener("pointerup", (e) => {
        if (!dragging) return;
        dragging = false;
        opts.handle.releasePointerCapture(e.pointerId);
        if (latest > 0) opts.onCommit(latest);
    });
}
