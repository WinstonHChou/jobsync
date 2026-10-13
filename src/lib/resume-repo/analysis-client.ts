import type { ResumeAnalysisEvent, ResumeOptimizationView } from "@/models/resumeOptimization.model";

export async function requestResumeAnalysis(run: ResumeOptimizationView, stage: "baseline" | "suggestions", signal: AbortSignal, onProgress: (message: string) => void): Promise<ResumeOptimizationView> {
  const response = await fetch(`/api/resume-optimizations/${run.id}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: run.revision, stage }), signal });
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error ?? `Analysis connection failed (${response.status}). Reload to check saved progress.`);
  }
  if (!response.body) throw new Error("Analysis stream unavailable. Reload to check saved progress.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = "", result: ResumeOptimizationView | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as ResumeAnalysisEvent;
    if (event.type === "progress") onProgress(event.message);
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "result") result = event.run;
  };
  try {
    while (true) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = pending.split("\n"); pending = lines.pop()!;
      for (const line of lines) consume(line);
      if (chunk.done) { consume(pending); break; }
    }
    if (!result) throw new Error("Analysis connection ended before completion. Reload and retry; completed baseline scores are kept.");
    return result;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
