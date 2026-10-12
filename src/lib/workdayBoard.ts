// Pure URL helpers shared by validation, the client UI, and the Workday fetcher.
// Persist the canonical board URL as `token`: it includes the tenant, shard,
// and site without introducing provider-specific database columns.
export interface WorkdayBoard {
  url: string;
  origin: string;
  tenant: string;
  site: string;
  apiUrl: string;
}

export function parseWorkdayBoardUrl(input: string): WorkdayBoard | null {
  try {
    if (input.includes("\\")) return null;
    const url = new URL(input.trim());
    const host = url.hostname.match(/^([a-z0-9][a-z0-9-]*)\.wd\d+\.myworkdayjobs\.com$/);
    if (url.protocol !== "https:" || url.port || url.username || url.password || !host) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (/^[a-z]{2,3}-[a-z]{2}$/i.test(parts[0] ?? "")) parts.shift();
    const site = decodeURIComponent(parts.shift() ?? "");
    if (!/^[a-z0-9][a-z0-9_-]{0,199}$/i.test(site)) return null;
    // Accept board links and deep job links, but not API or arbitrary paths.
    if (parts.length && (parts[0] !== "job" || parts.length < 3)) return null;
    const canonical = `${url.origin}/${site}`;
    return {
      url: canonical,
      origin: url.origin,
      tenant: host[1],
      site,
      apiUrl: `${url.origin}/wday/cxs/${host[1]}/${site}`,
    };
  } catch {
    return null;
  }
}

export function workdayJobUrls(board: WorkdayBoard, externalPath: string) {
  try {
    if (!/^\/job\/[^/]+\/[^/]+$/.test(externalPath) || /[\\?#]/.test(externalPath)) return null;
    const parts = externalPath.split("/").slice(2).map(decodeURIComponent);
    if (parts.some((p) => p === "." || p === ".." || /[\/\\]/.test(p))) return null;
    const path = `/job/${parts.map(encodeURIComponent).join("/")}`;
    return { url: `${board.url}${path}`, apiUrl: `${board.apiUrl}${path}` };
  } catch {
    return null;
  }
}
