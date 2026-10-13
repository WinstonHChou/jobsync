import { z } from "zod";
import { requireUser } from "@/actions/shared";
import { ownedOptimization } from "@/lib/resume-repo/service";
import { repositoryFor } from "@/lib/resume-repo/repository";
import { analyzeResumeStage } from "@/lib/resume-repo/analysis";
import type { ResumeAnalysisEvent } from "@/models/resumeOptimization.model";

export const runtime = "nodejs";
const inputSchema = z.object({ revision: z.number().int().nonnegative(), stage: z.enum(["baseline", "suggestions"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser().catch(() => null);
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const id = (await context.params).id;
  try { await repositoryFor(user.email); await ownedOptimization(id, user.id); }
  catch { return Response.json({ error: "Resume optimization not found" }, { status: 404 }); }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid analysis request" }, { status: 400 });

  const cancelled = new AbortController();
  const signal = AbortSignal.any([request.signal, cancelled.signal]);
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: ResumeAnalysisEvent) => { if (!closed) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
      send({ type: "progress", message: "Starting resume analysis…" });
      heartbeat = setInterval(() => send({ type: "heartbeat" }), 10_000);
      void (async () => {
        try {
          const run = await analyzeResumeStage(id, user.id, parsed.data.revision, parsed.data.stage, { signal, onProgress: (message) => send({ type: "progress", message }) });
          send({ type: "result", run });
        } catch (error) { send({ type: "error", message: error instanceof Error ? error.message : "Resume analysis failed" }); }
        finally { clearInterval(heartbeat); if (!closed) { closed = true; controller.close(); } }
      })();
    },
    cancel() { closed = true; clearInterval(heartbeat); cancelled.abort(); },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "private, no-store, no-transform", "X-Accel-Buffering": "no" } });
}
