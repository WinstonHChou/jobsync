"use client";

import { TriangleAlert } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getAllJobTitles, createJobTitle } from "@/actions/jobtitle.actions";
import { getAllTags, createTag } from "@/actions/tag.actions";
import { getAllJobLocations } from "@/actions/jobLocation.actions";
import { createLocation } from "@/actions/job.actions";
import { EntityStringChipInput } from "./EntityStringChipInput";
import { TitleFilterFields } from "./TitleFilterFields";
import type { AtsConfigValue } from "./types";

interface TargetingFieldsProps {
  value: AtsConfigValue;
  onChange: (next: AtsConfigValue) => void;
}

export function TargetingFields({ value, onChange }: TargetingFieldsProps) {
  // Highlight searches that rely entirely on resume skills for relevance.
  const noSignal =
    (value.titleContains?.length ?? 0) === 0 &&
    (value.targetTitles?.length ?? 0) === 0 &&
    (value.keywords?.length ?? 0) === 0;

  return (
    <>
      <TitleFilterFields value={value} onChange={onChange} />
      <EntityStringChipInput
        label="Target job titles"
        placeholder="e.g., Frontend Engineer"
        noun="job title"
        description="Optional ranking preference. Use Title contains any of above to require a title match."
        values={value.targetTitles ?? []}
        onChange={(next) => onChange({ ...value, targetTitles: next })}
        loadOptions={async () => {
          const res = await getAllJobTitles();
          return Array.isArray(res) ? res : [];
        }}
        createOption={async (lbl) => {
          const res = await createJobTitle(lbl);
          return res?.id ? res : null;
        }}
      />

      <EntityStringChipInput
        label="Keywords / skills"
        placeholder="e.g., React"
        noun="keyword"
        description="Optional. Matched against title and description."
        values={value.keywords ?? []}
        onChange={(next) => onChange({ ...value, keywords: next })}
        loadOptions={async () => {
          const res = await getAllTags();
          return Array.isArray(res) ? res : [];
        }}
        createOption={async (lbl) => {
          const res = await createTag(lbl);
          return res?.success ? res.data : null;
        }}
      />

      {noSignal && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            Add a title fragment, target title, or keyword to guide this search.
            Otherwise, only resume skills can provide relevance signals.
          </span>
        </div>
      )}

      <EntityStringChipInput
        label="Locations"
        placeholder="e.g., Calgary, Seattle"
        noun="location"
        description="Optional. Enable the toggle below to filter. Country aliases include US / USA / United States, TW / Taiwan / 台灣, and UK / United Kingdom. Cities are not inferred to a country."
        values={value.locations ?? []}
        onChange={(next) => onChange({ ...value, locations: next })}
        loadOptions={async () => {
          const res = await getAllJobLocations();
          return Array.isArray(res) ? res : [];
        }}
        createOption={async (lbl) => {
          const res = await createLocation(lbl);
          return res?.success ? res.data : null;
        }}
      />

      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-1">
          <Label>Only show jobs in these locations</Label>
          <p className="text-sm text-muted-foreground">
            When on, jobs matching none of your locations are dropped before
            ranking. Remote roles must match a listed location too; adding Remote permits remote roles anywhere.
          </p>
        </div>
        <Switch
          aria-label="Only show jobs in these locations"
          checked={!!value.strictLocation}
          disabled={(value.locations ?? []).length === 0}
          onCheckedChange={(checked) =>
            onChange({ ...value, strictLocation: checked })
          }
        />
      </div>
    </>
  );
}
