// @vitest-environment node
import { PrismaClient } from "@prisma/client";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedAccount } from "./helpers/backupTestDb";
import { git } from "@/lib/resume-repo/repository";
import { sourceHash } from "@/lib/resume-repo/latex";
import { ownedOptimization, changeOptimization, optimizationView } from "@/lib/resume-repo/service";
import { getCurrentUser } from "@/utils/user.utils";
import { createResumeOptimization, analyzeResumeOptimization, saveResumeOptimizationDraft, buildResumeOptimization, scoreResumeOptimization, commitResumeOptimization, listResumeOptimizationRuns, getResumeOptimizationSetup } from "@/actions/resumeOptimization.actions";
import { GET } from "@/app/api/resume-optimizations/[id]/pdf/route";
import { collectBackupData } from "@/lib/backup/export";
import type { ResumeFiles } from "@/models/resumeOptimization.model";
import { analyzeResumeStage } from "@/lib/resume-repo/analysis";
import { matchResumeText, suggestResumeEdits } from "@/lib/resume-repo/ai";

const ctx = await vi.hoisted(async () => {
  const helpers = await import("./helpers/backupTestDb");
  const context = helpers.makeTestDbUrl(); helpers.pushSchema(context.url); return context;
});
vi.mock("@/lib/db", async () => { const { PrismaClient } = await import("@prisma/client"); return { default: new PrismaClient({ datasources: { db: { url: ctx.url } } }) }; });
vi.mock("@/utils/user.utils", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/resume-repo/compiler", () => ({ compileResume: vi.fn(async (files: ResumeFiles) => ({ hash: sourceHash(files), pdf: Buffer.from("%PDF-test artifact").toString("base64"), pages: 1, warnings: [], text: "Built engineering systems with existing evidence." })) }));
vi.mock("@/lib/resume-repo/ai", () => ({
  resumeAiSettings: vi.fn(async () => ({ provider: "ollama", model: "test-model" })),
  matchResumeText: vi.fn(async () => ({ score: 75, body: "Match evidence", at: new Date().toISOString() })),
  suggestResumeEdits: vi.fn(async (_user: string, data: { catalog: { blocks: { id: string; original: string }[] } }) => ({ edits: [{ blockId: data.catalog.blocks[0].id, replacement: "Built reliable engineering systems.", reason: "Clarity", accepted: false, factsConfirmed: false }] })),
  changedSourceFiles: (before: ResumeFiles, after: ResumeFiles) => Object.keys(before).filter((file) => before[file] !== after[file]),
}));
vi.mock("unpdf", () => ({ extractText: vi.fn(async () => ({ text: "Candidate resume text", totalPages: 1 })) }));

const prisma = new PrismaClient({ datasources: { db: { url: ctx.url } } });
const files = { "Resume.tex": "\\documentclass{article}\n\\input{experience}\n\\begin{document}\n\\section{Experience}\n\\resumeSubHeadingListStart\n\\Engineer\n\\resumeSubHeadingListEnd\n\\end{document}\n", "experience.tex": "\\NewDocumentCommand{\\Engineer}{}{\\resumeItem{Built engineering systems.}}\n" };
let repo: string, ownerId: string, otherId: string, jobId: string;
beforeAll(async () => {
  ownerId = await seedAccount(prisma, "owner@example.com"); otherId = await seedAccount(prisma, "other@example.com");
  const company = await prisma.company.create({ data: { label: "Acme", value: "acme", createdBy: ownerId } });
  const title = await prisma.jobTitle.create({ data: { label: "Engineer", value: "engineer", createdBy: ownerId } });
  const status = await prisma.jobStatus.findFirstOrThrow();
  const job = await prisma.job.create({ data: { userId: ownerId, companyId: company.id, jobTitleId: title.id, statusId: status.id, description: "Build and maintain robotics and engineering systems using existing programming and systems integration experience. ".repeat(4), jobType: "full-time", createdAt: new Date() } }); jobId = job.id;
  repo = await mkdtemp(path.join(tmpdir(), "jobsync-resume-workflow-"));
  await git(repo, ["init", "-b", "main"]); await git(repo, ["config", "user.name", "Owner"]); await git(repo, ["config", "user.email", "owner@example.com"]);
  for (const [file, text] of Object.entries(files)) await writeFile(path.join(repo, file), text);
  await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "baseline"]);
  vi.stubEnv("RESUME_REPO_PATH", repo); vi.stubEnv("RESUME_REPO_ALLOWED_EMAILS", "owner@example.com,other@example.com");
}, 120_000);
beforeEach(() => { vi.mocked(getCurrentUser).mockResolvedValue({ id: ownerId, email: "owner@example.com", name: "Owner" }); });
afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); await rm(repo, { recursive: true, force: true }); await rm(ctx.dir, { recursive: true, force: true }); });
async function newRun(branch: string) {
  const result = await createResumeOptimization({ jobId, baseBranch: "main", targetBranch: branch, entrypoint: "Resume.tex", continueBranch: false });
  if (!result.success) throw new Error(result.message); return result.run;
}
describe("resume optimization workflow", () => {
  it("keeps a completed baseline when suggestions time out and retries only suggestions", async () => {
    let run = await newRun("acme/analysis-retry");
    vi.mocked(matchResumeText).mockClear();
    run = await analyzeResumeStage(run.id, ownerId, run.revision, "baseline");
    expect(run.data.baseline?.score).toBe(75);
    vi.mocked(suggestResumeEdits).mockRejectedValueOnce(new Error("Tailoring suggestions timed out"));
    await expect(analyzeResumeStage(run.id, ownerId, run.revision, "suggestions")).rejects.toThrow(/timed out/);
    const failed = await ownedOptimization(run.id, ownerId);
    expect(failed.data.baseline?.score).toBe(75);
    expect(failed.data.busyUntil).toBeUndefined();
    const retried = await analyzeResumeOptimization({ id: run.id, revision: failed.row.revision });
    expect(retried.success).toBe(true);
    expect(matchResumeText).toHaveBeenCalledOnce();
  });
  it("captures a private job, reviews edits, builds, scores, commits and downloads its exact PDF", async () => {
    let run = await newRun("acme/full-workflow");
    const analyzed = await analyzeResumeOptimization({ id: run.id, revision: run.revision }); expect(analyzed.success).toBe(true); if (!analyzed.success) return; run = analyzed.run;
    expect(run.data.baseline?.score).toBe(75); expect(run.data.edits[0].accepted).toBe(false);
    const edited = run.data.edits.map((edit) => ({ ...edit, accepted: true, factsConfirmed: true }));
    const saved = await saveResumeOptimizationDraft({ id: run.id, revision: run.revision, layout: run.data.layout, edits: edited }); expect(saved.success).toBe(true); if (!saved.success) return; run = saved.run;
    const built = await buildResumeOptimization({ id: run.id, revision: run.revision }); expect(built.success).toBe(true); if (!built.success) return; run = built.run;
    const scored = await scoreResumeOptimization({ id: run.id, revision: run.revision }); expect(scored.success).toBe(true); if (!scored.success) return; run = scored.run;
    const result = await commitResumeOptimization({ id: run.id, revision: run.revision, acknowledgeWarnings: true }); expect(result.success).toBe(true); if (!result.success) return; run = result.run;
    expect(run.data.status).toBe("committed"); expect(run.data.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(await readFile(path.join(repo, "experience.tex"), "utf8")).toBe(files["experience.tex"]);
    const response = await GET(new Request(`https://jobsync.test/api/resume-optimizations/${run.id}/pdf?download=1`), { params: Promise.resolve({ id: run.id }) });
    expect(response.status).toBe(200); expect(response.headers.get("content-disposition")).toContain("attachment"); expect(await response.text()).toBe("%PDF-test artifact");
    const backup = await collectBackupData(ownerId); expect(backup.ResumeOptimization.some((row) => row.id === run.id)).toBe(true);
  });
  it("keeps source and PDF bodies out of ordinary client responses", async () => {
    const run = await newRun("acme/private-snapshot");
    expect(run.data).not.toHaveProperty("files");
    const owned = await ownedOptimization(run.id, ownerId); owned.data.artifact = { hash: sourceHash(files), pages: 1, warnings: [], pdf: "private-pdf" };
    expect(optimizationView({ ...owned.row, data: JSON.stringify(owned.data) }).data.artifact).not.toHaveProperty("pdf");
  });
  it("enforces account ownership for source setup, history and PDFs", async () => {
    const run = await newRun("acme/ownership");
    vi.mocked(getCurrentUser).mockResolvedValue({ id: otherId, email: "other@example.com", name: "Other" });
    expect((await getResumeOptimizationSetup(jobId)).success).toBe(false);
    const history = await listResumeOptimizationRuns(jobId); expect(history).toEqual({ success: true, runs: [] });
    await expect(ownedOptimization(run.id, otherId)).rejects.toThrow(/not found/);
    expect((await GET(new Request("https://jobsync.test/pdf"), { params: Promise.resolve({ id: run.id }) })).status).toBe(404);
  });
  it("rejects stale revisions and serializes simultaneous mutations", async () => {
    const run = await newRun("acme/concurrency");
    await expect(changeOptimization(run.id, ownerId, run.revision + 1, async (data) => data)).rejects.toThrow(/another tab/);
    const results = await Promise.allSettled([changeOptimization(run.id, ownerId, run.revision, async (data) => data), changeOptimization(run.id, ownerId, run.revision, async (data) => data)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
  it("releases a failed operation and prevents commit without a matching build", async () => {
    const run = await newRun("acme/recover-failure");
    await expect(changeOptimization(run.id, ownerId, run.revision, async () => { throw new Error("test failure"); })).rejects.toThrow("test failure");
    const current = await ownedOptimization(run.id, ownerId); expect(current.data.busyUntil).toBeUndefined(); expect(current.row.revision).toBe(run.revision + 2);
    const commit = await commitResumeOptimization({ id: run.id, revision: current.row.revision, acknowledgeWarnings: true }); expect(commit).toMatchObject({ success: false, message: "Build and review the current draft before committing" });
  });
  it("invalidates a built PDF when the draft is changed", async () => {
    let run = await newRun("acme/stale-pdf");
    const built = await buildResumeOptimization({ id: run.id, revision: run.revision }); if (!built.success) throw new Error(built.message); run = built.run;
    const saved = await saveResumeOptimizationDraft({ id: run.id, revision: run.revision, layout: run.data.layout.map((section) => ({ ...section, title: "Systems Experience" })), edits: [] });
    if (!saved.success) throw new Error(saved.message);
    expect(saved.run.data.artifact).toBeUndefined(); expect(saved.run.data.candidate).toBeUndefined();
    expect((await GET(new Request("https://jobsync.test/pdf"), { params: Promise.resolve({ id: run.id }) })).status).toBe(409);
  });
});
