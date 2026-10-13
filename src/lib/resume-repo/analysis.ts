import "server-only";
import { compileResume } from "./compiler";
import { matchResumeText, suggestResumeEdits, type ResumeAiRequest } from "./ai";
import { changeOptimization } from "./service";

export type AnalysisStage = "baseline" | "suggestions";

// Each stage has its own persisted revision and HTTP request. A failed or
// disconnected suggestion request cannot discard or rerun the baseline score.
export async function analyzeResumeStage(id: string, userId: string, revision: number, stage: AnalysisStage, request: ResumeAiRequest = {}) {
  return changeOptimization(id, userId, revision, async (data) => {
    request.signal?.throwIfAborted();
    if (data.edits.length || JSON.stringify(data.layout) !== JSON.stringify(data.catalog.sections)) throw new Error("Create a fresh draft before generating another set of proposals");
    if (stage === "baseline" && data.baseline) return { ...data, buildError: undefined };
    if (stage === "suggestions" && !data.baseline) throw new Error("Match the baseline before generating suggestions");
    request.onProgress?.(stage === "baseline" ? "Compiling the baseline LaTeX resume…" : "Preparing source for tailoring suggestions…");
    const build = await compileResume(data.files, data.entrypoint);
    request.signal?.throwIfAborted();
    if (stage === "baseline") return { ...data, baseline: await matchResumeText(userId, data, build.text, request), buildError: undefined };
    const suggested = await suggestResumeEdits(userId, data, build.text, request);
    return { ...data, edits: suggested.edits, suggestedLayout: suggested.layout, buildError: undefined };
  });
}
