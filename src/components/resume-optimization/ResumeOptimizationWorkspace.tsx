"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PdfPreviewPane } from "@/components/pdf-export/PdfPreviewPane";
import { factsChanged } from "@/lib/resume-repo/facts";
import { requestResumeAnalysis } from "@/lib/resume-repo/analysis-client";
import type { ResumeOptimizationView, ResumeLayoutSection, ResumeEdit } from "@/models/resumeOptimization.model";
import {
  getResumeOptimizationSetup, listResumeOptimizationRuns, createResumeOptimization,
  saveResumeOptimizationDraft, buildResumeOptimization,
  scoreResumeOptimization, commitResumeOptimization, getResumeOptimizationDiff,
} from "@/actions/resumeOptimization.actions";

type Setup = Extract<Awaited<ReturnType<typeof getResumeOptimizationSetup>>, { success: true }>;
const selectClass = "h-9 rounded-md border bg-background px-2 text-sm";
export function ResumeOptimizationWorkspace({ jobId, title, company }: { jobId: string; title: string; company: string }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [runs, setRuns] = useState<ResumeOptimizationView[]>([]);
  const [run, setRun] = useState<ResumeOptimizationView | null>(null);
  const activeRunId = useRef<string | null>(null);
  const analysisController = useRef<AbortController | null>(null);
  const [layout, setLayout] = useState<ResumeLayoutSection[]>([]);
  const [edits, setEdits] = useState<ResumeEdit[]>([]);
  const [baseBranch, setBaseBranch] = useState("main");
  const [branch, setBranch] = useState("");
  const [entrypoint, setEntrypoint] = useState("Resume_Winston.tex");
  const [continuing, setContinuing] = useState(false);
  const [busy, setBusy] = useState("Loading repository…");
  const [error, setError] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [diff, setDiff] = useState<{ file: string; before: string; after: string }[] | null>(null);
  const [manualBlock, setManualBlock] = useState("");
  const dirty = !!run && (JSON.stringify(layout) !== JSON.stringify(run.data.layout) || JSON.stringify(edits) !== JSON.stringify(run.data.edits));
  const committed = run?.data.status === "committed";
  const running = !!run?.data.busyUntil && Date.parse(run.data.busyUntil) > Date.now();
  const disabled = Boolean(busy) || Boolean(committed) || running;
  function selectRun(next: ResumeOptimizationView) { activeRunId.current = next.id; setRun(next); setLayout(next.data.layout); setEdits(next.data.edits); setDiff(null); setAcknowledged(false); setError(null); }
  useEffect(() => {
    let cancelled = false;
    Promise.all([getResumeOptimizationSetup(jobId), listResumeOptimizationRuns(jobId)]).then(([configuration, history]) => {
      if (cancelled) return;
      if (configuration.success) setSetup(configuration); else setError(configuration.message);
      if (history.success) { setRuns(history.runs); if (history.runs[0]) selectRun(history.runs[0]); }
      setBusy("");
    }).catch(() => { if (!cancelled) { setError("Could not load the resume repository"); setBusy(""); } });
    return () => { cancelled = true; };
  }, [jobId]);
  useEffect(() => () => analysisController.current?.abort(), []);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  useEffect(() => {
    setBlob(null); setAcknowledged(false); setDiff(null);
    if (!run?.data.artifact || dirty) return;
    const controller = new AbortController();
    fetch(`/api/resume-optimizations/${run.id}/pdf?revision=${run.revision}`, { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("Preview unavailable; rebuild or reload the draft");
      const result = await response.blob(); if (!controller.signal.aborted) setBlob(result);
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [run?.id, run?.revision, run?.data.artifact, dirty]);
  async function refreshHistory() {
    const result = await listResumeOptimizationRuns(jobId);
    if (result.success) { setRuns(result.runs); const current = result.runs.find((item) => item.id === activeRunId.current); if (current) setRun((previous) => previous?.id === current.id && previous.revision === current.revision ? previous : current); }
  }
  async function execute(label: string, operation: () => Promise<void>) {
    setBusy(label); setError(null);
    try { await operation(); await refreshHistory(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Operation failed"); await refreshHistory(); }
    finally { setBusy(""); }
  }
  async function save() {
    if (!run) throw new Error("Choose a draft first");
    if (!dirty) return run;
    const result = await saveResumeOptimizationDraft({ id: run.id, revision: run.revision, layout, edits });
    if (!result.success) throw new Error(result.message);
    selectRun(result.run); return result.run;
  }
  function editSection(index: number, change: Partial<ResumeLayoutSection>) { setLayout((items) => items.map((section, i) => i === index ? { ...section, ...change } : section)); }
  function moveSection(index: number, delta: number) { const next = [...layout]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; setLayout(next); }
  function moveEntry(sectionIndex: number, entryIndex: number, delta: number) { const next = [...layout[sectionIndex].entries]; [next[entryIndex], next[entryIndex + delta]] = [next[entryIndex + delta], next[entryIndex]]; editSection(sectionIndex, { entries: next }); }
  function updateEdit(index: number, change: Partial<ResumeEdit>) { setEdits((items) => items.map((edit, i) => i === index ? { ...edit, ...change } : edit)); }
  return <div className="col-span-3 min-w-0 space-y-6 break-words py-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><Link href={`/dashboard/myjobs/${jobId}`} className="text-sm text-muted-foreground hover:underline">← Back to job</Link><h1 className="mt-2 text-2xl font-semibold">Tailor LaTeX resume</h1><p className="text-muted-foreground">{title} · {company}</p></div>
      {run && <div className="text-sm text-muted-foreground"><div>{run.data.branch} · {run.data.status}</div><div>Base {run.data.baseCommit.slice(0, 8)}{run.data.commit && ` · Saved ${run.data.commit.slice(0, 8)}`}</div></div>}
    </div>
    {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
    {busy && <div className="flex flex-wrap items-center gap-3"><p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />{busy}</p>{analysisController.current && <Button size="sm" variant="outline" onClick={() => analysisController.current?.abort()}>Stop analysis</Button>}</div>}
    {setup && <details open={!run} className="rounded-lg border p-4"><summary className="cursor-pointer font-medium">Create or continue a job branch</summary>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm"><span className="block">Base branch</span><select aria-label="Base branch" className={`${selectClass} max-w-full`} value={baseBranch} onChange={(event) => setBaseBranch(event.target.value)} disabled={!!busy || continuing}>{setup.branches.map((name) => <option key={name}>{name}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="block">Resume document</span><select aria-label="Resume document" className={`${selectClass} max-w-full`} value={entrypoint} onChange={(event) => setEntrypoint(event.target.value)} disabled={!!busy}>{setup.entrypoints.filter((file) => !file.startsWith("CoverLetter")).map((file) => <option key={file}>{file}</option>)}</select></label>
        <label className="space-y-1 text-sm"><span className="block">Job branch</span>{continuing ? <select aria-label="Existing job branch" className={`${selectClass} max-w-full`} value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">Choose a branch</option>{setup.branches.filter((name) => !["main", "master"].includes(name)).map((name) => <option key={name}>{name}</option>)}</select> : <Input aria-label="New job branch" placeholder="company/role" value={branch} onChange={(event) => setBranch(event.target.value)} disabled={!!busy} />}</label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={continuing} onChange={(event) => { setContinuing(event.target.checked); setBranch(""); }} />Continue existing branch</label>
        <Button disabled={!!busy || !branch || dirty} onClick={() => execute("Capturing resume source…", async () => { const result = await createResumeOptimization({ jobId, baseBranch, targetBranch: branch, entrypoint, continueBranch: continuing }); if (!result.success) throw new Error(result.message); selectRun(result.run); setRuns((items) => [result.run, ...items]); const updated = await getResumeOptimizationSetup(jobId); if (updated.success) setSetup(updated); })}>Start draft</Button>
      </div><p className="mt-3 text-xs text-muted-foreground">The draft starts from committed source. Local uncommitted edits are not included. Saving creates a local commit; pushing and merging remain separate.</p>
    </details>}
    {runs.length > 0 && <label className="flex flex-wrap items-center gap-2 text-sm">Saved drafts and variants<select aria-label="Optimization history" className={`${selectClass} max-w-full`} value={run?.id ?? ""} disabled={!!busy || dirty} onChange={(event) => { const next = runs.find((item) => item.id === event.target.value); if (next) selectRun(next); }}>{runs.map((item) => <option key={item.id} value={item.id}>{item.data.branch} · {item.data.status} · {new Date(item.createdAt).toLocaleString()}</option>)}</select><Button size="sm" variant="outline" disabled={!!busy} onClick={() => execute("Reloading draft…", async () => { const result = await listResumeOptimizationRuns(jobId); if (!result.success) throw new Error(result.message); setRuns(result.runs); const next = result.runs.find((item) => item.id === run?.id); if (next) selectRun(next); })}>Reload</Button>{dirty && <span className="text-muted-foreground">Unsaved changes</span>}</label>}
    {run && <>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-4 text-sm"><span>Baseline: <strong>{run.data.baseline?.score ?? "—"}</strong></span><span>Candidate: <strong>{!dirty ? run.data.candidate?.score ?? "—" : "—"}</strong></span><span>{run.data.provider} · {run.data.model}</span><span className="text-muted-foreground">Scores guide review; confirm content and presentation.</span></div>
      <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">Job posting captured for this draft · {new Date(run.createdAt).toLocaleDateString()}</summary><pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">{run.data.jobText}</pre></details>
      <div className="grid min-w-0 gap-5 @5xl/main:grid-cols-[minmax(250px,0.8fr)_minmax(320px,1.2fr)_minmax(320px,1fr)] [&>section]:min-w-0">
        <section className="space-y-3"><h2 className="font-semibold">Structure and selected entries</h2>
          {layout.map((section, index) => <div key={section.id} className="space-y-3 rounded-lg border p-3">
            <div className="flex gap-1"><Input className="min-w-0" aria-label={`Section ${index + 1} title`} value={section.title} disabled={disabled} onChange={(event) => editSection(index, { title: event.target.value })} /><Button size="icon" variant="ghost" aria-label={`Move ${section.title} up`} disabled={disabled || index === 0} onClick={() => moveSection(index, -1)}><ArrowUp className="size-4" /></Button><Button size="icon" variant="ghost" aria-label={`Move ${section.title} down`} disabled={disabled || index === layout.length - 1} onClick={() => moveSection(index, 1)}><ArrowDown className="size-4" /></Button><Button size="icon" variant="ghost" aria-label={`Remove ${section.title}`} disabled={disabled || layout.length === 1} onClick={() => setLayout((items) => items.filter((_, i) => i !== index))}><Trash2 className="size-4" /></Button></div>
            {section.entries.map((entry, entryIndex) => <div key={`${entryIndex}-${entry.macro}`} className="flex flex-wrap items-center gap-2 text-xs"><span className="grow" title={entry.macro}>{run.data.catalog.entries.find((item) => item.macro === entry.macro)?.label ?? entry.macro}</span><label className="flex items-center gap-1"><input type="checkbox" checked={entry.starred} disabled={disabled || !run.data.catalog.entries.find((item) => item.macro === entry.macro)?.starred} onChange={(event) => editSection(index, { entries: section.entries.map((item, i) => i === entryIndex ? { ...item, starred: event.target.checked } : item) })} />Starred variant</label><button aria-label={`Move ${entry.macro} up in ${section.title}`} disabled={disabled || entryIndex === 0} onClick={() => moveEntry(index, entryIndex, -1)}>↑</button><button aria-label={`Move ${entry.macro} down in ${section.title}`} disabled={disabled || entryIndex === section.entries.length - 1} onClick={() => moveEntry(index, entryIndex, 1)}>↓</button><button aria-label={`Remove ${entry.macro} from ${section.title}`} disabled={disabled} onClick={() => editSection(index, { entries: section.entries.filter((_, i) => i !== entryIndex) })}>×</button></div>)}
            <select aria-label={`Add entry to ${section.title}`} className={`${selectClass} w-full`} value="" disabled={disabled} onChange={(event) => { if (event.target.value) editSection(index, { entries: [...section.entries, { macro: event.target.value, starred: false }] }); }}><option value="">Add existing entry…</option>{run.data.catalog.entries.filter((entry) => !section.entries.some((item) => item.macro === entry.macro)).map((entry) => <option key={entry.macro} value={entry.macro}>{entry.label}</option>)}</select>
          </div>)}
          <Button variant="outline" disabled={disabled || layout.length >= 15} onClick={() => setLayout((items) => [...items, { id: `new-${crypto.randomUUID()}`, title: "Selected Projects", entries: [] }])}><Plus className="mr-2 size-4" />Add section</Button>
          {run.data.suggestedLayout && <Button variant="outline" disabled={disabled} onClick={() => setLayout(run.data.suggestedLayout!)}>Use AI-proposed structure</Button>}
        </section>
        <section className="space-y-3"><h2 className="font-semibold">Content review</h2>
          {!edits.length && <p className="text-sm text-muted-foreground">Generate suggestions, or select a source block below to edit it yourself.</p>}
          {edits.map((edit, index) => { const block = run.data.catalog.blocks.find((item) => item.id === edit.blockId); return <div key={edit.blockId} className="space-y-2 rounded-lg border p-3">
            <p className="text-sm font-medium">{block?.label} {block?.variant && `· ${block.variant}`}</p><p className="text-xs text-muted-foreground">{block?.file} · {block?.active ? "Included in baseline" : "Alternate or excluded content"}</p>
            {edit.reason && <p className="text-sm">{edit.reason}</p>}
            <details><summary className="cursor-pointer text-xs text-muted-foreground">Original LaTeX content</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{block?.original}</pre></details>
            <Textarea aria-label={`Suggested content for ${block?.label ?? edit.blockId}`} rows={5} className="font-mono text-xs" value={edit.replacement} disabled={disabled} onChange={(event) => updateEdit(index, { replacement: event.target.value, factsConfirmed: false })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.accepted} disabled={disabled} onChange={(event) => updateEdit(index, { accepted: event.target.checked })} />Use this change</label>
            <label className="flex items-start gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={edit.factsConfirmed} disabled={disabled} onChange={(event) => updateEdit(index, { factsConfirmed: event.target.checked })} />I checked the factual claims (required for changed content){block && factsChanged(block.original, edit.replacement) ? " — numbers or dates changed" : ""}</label>
          </div>; })}
          <div className="flex gap-2"><select aria-label="Source block to edit" className={`${selectClass} min-w-0 grow`} value={manualBlock} disabled={disabled} onChange={(event) => setManualBlock(event.target.value)}><option value="">Choose a content block…</option>{run.data.catalog.blocks.filter((block) => !edits.some((edit) => edit.blockId === block.id)).map((block) => <option key={block.id} value={block.id}>{block.label} · {block.variant ?? "shared"} · {block.original.slice(0, 45)}</option>)}</select><Button variant="outline" disabled={disabled || !manualBlock} onClick={() => { const block = run.data.catalog.blocks.find((item) => item.id === manualBlock); if (block) setEdits((items) => [...items, { blockId: block.id, replacement: block.original, reason: "Manual edit", accepted: true, factsConfirmed: false }]); setManualBlock(""); }}>Edit</Button></div>
          {run.data.baseline && <details><summary className="cursor-pointer text-sm">Baseline match analysis</summary><pre className="mt-2 whitespace-pre-wrap text-sm">{run.data.baseline.body}</pre></details>}
          {run.data.candidate && !dirty && <details><summary className="cursor-pointer text-sm">Candidate match analysis</summary><pre className="mt-2 whitespace-pre-wrap text-sm">{run.data.candidate.body}</pre></details>}
        </section>
        <section className="flex min-h-[600px] flex-col gap-3"><h2 className="font-semibold">LaTeX PDF preview</h2><PdfPreviewPane blob={blob} isGenerating={busy === "Building LaTeX preview…"} hasError={Boolean(run.data.buildError)} canExport={Boolean(run.data.artifact) && !dirty} previewLabel="Tailored LaTeX resume preview" emptyMessage="Build the current draft to preview its PDF." className="min-h-[550px] flex-1" />
          {run.data.artifact?.warnings.map((warning) => <p key={warning} className="text-sm text-amber-700 dark:text-amber-300">{warning}</p>)}
          {!!run.data.artifact?.warnings.length && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={(event) => setAcknowledged(event.target.checked)} />I reviewed the layout and shared-document warnings</label>}
          {committed && <a className="text-sm font-medium underline" href={`/api/resume-optimizations/${run.id}/pdf?download=1`}>Download committed PDF</a>}
        </section>
      </div>
      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button variant="outline" disabled={disabled || dirty || !!run.data.edits.length || JSON.stringify(layout) !== JSON.stringify(run.data.catalog.sections)} onClick={() => execute("Starting resume analysis…", async () => {
          const controller = new AbortController(); analysisController.current = controller;
          try {
            let current = run;
            if (!current.data.baseline) { current = await requestResumeAnalysis(current, "baseline", controller.signal, setBusy); selectRun(current); }
            current = await requestResumeAnalysis(current, "suggestions", controller.signal, setBusy); selectRun(current);
          } catch (failure) { if (controller.signal.aborted) throw new Error("Analysis stopped. Completed baseline scores are kept."); throw failure; }
          finally { analysisController.current = null; }
        })}>{run.data.baseline ? "Suggest changes" : "Analyze & suggest"}</Button>
        <Button variant="outline" disabled={disabled || !dirty} onClick={() => execute("Saving draft…", async () => { await save(); })}>Save draft</Button>
        <Button variant="outline" disabled={disabled} onClick={() => execute("Building LaTeX preview…", async () => { const current = await save(); const result = await buildResumeOptimization({ id: current.id, revision: current.revision }); if (!result.success) throw new Error(result.message); selectRun(result.run); })}>Build preview</Button>
        <Button variant="outline" disabled={disabled || dirty || !run.data.artifact} onClick={() => execute("Scoring candidate…", async () => { const result = await scoreResumeOptimization({ id: run.id, revision: run.revision }); if (!result.success) throw new Error(result.message); selectRun(result.run); })}>Re-score</Button>
        <Button variant="outline" disabled={!!busy} onClick={() => execute("Loading source comparison…", async () => { const current = committed ? run : await save(); const result = await getResumeOptimizationDiff(current.id); if (!result.success) throw new Error(result.message); setDiff(result.files); })}>Review source changes</Button>
        <Button disabled={disabled || dirty || !blob || !run.data.artifact || (!!run.data.artifact.warnings.length && !acknowledged)} onClick={() => execute("Committing approved source and PDF…", async () => { const result = await commitResumeOptimization({ id: run.id, revision: run.revision, acknowledgeWarnings: acknowledged }); if (!result.success) throw new Error(result.message); selectRun(result.run); const link = document.createElement("a"); link.href = `/api/resume-optimizations/${result.run.id}/pdf?download=1`; link.download = ""; document.body.appendChild(link); link.click(); link.remove(); })}>Commit & export</Button>
      </div>
      {diff && <section className="space-y-3"><h2 className="font-semibold">Source changes</h2>{!diff.length && <p className="text-sm text-muted-foreground">No source changes selected.</p>}{diff.map((file) => <details key={file.file} className="rounded-lg border p-3"><summary className="cursor-pointer font-mono text-sm">{file.file}</summary><div className="mt-3 grid gap-3 lg:grid-cols-2"><div><p className="mb-2 text-xs font-semibold">Original</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{file.before}</pre></div><div><p className="mb-2 text-xs font-semibold">Selected changes</p><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{file.after}</pre></div></div></details>)}</section>}
    </>}
  </div>;
}
