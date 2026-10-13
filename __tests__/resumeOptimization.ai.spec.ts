// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamText } from "ai";
import { getModel } from "@/lib/ai/providers";
import { matchResumeText, suggestResumeEdits, resumeAiSettings } from "@/lib/resume-repo/ai";
import { readCatalog, sourceHash } from "@/lib/resume-repo/latex";
import db from "@/lib/db";
import type { ResumeOptimizationData } from "@/models/resumeOptimization.model";
vi.mock("ai", () => ({ streamText: vi.fn() }));
vi.mock("@/lib/ai/providers", () => ({ getModel: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({ default: { userSettings: { findUnique: vi.fn() } } }));
vi.mock("@/lib/ai/rate-limiter", () => ({ checkRateLimit: vi.fn(() => ({ allowed: true })) }));
vi.mock("@/lib/aiUsage/tracker", () => ({ startAiCall: () => ({ finish: vi.fn(async () => {}), markFirstToken: vi.fn() }) }));
function data(): ResumeOptimizationData {
  const files = { "Resume.tex": "\\begin{document}\n\\section{Experience}\n\\Engineer\n\\end{document}", "experience.tex": "\\NewDocumentCommand{\\Engineer}{}{\\resumeItem{Built engineering systems with 100 Hz updates.}}" };
  const catalog = readCatalog(files, "Resume.tex");
  return { version: 1, files, catalog, layout: catalog.sections, edits: [], branch: "acme/engineer", baseCommit: "base", sourceHash: sourceHash(files), jobText: "Real job requirements", jobTitle: "Engineer", company: "Acme", entrypoint: "Resume.tex", status: "draft", provider: "ollama", model: "pinned-model", promptVersion: "v1", matchSystemPrompt: "Pinned system", matchPromptTemplate: "Fixed assessment date\n{{RESUME_SNAPSHOT}}\n{{JOB_SNAPSHOT}}" };
}
function mockResponse(result: { text: string; finishReason: string; totalUsage: object }) {
  vi.mocked(streamText).mockReturnValue({ fullStream: (async function* () { yield { type: "text-delta", text: result.text }; })(), finishReason: Promise.resolve(result.finishReason), totalUsage: Promise.resolve(result.totalUsage) } as never);
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());
describe("resume tailoring AI boundaries", () => {
  it("uses pinned provider, model and prompt without corrupting dollar signs", async () => {
    mockResponse({ text: "SCORES: match=80 recommendation=strong\n\n## Summary\nEvidence", finishReason: "stop", totalUsage: {} });
    expect((await matchResumeText("owner", data(), "Budget $& preserved")).score).toBe(80);
    expect(getModel).toHaveBeenCalledWith("ollama", "pinned-model", "owner");
    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ system: "Pinned system", prompt: "Fixed assessment date\nBudget $& preserved\nReal job requirements", temperature: 0.1 }));
  });
  it("returns validated proposals as unaccepted and handles provider reasoning/fences", async () => {
    const run = data(), block = run.catalog.blocks[0];
    const json = JSON.stringify({ edits: [{ blockId: block.id, replacement: "Delivered engineering systems with 100 Hz updates.", reason: "Relevant systems experience" }] });
    mockResponse({ text: `<think>internal</think>\n\`\`\`json\n${json}\n\`\`\``, finishReason: "stop", totalUsage: {} });
    expect((await suggestResumeEdits("owner", run, "Baseline")).edits[0]).toMatchObject({ accepted: false, factsConfirmed: false });
  });
  it("rejects invented targets, command injection and incomplete responses", async () => {
    const run = data(), block = run.catalog.blocks[0];
    mockResponse({ text: JSON.stringify({ edits: [{ blockId: "a".repeat(24), replacement: "New claim", reason: "why" }] }), finishReason: "stop", totalUsage: {} });
    await expect(suggestResumeEdits("owner", run, "Baseline")).rejects.toThrow(/unknown/);
    mockResponse({ text: JSON.stringify({ edits: [{ blockId: block.id, replacement: "\\input{secret}", reason: "why" }] }), finishReason: "stop", totalUsage: {} });
    await expect(suggestResumeEdits("owner", run, "Baseline")).rejects.toThrow(/Only resume content/);
    mockResponse({ text: "partial", finishReason: "length", totalUsage: {} });
    await expect(matchResumeText("owner", run, "Baseline")).rejects.toThrow(/reached its output limit/);
  });
  it("uses the existing provider-specific default model", async () => {
    vi.mocked(db.userSettings.findUnique).mockResolvedValue({ settings: JSON.stringify({ ai: { provider: "openai" } }) } as never);
    expect(await resumeAiSettings("owner")).toEqual({ provider: "openai", model: "gpt-4o-mini" });
  });
  it("gives LaTeX suggestions a larger budget while asking for compact changes", async () => {
    const run = data(), block = run.catalog.blocks[0];
    mockResponse({ text: JSON.stringify({ edits: [{ blockId: block.id, replacement: "Delivered engineering systems with 100 Hz updates.", reason: "Relevant experience." }] }), finishReason: "stop", totalUsage: {} });
    const suggestions = await suggestResumeEdits("owner", run, "Baseline");
    expect(suggestions.edits[0]).toMatchObject({ accepted: false, factsConfirmed: false });
    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 16384, system: expect.stringContaining("at most 6 high-impact edits") }));
  });
  it("uses a configured suggestion budget and rejects truncated JSON even if it looks complete", async () => {
    const run = data();
    vi.stubEnv("RESUME_SUGGESTION_MAX_TOKENS", "24576");
    try {
      mockResponse({ text: '{"edits":[]}', finishReason: "length", totalUsage: {} });
      await expect(suggestResumeEdits("owner", run, "Baseline")).rejects.toThrow(/requested budget: 24576 tokens/);
      expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 24576 }));
      vi.stubEnv("RESUME_SUGGESTION_MAX_TOKENS", "0");
      mockResponse({ text: '{"edits":[]}', finishReason: "stop", totalUsage: {} });
      await suggestResumeEdits("owner", run, "Baseline");
      expect(streamText).toHaveBeenLastCalledWith(expect.objectContaining({ maxOutputTokens: 16384 }));
    } finally { vi.unstubAllEnvs(); }
  });
  it("streams from the compatible endpoint with bounded output and no hidden retries", async () => {
    const run = { ...data(), provider: "openai-compatible", model: "Qwen/Qwen3.8-Flash-Next" }, progress = vi.fn();
    mockResponse({ text: "SCORES: match=80 recommendation=strong\nEvidence", finishReason: "stop", totalUsage: {} });
    await matchResumeText("owner", run, "Baseline", { onProgress: progress });
    expect(streamText).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, maxOutputTokens: 4096, abortSignal: expect.any(AbortSignal) }));
    expect(progress).toHaveBeenCalledWith(expect.stringContaining("waiting for openai-compatible"));
    expect(progress).toHaveBeenCalledWith(expect.stringContaining("receiving the AI response"));
  });
  it("reports endpoint timeouts by stage and respects cancellation", async () => {
    vi.mocked(streamText).mockReturnValue({ fullStream: (async function* () { yield { type: "error", error: new Error("timeout") }; })() } as never);
    await expect(matchResumeText("owner", data(), "Baseline")).rejects.toThrow(/Resume matching: the AI endpoint timed out/);
    const stopped = new AbortController(); stopped.abort();
    vi.mocked(streamText).mockClear();
    await expect(suggestResumeEdits("owner", data(), "Baseline", { signal: stopped.signal })).rejects.toThrow(/Tailoring suggestions stopped/);
    expect(streamText).not.toHaveBeenCalled();
  });
  it("distinguishes an app deadline before the first token from one during generation", async () => {
    for (const received of [false, true]) {
      const deadline = new AbortController();
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
      vi.mocked(streamText).mockReturnValue({ fullStream: (async function* () {
        if (received) yield { type: "text-delta", text: "Partial response" };
        deadline.abort(new DOMException("Timed out", "TimeoutError"));
        yield { type: "error", error: deadline.signal.reason };
      })() } as never);
      await expect(matchResumeText("owner", data(), "Baseline")).rejects.toThrow(received ? /timed out after 180s.*while generating/ : /timed out after 180s.*before the first response token/);
    }
  });
});
