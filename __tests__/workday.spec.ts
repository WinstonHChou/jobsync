// @vitest-environment node
import { parseWorkdayBoardUrl, workdayJobUrls } from "@/lib/workdayBoard";
import { fetchWorkdayListings, hydrateWorkdayJobs, searchWorkdayJobs } from "@/lib/scraper/workday";
import { mapWorkdayJob } from "@/lib/scraper/workday/mapper";
import { WorkdayCompanySchema, CreateAutomationSchema } from "@/models/automation.schema";
import { companyBoardUrl } from "@/lib/atsBoardUrl";
import { parseEditSourceConfig } from "@/components/automations/automation-wizard/wizardConfig";
import { resolveAtsBoard } from "@/actions/atsCompany.actions";
import { getCurrentUser } from "@/utils/user.utils";

vi.mock("@/utils/user.utils", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/constants", async (original) => {
  const actual = await original<typeof import("@/lib/constants")>();
  return { ...actual, APP_CONSTANTS: { ...actual.APP_CONSTANTS, WORKDAY_MAX_PAGES: 2 } };
});

const token = "https://acme.wd5.myworkdayjobs.com/External";
const api = "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External";
const listing = (id = "one") => ({ title: "Software Engineer", externalPath: `/job/New-York/Engineer_${id}`, locationsText: "2 Locations" });
const summary = (id = "one") => ({ title: "Software Engineer", company: "Acme", description: "", location: "2 Locations", url: `${token}${listing(id).externalPath}` });
const info = { title: " Software Engineer ", jobDescription: "<p>Build with TypeScript &amp; React.</p>", location: "New York, NY", additionalLocations: ["Boston, MA", "New York, NY"], timeType: "Full time", startDate: "2026-10-11", remoteType: "Hybrid" };
function response(body: unknown, status = 200, retry = "0"): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => retry } } as unknown as Response;
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("Workday board identity and validation", () => {
  it("canonicalizes locales, deep links, host case, and tracking without losing site case", () => {
    const board = parseWorkdayBoardUrl("https://ACME.wd5.myworkdayjobs.com/en-US/External/job/NY/Engineer_123?source=LinkedIn#apply");
    expect(board).toMatchObject({ url: token, tenant: "acme", site: "External", apiUrl: api });
    expect(companyBoardUrl("workday", { token: board!.url })).toBe(token);
    expect(parseWorkdayBoardUrl(token.replace("wd5", "wd1"))!.url).not.toBe(token);
    expect(parseWorkdayBoardUrl(token.replace("External", "Students"))!.url).not.toBe(token);
  });

  it.each([
    "http://acme.wd5.myworkdayjobs.com/External", "https://localhost/External",
    "https://acme.wd5.myworkdayjobs.com.evil.test/External", "https://user:pass@acme.wd5.myworkdayjobs.com/External",
    "https://acme.wd5.myworkdayjobs.com:8443/External", "https://acme.wd5.myworkdayjobs.com/",
    "https://acme.wd5.myworkdayjobs.com/Ex%2fternal", "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/jobs",
    "https://acme.wd5.myworkdayjobs.com/External\\job\\NY\\123",
  ])("rejects unsafe or unsupported board URL %s", (url) => {
    expect(parseWorkdayBoardUrl(url)).toBeNull();
    expect(WorkdayCompanySchema.safeParse({ name: "Acme", token: url }).success).toBe(false);
  });

  it("rejects untrusted job paths and creates both URLs on the validated board", () => {
    const board = parseWorkdayBoardUrl(token)!;
    expect(workdayJobUrls(board, "/job/New-York/Engineer_one")).toEqual({ url: summary().url, apiUrl: `${api}/job/New-York/Engineer_one` });
    for (const path of ["//evil.test/job/NY/123", "/job/../123", "/job/%2e%2e/123", "/job/NY/123?x=1", "/job/NY%2fother/123", "/job/NY/123\\other"]) {
      expect(workdayJobUrls(board, path)).toBeNull();
    }
  });

  it("round-trips Workday configuration and requires a company", () => {
    const config = { workday: { companies: [{ name: "Acme", token: `${token}/?source=alert` }] } };
    const input = { name: "Workday", jobBoard: "workday", sourceConfig: config, resumeId: "550e8400-e29b-41d4-a716-446655440000", matchThreshold: 80, scheduleHour: 8 };
    expect(CreateAutomationSchema.parse(input).sourceConfig?.workday?.companies[0].token).toBe(token);
    expect(parseEditSourceConfig(JSON.stringify(config))).toEqual(config);
    expect(CreateAutomationSchema.safeParse({ ...input, sourceConfig: { workday: { companies: [] } } }).success).toBe(false);
  });
});

