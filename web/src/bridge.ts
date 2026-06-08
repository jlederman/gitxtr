// Bridge to the Photino host. Each request gets a correlation id; the host echoes it back
// in { id, ok, data | error }. When running in a plain browser (no Photino host present),
// falls back to mock data so the UI can be developed without launching the desktop app.
// The host may also send unsolicited push messages { type, ...payload } with no id.

interface PhotinoExternal {
    sendMessage(message: string): void;
    receiveMessage(handler: (message: string) => void): void;
}

const ext = (window as unknown as { external?: Partial<PhotinoExternal> }).external;
const hasHost =
    !!ext && typeof ext.sendMessage === "function" && typeof ext.receiveMessage === "function";

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
const pushHandlers = new Map<string, (payload: Record<string, unknown>) => void>();
let counter = 0;

if (hasHost) {
    (ext as PhotinoExternal).receiveMessage((raw: string) => {
        let msg: Record<string, unknown>;
        try {
            msg = JSON.parse(raw) as Record<string, unknown>;
        } catch (e) {
            console.warn("Failed to parse host message:", e, raw);
            return;
        }

        // Response to a pending request
        if (typeof msg.id === "string") {
            const p = pending.get(msg.id);
            if (p) {
                pending.delete(msg.id);
                if (msg.ok) p.resolve(msg.data);
                else p.reject(new Error(typeof msg.error === "string" ? msg.error : "host error"));
                return;
            }
        }

        // Unsolicited push from host
        if (typeof msg.type === "string") pushHandlers.get(msg.type)?.(msg);
    });
}

export function onPush(type: string, handler: (payload: Record<string, unknown>) => void): void {
    pushHandlers.set(type, handler);
}

export function request<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
    if (!hasHost) {
        return import("./mock").then((m) => m.mockResponse(type, payload) as T);
    }
    const id = String(++counter);
    return new Promise<T>((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
        (ext as PhotinoExternal).sendMessage(JSON.stringify({ id, type, ...payload }));
    });
}

// Fire-and-forget message to the host: no correlation id, so it bypasses the request/response
// path entirely. Used by the terminal channel (term:*), where input/resize are one-way and
// output arrives via onPush().
export function send(type: string, payload: Record<string, unknown> = {}): void {
    if (hasHost) (ext as PhotinoExternal).sendMessage(JSON.stringify({ type, ...payload }));
}

export const runningInHost = hasHost;
