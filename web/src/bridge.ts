// Bridge to the Photino host. Each request gets a correlation id; the host echoes it back
// in { id, ok, data | error }. When running in a plain browser (no Photino host present),
// falls back to mock data so the UI can be developed without launching the desktop app.

interface PhotinoExternal {
  sendMessage(message: string): void;
  receiveMessage(handler: (message: string) => void): void;
}

interface HostResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

const ext = (window as unknown as { external?: Partial<PhotinoExternal> }).external;
const hasHost =
  !!ext && typeof ext.sendMessage === "function" && typeof ext.receiveMessage === "function";

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let counter = 0;

if (hasHost) {
  (ext as PhotinoExternal).receiveMessage((raw: string) => {
    let msg: HostResponse;
    try {
      msg = JSON.parse(raw) as HostResponse;
    } catch {
      return;
    }
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.data);
    else p.reject(new Error(msg.error ?? "host error"));
  });
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

export const runningInHost = hasHost;
