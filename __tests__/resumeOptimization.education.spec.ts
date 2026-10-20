// @vitest-environment node
import { describe, expect, it } from "vitest";
import { composeResume, readCatalog } from "@/lib/resume-repo/latex";
import { displayedGraduationDate, educationDateOptions, graduationDateEdit } from "@/lib/resume-repo/education";

export const educationFiles = {
  "Resume.tex": "\\begin{document}\n\\section{Education}\n\\Bachelor\n\\Masters\n\\end{document}\n",
  "education.tex": "\\NewDocumentCommand{\\Bachelor}{s}{\\resumeSubheading{Earlier University}{San Diego}{B.S. Engineering}{\\IfBooleanTF{#1}{Sep 2022 -- Jun 2026}{Jun 2026}}}\n% Archived education remains untouched\n\\NewDocumentCommand{\\Masters}{s}{\\resumeSubheading{Latest University}{New York}{M.S. Engineering}{\\IfBooleanTF{#1}{Sep 2026 --}{Expected Aug 2027}}}\n",
};

describe("manual education graduation dates", () => {
  it("identifies the latest included degree regardless of section entry order", () => {
    const catalog = readCatalog(educationFiles, "Resume.tex"), options = educationDateOptions(catalog, catalog.sections);
    expect(options.map((option) => option.block.macro)).toEqual(["Masters", "Bachelor"]);
    expect(options[0].block.field).toBe("educationDates");
    const legacy = { ...catalog, blocks: catalog.blocks.map(({ field: _field, ...block }) => { void _field; return block; }) };
    expect(educationDateOptions(legacy, legacy.sections)[0].block.id).toBe(options[0].block.id);
    expect(educationDateOptions(catalog, [{ ...catalog.sections[0], entries: [{ macro: "Bachelor", starred: false }] }])).toHaveLength(1);
  });
  it("changes only the selected resume date and requires factual review before composition", () => {
    const catalog = readCatalog(educationFiles, "Resume.tex"), option = educationDateOptions(catalog, catalog.sections)[0];
    const edit = graduationDateEdit(option, [], "Expected Dec 2027");
    expect(edit).toMatchObject({ accepted: true, factsConfirmed: false, replacement: "\\IfBooleanTF{#1}{Sep 2026 --}{Expected Dec 2027}" });
    expect(() => composeResume(educationFiles, "Resume.tex", catalog.sections, [edit])).toThrow(/Confirm the factual claims/);
    const result = composeResume(educationFiles, "Resume.tex", catalog.sections, [{ ...edit, factsConfirmed: true }]);
    expect(result["education.tex"]).toBe(educationFiles["education.tex"].replace("Expected Aug 2027", "Expected Dec 2027"));
    expect(result["Resume.tex"]).toBe(educationFiles["Resume.tex"]);
  });
  it("preserves start dates and the opposite variant when editing a starred degree", () => {
    const catalog = readCatalog(educationFiles, "Resume.tex");
    const layout = [{ ...catalog.sections[0], entries: [{ macro: "Masters", starred: true }] }];
    const option = educationDateOptions(catalog, layout)[0], edit = graduationDateEdit(option, [], "Expected Dec 2027");
    expect(displayedGraduationDate(option.block.original, true)).toBe("");
    expect(edit.replacement).toBe("\\IfBooleanTF{#1}{Sep 2026 -- Expected Dec 2027}{Expected Aug 2027}");
    expect(displayedGraduationDate(edit.replacement, true)).toBe("Expected Dec 2027");
    expect(displayedGraduationDate(edit.replacement, false)).toBe("Expected Aug 2027");
  });
  it("preserves an existing edit to the opposite variant and resets confirmation for a new date", () => {
    const catalog = readCatalog(educationFiles, "Resume.tex"), option = educationDateOptions(catalog, catalog.sections)[0];
    const starredEdit = { ...graduationDateEdit({ ...option, starred: true }, [], "Expected Dec 2027"), factsConfirmed: true };
    const edited = graduationDateEdit(option, [starredEdit], "Expected May 2028");
    expect(edited.replacement).toBe("\\IfBooleanTF{#1}{Sep 2026 -- Expected Dec 2027}{Expected May 2028}");
    expect(edited.factsConfirmed).toBe(false);
  });
  it("rejects injected LaTeX and ambiguous formatting rather than rewriting the date structure", () => {
    const catalog = readCatalog(educationFiles, "Resume.tex"), option = educationDateOptions(catalog, catalog.sections)[0];
    expect(() => graduationDateEdit(option, [], "\\input{secret}")).toThrow(/plain text/);
    expect(() => graduationDateEdit(option, [], "Expected Dec 2027% hidden")).toThrow(/plain text/);
    expect(() => displayedGraduationDate("\\textit{Expected Aug 2027}", false)).toThrow(/Content review/);
  });
});
