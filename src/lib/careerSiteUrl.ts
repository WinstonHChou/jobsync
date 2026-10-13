// Client-safe validation. The server also resolves and pins public DNS addresses
// for every request and redirect; URL validation alone cannot prevent rebinding.
export function isPublicCareerIp(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
    const [a, b, c, d] = ip.split(".").map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return false;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && [18, 19].includes(b)) ||
      (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113));
  }
  if (!/^[a-f0-9:]+$/.test(ip) || !ip.includes(":")) return false;
  const [first, second] = ip.split(":").map((p) => parseInt(p || "0", 16));
  // Global unicast only; exclude documentation and IPv4 transition ranges.
  return first >= 0x2000 && first < 0x4000 && first !== 0x2002 && first !== 0x3fff &&
    !(first === 0x2001 && [0, 0xdb8].includes(second));
}

export function parseCareerSiteUrl(input: string): URL | null {
  try {
    if (input.length > 2048 || input.includes("\\")) return null;
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || url.port || url.username || url.password) return null;
    url.hostname = url.hostname.replace(/\.$/, "");
    const host = url.hostname;
    if (!host.includes(".") && !host.startsWith("[")) return null;
    if (/(^|\.)(localhost|local|internal|lan|home|corp|onion)$/.test(host)) return null;
    if ((host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) && !isPublicCareerIp(host)) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

export function requiresCareerSiteAuthorization(url: URL): boolean {
  return url.hostname === "metacareers.com" || url.hostname.endsWith(".metacareers.com");
}

export function normalizeCareerSiteUrl(input: string): string | null {
  const url = parseCareerSiteUrl(input);
  if (!url) return null;
  for (const key of [...url.searchParams.keys()]) {
    if (/^(page|pagenumber|offset|from|cursor|utm_.*|gh_src|ref|source)$/i.test(key)) url.searchParams.delete(key);
  }
  if (url.hostname === "www.google.com" && /^\/about\/careers\/applications(?:\/|$)/.test(url.pathname)) {
    url.pathname = "/about/careers/applications/jobs/results/";
  }
  if (url.hostname === "careers.withwaymo.com") {
    url.pathname = "/jobs/search";
  }
  if (url.hostname === "careers.bcg.com" && !/\/search-results\/?$/.test(url.pathname)) {
    url.pathname = "/global/en/search-results";
  }
  url.searchParams.sort();
  return url.href;
}
