"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { educationDateOptions, displayedGraduationDate, graduationDateEdit, type EducationDateOption } from "@/lib/resume-repo/education";
import type { ResumeCatalog, ResumeEdit, ResumeLayoutSection } from "@/models/resumeOptimization.model";

export function EducationDateEditor({ catalog, layout, edits, disabled, onApply }: { catalog: ResumeCatalog; layout: ResumeLayoutSection[]; edits: ResumeEdit[]; disabled: boolean; onApply: (edit: ResumeEdit) => void }) {
  const options = educationDateOptions(catalog, layout);
  const [selected, setSelected] = useState("");
  const option = options.find((item) => item.key === selected) ?? options[0];
  if (!option) return null;
  const existing = edits.find((edit) => edit.blockId === option.block.id && edit.accepted);
  const source = existing?.replacement ?? option.block.original;
  let date: string;
  try { date = displayedGraduationDate(source, option.starred); }
  catch { return <p className="text-sm text-muted-foreground">This education date uses custom formatting. Edit it through Content review.</p>; }
  return <section className="space-y-3 rounded-lg border p-4">
    <h2 className="font-semibold">Education graduation date</h2>
    <p className="text-sm text-muted-foreground">The latest included degree is selected first. Generate AI suggestions first if needed, then choose the expected date for this job branch.</p>
    <label className="flex flex-wrap items-center gap-2 text-sm">Degree<select aria-label="Degree for graduation date" className="h-9 max-w-full rounded-md border bg-background px-2" value={option.key} disabled={disabled} onChange={(event) => setSelected(event.target.value)}>{options.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
    <DateInput key={option.key + ":" + source} option={option} edits={edits} date={date} disabled={disabled} onApply={onApply} />
    <p className="text-xs text-muted-foreground">After applying, confirm the date in Content review, then rebuild the PDF and re-score. Other degree entries and the opposite starred/unstarred date are preserved.</p>
  </section>;
}

function DateInput({ option, edits, date, disabled, onApply }: { option: EducationDateOption; edits: ResumeEdit[]; date: string; disabled: boolean; onApply: (edit: ResumeEdit) => void }) {
  const [value, setValue] = useState(date), [error, setError] = useState("");
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => { setValue("Expected Aug 2027"); setError(""); }}>Full-time: Aug 2027</Button>
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => { setValue("Expected Dec 2027"); setError(""); }}>Internship: Dec 2027</Button>
    </div>
    <div className="flex flex-wrap items-end gap-2">
      <label className="min-w-0 grow space-y-1 text-sm"><span className="block">Expected graduation date</span><Input aria-label="Expected graduation date" maxLength={80} value={value} placeholder="Expected Dec 2027" disabled={disabled} onChange={(event) => { setValue(event.target.value); setError(""); }} /></label>
      <Button type="button" variant="outline" disabled={disabled || !value.trim() || value.trim() === date} onClick={() => { try { onApply(graduationDateEdit(option, edits, value)); setError(""); } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not update the graduation date"); } }}>Apply graduation date</Button>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
