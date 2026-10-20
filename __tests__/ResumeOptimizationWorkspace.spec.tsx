import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResumeOptimizationWorkspace } from "@/components/resume-optimization/ResumeOptimizationWorkspace";
import { requestResumeAnalysis } from "@/lib/resume-repo/analysis-client";
import * as actions from "@/actions/resumeOptimization.actions";
import type { ResumeOptimizationView } from "@/models/resumeOptimization.model";

vi.mock("@/actions/resumeOptimization.actions", () => ({ getResumeOptimizationSetup: vi.fn(), listResumeOptimizationRuns: vi.fn(), createResumeOptimization: vi.fn(), saveResumeOptimizationDraft: vi.fn(), analyzeResumeOptimization: vi.fn(), buildResumeOptimization: vi.fn(), scoreResumeOptimization: vi.fn(), commitResumeOptimization: vi.fn(), getResumeOptimizationDiff: vi.fn() }));
vi.mock("@/lib/resume-repo/analysis-client", () => ({ requestResumeAnalysis: vi.fn() }));
vi.mock("@/components/pdf-export/PdfPreviewPane", () => ({ PdfPreviewPane: ({ blob }: { blob: Blob | null }) => <div>{blob ? "PDF preview ready" : "No PDF preview"}</div> }));

const runId = "12345678-1234-4234-8234-123456789012", blockId = "a".repeat(24);
function makeRun(overrides: Partial<ResumeOptimizationView["data"]> = {}): ResumeOptimizationView {
  return { id: runId, revision: 0, createdAt: "2026-10-13T12:00:00Z", updatedAt: "2026-10-13T12:00:00Z", data: { version: 1, entrypoint: "Resume.tex", branch: "acme/engineer", baseCommit: "b".repeat(40), sourceHash: "c".repeat(64), jobText: "Captured job posting", jobTitle: "Engineer", company: "Acme", provider: "ollama", model: "test-model", promptVersion: "v1", status: "draft", layout: [{ id: "section-0", title: "Experience", entries: [{ macro: "Engineer", starred: false }] }], edits: [], catalog: { sections: [{ id: "section-0", title: "Experience", entries: [{ macro: "Engineer", starred: false }] }], entries: [{ macro: "Engineer", file: "experience.tex", starred: true, label: "Engineer" }], blocks: [{ id: blockId, file: "experience.tex", start: 0, end: 20, original: "Built engineering systems.", label: "Engineer", kind: "bullet", macro: "Engineer", active: true }] }, ...overrides } };
}
let history: ResumeOptimizationView[];
beforeEach(() => {
  vi.resetAllMocks(); history = [makeRun()];
  vi.mocked(actions.getResumeOptimizationSetup).mockResolvedValue({ success: true, branches: ["main", "acme/engineer"], entrypoints: ["Resume.tex"], defaultEntrypoint: "Resume.tex", compiler: "pdflatex" });
  vi.mocked(actions.listResumeOptimizationRuns).mockImplementation(async () => ({ success: true, runs: history }));
  vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, blob: async () => new Blob(["%PDF-test"]) } as Response);
});
afterEach(() => vi.restoreAllMocks());
const renderWorkspace = () => render(<ResumeOptimizationWorkspace jobId="job-1" title="Engineer" company="Acme" />);
describe("LaTeX optimization review", () => {
  it("saves a graduation override through factual review and invalidates the old PDF", async () => {
    const run = makeRun({ artifact: { hash: "c".repeat(64), pages: 1, warnings: [] } });
    const original = "\\IfBooleanTF{#1}{Sep 2026 --}{Expected Aug 2027}", graduationId = "e".repeat(24);
    run.data.catalog.entries.push({ macro: "Masters", file: "education.tex", starred: true, label: "Latest University" });
    run.data.catalog.blocks.push({ id: graduationId, file: "education.tex", start: 0, end: original.length, original, kind: "metadata", macro: "Masters", label: "Latest University · dates", active: true });
    run.data.layout = [{ id: "education", title: "Education", entries: [{ macro: "Masters", starred: false }] }, ...run.data.layout];
    run.data.catalog.sections = run.data.layout;
    history = [run];
    vi.mocked(actions.saveResumeOptimizationDraft).mockImplementation(async (input) => {
      history = [{ ...run, revision: 2, data: { ...run.data, layout: input.layout, edits: input.edits, artifact: undefined, candidate: undefined } }];
      return { success: true, run: history[0] };
    });
    renderWorkspace(); await screen.findByText("PDF preview ready");
    fireEvent.click(screen.getByRole("button", { name: "Internship: Dec 2027" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply graduation date" }));
    await screen.findByText("Unsaved changes");
    expect(screen.getByText("No PDF preview")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/I checked the factual claims/));
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await screen.findByRole("button", { name: "Save draft" });
    expect(actions.saveResumeOptimizationDraft).toHaveBeenCalledWith(expect.objectContaining({ edits: [expect.objectContaining({ blockId: graduationId, replacement: original.replace("Aug", "Dec"), accepted: true, factsConfirmed: true })] }));
  });
  it("lets the user stop analysis and aborts the in-flight stage", async () => {
    let stageSignal: AbortSignal | undefined;
    vi.mocked(requestResumeAnalysis).mockImplementation((_run, _stage, signal) => {
      stageSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true }));
    });
    renderWorkspace(); await screen.findByLabelText("Section 1 title");
    fireEvent.click(screen.getByRole("button", { name: "Analyze & suggest" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop analysis" }));
    await screen.findByRole("alert");
    expect(stageSignal?.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("Analysis stopped");
    expect(screen.getByRole("button", { name: "Analyze & suggest" })).toBeEnabled();
  });
  it("retains the baseline after a suggestion failure and retries only suggestions", async () => {
    vi.mocked(requestResumeAnalysis).mockImplementation(async (run, stage, _signal, onProgress) => {
      onProgress(stage === "baseline" ? "Resume matching: receiving the AI response…" : "Tailoring suggestions: waiting for the AI…");
      if (stage === "suggestions") throw new Error("Tailoring suggestions timed out");
      history = [{ ...run, revision: 2, data: { ...run.data, baseline: { score: 70, body: "Saved baseline", at: "2026-10-13" } } }]; return history[0];
    });
    renderWorkspace(); await screen.findByLabelText("Section 1 title");
    fireEvent.click(screen.getByRole("button", { name: "Analyze & suggest" }));
    await screen.findByRole("alert");
    expect(screen.getByText("70")).toBeInTheDocument();
    vi.mocked(requestResumeAnalysis).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Suggest changes" }));
    await screen.findByRole("alert");
    expect(requestResumeAnalysis).toHaveBeenCalledOnce();
    expect(requestResumeAnalysis).toHaveBeenCalledWith(expect.anything(), "suggestions", expect.any(AbortSignal), expect.any(Function));
  });
  it("loads branch history and shows captured job context", async () => {
    renderWorkspace();
    await screen.findByLabelText("Section 1 title");
    expect(screen.getByLabelText("Optimization history")).toHaveValue(runId);
    expect(screen.getByText("Captured job posting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit & export" })).toBeDisabled();
  });
  it("offers AI content as unaccepted proposals", async () => {
    vi.mocked(requestResumeAnalysis).mockImplementation(async (run, stage) => {
      history = [{ ...run, revision: run.revision + 2, data: { ...run.data, baseline: { score: 70, body: "Baseline evidence", at: "2026-10-13" }, edits: stage === "suggestions" ? [{ blockId, replacement: "Built reliable systems.", reason: "Relevant experience", accepted: false, factsConfirmed: false }] : [] } }]; return history[0];
    });
    renderWorkspace(); await screen.findByLabelText("Section 1 title");
    fireEvent.click(screen.getByRole("button", { name: "Analyze & suggest" }));
    await screen.findByText("Relevant experience");
    expect(screen.getByLabelText("Use this change")).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Commit & export" })).toBeDisabled();
  });
  it("invalidates preview and saving eligibility when the layout changes", async () => {
    history = [makeRun({ artifact: { hash: "c".repeat(64), pages: 1, warnings: [] } })];
    renderWorkspace(); await screen.findByText("PDF preview ready");
    fireEvent.change(screen.getByLabelText("Section 1 title"), { target: { value: "Systems Experience" } });
    await screen.findByText("Unsaved changes");
    expect(screen.getByText("No PDF preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Commit & export" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  });
  it("requires warning acknowledgment and downloads only after successful commit", async () => {
    history = [makeRun({ artifact: { hash: "c".repeat(64), pages: 2, warnings: ["Resume is two pages"] } })];
    vi.mocked(actions.commitResumeOptimization).mockImplementation(async () => { history = [{ ...history[0], revision: 2, data: { ...history[0].data, status: "committed", commit: "d".repeat(40) } }]; return { success: true, run: history[0] }; });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderWorkspace(); await screen.findByText("PDF preview ready");
    expect(screen.getByRole("button", { name: "Commit & export" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I reviewed the layout and shared-document warnings"));
    fireEvent.click(screen.getByRole("button", { name: "Commit & export" }));
    await screen.findByRole("link", { name: "Download committed PDF" });
    expect(actions.commitResumeOptimization).toHaveBeenCalledWith({ id: runId, revision: 0, acknowledgeWarnings: true });
    expect(click).toHaveBeenCalledOnce();
  });
  it("shows configuration failures without exposing source or actions", async () => {
    history = [];
    vi.mocked(actions.getResumeOptimizationSetup).mockResolvedValue({ success: false, message: "Resume repository access is not configured for this account" });
    renderWorkspace(); await screen.findByRole("alert");
    expect(screen.getByRole("alert")).toHaveTextContent("not configured");
    expect(screen.queryByRole("button", { name: "Commit & export" })).not.toBeInTheDocument();
  });
  it("keeps a newly created draft selected when refreshing older history", async () => {
    const next = { ...makeRun(), id: "87654321-4321-4321-8321-210987654321", data: { ...makeRun().data, branch: "acme/new-role" } };
    vi.mocked(actions.createResumeOptimization).mockImplementation(async () => { history = [next, ...history]; return { success: true, run: next }; });
    renderWorkspace(); await screen.findByLabelText("Section 1 title");
    fireEvent.change(screen.getByLabelText("New job branch"), { target: { value: "acme/new-role" } });
    fireEvent.click(screen.getByRole("button", { name: "Start draft" }));
    await screen.findByText("acme/new-role · draft");
    expect(screen.getByLabelText("Optimization history")).toHaveValue(next.id);
  });
  it("retains the source comparison after a history refresh", async () => {
    history = [makeRun({ artifact: { hash: "c".repeat(64), pages: 1, warnings: [] } })];
    vi.mocked(actions.getResumeOptimizationDiff).mockResolvedValue({ success: true, files: [{ file: "experience.tex", before: "Before content", after: "After content" }] });
    renderWorkspace(); await screen.findByText("PDF preview ready");
    fireEvent.click(screen.getByRole("button", { name: "Review source changes" }));
    await screen.findByText("After content");
    expect(screen.getByText("Before content")).toBeInTheDocument();
  });
});
