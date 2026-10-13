export interface JobDetails {
  // Transient provenance used to group custom-site detail failures by watchlist URL.
  careerSourceUrl?: string;
  careerAdapter?: "workday";
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  postedDate?: string;
  salary?: string;
  employmentType?: string;
  isRemote?: boolean;
  workplaceType?: string;
}

export type ScraperError =
  | { type: "blocked"; reason: string }
  | { type: "rate_limited"; retryAfter?: number }
  | { type: "network"; message: string }
  | { type: "parse"; message: string };

export type ScraperResult<T> =
  | { success: true; data: T }
  | { success: false; error: ScraperError };
