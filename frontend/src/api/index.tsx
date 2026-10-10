import { createContext, useContext, type ReactNode } from "react";

import { ENDPOINTS, type Endpoint, type LatelyApi } from "./contract";

/**
 * Endpoints served by the FastAPI backend in live mode — all of them. Anything left out of
 * this set would be answered by demo data instead (kept for partial backends and tests).
 */
export const LIVE_ENDPOINTS: ReadonlySet<Endpoint> = new Set<Endpoint>(ENDPOINTS);

export function createApi(o: {
  mode: "demo" | "live";
  demo: LatelyApi;
  http: LatelyApi;
  live?: ReadonlySet<Endpoint>;
}): LatelyApi {
  if (o.mode === "demo") return o.demo;
  const live = o.live ?? LIVE_ENDPOINTS;
  return new Proxy({} as LatelyApi, {
    get(_target, name: string) {
      const impl = live.has(name as Endpoint) ? o.http : o.demo;
      const fn = impl[name as Endpoint] as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => fn.apply(impl, args);
    },
  });
}

const ApiContext = createContext<LatelyApi | null>(null);

export function ApiProvider({ api, children }: { api: LatelyApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): LatelyApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used inside <ApiProvider>");
  return api;
}
