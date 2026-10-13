import type { JobBoard } from "@/models/automation.model";
import { searchGreenhouseJobs } from "../greenhouse";
import { searchLeverJobs } from "../lever";
import { searchAshbyJobs } from "../ashby";
import { searchWorkdayJobs, hydrateWorkdayJobs } from "../workday";
import { searchCompanyCareers, hydrateCompanyCareers } from "../company-careers";
import type { AtsProvider } from "./types";

// Server-only: imports the real network-calling search fns (fetch, p-limit).
// Never import this from client-bundled code — use ATS_BOARDS from
// automation.model.ts for the plain, dependency-free board list.
export const ATS_PROVIDERS: Partial<Record<JobBoard, AtsProvider>> = {
  greenhouse: {
    id: "greenhouse",
    label: "Greenhouse",
    search: searchGreenhouseJobs,
  },
  lever: { id: "lever", label: "Lever", search: searchLeverJobs },
  ashby: { id: "ashby", label: "Ashby", search: searchAshbyJobs },
  "company-careers": { id: "company-careers", label: "Company careers", search: searchCompanyCareers, hydrate: hydrateCompanyCareers },
  workday: { id: "workday", label: "Workday", search: searchWorkdayJobs, hydrate: hydrateWorkdayJobs },
};
