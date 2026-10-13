// @vitest-environment node
import { expect, it, vi, afterEach } from "vitest";
import { requestResumeAnalysis } from "@/lib/resume-repo/analysis-client";
import type { ResumeOptimizationView } from "@/models/resumeOptimization.model";
const run = { id: "draft", revision: 2 } as ResumeOptimizationView;
const response = (chunks: string[]) => new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }));
afterEach(() => vi.restoreAllMocks());
it("reads split NDJSON events and uses the saved revision for the next stage", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(response(['{"type":"progress","message":"Matching…"}\n{"type":"heart', 'beat"}\n{"type":"result","run":{"id":"draft","revision":4}}\n']));
  const progress = vi.fn(), signal = new AbortController().signal;
  expect(await requestResumeAnalysis(run, "baseline", signal, progress)).toMatchObject({ revision: 4 });
  expect(progress).toHaveBeenCalledWith("Matching…");
  expect(fetch).toHaveBeenCalledWith("/api/resume-optimizations/draft/analyze", expect.objectContaining({ method: "POST", body: JSON.stringify({ revision: 2, stage: "baseline" }), signal }));
});
it("distinguishes provider errors, interrupted streams, and proxy failures", async () => {
  const fetch = vi.spyOn(globalThis, "fetch"), signal = new AbortController().signal;
  fetch.mockResolvedValueOnce(response(['{"type":"error","message":"Resume matching timed out"}\n']));
  await expect(requestResumeAnalysis(run, "baseline", signal, vi.fn())).rejects.toThrow("Resume matching timed out");
  fetch.mockResolvedValueOnce(response(['{"type":"heartbeat"}\n']));
  await expect(requestResumeAnalysis(run, "baseline", signal, vi.fn())).rejects.toThrow(/connection ended before completion/);
  fetch.mockResolvedValueOnce(new Response("gateway timeout", { status: 504 }));
  await expect(requestResumeAnalysis(run, "baseline", signal, vi.fn())).rejects.toThrow(/504/);
});
