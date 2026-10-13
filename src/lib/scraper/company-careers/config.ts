// Keep fetch tuning independent of the UI icon imports in lib/constants.ts.
export const CAREER_LIMITS = {
  requestTimeoutMs: 15_000,
  searchTimeoutMs: 90_000,
  detailTimeoutMs: 180_000,
  maxBytes: 5 * 1024 * 1024,
  maxPages: 50,
  maxJobs: 1000,
  boardConcurrency: 2,
  detailConcurrency: 4,
  maxRedirects: 4,
} as const;
