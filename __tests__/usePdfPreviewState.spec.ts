// Tests for the resume inline-preview hook. Two regressions live here:
//  1. The download/preview URL must carry `resumeId`, never `filePath` — the
//     route resolves the stored path from the caller's own row (path-traversal
//     fix), so a filePath request comes back 400.
//  2. The iframe must not point at the API route: every response carries
//     `X-Frame-Options: DENY` from next.config.mjs, so a framed navigation to
//     the route is refused by the browser. Feeding it a same-origin blob: URL
//     sidesteps framing rules entirely.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Resume } from "@/models/profile.model";

import usePdfPreviewState, {
  resumeFileUrl,
} from "@/components/profile/resume-container/usePdfPreviewState";

const fetchMock = vi.fn();
const objectUrl = "blob:http://localhost:3737/resume-preview";
const createObjectURL = vi.fn(() => objectUrl);
const revokeObjectURL = vi.fn();

const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

const resumeWithFile = (filePath: string, fileName: string): Resume => ({
  id: "resume-1",
  title: "My Resume",
  File: {
    fileName,
    filePath,
    fileType: filePath.endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
});

const pdfResume = resumeWithFile(
  "/data/files/resumes/Resume_Winston_2026-09-29T23-02-58.pdf",
  "Resume_Winston.pdf"
);

const docxResume = resumeWithFile(
  "/data/files/resumes/Resume_Winston.docx",
  "Resume_Winston.docx"
);

const pdfResponse = () => ({
  ok: true,
  status: 200,
  blob: async () => new Blob(["%PDF-1.4"], { type: "application/pdf" }),
});

const renderPreview = (resume: Resume) => {
  const hook = renderHook(() => usePdfPreviewState(resume));
  const open = () => act(() => hook.result.current.handlePreviewPdf());
  return { hook, open };
};

describe("resumeFileUrl", () => {
  it("sends the resume id and no path", () => {
    expect(resumeFileUrl("resume-1", true)).toBe(
      "/api/profile/resume?resumeId=resume-1&preview=true"
    );
    expect(resumeFileUrl("resume-1", false)).toBe(
      "/api/profile/resume?resumeId=resume-1"
    );
  });
});

describe("usePdfPreviewState", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset().mockResolvedValue(pdfResponse());
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    vi.unstubAllGlobals();
  });

  it("fetches the preview by resume id, never by filePath", async () => {
    const { hook, open } = renderPreview(pdfResume);

    open();
    await waitFor(() => expect(hook.result.current.previewUrl).toBe(objectUrl));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("/api/profile/resume?resumeId=resume-1&preview=true");
    expect(url).not.toContain("filePath");
    expect(url).not.toContain("/data/files/");
  });

  it("hands the iframe a blob url instead of the API route", async () => {
    const { hook, open } = renderPreview(pdfResume);

    open();
    await waitFor(() => expect(hook.result.current.previewUrl).toBe(objectUrl));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(hook.result.current.previewUrl).toBe(objectUrl);
    expect(hook.result.current.isPreviewLoading).toBe(false);
    expect(hook.result.current.previewError).toBeNull();
  });

  it("revokes the blob url when the preview closes", async () => {
    const { hook, open } = renderPreview(pdfResume);

    open();
    await waitFor(() => expect(hook.result.current.previewUrl).toBe(objectUrl));

    act(() => hook.result.current.closePreview());
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
    expect(hook.result.current.showPreview).toBe(false);
  });

  it("reports a failed preview instead of an empty frame", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, blob: async () => new Blob() });
    const { hook, open } = renderPreview(pdfResume);

    open();
    await waitFor(() =>
      expect(hook.result.current.previewError).toBe("Preview failed")
    );

    expect(hook.result.current.previewUrl).toBeNull();
    expect(hook.result.current.isPreviewLoading).toBe(false);
  });

  it("does not offer a preview for a non-pdf upload", () => {
    const { hook, open } = renderPreview(docxResume);

    expect(hook.result.current.isPreviewable).toBe(false);
    open();

    expect(hook.result.current.showPreview).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads through the same resume-id route", async () => {
    const { hook } = renderPreview(pdfResume);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await act(async () => {
      await hook.result.current.downloadFile();
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/profile/resume?resumeId=resume-1"
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain("preview=true");

    click.mockRestore();
  });
});
