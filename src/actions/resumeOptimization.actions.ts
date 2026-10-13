"use server";

import { z } from "zod";
import db from "@/lib/db";
import { requireUser } from "./shared";
import { removeHtmlTags, JOB_MATCH_SYSTEM_PROMPT, buildJobMatchPrompt } from "@/lib/ai";
import { readCatalog, composeResume, sourceHash } from "@/lib/resume-repo/latex";
import { repositoryFor, branches, snapshot, createBranch, commitResume, sourceDiff } from "@/lib/resume-repo/repository";
import { compileResume } from "@/lib/resume-repo/compiler";
import { resumeAiSettings, matchResumeText, changedSourceFiles } from "@/lib/resume-repo/ai";
import { optimizationView, ownedOptimization, changeOptimization } from "@/lib/resume-repo/service";
import { saveDraftSchema } from "@/lib/resume-repo/schemas";
import { analyzeResumeStage } from "@/lib/resume-repo/analysis";
import type { ResumeOptimizationData } from "@/models/resumeOptimization.model";

const runSchema = z.object({ id: z.string().uuid(), revision: z.number().int().nonnegative() });
const message = (error: unknown) => error instanceof Error ? error.message : "Resume operation failed";

export async function getResumeOptimizationSetup(jobId: string) {
  try {
    const user = await requireUser(), repo = await repositoryFor(user.email);
    const job = await db.job.findFirst({ where: { id: jobId, userId: user.id }, select: { id: true } });
    if (!job) throw new Error("Job not found");
    const base = await snapshot(repo, "main");
    return { success: true as const, branches: await branches(repo), entrypoints: Object.keys(base.files).filter((file) => base.files[file].includes("\\begin{document}")), defaultEntrypoint: "Resume_Winston.tex", compiler: process.env.RESUME_LATEX_BINARY || "pdflatex" };
  } catch (error) { return { success: false as const, message: message(error) }; }
}
export async function listResumeOptimizationRuns(jobId: string) {
  try {
    const user = await requireUser(); await repositoryFor(user.email);
    const rows = await db.resumeOptimization.findMany({ where: { jobId, userId: user.id }, orderBy: { createdAt: "desc" }, take: 30 });
    return { success: true as const, runs: rows.map(optimizationView) };
  } catch (error) { return { success: false as const, message: message(error) }; }
}
export async function createResumeOptimization(input: { jobId: string; baseBranch: string; targetBranch: string; entrypoint: string; continueBranch: boolean }) {
  try {
    const parsed = z.object({ jobId: z.string().min(1), baseBranch: z.string().min(1).max(120), targetBranch: z.string().min(1).max(120), entrypoint: z.string().regex(/^[A-Za-z0-9_-]+\.tex$/), continueBranch: z.boolean() }).parse(input);
    const user = await requireUser(), repo = await repositoryFor(user.email);
    const job = await db.job.findFirst({ where: { id: parsed.jobId, userId: user.id }, include: { JobTitle: true, Company: true, Location: true } });
    if (!job) throw new Error("Job not found");
    const base = await snapshot(repo, parsed.continueBranch ? parsed.targetBranch : parsed.baseBranch);
    const catalog = readCatalog(base.files, parsed.entrypoint);
    const jobText = `Title: ${job.JobTitle.label}\nCompany: ${job.Company.label}\nLocation: ${job.Location?.label ?? ""}\n\n${removeHtmlTags(job.description)}`;
    if (jobText.length > 30_000 || removeHtmlTags(job.description).trim().length < 200) throw new Error("Add a complete job description before tailoring a resume");
    const settings = await resumeAiSettings(user.id);
    const data: ResumeOptimizationData = { version: 1, entrypoint: parsed.entrypoint, branch: parsed.targetBranch, baseCommit: base.commit, files: base.files, sourceHash: base.hash, jobText, jobTitle: job.JobTitle.label, company: job.Company.label, catalog, layout: catalog.sections, edits: [], ...settings, promptVersion: "latex-tailoring-v1", matchSystemPrompt: JOB_MATCH_SYSTEM_PROMPT, matchPromptTemplate: buildJobMatchPrompt("{{RESUME_SNAPSHOT}}", "{{JOB_SNAPSHOT}}"), status: "draft" };
    if (!parsed.continueBranch) await createBranch(repo, parsed.targetBranch, base.commit);
    else { const { validateBranch } = await import("@/lib/resume-repo/repository"); validateBranch(parsed.targetBranch); }
    const row = await db.resumeOptimization.create({ data: { userId: user.id, jobId: job.id, data: JSON.stringify(data) } });
    return { success: true as const, run: optimizationView(row) };
  } catch (error) { return { success: false as const, message: message(error) }; }
}
export async function saveResumeOptimizationDraft(input: z.infer<typeof saveDraftSchema>) {
  try {
    const parsed = saveDraftSchema.parse(input), user = await requireUser(); await repositoryFor(user.email);
    const run = await changeOptimization(parsed.id, user.id, parsed.revision, async (data) => {
      composeResume(data.files, data.entrypoint, parsed.layout, parsed.edits);
      return { ...data, layout: parsed.layout, edits: parsed.edits, artifact: undefined, candidate: undefined, buildError: undefined };
    });
    return { success: true as const, run };
  } catch (error) { return { success: false as const, message: message(error) }; }
}
export async function analyzeResumeOptimization(input: z.infer<typeof runSchema>) {
  try {
    const parsed = runSchema.parse(input), user = await requireUser(); await repositoryFor(user.email);
    const baseline = await analyzeResumeStage(parsed.id, user.id, parsed.revision, "baseline");
    const run = await analyzeResumeStage(parsed.id, user.id, baseline.revision, "suggestions");
    return { success: true as const, run };
  } catch (error) { return { success: false as const, message: message(error) }; }
}
export async function buildResumeOptimization(input: z.infer<typeof runSchema>) {
  try {
    const parsed = runSchema.parse(input), user = await requireUser(); await repositoryFor(user.email);
    const run = await changeOptimization(parsed.id, user.id, parsed.revision, async (data) => {
      const files = composeResume(data.files, data.entrypoint, data.layout, data.edits);
      const build = await compileResume(files, data.entrypoint);
      // Shared source edits can affect the CV even when the target is a resume.
      if (changedSourceFiles(data.files, files).some((file) => file !== data.entrypoint) && files["CV_Winston.tex"] && data.entrypoint !== "CV_Winston.tex") {
        await compileResume(files, "CV_Winston.tex");
        build.warnings.push("Shared content changed; the CV also compiled successfully. Review its source impact before committing");
      }
      const { text: _text, ...artifact } = build; void _text;
      return { ...data, artifact, candidate: undefined, buildError: undefined };
    });
    return { success: true as const, run };
  } catch (error) { return { success: false as const, message: message(error) }; }
}
export async function scoreResumeOptimization(input: z.infer<typeof runSchema>) {
  try {
    const parsed = runSchema.parse(input), user = await requireUser(); await repositoryFor(user.email);
    const run = await changeOptimization(parsed.id, user.id, parsed.revision, async (data) => {
      const files = composeResume(data.files, data.entrypoint, data.layout, data.edits);
      if (!data.artifact || data.artifact.hash !== sourceHash(files)) throw new Error("Build the current draft before scoring it");
      if (!data.baseline) { const base = await compileResume(data.files, data.entrypoint); data.baseline = await matchResumeText(user.id, data, base.text); }
      const { extractText } = await import("unpdf");
      const extracted = await extractText(new Uint8Array(Buffer.from(data.artifact.pdf, "base64")), { mergePages: true });
      return { ...data, candidate: await matchResumeText(user.id, data, extracted.text), buildError: undefined };
    });
    return { success: true as const, run };
  } catch (error) { return { success: false as const, message: message(error) }; }
}
export async function commitResumeOptimization(input: z.infer<typeof runSchema> & { acknowledgeWarnings: boolean }) {
  try {
    const parsed = runSchema.extend({ acknowledgeWarnings: z.boolean() }).parse(input), user = await requireUser(), repo = await repositoryFor(user.email);
    const run = await changeOptimization(parsed.id, user.id, parsed.revision, async (data) => {
      const files = composeResume(data.files, data.entrypoint, data.layout, data.edits);
      if (!data.artifact || data.artifact.hash !== sourceHash(files)) throw new Error("Build and review the current draft before committing");
      if (data.artifact.warnings.length && !parsed.acknowledgeWarnings) throw new Error("Acknowledge the build warnings before committing");
      const commit = await commitResume(repo, data.branch, data.baseCommit, files, data.entrypoint, Buffer.from(data.artifact.pdf, "base64"), parsed.id, user);
      return { ...data, commit, status: "committed", buildError: undefined };
    });
    return { success: true as const, run };
  } catch (error) { return { success: false as const, message: message(error) }; }
}
export async function getResumeOptimizationDiff(id: string) {
  try {
    const user = await requireUser(); await repositoryFor(user.email);
    const { data } = await ownedOptimization(z.string().uuid().parse(id), user.id);
    const files = composeResume(data.files, data.entrypoint, data.layout, data.edits);
    return { success: true as const, files: await sourceDiff(data.files, files) };
  } catch (error) { return { success: false as const, message: message(error) }; }
}
