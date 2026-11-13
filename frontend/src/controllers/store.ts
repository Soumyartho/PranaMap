import { useSyncExternalStore } from "react";

/**
 * Tiny observable store: components re-render on change, no library needed.
 * Selectors must return stable references (a field, not a freshly filtered array);
 * derive lists with useMemo in the component.
 */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const next = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe,
    use<S>(selector: (s: T) => S): S {
      return useSyncExternalStore(subscribe, () => selector(state));
    },
  };
}
