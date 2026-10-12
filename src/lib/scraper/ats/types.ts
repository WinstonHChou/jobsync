import type { JobBoard } from "@/models/automation.model";
import type { JobDetails } from "../types";

// `host` is optional and Lever-only (Greenhouse ignores it); it's persisted
// once a company is resolved so runtime fetches never re-probe regions.
export type AtsHost = "default" | "eu";

export interface AtsFetchOptions {
  signal?: AbortSignal;
}

export interface AtsSearchResult {
  jobs: JobDetails[];
  errors: { token: string; reason: string }[];
}

export interface AtsProvider {
  id: JobBoard;
  label: string; // display name shown in the wizard/detail UI
  // Fetch a watchlist with bounded concurrency + per-token isolation.
  search(
    companies: { name: string; token: string; host?: AtsHost }[],
    options?: AtsFetchOptions,
  ): Promise<AtsSearchResult>;
  // Providers with separate detail endpoints hydrate only after URL dedup.
  hydrate?(jobs: JobDetails[], options?: AtsFetchOptions): Promise<AtsSearchResult>;
}
