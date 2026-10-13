import pLimit from "p-limit";
import { normalizeCareerSiteUrl, parseCareerSiteUrl, requiresCareerSiteAuthorization } from "@/lib/careerSiteUrl";
import { parseWorkdayBoardUrl } from "@/lib/workdayBoard";
import type { AtsFetchOptions, AtsSearchResult } from "../ats/types";
import type { JobDetails } from "../types";
import { searchGreenhouseJobs } from "../greenhouse";
import { searchLeverJobs } from "../lever";
import { searchAshbyJobs } from "../ashby";
import { fetchWorkdayListings, hydrateWorkdayJobs } from "../workday";
import { ATS_TOKEN_REGEX, normalizeJobUrl } from "../utils";
import { CAREER_LIMITS } from "./config";
import { CareerHttpError, fetchCareerPage } from "./http";
import { decodeHtml, parseCareerListings, parseStructuredJobs } from "./parser";

type Vendor = { provider: "greenhouse" | "lever" | "ashby" | "workday"; token: string; host?: "default" | "eu" };
const reason = (error: unknown) => error instanceof Error ? error.message : "Could not read company careers site";
const deadline = (ms: number, signal?: AbortSignal) => AbortSignal.any([AbortSignal.timeout(ms), ...(signal ? [signal] : [])]);

