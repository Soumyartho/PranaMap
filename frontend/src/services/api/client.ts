/** Thin fetch wrapper. Every call has a timeout: on rural 2G a hung request is worse than a failed one. */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api";
let token: string | null = null;

export const setToken = (value: string | null) => {
  token = value;
};

/** Authenticated binary download (audio, files) as a Blob. */
export async function apiBlob(path: string): Promise<Blob> {
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  return res.blob();
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers, body, signal: controller.signal });
    if (!res.ok) {
      let message = res.statusText;
      try {
        message = (await res.json()).detail ?? message;
      } catch {
        /* not JSON */
      }
      throw new ApiError(res.status, typeof message === "string" ? message : JSON.stringify(message));
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, "offline");
  } finally {
    clearTimeout(timer);
  }
}
