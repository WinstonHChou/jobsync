export type ResumeFiles = Record<string, string>;
export interface ResumeEntry { macro: string; starred: boolean; }
export interface ResumeLayoutSection { id: string; title: string; entries: ResumeEntry[]; }
export interface ResumeSourceBlock {
  id: string; file: string; start: number; end: number; original: string;
  label: string; kind: "bullet" | "metadata" | "skills"; macro: string;
  field?: "educationDates";
  active: boolean; variant?: "starred" | "unstarred";
}
export interface ResumeCatalog {
  sections: ResumeLayoutSection[];
  entries: { macro: string; file: string; starred: boolean; label: string }[];
  blocks: ResumeSourceBlock[];
}
export interface ResumeEdit { blockId: string; replacement: string; reason: string; accepted: boolean; factsConfirmed: boolean; }
export interface ResumeMatch { score: number; body: string; at: string; }
export interface ResumeArtifact { hash: string; pdf: string; pages: number; warnings: string[]; }
export interface ResumeOptimizationData {
  version: 1; entrypoint: string; branch: string; baseCommit: string; files: ResumeFiles;
  sourceHash: string; jobText: string; jobTitle: string; company: string;
  catalog: ResumeCatalog; layout: ResumeLayoutSection[]; edits: ResumeEdit[];
  suggestedLayout?: ResumeLayoutSection[];
  busyUntil?: string;
  provider: string; model: string; promptVersion: string;
  matchSystemPrompt?: string; matchPromptTemplate?: string;
  baseline?: ResumeMatch; candidate?: ResumeMatch; artifact?: ResumeArtifact;
  commit?: string; status: "draft" | "committed"; buildError?: string;
}
export interface ResumeOptimizationView {
  id: string; revision: number; createdAt: string; updatedAt: string;
  data: Omit<ResumeOptimizationData, "files" | "artifact"> & { artifact?: Omit<ResumeArtifact, "pdf"> };
}
export type ResumeAnalysisEvent =
  | { type: "progress"; message: string }
  | { type: "heartbeat" }
  | { type: "result"; run: ResumeOptimizationView }
  | { type: "error"; message: string };