describe("Workday listings", () => {
  it("pages by the returned count, preserves summaries, and requests no descriptions", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ total: 3, jobPostings: [listing("one"), listing("two")] }))
      .mockResolvedValueOnce(response({ total: 3, jobPostings: [listing("three")] }));
    const result = await fetchWorkdayListings("Acme", token);
    expect(result.errors).toEqual([]);
    expect(result.jobs).toHaveLength(3);
    expect(result.jobs[0]).toEqual(summary());
    expect(fetch.mock.calls.map(([, options]) => JSON.parse(options!.body as string).offset)).toEqual([0, 2]);
    expect(fetch.mock.calls[0]).toEqual([`${api}/jobs`, expect.objectContaining({ method: "POST", redirect: "error" })]);
  });

  it("reports partial coverage at the page cap", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ total: 3, jobPostings: [listing("one")] }))
      .mockResolvedValueOnce(response({ total: 3, jobPostings: [listing("two")] }));
    const result = await fetchWorkdayListings("Acme", token);
    expect(result.jobs).toHaveLength(2);
    expect(result.errors[0].reason).toContain("Listing limit reached");
  });

  it("detects repeated pages instead of reporting complete coverage", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ total: 5, jobPostings: [listing()] }));
    const result = await fetchWorkdayListings("Acme", token);
    expect(result.jobs).toHaveLength(1);
    expect(result.errors[0].reason).toContain("pagination repeated");
  });

  it("accepts an empty board but rejects malformed data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({ total: 0, jobPostings: [] })).mockResolvedValueOnce(response({ jobPostings: [] }));
    expect(await fetchWorkdayListings("Acme", token)).toEqual({ jobs: [], errors: [] });
    expect((await fetchWorkdayListings("Acme", token)).errors[0].reason).toContain("Malformed");
  });

  it("retains successful boards when another board is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => String(url).includes("acme.") ? response({ total: 1, jobPostings: [listing()] }) : response({}, 404));
    const bad = "https://bad.wd1.myworkdayjobs.com/External";
    const result = await searchWorkdayJobs([{ name: "Acme", token }, { name: "Bad", token: bad }]);
    expect(result.jobs).toHaveLength(1);
    expect(result.errors).toEqual([{ token: bad, reason: "Workday careers site not found (returned 404)" }]);
  });

  it("validates a board using only its first page", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user1" } as never);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ total: 2000, jobPostings: [listing()] }));
    expect(await resolveAtsBoard("workday", `${token}/en-US`)).toMatchObject({ success: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(await resolveAtsBoard("workday", token.replace("/External", "/en-US/External"))).toEqual({ success: true, name: "Acme", token });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("requires authentication and never fetches invalid URLs", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    expect(await resolveAtsBoard("workday", token)).toMatchObject({ success: false });
    vi.mocked(getCurrentUser).mockResolvedValue({ id: "user1" } as never);
    expect(await resolveAtsBoard("workday", "https://localhost/External")).toMatchObject({ success: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Workday descriptions", () => {
  it("maps full descriptions, locations, dates, employment, and explicit workplace types", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ jobPostingInfo: info }));
    const result = await hydrateWorkdayJobs([summary()]);
    expect(result.errors).toEqual([]);
    expect(result.jobs[0]).toMatchObject({ title: "Software Engineer", description: info.jobDescription, location: "New York, NY, Boston, MA", postedDate: "2026-10-11", employmentType: "Full time", workplaceType: "HYBRID" });
    expect(fetch.mock.calls[0][0]).toBe(`${api}/job/New-York/Engineer_one`);
    expect(mapWorkdayJob(summary(), { ...info, remoteType: "Flex" }).workplaceType).toBeUndefined();
  });

  it("skips closed postings and reports other failures without discarding successful details", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ jobPostingInfo: info }))
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({}, 403));
    const result = await hydrateWorkdayJobs([summary(), summary("two"), summary("three")]);
    expect(result.jobs).toHaveLength(1);
    expect(result.errors).toEqual([{ token, reason: "1 job description(s) skipped: Workday returned 403" }]);
  });

  it("retries a transient rate limit once", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response({}, 429)).mockResolvedValueOnce(response({ jobPostingInfo: info }));
    expect((await hydrateWorkdayJobs([summary()])).jobs).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports a persistent rate limit", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}, 429));
    const result = await hydrateWorkdayJobs([summary()]);
    expect(result.jobs).toEqual([]);
    expect(result.errors[0].reason).toContain("rate limited");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("defers long rate limits to another run instead of retrying immediately", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(response({}, 429, "60"));
    const result = await hydrateWorkdayJobs([summary()]);
    expect(result.errors[0].reason).toContain("retry on the next run");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrent description requests", async () => {
    let active = 0;
    let peak = 0;
    const pending: Array<() => void> = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      active++;
      peak = Math.max(peak, active);
      return new Promise<Response>((resolve) => pending.push(() => {
        active--;
        resolve(response({ jobPostingInfo: info }));
      }));
    });
    const task = hydrateWorkdayJobs(Array.from({ length: 6 }, (_, i) => summary(String(i))));
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetch).toHaveBeenCalledTimes(4);
    pending.splice(0).forEach((complete) => complete());
    await new Promise((resolve) => setImmediate(resolve));
    pending.splice(0).forEach((complete) => complete());
    expect((await task).jobs).toHaveLength(6);
    expect(peak).toBe(4);
  });

  it("reports a description deadline without saving incomplete data", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason), { once: true });
    }));
    const task = hydrateWorkdayJobs([summary()]);
    await new Promise((resolve) => setImmediate(resolve));
    deadline.abort(new DOMException("Timed out", "TimeoutError"));
    const result = await task;
    expect(result.jobs).toEqual([]);
    expect(result.errors[0].reason).toContain("description fetch timed out");
  });

  it("does not save malformed descriptions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ jobPostingInfo: { title: "Engineer" } }));
    const result = await hydrateWorkdayJobs([summary()]);
    expect(result.jobs).toEqual([]);
    expect(result.errors[0].reason).toContain("Malformed");
  });

  it("accepts null optional fields without losing a valid description", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response({ jobPostingInfo: {
      ...info, location: null, additionalLocations: null, startDate: null, timeType: null, remoteType: null,
    } }));
    const result = await hydrateWorkdayJobs([summary()]);
    expect(result.errors).toEqual([]);
    expect(result.jobs[0]).toMatchObject({ description: info.jobDescription, location: "2 Locations" });
  });

  it("propagates user cancellation before starting requests", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController(); controller.abort();
    await expect(hydrateWorkdayJobs([summary()], { signal: controller.signal })).rejects.toThrow();
    await expect(searchWorkdayJobs([{ name: "Acme", token }], { signal: controller.signal })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
