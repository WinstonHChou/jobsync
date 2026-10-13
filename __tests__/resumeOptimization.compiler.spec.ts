// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compileResume } from "@/lib/resume-repo/compiler";
import { writeFile, readFile, rm } from "node:fs/promises";
const exec = vi.hoisted(() => vi.fn(async () => ({ stdout: "", stderr: "" })));
vi.mock("node:child_process", () => ({ execFile: Object.assign(vi.fn(), { [Symbol.for("nodejs.util.promisify.custom")]: exec }) }));
vi.mock("node:fs/promises", () => ({ mkdtemp: vi.fn(async () => "/tmp/resume-build-test"), writeFile: vi.fn(async () => {}), readFile: vi.fn(async (file: string) => file.endsWith(".pdf") ? Buffer.from("%PDF-test") : "Overfull \\hbox warning"), rm: vi.fn(async () => {}) }));
vi.mock("unpdf", () => ({ extractText: vi.fn(async () => ({ text: "Engineering resume content", totalPages: 1 })) }));
beforeEach(() => { vi.clearAllMocks(); exec.mockResolvedValue({ stdout: "", stderr: "" }); });
describe("bounded LaTeX compilation", () => {
  it("passes shell/file restrictions and resource limits without forwarding credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "private-key");
    const result = await compileResume({ "Resume.tex": "\\input{content}", "content.tex": "Resume content" }, "Resume.tex");
    expect(result.pdf).toBe(Buffer.from("%PDF-test").toString("base64"));
    expect(exec).toHaveBeenCalledTimes(2);
    const [binary, args, options] = exec.mock.calls[0] as unknown as [string, string[], { env: Record<string, string>; timeout: number; maxBuffer: number }];
    expect(binary).toBe("prlimit"); expect(args).toContain("--as=1073741824"); expect(args).toContain("-no-shell-escape");
    expect(options.env).toMatchObject({ openin_any: "p", openout_any: "p", shell_escape: "0" });
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY"); expect(options.timeout).toBe(30_000);
    expect(rm).toHaveBeenCalledWith("/tmp/resume-build-test", { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  it.each(["../secret", "/etc/passwd", "https://example.com/private"])("rejects an external input %s before writing files", async (input) => {
    await expect(compileResume({ "Resume.tex": `\\input{${input}}` }, "Resume.tex")).rejects.toThrow(/within the configured source/);
    expect(writeFile).not.toHaveBeenCalled(); expect(exec).not.toHaveBeenCalled();
  });
  it("rejects invalid source filenames and cleans up after compiler failure", async () => {
    await expect(compileResume({ "Resume.tex": "Resume", "../outside.tex": "Forbidden" }, "Resume.tex")).rejects.toThrow(/Invalid source filename/);
    exec.mockRejectedValue(new Error("compiler failed"));
    vi.mocked(readFile).mockResolvedValue("! Unbalanced list\nl.12 \\end{document}" as never);
    await expect(compileResume({ "Resume.tex": "Resume" }, "Resume.tex")).rejects.toThrow(/Unbalanced list/);
    expect(rm).toHaveBeenCalled();
  });
});
