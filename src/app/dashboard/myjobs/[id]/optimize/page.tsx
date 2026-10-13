import { notFound } from "next/navigation";
import { getJobDetails } from "@/actions/job.actions";
import { ResumeOptimizationWorkspace } from "@/components/resume-optimization/ResumeOptimizationWorkspace";

export default async function ResumeOptimizationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getJobDetails(id);
  if (!result?.job) notFound();
  return <ResumeOptimizationWorkspace jobId={id} title={result.job.JobTitle.label} company={result.job.Company.label} />;
}
