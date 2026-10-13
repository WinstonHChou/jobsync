import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, mkdtemp, writeFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ResumeFiles } from "@/models/resumeOptimization.model";
import { sourceHash } from "./latex";

const exec = promisify(execFile);
export async function git(repo: string, args: string[]) {
  const result = await exec("git", ["-c", `safe.directory=${repo}`, "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo, timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
    env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV || "production", LANG: "C.UTF-8", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout.trim();
}
export function validateBranch(branch: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,120}$/.test(branch) || branch.includes("..") || branch.includes("//") || branch.endsWith("/") || branch.endsWith(".lock") || branch.split("/").some((part) => part.startsWith(".") || part.endsWith("."))) throw new Error("Use a valid Git branch name");
  if (branch === "main" || branch === "master") throw new Error("Choose a job-specific branch");
}
export async function repositoryFor(email: string) {
  const allowed = (process.env.RESUME_REPO_ALLOWED_EMAILS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(email.toLowerCase()) || !process.env.RESUME_REPO_PATH) throw new Error("Resume repository access is not configured for this account");
  const repo = await realpath(process.env.RESUME_REPO_PATH);
  if (await git(repo, ["rev-parse", "--show-toplevel"]) !== repo) throw new Error("Configure the root of the Resume-CV Git repository");
  return repo;
}
export async function branches(repo: string) {
  return (await git(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])).split("\n").filter(Boolean);
}
export async function snapshot(repo: string, branch: string) {
  if (!(await branches(repo)).includes(branch)) throw new Error("Branch not found");
  const commit = await git(repo, ["rev-parse", `refs/heads/${branch}^{commit}`]);
  const entries = (await git(repo, ["ls-tree", commit])).split("\n");
  const files: ResumeFiles = {};
  for (const entry of entries) {
    const match = entry.match(/^100(?:644|755) blob [a-f0-9]+\t([A-Za-z0-9_-]+\.tex)$/);
    if (!match) continue;
    const result = await exec("git", ["-c", `safe.directory=${repo}`, "show", `${commit}:${match[1]}`], { cwd: repo, timeout: 10_000, maxBuffer: 128 * 1024 });
    files[match[1]] = result.stdout;
  }
  if (!Object.keys(files).length || Object.keys(files).length > 40 || JSON.stringify(files).length > 512_000) throw new Error("Resume repository source exceeds supported limits");
  return { commit, files, hash: sourceHash(files) };
}
export async function createBranch(repo: string, branch: string, base: string) {
  validateBranch(branch);
  await git(repo, ["update-ref", `refs/heads/${branch}`, base, "0000000000000000000000000000000000000000"]);
}
export async function assertBranchVersion(repo: string, branch: string, expected: string) {
  validateBranch(branch);
  if (await git(repo, ["rev-parse", `refs/heads/${branch}`]) !== expected) throw new Error("The job branch changed externally. Start a fresh draft from its latest commit before saving");
  const checkedOut = (await git(repo, ["worktree", "list", "--porcelain"])).split("\n").includes(`branch refs/heads/${branch}`);
  if (checkedOut) throw new Error("This branch is checked out elsewhere. Switch that checkout to another branch before committing through JobSync");
}
export async function commitResume(repo: string, branch: string, base: string, files: ResumeFiles, entrypoint: string, pdf: Buffer, runId: string, author: { name: string; email: string }) {
  validateBranch(branch);
  const tip = await git(repo, ["rev-parse", `refs/heads/${branch}`]);
  if (tip !== base) {
    // A Git commit can succeed just before a database save fails. Recover the
    // already-created artifact for this exact run instead of committing twice.
    const subject = await git(repo, ["log", "-1", "--format=%B", tip]);
    if (subject.includes(`JobSync optimization: ${runId}`) && (await snapshot(repo, branch)).hash === sourceHash(files) && (await committedPdf(repo, tip, entrypoint)).equals(pdf)) return tip;
  }
  await assertBranchVersion(repo, branch, base);
  const scratch = await mkdtemp(path.join(tmpdir(), "jobsync-resume-commit-"));
  try {
    await git(scratch, ["-c", `safe.directory=${repo}`, "clone", "--no-local", "--no-checkout", "--", repo, "."]);
    await git(scratch, ["checkout", "--detach", base]);
    for (const [file, content] of Object.entries(files)) {
      if (!/^[A-Za-z0-9_-]+\.tex$/.test(file)) throw new Error("Invalid source filename");
      const target = path.join(scratch, file);
      if ((await lstat(target)).isSymbolicLink()) throw new Error("Symlink sources are unsupported");
      await writeFile(target, content);
    }
    const pdfName = entrypoint.replace(/\.tex$/, ".pdf");
    if ((await lstat(path.join(scratch, pdfName)).catch(() => null))?.isSymbolicLink()) throw new Error("Symlink PDFs are unsupported");
    await writeFile(path.join(scratch, pdfName), pdf);
    await git(scratch, ["add", "--", ...Object.keys(files), pdfName]);
    await git(scratch, ["-c", `user.name=${author.name.replace(/[\r\n]/g, " ").trim() || author.email.split("@")[0]}`, "-c", `user.email=${author.email}`, "commit", "-m", `Tailor resume: ${branch}\n\nJobSync optimization: ${runId}`]);
    const commit = await git(scratch, ["rev-parse", "HEAD"]);
    // Import objects without touching the worktree/index, then update the branch
    // only if its expected parent still matches. No reset, checkout or push.
    await git(repo, ["fetch", "--no-tags", "--no-write-fetch-head", "--", scratch, commit]);
    await assertBranchVersion(repo, branch, base);
    await git(repo, ["update-ref", `refs/heads/${branch}`, commit, base]);
    return commit;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
export async function sourceDiff(before: ResumeFiles, after: ResumeFiles) {
  const result: { file: string; before: string; after: string }[] = [];
  for (const file of Object.keys(before)) if (before[file] !== after[file]) result.push({ file, before: before[file], after: after[file] });
  return result;
}
// Kept separate for straightforward testing of imported objects after a commit.
export async function committedPdf(repo: string, commit: string, entrypoint: string) {
  const result = await promisify(execFile)("git", ["-c", `safe.directory=${repo}`, "show", `${commit}:${entrypoint.replace(/\.tex$/, ".pdf")}`], { cwd: repo, encoding: "buffer", timeout: 10_000, maxBuffer: 5 * 1024 * 1024 });
  return result.stdout;
}
