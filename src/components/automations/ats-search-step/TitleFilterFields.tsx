"use client";

import { useId, useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import type { AtsConfigValue } from "./types";

export function TitleFilterFields({ value, onChange }: { value: AtsConfigValue; onChange: (next: AtsConfigValue) => void }) {
  const id = useId(), [draft, setDraft] = useState("");
  const fragments = value.titleContains ?? [];
  const canAdd = !!draft.trim() && fragments.length < 20 && !fragments.some((term) => term.toLowerCase() === draft.trim().toLowerCase());
  function add() {
    if (!canAdd) return;
    onChange({ ...value, titleContains: [...fragments, draft.trim()] });
    setDraft("");
  }
  return <div className="space-y-2 rounded-lg border p-3">
    <Label htmlFor={id}>Title contains any of</Label>
    <div className="flex gap-2">
      <Input id={id} placeholder="e.g., robot" value={draft} maxLength={100} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }} />
      <Button type="button" variant="outline" size="icon" aria-label="Add title fragment" disabled={!canAdd} onClick={add}><Plus className="size-4" /></Button>
    </div>
    {!!fragments.length && <div className="flex flex-wrap gap-1">{fragments.map((term) => <Badge key={term} variant="secondary" className="max-w-full gap-1"><span className="min-w-0 truncate">{term}</span><button type="button" className="shrink-0" aria-label={"Remove title fragment " + term} onClick={() => onChange({ ...value, titleContains: fragments.filter((item) => item !== term) })}><X className="size-3" /></button></Badge>)}</div>}
    <label className="flex items-center gap-2 text-sm">Match mode<select aria-label="Title match mode" className="h-9 rounded-md border bg-background px-2" value={value.titleMatchMode ?? "contains"} onChange={(event) => onChange({ ...value, titleMatchMode: event.target.value === "words" ? "words" : "contains" })}><option value="contains">Partial text</option><option value="words">Whole word or phrase</option></select></label>
    <p className="text-sm text-muted-foreground">Press Enter or + to add each fragment. Only titles matching at least one fragment can be analyzed or saved. Empty means no title restriction. Separate fragments use OR; title and location filters must both pass.</p>
    <p className="text-sm text-muted-foreground">Partial text: robot matches Robotics. Whole word: intern matches Engineering Intern, but not Internal Tools Engineer. Fragments stay in this automation.</p>
  </div>;
}
