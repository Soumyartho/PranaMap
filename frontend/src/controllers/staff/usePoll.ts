import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/services/api/client";

/**
 * Fetch and refresh every `intervalMs` while the tab is visible. Staff views are online web
 * pages; polling keeps them live without a realtime server (swap for Supabase Realtime/SSE later).
 */
export function usePoll<T>(path: string | null, intervalMs = 15_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const res = await api<T>(path);
      if (alive.current) {
        setData(res);
        setError(null);
      }
    } catch (err) {
      if (alive.current) setError((err as Error).message);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    void reload();
    const id = setInterval(() => document.visibilityState === "visible" && void reload(), intervalMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [reload, intervalMs]);

  return { data, error, reload, setData };
}
