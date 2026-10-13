// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookup } from "node:dns/promises";
import { request, type RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { fetchCareerPage, resolveCareerAddress } from "@/lib/scraper/company-careers/http";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));
vi.mock("@/lib/scraper/company-careers/config", () => ({ CAREER_LIMITS: { requestTimeoutMs: 1000, maxBytes: 100, maxRedirects: 2 } }));

type ResponseSpec = { status?: number; body?: string | Buffer; headers?: Record<string, string>; interrupted?: boolean };
let responses: ResponseSpec[];
beforeEach(() => {
  vi.resetAllMocks(); responses = [];
  vi.mocked(lookup).mockResolvedValue([{ address: "8.8.8.8", family: 4 }] as never);
  vi.mocked(request).mockImplementation((...args: unknown[]) => {
    const callback = args[2] as (res: IncomingMessage) => void;
    const req = Object.assign(new EventEmitter(), { end: () => {
      const spec = responses.shift() ?? {};
      const body = spec.body ?? "OK";
      const res = Object.assign(Readable.from([typeof body === "string" ? Buffer.from(body) : body]), { statusCode: spec.status ?? 200, headers: spec.headers ?? {} }) as unknown as IncomingMessage;
      callback(res);
      if (spec.interrupted) queueMicrotask(() => res.emit("aborted"));
    } });
    return req as unknown as ClientRequest;
  });
});

describe("safe careers HTTP requests", () => {
  it("rejects mixed public/private DNS answers before HTTPS is called", async () => {
    vi.mocked(lookup).mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }] as never);
    await expect(fetchCareerPage("https://careers.example.com/jobs")).rejects.toThrow(/public network addresses/);
    expect(request).not.toHaveBeenCalled();
  });
  it("pins the validated DNS answer in the HTTPS lookup callback", async () => {
    expect(await fetchCareerPage("https://careers.example.com/jobs")).toEqual({ url: "https://careers.example.com/jobs", body: "OK" });
    const options = vi.mocked(request).mock.calls[0][1] as RequestOptions;
    const callback = vi.fn();
    (options.lookup as unknown as (host: string, opts: object, cb: typeof callback) => void)("careers.example.com", {}, callback);
    expect(callback).toHaveBeenCalledWith(null, "8.8.8.8", 4);
    expect(options).toMatchObject({ agent: false, autoSelectFamily: false });
  });
  it("revalidates redirect destinations and blocks private IPs, credentials, and HTTP", async () => {
    for (const location of ["https://127.0.0.1/jobs", "http://careers.example.com/jobs", "https://user:pass@careers.example.com/jobs"]) {
      responses.push({ status: 302, headers: { location } });
      await expect(fetchCareerPage("https://careers.example.com/jobs")).rejects.toThrow(/public HTTPS/);
    }
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("checks DNS again after a hostname redirect", async () => {
    responses.push({ status: 302, headers: { location: "https://other.example.com/jobs" } });
    vi.mocked(lookup).mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }] as never).mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }] as never);
    await expect(fetchCareerPage("https://careers.example.com/jobs")).rejects.toThrow(/public network addresses/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("bounds redirect loops", async () => {
    responses.push(...Array.from({ length: 3 }, () => ({ status: 302, headers: { location: "/jobs" } })));
    await expect(fetchCareerPage("https://careers.example.com/jobs")).rejects.toThrow(/redirect limit/);
    expect(request).toHaveBeenCalledTimes(3);
  });
  it("bounds declared, streamed, and decompressed body sizes", async () => {
    responses.push({ headers: { "content-length": "101" } });
    await expect(fetchCareerPage("https://careers.example.com/jobs")).rejects.toThrow(/size limit/);
    responses.push({ body: "a".repeat(101) });
    await expect(fetchCareerPage("https://careers.example.com/jobs")).rejects.toThrow(/size limit/);
    responses.push({ body: gzipSync("a".repeat(101)), headers: { "content-encoding": "gzip" } });
    await expect(fetchCareerPage("https://careers.example.com/jobs")).rejects.toThrow(/size limit/);
  });
  it("returns rate limits and interrupted responses as failures", async () => {
    responses.push({ status: 429 });
    await expect(fetchCareerPage("https://careers.example.com/jobs")).rejects.toMatchObject({ status: 429, message: "rate limited" });
    responses.push({ interrupted: true });
    await expect(fetchCareerPage("https://careers.example.com/jobs")).rejects.toThrow(/interrupted/);
  });
  it("cancels a pending DNS lookup promptly", async () => {
    vi.mocked(lookup).mockReturnValue(new Promise(() => {}));
    const controller = new AbortController();
    const result = fetchCareerPage("https://careers.example.com/jobs", controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(result).rejects.toThrow("cancelled"); expect(request).not.toHaveBeenCalled();
  });
  it("handles public literal IPs without DNS and rejects Meta before DNS", async () => {
    expect(await resolveCareerAddress("8.8.8.8")).toEqual({ address: "8.8.8.8", family: 4 });
    expect(lookup).not.toHaveBeenCalled();
    await expect(fetchCareerPage("https://www.metacareers.com/jobsearch/")).rejects.toThrow(/authorized integration/);
    expect(lookup).not.toHaveBeenCalled();
  });
});
