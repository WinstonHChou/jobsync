// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCompanyCareers, hydrateCompanyCareers, resolveCompanyCareers, searchCompanyCareers } from "@/lib/scraper/company-careers";
import { fetchCareerPage, CareerHttpError } from "@/lib/scraper/company-careers/http";
import { searchGreenhouseJobs } from "@/lib/scraper/greenhouse";
import { searchLeverJobs } from "@/lib/scraper/lever";
import { fetchWorkdayListings, hydrateWorkdayJobs } from "@/lib/scraper/workday";
import { resolveAtsBoard } from "@/actions/atsCompany.actions";
import { getCurrentUser } from "@/utils/user.utils";

vi.mock("@/lib/scraper/company-careers/http", async (original) => ({ ...await original<typeof import("@/lib/scraper/company-careers/http")>(), fetchCareerPage: vi.fn() }));
vi.mock("@/lib/scraper/greenhouse", () => ({ searchGreenhouseJobs: vi.fn() }));
vi.mock("@/lib/scraper/lever", () => ({ searchLeverJobs: vi.fn() }));
vi.mock("@/lib/scraper/ashby", () => ({ searchAshbyJobs: vi.fn() }));
vi.mock("@/lib/scraper/workday", () => ({ fetchWorkdayListings: vi.fn(), hydrateWorkdayJobs: vi.fn() }));
vi.mock("@/utils/user.utils", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/scraper/company-careers/config", () => ({ CAREER_LIMITS: { requestTimeoutMs: 1000, searchTimeoutMs: 5000, detailTimeoutMs: 5000, maxPages: 2, maxJobs: 3, boardConcurrency: 2, detailConcurrency: 2 } }));

const token = "https://careers.example.com/jobs?q=intern";
const job = (id = "123", description = "") => ({ title: "Engineering Intern", company: "Acme", location: "Boston", description, url: `https://careers.example.com/jobs/${id}`, careerSourceUrl: token });
const ld = (id = "123") => `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "Engineering Intern", description: "Build things", url: `/jobs/${id}`, hiringOrganization: { name: "Acme" } })}</script>`;
const page = (body: string, url = token) => ({ body, url });
beforeEach(() => vi.resetAllMocks());

describe("company careers providers", () => {
  it("dispatches Waymo directly to Greenhouse and preserves original source identity", async () => {
    vi.mocked(searchGreenhouseJobs).mockResolvedValue({ jobs: [job("123", "Full description")], errors: [] });
    const source = "https://careers.withwaymo.com/jobs/search";
    const result = await fetchCompanyCareers("Waymo", source);
    expect(searchGreenhouseJobs).toHaveBeenCalledWith([{ name: "Waymo", token: "waymo" }]);
    expect(fetchCareerPage).not.toHaveBeenCalled();
    expect(result.jobs[0].careerSourceUrl).toBe(source);
  });
  it("resolves EU Lever URLs and maps vendor failures to the careers URL", async () => {
    vi.mocked(searchLeverJobs).mockResolvedValue({ jobs: [], errors: [{ token: "acme", reason: "unreachable" }] });
    expect(await fetchCompanyCareers("Acme", "https://jobs.eu.lever.co/acme")).toMatchObject({ errors: [{ token: "https://jobs.eu.lever.co/acme", reason: "unreachable" }] });
    expect(searchLeverJobs).toHaveBeenCalledWith([{ name: "Acme", token: "acme", host: "eu" }]);
  });
  it("detects an embedded ATS board and does not mistake a single job link for a board", async () => {
    vi.mocked(fetchCareerPage).mockResolvedValue(page('<iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe>'));
    vi.mocked(searchGreenhouseJobs).mockResolvedValue({ jobs: [job()], errors: [] });
    expect((await fetchCompanyCareers("Acme", token.split("?")[0])).errors).toEqual([]);
    expect(searchGreenhouseJobs).toHaveBeenCalledWith([{ name: "Acme", token: "acme" }]);
    vi.mocked(searchGreenhouseJobs).mockClear();
    vi.mocked(fetchCareerPage).mockResolvedValue(page('<a href="https://boards.greenhouse.io/acme/jobs/123">One job</a>'));
    expect((await fetchCompanyCareers("Acme", token.split("?")[0])).errors[0].reason).toMatch(/no supported public job data/);
    expect(searchGreenhouseJobs).not.toHaveBeenCalled();
  });
  it("rejects ATS URL filters rather than silently ignoring them", async () => {
    expect((await fetchCompanyCareers("Waymo", "https://careers.withwaymo.com/jobs/search?q=intern")).errors[0].reason).toMatch(/automation filters/);
    expect(searchGreenhouseJobs).not.toHaveBeenCalled();
  });
  it("pages structured sites, deduplicates URLs, and preserves jobs after later failures", async () => {
    vi.mocked(fetchCareerPage).mockResolvedValueOnce(page(ld() + '<a href="?q=intern&page=2" rel="next">Next</a>'))
      .mockResolvedValueOnce(page(ld() + ld("456"), token + "&page=2"));
    const result = await fetchCompanyCareers("Acme", token);
    expect(result.jobs).toHaveLength(2); expect(result.errors).toEqual([]);
    vi.mocked(fetchCareerPage).mockResolvedValueOnce(page(ld() + '<a href="?q=intern&page=2" rel="next">Next</a>')).mockRejectedValueOnce(new Error("rate limited"));
    const partial = await fetchCompanyCareers("Acme", token);
    expect(partial.jobs).toHaveLength(1); expect(partial.errors).toEqual([{ token, reason: "rate limited" }]);
  });
  it("reports coverage limits and repeated pages", async () => {
    vi.mocked(fetchCareerPage).mockResolvedValueOnce(page(ld() + '<a href="?q=intern&page=2" rel="next">Next</a>'))
      .mockResolvedValueOnce(page(ld("456") + '<a href="?q=intern&page=3" rel="next">Next</a>', token + "&page=2"));
    expect((await fetchCompanyCareers("Acme", token)).errors[0].reason).toMatch(/listing limit/);
    vi.mocked(fetchCareerPage).mockResolvedValueOnce(page(ld() + '<a href="?q=intern&page=2" rel="next">Next</a>')).mockResolvedValueOnce(page(ld() + '<a href="?q=intern&page=3" rel="next">Next</a>', token + "&page=2"));
    expect((await fetchCompanyCareers("Acme", token)).errors[0].reason).toMatch(/no new jobs/);
  });
  it("reports unsupported and unauthorized sites without network probing Meta", async () => {
    const meta = await fetchCompanyCareers("Meta", "https://www.metacareers.com/jobsearch/");
    expect(meta.errors[0].reason).toMatch(/authorized integration/); expect(fetchCareerPage).not.toHaveBeenCalled();
    vi.mocked(fetchCareerPage).mockResolvedValue(page("<div>Loading...</div>"));
    await expect(resolveCompanyCareers(token)).rejects.toThrow(/no supported public job data/);
  });
  it("isolates one failed company from another", async () => {
    vi.mocked(fetchCareerPage).mockImplementation(async (url) => { if (url.includes("bad")) throw new Error("unreachable"); return page(ld(), url); });
    const result = await searchCompanyCareers([{ name: "Acme", token }, { name: "Bad", token: "https://bad.example.com/jobs" }]);
    expect(result.jobs).toHaveLength(1); expect(result.errors).toHaveLength(1);
  });
  it("fetches only missing descriptions and groups detail failures by company URL", async () => {
    vi.mocked(fetchCareerPage).mockResolvedValueOnce(page(ld(), job().url)).mockRejectedValueOnce(new Error("unreachable")).mockRejectedValueOnce(new Error("unreachable"));
    const complete = job("complete", "Already complete");
    const result = await hydrateCompanyCareers([complete, job(), job("456"), job("789")]);
    expect(fetchCareerPage).toHaveBeenCalledTimes(3); expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toBe(complete);
    expect(result.errors).toEqual([{ token, reason: "2 job description(s) skipped: unreachable" }]);
  });
  it("skips closed jobs but rejects unstructured details", async () => {
    vi.mocked(fetchCareerPage).mockRejectedValueOnce(new CareerHttpError(404, "closed")).mockResolvedValueOnce(page("<p>Not structured</p>"));
    const result = await hydrateCompanyCareers([job(), job("456")]);
    expect(result.jobs).toEqual([]); expect(result.errors[0].reason).toMatch(/1 job description/);
  });
  it("delegates Workday hydration and keeps custom source provenance", async () => {
    const source = "https://acme.wd5.myworkdayjobs.com/External";
    vi.mocked(fetchWorkdayListings).mockResolvedValue({ jobs: [{ ...job(), url: source + "/job/NY/Engineer_123" }], errors: [] });
    const search = await fetchCompanyCareers("Acme", source);
    vi.mocked(hydrateWorkdayJobs).mockResolvedValue({ jobs: [{ ...search.jobs[0], description: "Workday full description" }], errors: [] });
    expect((await hydrateCompanyCareers(search.jobs)).jobs[0]).toMatchObject({ careerSourceUrl: source, description: "Workday full description" });
  });
  it("validates a full description before accepting a generic site", async () => {
    vi.mocked(fetchCareerPage).mockResolvedValueOnce(page('<a href="/jobs/123">Intern</a>')).mockResolvedValueOnce(page(ld(), job().url));
    expect(await resolveCompanyCareers(token)).toEqual({ name: "Acme", token });
  });
  it("requires authentication at the URL resolution action", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await resolveAtsBoard("company-careers", token)).toEqual({ success: false, message: "Not authenticated" });
    expect(fetchCareerPage).not.toHaveBeenCalled();
  });
  it("propagates cancellation instead of returning partial success", async () => {
    const controller = new AbortController(); controller.abort(new Error("cancelled"));
    await expect(fetchCompanyCareers("Acme", token, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(fetchCareerPage).not.toHaveBeenCalled();
  });
});
