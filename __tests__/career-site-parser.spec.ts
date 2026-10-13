import { describe, expect, it } from "vitest";
import { embeddedJson, parseCareerListings, parseStructuredJobs } from "@/lib/scraper/company-careers/parser";

const google = "https://www.google.com/about/careers/applications/jobs/results/?q=intern";
const bcg = "https://careers.bcg.com/global/en/search-results?keywords=intern";
const base = "https://careers.example.com/jobs";
const ld = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

describe("company careers public data parsers", () => {
  it("extracts balanced JSON without executing scripts or confusing brackets in strings", () => {
    expect(embeddedJson('marker:{"description":"a } \\\" [", "jobs":[1]} ; evil()', "marker:")).toEqual({ description: 'a } " [', jobs: [1] });
    expect(embeddedJson("marker:{oops};", "marker:")).toBeNull();
  });
  it("maps Google search data including full descriptions and stable public links", () => {
    const row = ["12345", "Software Engineering Intern", "https://accounts.google.com/signin", [null, "<p>Responsibilities</p>"], [null, "<p>Qualifications</p>"], null, null, "Google", "en-US", [["Boston, MA, USA"]], [null, "<p>About</p>"]];
    const html = `AF_initDataCallback({key: 'ds:1', data:${JSON.stringify([[row], null, 40, 20])}, sideChannel:{}});<a href="jobs/results/12345-software-intern/">Intern</a>`;
    const parsed = parseCareerListings(html, google, "Google");
    expect(parsed.jobs[0]).toMatchObject({ title: row[1], location: "Boston, MA, USA", description: "<p>About</p>\n<p>Qualifications</p>\n<p>Responsibilities</p>", url: "https://www.google.com/about/careers/applications/jobs/results/12345-software-intern/" });
    expect(new URL(parsed.next!).searchParams.get("q")).toBe("intern");
    expect(new URL(parsed.next!).searchParams.get("page")).toBe("2");
    expect(parseCareerListings(html, google + "&page=2", "Google").next).toBeUndefined();
  });
  it("fails clearly on a changed Google payload", () => expect(() => parseCareerListings("<html>Login</html>", google, "Google")).toThrow(/Google careers search data/));
  it("recognizes Google's explicit zero-result search payload", () => {
    expect(parseCareerListings("AF_initDataCallback({key: 'ds:1', data:[null,null,0,20]});", google, "Google")).toEqual({ jobs: [], supported: true, next: undefined });
  });
  it("maps Phenom summaries and keeps filters through offset pagination", () => {
    const html = `var data={"eagerLoadRefineSearch":${JSON.stringify({ status: 200, totalHits: 2, data: { jobs: [{ title: "Consulting Intern", jobSeqNo: "BCG1US123EXTERNAL", multi_location: ["Boston", "New York"], applyUrl: "https://apply.example.com/private", type: "Full-Time" }] } })}};`;
    const parsed = parseCareerListings(html, bcg, "BCG");
    expect(parsed.jobs[0]).toMatchObject({ url: "https://careers.bcg.com/global/en/job/BCG1US123EXTERNAL", description: "", location: "Boston; New York" });
    expect(new URL(parsed.next!).searchParams.get("from")).toBe("1");
    expect(new URL(parsed.next!).searchParams.get("keywords")).toBe("intern");
  });
  it("recognizes an explicit empty Phenom board", () => {
    expect(parseCareerListings('"eagerLoadRefineSearch":{"status":200,"totalHits":0,"data":{"jobs":[]}}', bcg, "BCG")).toEqual({ jobs: [], supported: true, next: undefined });
  });
  it("walks structured graphs and item lists, preserves descriptions and remote metadata", () => {
    const job = { "@type": "JobPosting", title: "Engineer", description: "<p>Build things</p>", url: "/jobs/123", hiringOrganization: { name: "Acme" }, jobLocation: [{ address: { addressLocality: "Boston", addressRegion: "MA", addressCountry: "US" } }], jobLocationType: "TELECOMMUTE", employmentType: ["FULL_TIME"], datePosted: "2026-10-01" };
    const html = ld({ "@graph": [{ "@type": "ItemList", itemListElement: [{ item: job }] }] });
    expect(parseStructuredJobs(html, base, "Fallback")[0]).toMatchObject({ company: "Acme", url: "https://careers.example.com/jobs/123", location: "Boston, MA, US", isRemote: true, employmentType: "FULL_TIME" });
  });
  it("uses detail-page URL when JSON-LD omits url and skips malformed unrelated scripts", () => {
    expect(parseStructuredJobs('<script type="application/ld+json">invalid</script>' + ld({ "@type": "JobPosting", title: "Engineer", description: "Full description" }), base + "/123", "Acme")[0].url).toBe(base + "/123");
  });
  it("discovers same-origin job links and next-page links without following application or off-site links", () => {
    const html = '<link rel="next" href="?page=2"><a href="/jobs/123">Engineering <b>Intern</b></a><a href="https://other.example.com/jobs/456">Other</a><a href="/jobs/search">Search</a><a href="/apply/789">Apply</a>';
    const parsed = parseCareerListings(html, base, "Acme");
    expect(parsed.jobs).toHaveLength(1);
    expect(parsed.jobs[0]).toMatchObject({ title: "Engineering Intern", description: "" });
    expect(parsed.next).toBe(base + "?page=2");
  });
  it("does not accept an empty browser shell as a supported careers page", () => expect(parseCareerListings('<div id="app"></div>', base, "Acme").supported).toBe(false));
  it("discovers structured summaries and requires descriptions on detail pages", () => {
    const html = ld({ "@type": "ItemList", itemListElement: [{ item: { "@type": "JobPosting", title: "Intern", url: "/jobs/123" } }] });
    expect(parseCareerListings(html, base, "Acme").jobs[0]).toMatchObject({ title: "Intern", url: base + "/123", description: "" });
    expect(parseStructuredJobs(html, base, "Acme")).toEqual([]);
  });
});
