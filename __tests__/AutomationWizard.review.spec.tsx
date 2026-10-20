import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutomationWizard } from "@/components/automations/AutomationWizard";
import { updateAutomation } from "@/actions/automation.actions";
import type { AutomationWithResume } from "@/models/automation.model";

vi.mock("@/actions/automation.actions", () => ({ createAutomation: vi.fn(), updateAutomation: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/toast", () => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("@/components/automations/AtsSearchStep", () => ({ AtsSearchStep: () => null }));
vi.mock("@/components/automations/automation-wizard/StepBasics", () => ({ StepBasics: () => null }));
vi.mock("@/components/automations/automation-wizard/StepResume", () => ({ StepResume: () => null }));
vi.mock("@/components/automations/automation-wizard/StepMatching", () => ({ StepMatching: () => null }));
vi.mock("@/components/automations/automation-wizard/StepSchedule", () => ({ StepSchedule: () => null }));

it("requires an explicit save after reaching Review and preserves strict filter settings", async () => {
  const user = userEvent.setup(), closed = vi.fn();
  const automation: AutomationWithResume = { id: "automation", userId: "owner", name: "Robotics", jobBoard: "greenhouse", keywords: "", location: "", resumeId: "550e8400-e29b-41d4-a716-446655440000", resume: { id: "550e8400-e29b-41d4-a716-446655440000", title: "Resume" }, matchThreshold: 80, scheduleHour: 8, nextRunAt: null, lastRunAt: null, status: "paused", createdAt: new Date(), updatedAt: new Date(), sourceConfig: JSON.stringify({ greenhouse: { companies: [{ name: "Acme", token: "acme" }], titleContains: ["robotics", "controls"], titleMatchMode: "words", locations: ["Taiwan"], strictLocation: true } }) };
  render(<AutomationWizard open onOpenChange={closed} resumes={[{ id: automation.resumeId, title: "Resume", sectionCount: 2 }]} automations={[automation]} onSuccess={vi.fn()} editAutomation={automation} />);
  for (let index = 0; index < 5; index++) await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("robotics OR controls (whole word/phrase)")).toBeInTheDocument();
  expect(updateAutomation).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Update Automation" }));
  expect(updateAutomation).toHaveBeenCalledOnce();
  expect(updateAutomation).toHaveBeenCalledWith("automation", expect.objectContaining({ sourceConfig: { greenhouse: expect.objectContaining({ titleContains: ["robotics", "controls"], titleMatchMode: "words", locations: ["Taiwan"], strictLocation: true }) } }));
});
