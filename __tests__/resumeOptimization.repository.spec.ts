// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { git, snapshot, createBranch, commitResume, assertBranchVersion, validateBranch, repositoryFor, committedPdf } from "@/lib/resume-repo/repository";

let repo: string;
beforeEach(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "jobsync-git-test-"));
  await git(repo, ["init", "-b", "main"]); await git(repo, ["config", "user.name", "Test"]); await git(repo, ["config", "user.email", "test@example.com"]);
  await writeFile(path.join(repo, "Resume.tex"), "Baseline source\n"); await writeFile(path.join(repo, "Resume.pdf"), "%PDF-original");
  await git(repo, ["add", "."]); await git(repo, ["commit", "-m", "baseline"]);
});
afterEach(async () => { await rm(repo, { recursive: true, force: true }); });
describe("isolated resume Git transactions", () => {
  it("creates a job branch and commits source/PDF without changing the normal checkout", async () => {
    const base = await snapshot(repo, "main"); await createBranch(repo, "acme/engineer", base.commit);
    const pdf = Buffer.from("%PDF-tailored"), files = { "Resume.tex": "Tailored source\n" };
    const commit = await commitResume(repo, "acme/engineer", base.commit, files, "Resume.tex", pdf, "run-1", { name: "Test", email: "test@example.com" });
    expect(await git(repo, ["branch", "--show-current"])).toBe("main");
    expect(await readFile(path.join(repo, "Resume.tex"), "utf8")).toBe("Baseline source\n");
    expect((await snapshot(repo, "acme/engineer")).files).toEqual(files);
    expect(await committedPdf(repo, commit, "Resume.tex")).toEqual(pdf);
    expect(await git(repo, ["rev-parse", `${commit}^`])).toBe(base.commit);
    expect(await commitResume(repo, "acme/engineer", base.commit, files, "Resume.tex", pdf, "run-1", { name: "Test", email: "test@example.com" })).toBe(commit);
  });
  it("rejects stale refs, checked-out job branches and duplicate branch creation", async () => {
    const base = await snapshot(repo, "main"); await createBranch(repo, "acme/engineer", base.commit);
    await expect(createBranch(repo, "acme/engineer", base.commit)).rejects.toThrow();
    await expect(assertBranchVersion(repo, "acme/engineer", "0".repeat(40))).rejects.toThrow(/changed externally/);
    await git(repo, ["checkout", "acme/engineer"]);
    await expect(assertBranchVersion(repo, "acme/engineer", base.commit)).rejects.toThrow(/checked out elsewhere/);
  });
  it.each(["main", "master", "--upload-pack=evil", "company/../role", "company//role", ".hidden/role", "company/role.lock"])("rejects unsafe target %s", (branch) => expect(() => validateBranch(branch)).toThrow());
  it("restricts access to configured emails", async () => {
    vi.stubEnv("RESUME_REPO_PATH", repo); vi.stubEnv("RESUME_REPO_ALLOWED_EMAILS", "owner@example.com");
    await expect(repositoryFor("other@example.com")).rejects.toThrow(/not configured/);
    expect(await repositoryFor("OWNER@example.com")).toBe(repo);
    vi.unstubAllEnvs();
  });
});
