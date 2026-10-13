// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/resume-optimizations/[id]/analyze/route";
import { requireUser } from "@/actions/shared";
import { repositoryFor } from "@/lib/resume-repo/repository";
import { ownedOptimization } from "@/lib/resume-repo/service";
import { analyzeResumeStage } from "@/lib/resume-repo/analysis";
vi.mock("@/actions/shared", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/resume-repo/repository", () => ({ repositoryFor: vi.fn() }));
vi.mock("@/lib/resume-repo/service", () => ({ ownedOptimization: vi.fn() }));
vi.mock("@/lib/resume-repo/analysis", () => ({ analyzeResumeStage: vi.fn() }));
const context = { params: Promise.resolve({ id: "draft-id" }) };
const request = (body: unknown = { revision: 0, stage: "baseline" }) => new Request("http://localhost/api/resume-optimizations/draft-id/analyze", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requireUser).mockResolvedValue({ id: "owner", email: "owner@example.test" } as never); vi.mocked(repositoryFor).mockResolvedValue("/tmp/repo"); vi.mocked(ownedOptimization).mockResolvedValue({} as never); });
afterEach(() => vi.useRealTimers());
it("authenticates and checks ownership before opening a stream", async () => {
  vi.mocked(requireUser).mockRejectedValueOnce(new Error("Not authenticated"));
  expect((await POST(request(), context)).status).toBe(401);
  vi.mocked(ownedOptimization).mockRejectedValueOnce(new Error("Not found"));
  expect((await POST(request(), context)).status).toBe(404);
  expect(analyzeResumeStage).not.toHaveBeenCalled();
  expect((await POST(request({ revision: -1, stage: "unknown" }), context)).status).toBe(400);
});
it("streams progress immediately, emits heartbeats while waiting, and disables proxy buffering", async () => {
  vi.useFakeTimers(); let complete!: (value: never) => void;
  vi.mocked(analyzeResumeStage).mockImplementation((_id, _owner, _revision, _stage, options) => { options?.onProgress?.("Resume matching: waiting…"); return new Promise((resolve) => { complete = resolve; }); });
  const response = await POST(request(), context), reader = response.body!.getReader();
  expect(response.headers.get("X-Accel-Buffering")).toBe("no");
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("Starting resume analysis");
  expect(new TextDecoder().decode((await reader.read()).value)).toContain("Resume matching: waiting");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"heartbeat"');
  complete({ id: "draft-id", revision: 2 } as never);
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('"result"');
  expect((await reader.read()).done).toBe(true);
});
it("reports a failed stage in-band after headers have been sent", async () => {
  vi.mocked(analyzeResumeStage).mockRejectedValue(new Error("Resume matching timed out"));
  const response = await POST(request(), context);
  expect(await response.text()).toContain('"type":"error","message":"Resume matching timed out"');
});
it("cancels provider work when the stream reader disconnects", async () => {
  let aborted!: Promise<void>;
  vi.mocked(analyzeResumeStage).mockImplementation((_id, _owner, _revision, _stage, options) => {
    aborted = new Promise<void>((resolve) => options!.signal!.addEventListener("abort", () => resolve(), { once: true }));
    return aborted.then(() => { throw new Error("Stopped"); });
  });
  const response = await POST(request(), context);
  await response.body!.cancel(); await aborted;
});
