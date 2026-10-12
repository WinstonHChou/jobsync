import pLimit from "p-limit";
import { z } from "zod";
import { APP_CONSTANTS } from "@/lib/constants";
import { parseWorkdayBoardUrl, workdayJobUrls } from "@/lib/workdayBoard";
import type { AtsFetchOptions, AtsSearchResult } from "../ats/types";
import type { JobDetails } from "../types";
import { mapWorkdayJob } from "./mapper";

const optionalText = z.string().nullish().transform((value) => value ?? undefined);
const listingSchema = z.object({
  total: z.number().int().nonnegative(),
  jobPostings: z.array(z.object({
    title: z.string().trim().min(1),
    externalPath: z.string().min(1),
    locationsText: optionalText,
  })),
});
const detailSchema = z.object({
  jobPostingInfo: z.object({
    title: z.string().trim().min(1),
    jobDescription: z.string().refine((value) => value.trim().length > 0),
    location: optionalText,
    additionalLocations: z.array(z.string()).nullish().transform((value) => value ?? undefined),
    startDate: optionalText,
    timeType: optionalText,
    remoteType: optionalText,
  }),
});

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : "Could not reach Workday";
}

// One retry for transient responses, honoring Retry-After within the deadline.
async function request(url: string, signal: AbortSignal, body?: object): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.any([signal, AbortSignal.timeout(APP_CONSTANTS.WORKDAY_REQUEST_TIMEOUT_MS)]),
      redirect: "error", // Never follow an unvalidated host from a supplied URL.
      cache: "no-store",
    });
    if (response.ok || response.status === 404) return response;
    await response.body?.cancel();
    if (![429, 502, 503, 504].includes(response.status) || attempt === 1) {
      throw new Error(response.status === 429 ? "rate limited" : `Workday returned ${response.status}`);
    }
    const retry = response.headers.get("retry-after");
    const seconds = retry === null ? NaN : Number(retry);
    const delay = Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry ?? "") - Date.now());
    const wait = Number.isFinite(delay) ? delay : 1000;
    if (wait > 10_000) throw new Error("rate limited — retry on the next run");
    await new Promise<void>((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, wait);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { signal.removeEventListener("abort", abort); abort(); }
    });
  }
}

export async function fetchWorkdayListings(
  name: string,
  token: string,
  options?: AtsFetchOptions & { firstPageOnly?: boolean },
): Promise<AtsSearchResult> {
  const jobs: JobDetails[] = [];
  const errors: AtsSearchResult["errors"] = [];
  const board = parseWorkdayBoardUrl(token);
  if (!board) return { jobs, errors: [{ token, reason: "Invalid Workday careers URL" }] };
  const signal = AbortSignal.any([
    AbortSignal.timeout(APP_CONSTANTS.WORKDAY_LIST_TIMEOUT_MS),
    ...(options?.signal ? [options.signal] : []),
  ]);
  const seen = new Set<string>();
  let offset = 0;
  try {
    for (let page = 0; page < APP_CONSTANTS.WORKDAY_MAX_PAGES; page++) {
      const response = await request(`${board.apiUrl}/jobs`, signal, {
        appliedFacets: {}, limit: APP_CONSTANTS.WORKDAY_PAGE_LIMIT, offset, searchText: "",
      });
      if (response.status === 404) throw new Error("Workday careers site not found (returned 404)");
      const parsed = listingSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Malformed Workday listings");
      const { total, jobPostings } = parsed.data;
      let added = 0;
      for (const entry of jobPostings) {
        const urls = workdayJobUrls(board, entry.externalPath);
        if (!urls) throw new Error("Invalid Workday job path");
        if (seen.has(urls.url)) continue;
        seen.add(urls.url);
        jobs.push({ title: entry.title.trim(), company: name, location: entry.locationsText ?? "", description: "", url: urls.url });
        added++;
      }
      if (jobPostings.length > 0 && !added) {
        throw new Error("Workday pagination repeated a page before all listings were retrieved");
      }
      offset += jobPostings.length;
      if (options?.firstPageOnly || offset >= total) break;
      if (!added) throw new Error("Workday pagination stopped before all listings were retrieved");
      if (page === APP_CONSTANTS.WORKDAY_MAX_PAGES - 1) {
        throw new Error(`Listing limit reached — retrieved ${jobs.length} of ${total} jobs`);
      }
    }
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    errors.push({ token, reason: signal.aborted ? "Workday listings timed out" : failureReason(error) });
  }
  return { jobs, errors };
}

// Summaries first: the runner removes saved URLs before requesting descriptions.
export async function searchWorkdayJobs(
  companies: { name: string; token: string }[],
  options?: AtsFetchOptions,
): Promise<AtsSearchResult> {
  const limit = pLimit(APP_CONSTANTS.WORKDAY_BOARD_CONCURRENCY);
  const results = await Promise.all(companies.map(({ name, token }) =>
    limit(() => fetchWorkdayListings(name, token, options)),
  ));
  options?.signal?.throwIfAborted();
  return { jobs: results.flatMap((r) => r.jobs), errors: results.flatMap((r) => r.errors) };
}

export async function hydrateWorkdayJobs(jobs: JobDetails[], options?: AtsFetchOptions): Promise<AtsSearchResult> {
  const limit = pLimit(APP_CONSTANTS.WORKDAY_DETAIL_CONCURRENCY);
  const signal = AbortSignal.any([
    AbortSignal.timeout(APP_CONSTANTS.WORKDAY_DETAIL_TIMEOUT_MS),
    ...(options?.signal ? [options.signal] : []),
  ]);
  const failures = new Map<string, { count: number; reason: string }>();
  const results = await Promise.all(jobs.map((job) => limit(async () => {
    const board = parseWorkdayBoardUrl(job.url);
    const token = board?.url ?? job.url;
    try {
      if (!board) throw new Error("Invalid Workday job URL");
      const path = new URL(job.url).pathname.slice(new URL(board.url).pathname.length);
      const urls = workdayJobUrls(board, path);
      if (!urls) throw new Error("Invalid Workday job path");
      const response = await request(urls.apiUrl, signal);
      if (response.status === 404) return null; // A posting closed between list and detail.
      const detail = detailSchema.safeParse(await response.json());
      if (!detail.success) throw new Error("Malformed Workday job description");
      return mapWorkdayJob(job, detail.data.jobPostingInfo);
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      const failure = failures.get(token);
      failures.set(token, { count: (failure?.count ?? 0) + 1, reason: signal.aborted ? "description fetch timed out" : failureReason(error) });
      return null;
    }
  })));
  options?.signal?.throwIfAborted();
  return {
    jobs: results.filter((job): job is JobDetails => job !== null),
    errors: [...failures].map(([token, failure]) => ({ token, reason: `${failure.count} job description(s) skipped: ${failure.reason}` })),
  };
}
