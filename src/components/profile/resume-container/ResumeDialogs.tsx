"use client";
import { useEffect, useState } from "react";
import { Eye, Paperclip } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../ui/alert-dialog";
import { Button } from "../../ui/button";

export function AttachPdfDialog({
  open,
  onOpenChange,
  onChoice,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoice: (choice: "replace" | "download-only") => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace existing attachment?</AlertDialogTitle>
          <AlertDialogDescription>
            This resume already has a file attached. Would you like to replace
            it with the exported PDF?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <Button variant="outline" onClick={() => onChoice("download-only")}>
            Download only
          </Button>
          <AlertDialogAction onClick={() => onChoice("replace")}>
            Replace attachment
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ClearChatBeforeReviewDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear the assistant conversation?</AlertDialogTitle>
          <AlertDialogDescription>
            A job is waiting for your approval in the assistant. Starting a
            review clears the conversation, and that job will not be saved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Clear and review
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function DiscardImportDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard import?</AlertDialogTitle>
          <AlertDialogDescription>
            This will delete this resume and its attached file. Unsaved
            suggestions will be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
          >
            Discard import
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function PdfPreviewDialog({
  open,
  onOpenChange,
  filePath,
  fileName,
  onDownload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string;
  fileName: string;
  onDownload: () => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid SSR portal hydration mismatches
  if (!mounted || !open) return null;

  const pdfUrl = `/api/profile/resume?preview=true&filePath=${encodeURIComponent(filePath)}`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col">
        <AlertDialogHeader className="flex-shrink-0">
          <AlertDialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Preview: {fileName}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Viewing attached PDF file inline. Use the download button to save a
            copy.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex-1 min-h-0 relative rounded-md border overflow-hidden bg-muted/30">
          {filePath ? (
            <iframe
              src={pdfUrl}
              title={`PDF Preview: ${fileName}`}
              className="w-full h-full min-h-[60vh] border-0"
              loading="lazy"
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
              <Paperclip className="h-8 w-8" />
              <span>No file attached</span>
            </div>
          )}
        </div>

        <AlertDialogFooter className="flex-shrink-0 mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={onDownload}>
            <Paperclip className="h-4 w-4 mr-2" />
            Download
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}