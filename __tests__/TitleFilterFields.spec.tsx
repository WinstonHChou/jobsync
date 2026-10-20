import React, { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TitleFilterFields } from "@/components/automations/ats-search-step/TitleFilterFields";
import type { AtsConfigValue } from "@/components/automations/ats-search-step/types";

it("edits local fragments and match mode while preserving other automation settings", async () => {
  const user = userEvent.setup(), changed = vi.fn();
  function Editor() {
    const [value, setValue] = useState<AtsConfigValue>({ companies: [], targetTitles: ["Robotics Engineer"], locations: ["Taiwan"], strictLocation: true });
    return <TitleFilterFields value={value} onChange={(next) => { changed(next); setValue(next); }} />;
  }
  render(<Editor />);
  await user.type(screen.getByLabelText("Title contains any of"), "robot{Enter}");
  await user.type(screen.getByLabelText("Title contains any of"), "controls");
  await user.click(screen.getByRole("button", { name: "Add title fragment" }));
  await user.selectOptions(screen.getByLabelText("Title match mode"), "words");
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ titleContains: ["robot", "controls"], titleMatchMode: "words", targetTitles: ["Robotics Engineer"], locations: ["Taiwan"], strictLocation: true }));
  await user.click(screen.getByRole("button", { name: "Remove title fragment robot" }));
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ titleContains: ["controls"] }));
});

it("prevents duplicate fragments and keeps Enter inside the filter editor", async () => {
  const user = userEvent.setup(), changed = vi.fn(), submitted = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(<form onSubmit={submitted}><TitleFilterFields value={{ companies: [], titleContains: ["robot"] }} onChange={changed} /></form>);
  await user.type(screen.getByLabelText("Title contains any of"), "ROBOT{Enter}");
  expect(changed).not.toHaveBeenCalled();
  expect(submitted).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Add title fragment" })).toBeDisabled();
});
