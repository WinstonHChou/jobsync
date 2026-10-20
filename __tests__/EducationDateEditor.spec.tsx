import React, { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { EducationDateEditor } from "@/components/resume-optimization/EducationDateEditor";
import type { ResumeCatalog, ResumeEdit } from "@/models/resumeOptimization.model";

const original = "\\IfBooleanTF{#1}{Sep 2026 --}{Expected Aug 2027}";
const catalog: ResumeCatalog = { sections: [{ id: "education", title: "Education", entries: [{ macro: "Masters", starred: false }] }], entries: [{ macro: "Masters", label: "Latest University", file: "education.tex", starred: true }], blocks: [{ id: "a".repeat(24), file: "education.tex", start: 1, end: original.length + 1, original, label: "Latest University · dates", kind: "metadata", macro: "Masters", active: true }] };

it("offers internship, full-time, and custom dates as reviewable edits", () => {
  const applied = vi.fn();
  function Editor() {
    const [edits, setEdits] = useState<ResumeEdit[]>([]);
    return <EducationDateEditor catalog={catalog} layout={catalog.sections} edits={edits} disabled={false} onApply={(edit) => { applied(edit); setEdits([edit]); }} />;
  }
  render(<Editor />);
  expect(screen.getByLabelText("Expected graduation date")).toHaveValue("Expected Aug 2027");
  fireEvent.click(screen.getByRole("button", { name: "Internship: Dec 2027" }));
  expect(applied).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply graduation date" }));
  expect(applied).toHaveBeenLastCalledWith(expect.objectContaining({ replacement: original.replace("Aug", "Dec"), accepted: true, factsConfirmed: false }));
  fireEvent.click(screen.getByRole("button", { name: "Full-time: Aug 2027" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply graduation date" }));
  expect(applied).toHaveBeenLastCalledWith(expect.objectContaining({ replacement: original }));
  fireEvent.change(screen.getByLabelText("Expected graduation date"), { target: { value: "Expected May 2028" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply graduation date" }));
  expect(applied).toHaveBeenLastCalledWith(expect.objectContaining({ replacement: original.replace("Aug 2027", "May 2028") }));
});

it("hides unavailable education fields and locks committed or busy drafts", () => {
  const applied = vi.fn();
  const { rerender } = render(<EducationDateEditor catalog={{ ...catalog, blocks: [] }} layout={catalog.sections} edits={[]} disabled={false} onApply={applied} />);
  expect(screen.queryByLabelText("Expected graduation date")).not.toBeInTheDocument();
  rerender(<EducationDateEditor catalog={catalog} layout={catalog.sections} edits={[]} disabled onApply={applied} />);
  expect(screen.getByLabelText("Expected graduation date")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Internship: Dec 2027" })).toBeDisabled();
});
