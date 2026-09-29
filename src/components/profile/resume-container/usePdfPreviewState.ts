"use client";

import { useState, useCallback } from "react";

interface ResumeFile {
  filePath: string;
  fileName: string;
}

interface Resume {
  id: string;
  title: string;
  File?: ResumeFile;
}

interface UsePdfPreviewStateReturn {
  showPreview: boolean;
  setShowPreview: (show: boolean) => void;
  handlePreviewPdf: () => void;
  downloadUrl: string | null;
  downloadFile: () => Promise<void>;
  isPreviewable: boolean;
}

export default function usePdfPreviewState(
  resume: Resume
): UsePdfPreviewStateReturn {
  const [showPreview, setShowPreview] = useState<boolean>(false);

  const filePath = resume.File?.filePath ?? null;

  const downloadUrl = filePath
    ? `/api/profile/resume?preview=true&filePath=${encodeURIComponent(filePath)}`
    : null;

  const isPreviewable = !!filePath;

  const handlePreviewPdf = useCallback(() => {
    if (resume.File?.filePath) {
      setShowPreview(true);
    }
  }, [resume.File?.filePath]);

  const downloadFile = useCallback(async () => {
    if (!downloadUrl) return;

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error("Failed to download file");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = resume.File?.fileName ?? "resume.pdf";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Download failed:", error);
    }
  }, [downloadUrl, resume.File?.fileName]);

  return {
    showPreview,
    setShowPreview,
    handlePreviewPdf,
    downloadUrl,
    downloadFile,
    isPreviewable,
  };
}
