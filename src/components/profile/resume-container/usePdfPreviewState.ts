"use client";

import { useCallback, useEffect, useState } from "react";
import type { Resume } from "@/models/profile.model";

interface UsePdfPreviewStateReturn {
  showPreview: boolean;
  setShowPreview: (show: boolean) => void;
  handlePreviewPdf: () => void;
  closePreview: () => void;
  previewUrl: string | null;
  isPreviewLoading: boolean;
  previewError: string | null;
  downloadFile: () => Promise<void>;
  isDownloading: boolean;
  isPreviewable: boolean;
}

/**
 * The route looks the stored path up through the caller's own resume row, so the
 * client sends only the resume id. (`filePath` used to travel in the query
 * string; it went away with the path-traversal fix on the route.)
 */
export function resumeFileUrl(resumeId: string, preview: boolean): string {
  const previewParam = preview ? "&preview=true" : "";
  return `/api/profile/resume?resumeId=${encodeURIComponent(resumeId)}${previewParam}`;
}

/** Only PDFs render inline; the browser has no viewer for a framed .docx blob. */
function isPdfPath(filePath: string | null | undefined): boolean {
  return !!filePath && /\.pdf$/i.test(filePath);
}

export default function usePdfPreviewState(
  resume: Resume
): UsePdfPreviewStateReturn {
  const resumeId = resume.id;
  const filePath = resume.File?.filePath ?? null;
  const isPreviewable = isPdfPath(filePath);

  const [showPreview, setShowPreview] = useState<boolean>(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);

  const handlePreviewPdf = useCallback(() => {
    if (isPreviewable) setShowPreview(true);
  }, [isPreviewable]);

  const closePreview = useCallback(() => setShowPreview(false), []);

  /**
   * `X-Frame-Options: DENY` is sent on every response (next.config.mjs), so an
   * iframe pointed at the API route is refused by the browser — the route's own
   * SAMEORIGIN header never survives that global one. A same-origin blob: URL
   * is not a framed navigation, so it renders regardless.
   */
  useEffect(() => {
    if (!showPreview || !resumeId || !isPreviewable) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    setIsPreviewLoading(true);
    setPreviewError(null);

    void (async () => {
      try {
        const response = await fetch(resumeFileUrl(resumeId, true));
        if (!response.ok) {
          throw new Error(`Preview request failed (${response.status})`);
        }
        objectUrl = URL.createObjectURL(await response.blob());
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setPreviewUrl(objectUrl);
      } catch (error) {
        console.error("Resume preview failed:", error);
        if (!cancelled) setPreviewError("Preview failed");
      } finally {
        if (!cancelled) setIsPreviewLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPreviewUrl(null);
    };
  }, [showPreview, resumeId, isPreviewable]);

  const downloadFile = useCallback(async () => {
    if (!resumeId) return;

    setIsDownloading(true);
    try {
      const response = await fetch(resumeFileUrl(resumeId, false));
      if (!response.ok) {
        throw new Error("Failed to download file");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = resume.File?.fileName ?? "resume";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
    } finally {
      setIsDownloading(false);
    }
  }, [resumeId, resume.File?.fileName]);

  return {
    showPreview,
    setShowPreview,
    handlePreviewPdf,
    closePreview,
    previewUrl,
    isPreviewLoading,
    previewError,
    downloadFile,
    isDownloading,
    isPreviewable,
  };
}
