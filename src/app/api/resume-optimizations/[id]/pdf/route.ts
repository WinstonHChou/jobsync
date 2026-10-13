import { requireUser } from "@/actions/shared";
import { ownedOptimization } from "@/lib/resume-repo/service";
import { repositoryFor } from "@/lib/resume-repo/repository";
import { composeResume, sourceHash } from "@/lib/resume-repo/latex";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(); await repositoryFor(user.email);
    const { id } = await context.params, { row, data } = await ownedOptimization(id, user.id);
    const revision = new URL(request.url).searchParams.get("revision");
    if (revision !== null && Number(revision) !== row.revision) return new Response("Preview changed; reload the draft", { status: 409 });
    if (!data.artifact || data.artifact.hash !== sourceHash(composeResume(data.files, data.entrypoint, data.layout, data.edits))) return new Response("Build the current draft first", { status: 409 });
    const name = `${data.branch.replace(/[^a-zA-Z0-9_-]/g, "-")}.pdf`;
    const attachment = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(Buffer.from(data.artifact.pdf, "base64")), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${name}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return new Response("PDF unavailable", { status: 404 }); }
}
