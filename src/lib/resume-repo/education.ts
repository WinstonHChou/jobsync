import type { ResumeCatalog, ResumeEdit, ResumeLayoutSection, ResumeSourceBlock } from "@/models/resumeOptimization.model";
import { group, maskComments } from "./syntax";

export interface EducationDateOption { key: string; block: ResumeSourceBlock; starred: boolean; label: string; }

function dateOrder(source: string): number {
  const years = [...source.matchAll(/\b(?:19|20|21)\d{2}\b/g)].map((match) => Number(match[0]) * 12);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  for (const match of source.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+((?:19|20|21)\d{2})\b/gi)) years.push(Number(match[2]) * 12 + months.indexOf(match[1].toLowerCase()) + 1);
  return Math.max(0, ...years);
}

export function educationDateOptions(catalog: ResumeCatalog, layout: ResumeLayoutSection[]): EducationDateOption[] {
  const options = new Map<string, EducationDateOption>();
  for (const entry of layout.flatMap((section) => section.entries)) {
    // The label fallback also supports drafts captured before field metadata
    // was introduced; their source block IDs and snapshots remain valid.
    const dates = catalog.blocks.filter((block) => block.macro === entry.macro && (block.field === "educationDates" || (block.file === "education.tex" && block.kind === "metadata" && block.label.endsWith(" · dates"))) && (!block.variant || block.variant === (entry.starred ? "starred" : "unstarred")));
    for (const block of dates) {
      const key = block.id + (entry.starred ? ":starred" : ":unstarred");
      options.set(key, { key, block, starred: entry.starred, label: (catalog.entries.find((item) => item.macro === entry.macro)?.label ?? entry.macro) + (entry.starred ? " · starred" : "") });
    }
  }
  return [...options.values()].sort((a, b) => dateOrder(b.block.original) - dateOrder(a.block.original));
}

// Visit only the selected #1 branch. All other bytes, including comments,
// the opposite variant, and optional date-range prefixes, stay in place.
function transformDate(source: string, starred: boolean, change: (value: string) => string): string {
  const masked = maskComments(source), match = masked.match(/^\s*\\IfBooleanTF\s*/);
  if (match) {
    const parameter = group(masked, match[0].length), yes = group(masked, parameter.next), no = group(masked, yes.next);
    if (parameter.text !== "#1" || masked.slice(no.next).trim()) throw new Error("Use Content review to edit this date format");
    const selected = starred ? yes : no;
    return source.slice(0, selected.start) + transformDate(source.slice(selected.start, selected.end), starred, change) + source.slice(selected.end);
  }
  if (/[\\{}%]/.test(source)) throw new Error("Use Content review to edit this date format");
  return change(source);
}

function rangeParts(value: string) { return value.match(/^([\s\S]*?)(\s*(?:--|–|—)\s*)([\s\S]*)$/); }

export function displayedGraduationDate(source: string, starred: boolean): string {
  let date = "";
  transformDate(source, starred, (value) => { date = (rangeParts(value)?.[3] ?? value).trim(); return value; });
  return date;
}

export function graduationDateEdit(option: EducationDateOption, edits: ResumeEdit[], value: string): ResumeEdit {
  const date = value.trim();
  if (!/^[\p{L}\p{N} .,'()\-–—]{1,80}$/u.test(date)) throw new Error("Enter a graduation date as plain text, up to 80 characters");
  const existing = edits.find((edit) => edit.blockId === option.block.id && edit.accepted);
  const source = existing?.replacement ?? option.block.original;
  const replacement = transformDate(source, option.starred, (leaf) => {
    const range = rangeParts(leaf.trim());
    const content = range ? range[1] + range[2] + (/\s$/.test(range[2]) ? "" : " ") + date : date;
    return leaf.slice(0, leaf.length - leaf.trimStart().length) + content + leaf.slice(leaf.trimEnd().length);
  });
  return { blockId: option.block.id, replacement, reason: "Manual expected graduation date", accepted: true, factsConfirmed: existing?.replacement === replacement ? existing.factsConfirmed : false };
}
