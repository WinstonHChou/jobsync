export interface WorkdayListing {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
  remoteType?: string;
}

export interface WorkdayJobInfo {
  title: string;
  jobDescription: string;
  location?: string;
  additionalLocations?: string[];
  startDate?: string;
  timeType?: string;
  remoteType?: string;
}
