import "server-only";
import db from "@/lib/db";
import type { ResumeOptimizationData, ResumeOptimizationView } from "@/models/resumeOptimization.model";

export function optimizationView(row: { id: string; revision: number; createdAt: Date; updatedAt: Date; data: string }): ResumeOptimizationView {
  const { files: _files, artifact, ...data } = JSON.parse(row.data) as ResumeOptimizationData;
  void _files;
  return { id: row.id, revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), data: { ...data, ...(artifact ? { artifact: { hash: artifact.hash, pages: artifact.pages, warnings: artifact.warnings } } : {}) } };
}
export async function ownedOptimization(id: string, userId: string) {
  const row = await db.resumeOptimization.findFirst({ where: { id, userId } });
  if (!row) throw new Error("Resume optimization not found");
  return { row, data: JSON.parse(row.data) as ResumeOptimizationData };
}
export async function changeOptimization(id: string, userId: string, revision: number, operation: (data: ResumeOptimizationData) => Promise<ResumeOptimizationData>) {
  const { row, data } = await ownedOptimization(id, userId);
  if (row.revision !== revision) throw new Error("This draft changed in another tab. Reload before continuing");
  if (data.status === "committed") throw new Error("This variant is committed. Start another draft to edit it");
  if (data.busyUntil && Date.parse(data.busyUntil) > Date.now()) throw new Error("An operation is already running on this draft");
  const claim = await db.resumeOptimization.updateMany({ where: { id, userId, revision }, data: { revision: { increment: 1 }, data: JSON.stringify({ ...data, busyUntil: new Date(Date.now() + 10 * 60_000).toISOString() }) } });
  if (claim.count !== 1) throw new Error("This draft changed in another tab. Reload before continuing");
  try {
    const updated = await operation(data);
    delete updated.busyUntil;
    const saved = await db.resumeOptimization.updateMany({ where: { id, userId, revision: revision + 1 }, data: { revision: { increment: 1 }, data: JSON.stringify(updated) } });
    if (saved.count !== 1) throw new Error("Draft version changed while saving");
    return optimizationView((await ownedOptimization(id, userId)).row);
  } catch (error) {
    delete data.busyUntil;
    data.buildError = error instanceof Error ? error.message : "Operation failed";
    await db.resumeOptimization.updateMany({ where: { id, userId, revision: revision + 1 }, data: { revision: { increment: 1 }, data: JSON.stringify(data) } });
    throw error;
  }
}
