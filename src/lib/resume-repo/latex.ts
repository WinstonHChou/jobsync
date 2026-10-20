import { createHash } from "node:crypto";
import type { ResumeCatalog, ResumeFiles, ResumeLayoutSection, ResumeSourceBlock, ResumeEdit } from "@/models/resumeOptimization.model";
export { factsChanged } from "./facts";
import { group, maskComments } from "./syntax";
export { group, maskComments } from "./syntax";

export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const sourceHash = (files: ResumeFiles) => hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
function macros(files: ResumeFiles) {
  const result: { name: string; file: string; spec: string; start: number; end: number }[] = [];
  for (const [file, raw] of Object.entries(files)) {
    const source = maskComments(raw);
    for (const match of source.matchAll(/\\NewDocumentCommand\s*/g)) {
      const name = group(source, match.index! + match[0].length);
      const spec = group(source, name.next), body = group(source, spec.next);
      if (/^\\[A-Za-z]+$/.test(name.text) && ["s", ""].includes(spec.text)) result.push({ name: name.text.slice(1), file, spec: spec.text, start: body.start, end: body.end });
    }
  }
  return result;
}
function sections(files: ResumeFiles, entrypoint: string) {
  const raw = files[entrypoint]; if (!raw) throw new Error("Resume entrypoint not found");
  const source = maskComments(raw), endDocument = source.indexOf("\\end{document}");
  const matches = [...source.matchAll(/\\section\s*/g)];
  return matches.map((match, index) => {
    const title = group(source, match.index! + match[0].length);
    const end = matches[index + 1]?.index ?? endDocument;
    if (end < title.next) throw new Error("Unsupported resume document structure");
    return { id: `section-${index}`, start: match.index!, end, title, entries: [...source.slice(title.next, end).matchAll(/\\([A-Za-z]+)(\*)?/g)] };
  });
}
const plain = (value: string) => value.replace(/\\([&%#_$])/g, "$1").replace(/\\(?:textbf|textit|emph)\{([^{}]*)\}/g, "$1");
function entryLabel(definition: ReturnType<typeof macros>[number], files: ResumeFiles) {
  const source = maskComments(files[definition.file]);
  const body = source.slice(definition.start, definition.end);
  const heading = body.match(/\\(?:resumeSubheading|resumeProjectHeading)\b\s*/);
  if (heading) return plain(group(source, definition.start + heading.index! + heading[0].length).text).split("$|$")[0].trim();
  return definition.name === "skillsResume" ? "Resume skills" : definition.name === "skillsCV" ? "CV skills" : definition.name;
}
export function readCatalog(files: ResumeFiles, entrypoint: string): ResumeCatalog {
  const definitions = macros(files), names = new Set(definitions.map((entry) => entry.name));
  const layout = sections(files, entrypoint).map((section) => ({ id: section.id, title: plain(section.title.text), entries: section.entries.filter((match) => names.has(match[1])).map((match) => ({ macro: match[1], starred: Boolean(match[2]) })) }));
  if (!layout.length) throw new Error("No supported resume sections found");
  const uses = new Map<string, Set<boolean>>();
  layout.flatMap((section) => section.entries).forEach((entry) => { const set = uses.get(entry.macro) ?? new Set(); set.add(entry.starred); uses.set(entry.macro, set); });
  const blocks: ResumeSourceBlock[] = [];
  for (const definition of definitions) {
    if (["heading.tex", entrypoint].includes(definition.file)) continue;
    const raw = files[definition.file], source = maskComments(raw);
    const conditions: { start: number; end: number; starred: boolean }[] = [];
    for (const match of source.slice(definition.start, definition.end).matchAll(/\\IfBooleanTF\s*/g)) {
      const argument = group(source, definition.start + match.index! + match[0].length);
      if (argument.text !== "#1") continue;
      const yes = group(source, argument.next), no = group(source, yes.next);
      conditions.push({ start: yes.start, end: yes.end, starred: true }, { start: no.start, end: no.end, starred: false });
    }
    const add = (start: number, end: number, kind: ResumeSourceBlock["kind"], label: string, field?: ResumeSourceBlock["field"]) => {
      const condition = conditions.find((range) => start >= range.start && end <= range.end);
      const active = Boolean(uses.get(definition.name)?.size) && (!condition || uses.get(definition.name)!.has(condition.starred));
      blocks.push({ id: hash(`${definition.file}:${definition.name}:${start}:${raw.slice(start, end)}`).slice(0, 24), file: definition.file, start, end, original: raw.slice(start, end), label: label === definition.name ? entryLabel(definition, files) : label, kind, macro: definition.name, active, ...(field ? { field } : {}), ...(condition ? { variant: condition.starred ? "starred" : "unstarred" } : {}) });
    };
    const body = source.slice(definition.start, definition.end);
    for (const match of body.matchAll(/\\resumeItem\b\s*/g)) {
      const argument = group(source, definition.start + match.index! + match[0].length);
      add(argument.start, argument.end, "bullet", definition.name);
    }
    for (const match of body.matchAll(/\\resumeSubheading\s*/g)) {
      let cursor = definition.start + match.index! + match[0].length;
      for (let index = 0; index < 3; index++) {
        const argument = group(source, cursor); cursor = argument.next;
        if (index > 0) add(argument.start, argument.end, "metadata", `${entryLabel(definition, files)} · ${definition.file === "education.tex" ? index === 1 ? "location" : "degree" : index === 1 ? "dates" : "role title"}`);
      }
      while (/\s/.test(source[cursor] ?? "") && cursor < source.length) cursor++;
      if (source[cursor] === "[") { const argument = group(source, cursor, "["); add(argument.start, argument.end, "metadata", `${entryLabel(definition, files)} · technology labels`); cursor = argument.next; }
      const final = group(source, cursor);
      add(final.start, final.end, "metadata", `${entryLabel(definition, files)} · ${definition.file === "education.tex" ? "dates" : "location"}`, definition.file === "education.tex" ? "educationDates" : undefined);
    }
    if (definition.name.startsWith("skills")) {
      for (const match of body.matchAll(/\\textbf\s*/g)) {
        const start = definition.start + match.index!;
        const label = group(source, start + match[0].length);
        const condition = conditions.find((range) => start >= range.start && start < range.end);
        const boundary = condition?.end ?? definition.end;
        const lineEnd = source.indexOf("\\\\", label.next);
        let cursor = label.next;
        while (/\s/.test(source[cursor] ?? "") && cursor < boundary) cursor++;
        const valueGroup = source[cursor] === "{" ? group(source, cursor) : null;
        const end = valueGroup ? valueGroup.next : lineEnd >= 0 && lineEnd < boundary ? lineEnd : boundary;
        if (end > label.next) add(start, end, "skills", `${definition.name}: ${plain(label.text)}`);
      }
    }
  }
  return { sections: layout, blocks, entries: definitions.filter((entry) => !entry.name.startsWith("heading")).map((entry) => ({ macro: entry.name, file: entry.file, starred: entry.spec === "s", label: entryLabel(entry, files) })) };
}
const escapeTitle = (title: string) => title.replace(/[&%#_$]/g, (char) => `\\${char}`);
function safeReplacement(text: string, original: string) {
  const forbidden = /\\(?:input|include|usepackage|documentclass|openin|openout|read|write|immediate|special|catcode|csname|def|edef|gdef|let|loop|repeat|directlua|pdfobj|pdfximage|newcommand|NewDocumentCommand|endinput)\b/i;
  if (forbidden.test(maskComments(text))) throw new Error("Only resume content and formatting commands can be edited");
  const commands = new Set([...maskComments(original).matchAll(/\\([A-Za-z]+)/g)].map((match) => match[1]));
  ["textbf", "textit", "emph"].forEach((name) => commands.add(name));
  for (const match of maskComments(text).matchAll(/\\([A-Za-z]+)/g)) if (!commands.has(match[1])) throw new Error(`Unsupported formatting command: ${match[1]}`);
  let depth = 0;
  for (let i = 0; i < text.length; i++) { if (text[i] === "\\") { i++; continue; } if (text[i] === "{") depth++; if (text[i] === "}" && --depth < 0) throw new Error("Unbalanced replacement braces"); }
  if (depth) throw new Error("Unbalanced replacement braces");
}
export function composeResume(files: ResumeFiles, entrypoint: string, layout: ResumeLayoutSection[], edits: ResumeEdit[]): ResumeFiles {
  const catalog = readCatalog(files, entrypoint), originalSections = sections(files, entrypoint);
  const names = new Set(catalog.entries.map((entry) => entry.macro));
  const ids = new Set<string>();
  for (const section of layout) {
    if (ids.has(section.id) || !section.title.trim() || /[\\{}\n\r]/.test(section.title)) throw new Error("Invalid section title or duplicate section");
    ids.add(section.id);
    for (const entry of section.entries) if (!names.has(entry.macro) || (entry.starred && !catalog.entries.find((item) => item.macro === entry.macro)?.starred)) throw new Error("Unknown resume entry or unsupported variant");
  }
  if (!layout.length || layout.length > 15) throw new Error("Choose between one and fifteen sections");
  const result = { ...files };
  const replacements = new Map<string, { start: number; end: number; text: string }[]>();
  for (const edit of edits.filter((item) => item.accepted)) {
    const block = catalog.blocks.find((item) => item.id === edit.blockId);
    if (!block) throw new Error("Source block changed; refresh the draft");
    if (!edit.factsConfirmed && edit.replacement !== block.original) throw new Error("Confirm the factual claims in each selected content edit before building");
    safeReplacement(edit.replacement, block.original);
    const list = replacements.get(block.file) ?? []; list.push({ start: block.start, end: block.end, text: edit.replacement }); replacements.set(block.file, list);
  }
  for (const [file, list] of replacements) {
    list.sort((a, b) => b.start - a.start);
    let previous = Infinity;
    for (const item of list) { if (item.end > previous) throw new Error("Overlapping content edits"); previous = item.start; result[file] = result[file].slice(0, item.start) + item.text + result[file].slice(item.end); }
  }
  const raw = files[entrypoint], newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const assembled = layout.map((next) => {
    const current = originalSections.find((item) => item.id === next.id), before = catalog.sections.find((item) => item.id === next.id);
    if (current && before) {
      let chunk = raw.slice(current.start, current.end);
      if (JSON.stringify(before.entries) === JSON.stringify(next.entries)) return chunk.slice(0, current.title.start - current.start) + escapeTitle(next.title) + chunk.slice(current.title.end - current.start);
      const masked = maskComments(chunk), references = [...masked.matchAll(/\\([A-Za-z]+)(\*)?/g)].filter((match) => names.has(match[1]));
      if (references.length) {
        const start = references[0].index!, end = references.at(-1)!.index! + references.at(-1)![0].length;
        // Preserve the comments between old entry references as a source archive.
        const comments = chunk.slice(start, end).split(/\r?\n/).filter((line) => line.trim().startsWith("%"));
        chunk = chunk.slice(0, start) + [...next.entries.map((entry) => `\\${entry.macro}${entry.starred ? "*" : ""}`), ...comments].join(newline + "    ") + chunk.slice(end);
        return chunk.slice(0, current.title.start - current.start) + escapeTitle(next.title) + chunk.slice(current.title.end - current.start);
      }
    }
    return `\\section{${escapeTitle(next.title)}}${newline}  \\resumeSubHeadingListStart${newline}${next.entries.map((entry) => `    \\${entry.macro}${entry.starred ? "*" : ""}`).join(newline)}${newline}  \\resumeSubHeadingListEnd${newline}${newline}`;
  }).join("");
  result[entrypoint] = raw.slice(0, originalSections[0].start) + assembled + raw.slice(originalSections.at(-1)!.end);
  return result;
}