export function detectCareerVendor(input: string): Vendor | null {
  const url = parseCareerSiteUrl(input);
  if (!url) return null;
  if (url.hostname === "careers.withwaymo.com") return { provider: "greenhouse", token: "waymo" };
  const workday = parseWorkdayBoardUrl(input);
  if (workday) return { provider: "workday", token: workday.url };
  let token = url.pathname.split("/").filter(Boolean)[0];
  if (["boards.greenhouse.io", "job-boards.greenhouse.io"].includes(url.hostname)) {
    if (url.pathname === "/embed/job_board") token = url.searchParams.get("for") ?? "";
    return ATS_TOKEN_REGEX.test(token ?? "") ? { provider: "greenhouse", token } : null;
  }
  if (["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname) && ATS_TOKEN_REGEX.test(token ?? "")) return { provider: "lever", token, host: url.hostname.includes(".eu.") ? "eu" : "default" };
  if (url.hostname === "jobs.ashbyhq.com" && ATS_TOKEN_REGEX.test(token ?? "")) return { provider: "ashby", token };
  return null;
}

function embeddedVendor(html: string, base: string): Vendor | null {
  for (const match of html.matchAll(/<(?:a|iframe)\b[^>]*\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(decodeHtml(match[1]), base);
      const vendor = detectCareerVendor(url.href);
      // A link to one posting should not expand to the vendor's entire board.
      if (vendor && (vendor.provider === "workday" ? !url.pathname.includes("/job/") : url.pathname.split("/").filter(Boolean).length === 1 || url.pathname === "/embed/job_board")) return vendor;
    } catch { /* Ignore unrelated links. */ }
  }
  return null;
}

async function searchVendor(name: string, vendor: Vendor, options?: AtsFetchOptions & { firstPageOnly?: boolean }): Promise<AtsSearchResult> {
  const companies = [{ name, token: vendor.token, ...(vendor.host ? { host: vendor.host } : {}) }];
  switch (vendor.provider) {
    case "greenhouse": return searchGreenhouseJobs(companies);
    case "lever": return searchLeverJobs(companies);
    case "ashby": return searchAshbyJobs(companies);
    case "workday": return fetchWorkdayListings(name, vendor.token, options);
  }
}

export async function fetchCompanyCareers(
  name: string, input: string, options?: AtsFetchOptions & { firstPageOnly?: boolean },
): Promise<AtsSearchResult> {
  const token = normalizeCareerSiteUrl(input);
  const jobs: JobDetails[] = [];
  const errors: AtsSearchResult["errors"] = [];
  const signal = deadline(CAREER_LIMITS.searchTimeoutMs, options?.signal);
  try {
    if (!token) throw new Error("Enter a public HTTPS careers URL");
    if (requiresCareerSiteAuthorization(new URL(token))) throw new Error("Meta careers requires an authorized integration and is not supported by this source");
    const vendor = detectCareerVendor(token);
    const runVendor = async (detected: Vendor) => {
      const params = new URL(token).searchParams;
      if ([...params.keys()].some((key) => key !== "for" || detected.provider !== "greenhouse")) throw new Error("Use automation filters for ATS-backed careers sites; URL search filters are not supported");
      const result = await searchVendor(name, detected, { ...options, signal });
      signal.throwIfAborted();
      return { jobs: result.jobs.map((job) => ({ ...job, careerSourceUrl: token, ...(detected.provider === "workday" ? { careerAdapter: "workday" as const } : {}) })), errors: result.errors.map((error) => ({ ...error, token })) };
    };
    if (vendor) return await runVendor(vendor);
    const seenPages = new Set<string>(), seenJobs = new Set<string>();
    let next: string | undefined = token;
    for (let page = 0; next; page++) {
      signal.throwIfAborted();
      if (page >= CAREER_LIMITS.maxPages || jobs.length >= CAREER_LIMITS.maxJobs) throw new Error(`Careers listing limit reached (${jobs.length} jobs); narrow the careers URL filters`);
      if (seenPages.has(next)) throw new Error("Careers pagination repeated a page");
      seenPages.add(next);
      const response = await fetchCareerPage(next, signal);
      if (page === 0) {
        const embedded = embeddedVendor(response.body, response.url);
        if (embedded) return await runVendor(embedded);
      }
      const parsed = parseCareerListings(response.body, response.url, name);
      if (!parsed.supported) throw new Error("This careers page has no supported public job data. Try its job search URL or underlying ATS board; browser-only sites are not supported yet");
      let added = 0;
      for (const job of parsed.jobs) {
        const url = normalizeJobUrl(job.url);
        if (seenJobs.has(url)) continue;
        if (jobs.length >= CAREER_LIMITS.maxJobs) throw new Error(`Careers listing limit reached (${jobs.length} jobs); narrow the careers URL filters`);
        seenJobs.add(url); added++;
        jobs.push({ ...job, url, careerSourceUrl: token });
      }
      if (options?.firstPageOnly) break;
      if (parsed.next && !added) throw new Error("Careers pagination returned no new jobs before completion");
      if (parsed.next && new URL(parsed.next).origin !== new URL(response.url).origin) throw new Error("Careers pagination must stay on the same origin");
      next = parsed.next;
    }
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    errors.push({ token: token ?? input, reason: signal.aborted ? "Company careers search timed out" : reason(error) });
  }
  return { jobs, errors };
}

export async function searchCompanyCareers(companies: { name: string; token: string }[], options?: AtsFetchOptions): Promise<AtsSearchResult> {
  const limit = pLimit(CAREER_LIMITS.boardConcurrency);
  const results = await Promise.all(companies.map(({ name, token }) => limit(() => fetchCompanyCareers(name, token, options))));
  options?.signal?.throwIfAborted();
  return { jobs: results.flatMap((result) => result.jobs), errors: results.flatMap((result) => result.errors) };
}

export async function hydrateCompanyCareers(jobs: JobDetails[], options?: AtsFetchOptions): Promise<AtsSearchResult> {
  const limit = pLimit(CAREER_LIMITS.detailConcurrency);
  const signal = deadline(CAREER_LIMITS.detailTimeoutMs, options?.signal);
  const failures = new Map<string, { count: number; reason: string }>();
  const result = await Promise.all(jobs.map((job) => limit(async () => {
    if (job.description.trim()) return job;
    try {
      if (job.careerAdapter === "workday") {
        const hydrated = await hydrateWorkdayJobs([job], { signal });
        if (hydrated.errors.length) throw new Error(hydrated.errors[0].reason);
        return hydrated.jobs[0] ?? null;
      }
      const response = await fetchCareerPage(job.url, signal);
      const details = parseStructuredJobs(response.body, response.url, job.company);
      const detail = details.find((entry) => normalizeJobUrl(entry.url) === normalizeJobUrl(job.url)) ?? (details.length === 1 ? details[0] : undefined);
      if (!detail) throw new Error("Job detail has no supported structured description");
      return { ...job, ...detail, url: job.url, careerSourceUrl: job.careerSourceUrl };
    } catch (error) {
      if (options?.signal?.aborted) throw error;
      if (error instanceof CareerHttpError && [404, 410].includes(error.status)) return null;
      const token = job.careerSourceUrl ?? job.url, previous = failures.get(token);
      failures.set(token, { count: (previous?.count ?? 0) + 1, reason: signal.aborted ? "description fetch timed out" : reason(error) });
      return null;
    }
  })));
  options?.signal?.throwIfAborted();
  return { jobs: result.filter((job): job is JobDetails => job !== null), errors: [...failures].map(([token, failure]) => ({ token, reason: `${failure.count} job description(s) skipped: ${failure.reason}` })) };
}

export async function resolveCompanyCareers(input: string): Promise<{ name: string; token: string }> {
  const token = normalizeCareerSiteUrl(input);
  if (!token) throw new Error("Enter a public HTTPS careers URL");
  const hostname = new URL(token).hostname;
  const name = hostname === "www.google.com" ? "Google" : hostname === "careers.bcg.com" ? "BCG" : hostname === "careers.withwaymo.com" ? "Waymo" : hostname.replace(/^(?:www|careers|jobs)\./, "").split(".")[0].replace(/[-_]/g, " ");
  const listings = await fetchCompanyCareers(name, token, { firstPageOnly: true });
  if (listings.errors.length) throw new Error(listings.errors[0].reason);
  if (!listings.jobs.length) return { name, token }; // Known ATS or explicit empty listing payload.
  const sample = await hydrateCompanyCareers(listings.jobs.slice(0, 3));
  if (!sample.jobs.length) throw new Error(sample.errors[0]?.reason ?? "No supported job descriptions found on this careers page");
  return { name: ["Google", "BCG", "Waymo"].includes(name) ? name : sample.jobs[0].company || name, token };
}
