import "./contextMenu.css";

type MenuItem = { label: string; action: string };
type ActionHandler = (action: string, payload: unknown) => void;

let activePayload: unknown = null;
let onAction: ActionHandler = () => {};

const menuEl = () => document.getElementById("ctx-menu") as HTMLElement;

export function initContextMenu(handler: ActionHandler): void {
    onAction = handler;

    menuEl().addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
        if (btn?.dataset.action != null) {
            onAction(btn.dataset.action, activePayload);
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

export function showContextMenu(
    items: MenuItem[],
    payload: unknown,
    clientX: number,
    clientY: number,
): void {
    activePayload = payload;
    const menu = menuEl();
    menu.innerHTML = items
        .map((i) => `<button data-action="${i.action}">${i.label}</button>`)
        .join("");
    menu.hidden = false;
    const { offsetWidth: w, offsetHeight: h } = menu;
    menu.style.left = `${Math.min(clientX, window.innerWidth - w - 4)}px`;
    menu.style.top = `${Math.min(clientY, window.innerHeight - h - 4)}px`;
}

function hide(): void {
    menuEl().hidden = true;
    activePayload = null;
}
