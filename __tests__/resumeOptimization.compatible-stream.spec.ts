// @vitest-environment node
import { expect, it, vi, beforeEach, afterEach } from "vitest";
import { createOpenAI } from "@ai-sdk/openai";
import { getModel } from "@/lib/ai/providers";
import { matchResumeText, suggestResumeEdits } from "@/lib/resume-repo/ai";
import { readCatalog, sourceHash } from "@/lib/resume-repo/latex";
import type { ResumeOptimizationData } from "@/models/resumeOptimization.model";
vi.mock("@/lib/ai/providers", () => ({ getModel: vi.fn() }));
vi.mock("@/lib/aiUsage/tracker", () => ({ startAiCall: () => ({ finish: vi.fn(async () => {}), markFirstToken: vi.fn() }) }));
vi.mock("@/lib/ai/rate-limiter", () => ({ checkRateLimit: () => ({ allowed: true }) }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());
it("sends the configured matching budget through the real OpenAI-compatible adapter and parses its score", async () => {
  vi.stubEnv("RESUME_MATCH_MAX_TOKENS", "8192");
  const chunk = (delta: object, reason: string | null = null) => `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: "Qwen/Qwen3.8-Flash-Next", choices: [{ index: 0, delta, finish_reason: reason }] })}\n\n`;
  const fetch = vi.fn(async () => new Response(chunk({ role: "assistant", content: "SCORES: match=80 " }) + chunk({ content: "recommendation=strong\n\nEvidence" }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } }));
  const model = createOpenAI({ baseURL: "http://test.invalid/v1", apiKey: "", fetch }).chat("Qwen/Qwen3.8-Flash-Next");
  vi.mocked(getModel).mockResolvedValue(model);
  const data = { provider: "openai-compatible", model: "Qwen/Qwen3.8-Flash-Next", jobText: "Job context", matchSystemPrompt: "Match instructions", matchPromptTemplate: "{{RESUME_SNAPSHOT}}\n{{JOB_SNAPSHOT}}" } as ResumeOptimizationData;
  expect((await matchResumeText("owner", data, "PDF resume text")).score).toBe(80);
  expect(fetch).toHaveBeenCalledOnce();
  const args = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(args[0]).toBe("http://test.invalid/v1/chat/completions");
  expect(JSON.parse(String(args[1].body))).toMatchObject({ stream: true, model: "Qwen/Qwen3.8-Flash-Next", max_tokens: 8192 });
});
it("sends the larger suggestion budget as max_tokens and preserves truncation rejection through the real adapter", async () => {
  const files = { "Resume.tex": "\\begin{document}\n\\section{Experience}\n\\Engineer\n\\end{document}", "experience.tex": "\\NewDocumentCommand{\\Engineer}{}{\\resumeItem{Built engineering systems.}}" };
  const catalog = readCatalog(files, "Resume.tex");
  const json = JSON.stringify({ edits: [{ blockId: catalog.blocks[0].id, replacement: "Delivered engineering systems.", reason: "Relevant experience." }] });
  const fetch = vi.fn(async (_url: unknown, options: RequestInit | undefined) => {
    const body = JSON.parse(String(options?.body));
    const chunk = (content: string | null, reason: string | null) => `data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: reason }] })}\n\n`;
    return new Response(chunk(json, null) + chunk(null, body.max_tokens >= 16384 ? "stop" : "length") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
  });
  vi.mocked(getModel).mockResolvedValue(createOpenAI({ baseURL: "http://test.invalid/v1", apiKey: "", fetch }).chat("Qwen/Qwen3.8-Flash-Next"));
  const data: ResumeOptimizationData = { version: 1, branch: "test/engineer", baseCommit: "b".repeat(40), sourceHash: sourceHash(files), jobTitle: "Engineer", company: "Example", edits: [], promptVersion: "test", status: "draft", provider: "openai-compatible", model: "Qwen/Qwen3.8-Flash-Next", jobText: "Job context", files, catalog, layout: catalog.sections, entrypoint: "Resume.tex" };
  const suggestions = await suggestResumeEdits("owner", data, "Baseline PDF text");
  expect(suggestions.edits[0]).toMatchObject({ replacement: "Delivered engineering systems.", accepted: false, factsConfirmed: false });
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toMatchObject({ max_tokens: 16384, stream: true });
  vi.stubEnv("RESUME_SUGGESTION_MAX_TOKENS", "4096");
  try { await expect(suggestResumeEdits("owner", data, "Baseline PDF text")).rejects.toThrow(/requested budget: 4096 tokens/); }
  finally { vi.unstubAllEnvs(); }
});
