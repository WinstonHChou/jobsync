import type { JobDetails } from "../types";
import type { WorkdayJobInfo } from "./types";

export function mapWorkdayJob(listing: JobDetails, info: WorkdayJobInfo): JobDetails {
  const locations = [info.location, ...(info.additionalLocations ?? [])]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const remoteType = info.remoteType?.trim().toLowerCase();
  const workplaceType = remoteType === "remote" ? "REMOTE"
    : remoteType === "hybrid" ? "HYBRID"
    : ["on-site", "onsite", "on site"].includes(remoteType ?? "") ? "ONSITE"
    : undefined;
  return {
    ...listing,
    title: info.title.trim(),
    description: info.jobDescription,
    location: [...new Set(locations)].join(", ") || listing.location,
    postedDate: info.startDate,
    employmentType: info.timeType,
    workplaceType,
  };
}
