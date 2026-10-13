// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readCatalog, composeResume, maskComments, sourceHash, factsChanged } from "@/lib/resume-repo/latex";
import type { ResumeFiles } from "@/models/resumeOptimization.model";

export const files: ResumeFiles = {
  "Resume.tex": "\\documentclass{article}\n\\input{preamble}\n\\begin{document}\n\\section{Education}\n\\resumeSubHeadingListStart\n\\School\n\\resumeSubHeadingListEnd\n% archived composition\n% \\section{Projects}\n% \\Project*\n\\section{Engineering \\& Research}\n\\resumeSubHeadingListStart\n\\Engineer\n\\resumeSubHeadingListEnd\n\\section{Skills}\n\\skillsResume*\n\\end{document}\n",
  "preamble.tex": "\\input{experience}\n\\input{skills}\n",
  "experience.tex": "\\NewDocumentCommand{\\Engineer}{s}{\n\\resumeSubheading{Acme}{2025}{Engineer}[\\IfBooleanTF{#1}{Python}{C++, ROS 2}]{Boston}\n\\IfBooleanTF{#1}{\\resumeItem{Developed \\textbf{planning} algorithms.}}{\n% \\resumeItem{Inactive invented metric 999.}\n\\resumeItem{Built systems with 100 Hz updates and 98\\% reliability.}\n}\n}\n\\NewDocumentCommand{\\School}{}{\\resumeItem{Studied engineering.}}\n\\NewDocumentCommand{\\Project}{s}{\\IfBooleanTF{#1}{\\resumeItem{Built robotics software.}}{\\resumeItem{Built hardware.}}}\n",
  "skills.tex": "\\NewDocumentCommand{\\skillsResume}{s}{\\IfBooleanTF{#1}{\\textbf{Languages}{: C++, Python} \\\\ \n\\textbf{Tools}{: Docker, ROS}}{\\textbf{Systems:} C++, ROS 2 \\\\ \n\\textbf{Tools}{: Linux}}}\n",
};
describe("source-preserving resume adapter", () => {
  it("round trips an untouched document including archived comments", () => {
    const catalog = readCatalog(files, "Resume.tex");
    expect(composeResume(files, "Resume.tex", catalog.sections, [])).toEqual(files);
    expect(catalog.sections.map((section) => section.title)).toEqual(["Education", "Engineering & Research", "Skills"]);
  });
  it("distinguishes active variants and ignores commented bullets", () => {
    const catalog = readCatalog(files, "Resume.tex");
    expect(catalog.blocks.some((block) => block.original.includes("999"))).toBe(false);
    expect(catalog.blocks.find((block) => block.original.includes("100 Hz"))).toMatchObject({ active: true, variant: "unstarred" });
    expect(catalog.blocks.find((block) => block.original.includes("planning"))).toMatchObject({ active: false, variant: "starred" });
    expect(catalog.blocks.find((block) => block.macro === "Project")).toMatchObject({ active: false });
  });
  it("reorders and renames sections while retaining macro definitions", () => {
    const catalog = readCatalog(files, "Resume.tex"), layout = [catalog.sections[2], { ...catalog.sections[1], title: "GNC & Autonomy" }, catalog.sections[0]];
    const result = composeResume(files, "Resume.tex", layout, []);
    expect(readCatalog(result, "Resume.tex").sections.map((section) => section.title)).toEqual(["Skills", "GNC & Autonomy", "Education"]);
    expect(result["experience.tex"]).toBe(files["experience.tex"]);
    expect(result["Resume.tex"]).toContain("% archived composition");
  });
  it("changes selected entries and adds a section from existing macros", () => {
    const catalog = readCatalog(files, "Resume.tex");
    const layout = [...catalog.sections, { id: "projects", title: "Selected Projects", entries: [{ macro: "Project", starred: true }] }];
    const result = composeResume(files, "Resume.tex", layout, []);
    expect(readCatalog(result, "Resume.tex").sections.at(-1)?.entries).toEqual([{ macro: "Project", starred: true }]);
  });
  it("patches exactly one bullet and keeps other variants and comments", () => {
    const catalog = readCatalog(files, "Resume.tex"), block = catalog.blocks.find((item) => item.original.includes("100 Hz"))!;
    const replacement = "Delivered systems with 100 Hz updates and 98\\% reliability.";
    const result = composeResume(files, "Resume.tex", catalog.sections, [{ blockId: block.id, replacement, accepted: true, factsConfirmed: true, reason: "clarity" }]);
    expect(result["experience.tex"]).toBe(files["experience.tex"].replace(block.original, replacement));
    expect(result["Resume.tex"]).toBe(files["Resume.tex"]);
  });
  it("rejects stale block identifiers, overlapping edits, unsupported commands and changed facts", () => {
    const catalog = readCatalog(files, "Resume.tex"), block = catalog.blocks.find((item) => item.original.includes("100 Hz"))!;
    const edit = { blockId: block.id, replacement: block.original, accepted: true, factsConfirmed: false, reason: "" };
    expect(() => composeResume(files, "Resume.tex", catalog.sections, [{ ...edit, blockId: "not-found" }])).toThrow(/Source block changed/);
    expect(() => composeResume(files, "Resume.tex", catalog.sections, [edit, edit])).toThrow(/Overlapping/);
    expect(() => composeResume(files, "Resume.tex", catalog.sections, [{ ...edit, replacement: "\\input{secrets}", factsConfirmed: true }])).toThrow(/Only resume content/);
    expect(() => composeResume(files, "Resume.tex", catalog.sections, [{ ...edit, replacement: block.original.replace("100", "1000") }])).toThrow(/Confirm/);
  });
  it("rejects unknown entries and unsafe titles", () => {
    const catalog = readCatalog(files, "Resume.tex");
    expect(() => composeResume(files, "Resume.tex", [{ ...catalog.sections[0], title: "\\input{foo}" }], [])).toThrow(/Invalid section/);
    expect(() => composeResume(files, "Resume.tex", [{ ...catalog.sections[0], entries: [{ macro: "Malicious", starred: false }] }], [])).toThrow(/Unknown resume entry/);
  });
  it("preserves CRLF and escaped percent signs", () => {
    const windows = Object.fromEntries(Object.entries(files).map(([key, value]) => [key, value.replace(/\n/g, "\r\n")]));
    expect(composeResume(windows, "Resume.tex", readCatalog(windows, "Resume.tex").sections, [])).toEqual(windows);
    expect(maskComments("98\\% success % hidden\n")).toContain("98\\% success");
    expect(sourceHash(files)).toBe(sourceHash(Object.fromEntries(Object.entries(files).reverse())));
    expect(factsChanged("100 Hz and 98\\%", "98\\% at 100 Hz")).toBe(false);
  });
  it("keeps skills block replacements inside their original braces", () => {
    const catalog = readCatalog(files, "Resume.tex");
    for (const block of catalog.blocks.filter((item) => item.kind === "skills")) {
      expect(() => composeResume(files, "Resume.tex", catalog.sections, [{ blockId: block.id, replacement: block.original.replace("Python", "Python, MATLAB"), accepted: true, factsConfirmed: true, reason: "" }])).not.toThrow();
    }
  });
  it("edits header fields without changing the macro arguments or conditional technology labels", () => {
    const catalog = readCatalog(files, "Resume.tex");
    const role = catalog.blocks.find((block) => block.kind === "metadata" && block.original === "Engineer")!;
    const technologies = catalog.blocks.find((block) => block.kind === "metadata" && block.original.includes("C++, ROS 2"))!;
    expect(technologies.original).toBe("\\IfBooleanTF{#1}{Python}{C++, ROS 2}");
    const result = composeResume(files, "Resume.tex", catalog.sections, [{ blockId: role.id, replacement: "Systems Engineer", accepted: true, factsConfirmed: true, reason: "accurate title" }]);
    expect(result["experience.tex"]).toContain("{2025}{Systems Engineer}[\\IfBooleanTF{#1}{Python}{C++, ROS 2}]{Boston}");
    expect(result["experience.tex"]).toBe(files["experience.tex"].replace("{2025}{Engineer}", "{2025}{Systems Engineer}"));
  });
});
