import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractText } from "unpdf";
import type { ResumeFiles } from "@/models/resumeOptimization.model";
import { sourceHash, maskComments } from "./latex";
import pLimit from "p-limit";
const buildLimit = pLimit(2);

async function build(files: ResumeFiles, entrypoint: string) {
  if (!files[entrypoint] || !/^[A-Za-z0-9_-]+\.tex$/.test(entrypoint)) throw new Error("Invalid resume entrypoint");
  const supportedInputs = new Set([...Object.keys(files).map((file) => file.replace(/\.tex$/, "")), "glyphtounicode"]);
  for (const content of Object.values(files)) {
    for (const match of maskComments(content).matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)) if (!supportedInputs.has(match[1].replace(/\.tex$/, ""))) throw new Error("LaTeX inputs must stay within the configured source files");
  }
  const scratch = await mkdtemp(path.join(tmpdir(), "jobsync-resume-build-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      if (!/^[A-Za-z0-9_-]+\.tex$/.test(file)) throw new Error("Invalid source filename");
      await writeFile(path.join(scratch, file), content, { mode: 0o600 });
    }
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV || "production", LANG: "C.UTF-8", openin_any: "p", openout_any: "p", shell_escape: "0", TEXMFOUTPUT: scratch };
    if (process.env.RESUME_TEXMF_HOME) {
      env.TEXMFHOME = process.env.RESUME_TEXMF_HOME;
      env.TEXMFCONFIG = path.join(process.env.RESUME_TEXMF_HOME, "config");
      env.TEXMFVAR = path.join(process.env.RESUME_TEXMF_HOME, "var");
    }
    try {
      const binary = process.env.RESUME_LATEX_BINARY || "pdflatex";
      const args = ["-no-shell-escape", "-halt-on-error", "-interaction=nonstopmode", entrypoint];
      for (let pass = 0; pass < 2; pass++) await promisify(execFile)("prlimit", ["--as=1073741824", "--cpu=30", "--fsize=10485760", "--", binary, ...args], { cwd: scratch, env, timeout: 30_000, maxBuffer: 512_000 });
    } catch (error) {
      const log = await readFile(path.join(scratch, entrypoint.replace(/\.tex$/, ".log")), "utf8").catch(() => "");
      const message = (error as NodeJS.ErrnoException).code === "ENOENT"
        ? "Install pdflatex, prlimit, and the template's packages, or set RESUME_LATEX_BINARY"
        : log.split("\n").filter((line) => line.startsWith("!") || line.startsWith("l.")).slice(-8).join("\n") || "LaTeX build failed or exceeded its time limit";
      throw new Error(message);
    }
    const pdf = await readFile(path.join(scratch, entrypoint.replace(/\.tex$/, ".pdf")));
    if (pdf.length > 5 * 1024 * 1024 || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Invalid or oversized compiled PDF");
    const extracted = await extractText(new Uint8Array(pdf), { mergePages: true });
    if (!extracted.text.trim() || extracted.text.length > 30_000) throw new Error("Compiled resume text is empty or exceeds matching limits");
    const log = await readFile(path.join(scratch, entrypoint.replace(/\.tex$/, ".log")), "utf8");
    const warnings = [...new Set(log.split("\n").filter((line) => /Overfull|LaTeX Warning/.test(line)))].slice(0, 15);
    if (extracted.totalPages > 1) warnings.unshift(`Resume is ${extracted.totalPages} pages; your saved job variants normally use one page`);
    return { hash: sourceHash(files), pdf: pdf.toString("base64"), pages: extracted.totalPages, warnings, text: extracted.text };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
export async function compileResume(files: ResumeFiles, entrypoint: string) {
  return buildLimit(() => build(files, entrypoint));
}
