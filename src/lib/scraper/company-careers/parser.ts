import type { JobDetails } from "../types";
import { parseCareerSiteUrl } from "@/lib/careerSiteUrl";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
export const decodeHtml = (value: string): string => value.replace(/&(?:amp|quot|apos|lt|gt|#39|#x27);/gi, (entity) => ({ "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&#39;": "'", "&#x27;": "'" })[entity.toLowerCase()] ?? entity);

// Extract one JSON value from a script without executing any JavaScript.
export function embeddedJson(html: string, marker: string): unknown {
  const index = html.indexOf(marker);
  if (index < 0) return null;
  const start = index + marker.length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") {
      if (--depth === 0) {
        try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function publicUrl(value: string, base: string): string | null {
  try { return parseCareerSiteUrl(new URL(decodeHtml(value), base).href)?.href ?? null; } catch { return null; }
}

function address(value: unknown): string {
  const place = object(value);
  const addr = object(place.address);
  return [addr.addressLocality, addr.addressRegion, typeof addr.addressCountry === "string" ? addr.addressCountry : object(addr.addressCountry).name]
    .map(text).filter(Boolean).join(", ") || text(place.name);
}

export function parseStructuredJobs(html: string, base: string, company: string, includeSummaries = false): JobDetails[] {
  const jobs: JobDetails[] = [];
  const visit = (value: unknown, depth = 0) => {
    if (depth > 15) return;
    if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
    const item = object(value);
    const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    if (types.includes("JobPosting")) {
      const explicitUrl = text(item.url) || text(object(item.mainEntityOfPage)["@id"]) || text(item.mainEntityOfPage);
      const url = publicUrl(explicitUrl || base, base);
      const title = text(item.title), description = text(item.description);
      if (url && title && (description || (includeSummaries && explicitUrl))) {
        const locations = Array.isArray(item.jobLocation) ? item.jobLocation : [item.jobLocation];
        const remote = item.jobLocationType === "TELECOMMUTE";
        jobs.push({ title, description, url, company: text(object(item.hiringOrganization).name) || company,
          location: locations.map(address).filter(Boolean).join("; ") || (remote ? "Remote" : ""),
          postedDate: text(item.datePosted) || undefined,
          employmentType: Array.isArray(item.employmentType) ? item.employmentType.map(text).join(", ") : text(item.employmentType) || undefined,
          ...(remote ? { isRemote: true, workplaceType: "REMOTE" } : {}),
        });
      }
      return;
    }
    for (const key of ["@graph", "itemListElement", "item", "mainEntity"]) {
      if (item[key]) visit(item[key], depth + 1);
    }
  };
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\btype\s*=\s*["']application\/ld\+json["']/i.test(script[1])) continue;
    try { visit(JSON.parse(script[2])); } catch { /* Malformed unrelated structured data. */ }
  }
  // Missing URLs are valid on a single detail page, but cannot identify
  // multiple postings on a listing page.
  return jobs.length > 1 ? jobs.filter((job) => job.url !== base) : jobs;
}

export interface CareerListings { jobs: JobDetails[]; next?: string; supported: boolean; }

function parseGoogle(html: string, base: string, company: string): CareerListings {
  const script = html.match(/AF_initDataCallback\(\{key:\s*'ds:1'[\s\S]*?data\s*:/)?.[0];
  const value = script ? embeddedJson(html, script) : null;
  if (!Array.isArray(value) || typeof value[2] !== "number" || typeof value[3] !== "number" || value[3] <= 0 ||
    (!Array.isArray(value[0]) && !(value[0] === null && value[2] === 0))) {
    throw new Error("Google careers search data changed or is unavailable");
  }
  const slugs = new Map<string, string>();
  for (const match of html.matchAll(/jobs\/results\/(\d+[^"<>\s?]*)/g)) slugs.set(match[1].split("-")[0], match[1].replace(/\/+$/, ""));
  const jobs = (value[0] ?? []).map((row: unknown) => {
    if (!Array.isArray(row) || !text(row[0]) || !text(row[1])) throw new Error("Malformed Google careers listing");
    const descriptions = [row[10], row[4], row[3]].map((part) => Array.isArray(part) ? text(part[1]) : "").filter(Boolean);
    if (!descriptions.length) throw new Error("Google listing has no description");
    return { title: row[1], company: text(row[7]) || company, description: descriptions.join("\n"),
      location: Array.isArray(row[9]) ? row[9].map((place) => Array.isArray(place) ? text(place[0]) : "").filter(Boolean).join("; ") : "",
      url: new URL(`/about/careers/applications/jobs/results/${slugs.get(row[0]) ?? row[0]}/`, base).href,
    } satisfies JobDetails;
  });
  const url = new URL(base), page = Number(url.searchParams.get("page") ?? 1);
  const hasNext = page * value[3] < value[2];
  if (hasNext) url.searchParams.set("page", String(page + 1));
  return { jobs, supported: true, next: hasNext ? url.href : undefined };
}

function parsePhenom(html: string, base: string, company: string): CareerListings | null {
  const match = html.match(/"eagerLoadRefineSearch"\s*:\s*/);
  if (!match) return null;
  const payload = object(embeddedJson(html, match[0]));
  const entries = object(payload.data).jobs;
  if (payload.status !== 200 || !Array.isArray(entries) || typeof payload.totalHits !== "number") throw new Error("Malformed Phenom careers listings");
  const root = new URL(base);
  const locale = root.pathname.match(/^\/(.+?)\/search-results/);
  if (!locale) throw new Error("Paste the Phenom search-results URL");
  const jobs = entries.map((entry) => {
    const row = object(entry), title = text(row.title), id = text(row.jobSeqNo);
    if (!title || !/^[a-z0-9_-]+$/i.test(id)) throw new Error("Malformed Phenom job identifier");
    return { title, company, description: "", location: Array.isArray(row.multi_location) ? row.multi_location.map(text).join("; ") : text(row.location),
      employmentType: text(row.type) || undefined, postedDate: text(row.postedDate) || undefined,
      url: new URL(`/${locale[1]}/job/${id}`, root).href,
    } satisfies JobDetails;
  });
  const from = Number(root.searchParams.get("from") ?? 0) + entries.length;
  const hasNext = from < payload.totalHits;
  if (hasNext && !entries.length) throw new Error("Phenom pagination stopped before all listings were retrieved");
  if (hasNext) { root.searchParams.set("from", String(from)); root.searchParams.set("s", "1"); }
  return { jobs, supported: true, next: hasNext ? root.href : undefined };
}

export function parseCareerListings(html: string, base: string, company: string): CareerListings {
  const root = new URL(base);
  if (root.hostname === "www.google.com" && root.pathname.startsWith("/about/careers/applications/")) return parseGoogle(html, base, company);
  const phenom = parsePhenom(html, base, company);
  if (phenom) return phenom;
  const jobs = parseStructuredJobs(html, base, company, true);
  const seen = new Set(jobs.map((job) => job.url));
  let next: string | undefined;
  for (const link of html.matchAll(/<link\b([^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*)>/gi)) {
    const url = publicUrl(link[2], base);
    if (url && new URL(url).origin === root.origin && /\brel\s*=\s*["']next["']/i.test(link[1])) next = url;
  }
  for (const anchor of html.matchAll(/<a\b([^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const url = publicUrl(anchor[2], base);
    if (!url || new URL(url).origin !== root.origin) continue;
    if (/\brel\s*=\s*["']next["']/i.test(anchor[1]) || /^\s*(?:next|next page)\s*(?:[›»→])?\s*$/i.test(anchor[3].replace(/<[^>]+>/g, ""))) { next = url; continue; }
    if (!/\/(?:jobs?|positions?|requisitions?)\/[a-z0-9][a-z0-9_-]{2,}/i.test(new URL(url).pathname) || /\/jobs?\/(?:search|results|categories)(?:\/|$)/i.test(new URL(url).pathname)) continue;
    const title = decodeHtml(anchor[3].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
    if (!title || title.length > 300 || seen.has(url)) continue;
    seen.add(url); jobs.push({ title, company, location: "", description: "", url });
  }
  return { jobs, next, supported: jobs.length > 0 };
}
