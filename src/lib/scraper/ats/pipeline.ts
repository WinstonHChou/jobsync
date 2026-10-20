import { APP_CONSTANTS } from "@/lib/constants";
import type { PrerankComponents } from "@/models/ai.schemas";
import type { JobDetails } from "../types";
import { scoreJob, passesFloor, buildIdf } from "./rank";
import { titleMatches, locationMatches, isUnknownLocation } from "./filters";
import type { TitleMatchMode } from "@/models/automation.model";

export interface PipelineConfig {
  targetTitles: string[];
  titleContains?: string[];
  titleMatchMode?: TitleMatchMode;
  keywords: string[];
  locations: string[];
  strictLocation: boolean;
}

export interface ScoredJob {
  job: JobDetails;
  score: number;
  components: PrerankComponents;
}

export interface PipelineResult {
  // Top-K survivors to LLM-analyze (highest scoring).
  toAnalyze: ScoredJob[];
  // Remaining floor survivors saved un-analyzed.
  toSaveUnanalyzed: ScoredJob[];
  funnel: {
    deduped: number; // jobs handed in (already deduped by the runner)
    titled: number | null; // survivors after strict title gate (null if off)
    unknownLocation: number; // unknown locations excluded by the strict gate
    located: number | null; // survivors after strict location gate (null if off)
    floorSurvivors: number; // jobs clearing the floor, before the cap ceiling
    scoreCut: number; // floor survivors dropped by the minimum-score gate
    relevant: number; // survivors after the score gate and cap (the LLM budget)
  };
}

// Pure funnel: strict title/location gates -> score -> relevance floor ->
// cap ceiling -> top-K split. No I/O, no LLM; unit-testable in isolation.
export function runAtsPipeline(
  fetchedJobs: JobDetails[],
  config: PipelineConfig,
  resumeSkills: string[],
  options?: { k?: number; cap?: number; corpus?: JobDetails[] },
): PipelineResult {
  const k = options?.k ?? APP_CONSTANTS.MAX_JOBS_PER_RUN;
  const cap = options?.cap ?? APP_CONSTANTS.ATS_LISTING_CAP;

  const deduped = fetchedJobs.length;

  // Term-rarity weights are derived from the full fetched corpus (pre-dedup) so
  // they stay stable on steady-state runs where few new jobs remain.
  const idf = buildIdf(options?.corpus ?? fetchedJobs);

  const fragments = config.titleContains ?? [];
  const titleGateActive = fragments.some((term) => !!term.trim());
  const titled = titleGateActive ? fetchedJobs.filter((job) => titleMatches(job.title, fragments, config.titleMatchMode)) : null;
  const titleSurvivors = titled ?? fetchedJobs;
  const gateActive = config.strictLocation && config.locations.length > 0;
  const unknownLocation = gateActive ? titleSurvivors.filter((job) => isUnknownLocation(job.location)).length : 0;
  const located = gateActive
    ? titleSurvivors.filter((job) => !isUnknownLocation(job.location) && locationMatches(job.location, config.locations))
    : null;

  const working = located ?? titleSurvivors;

  const scored: ScoredJob[] = working.map((job) => {
    const { score, components } = scoreJob(
      job,
      [...config.targetTitles, ...fragments],
      config.keywords,
      resumeSkills,
      config.locations,
      idf,
    );
    return { job, score, components };
  });

  const floorSurvivors = scored
    // A direct user-selected fragment is sufficient relevance evidence, even
    // when it is only part of a word (robot -> robotics).
    .filter((s) => titleGateActive || passesFloor(s.components))
    .sort((a, b) => b.score - a.score);

  // Term presence is not enough to be worth an LLM call — a single generic hit
  // clears the floor. Cut the weak tail by weighted score too. Fails open: idf
  // is corpus-relative, so a board where every job shares the user's terms
  // scores everything near zero, and dropping that whole run would be worse
  // than analyzing it.
  const strong = floorSurvivors.filter(
    (s) => s.score >= APP_CONSTANTS.ATS_MIN_PRERANK_SCORE,
  );
  const ranked = strong.length > 0 ? strong : floorSurvivors;

  const capped = ranked.slice(0, cap);

  return {
    toAnalyze: capped.slice(0, k),
    toSaveUnanalyzed: capped.slice(k),
    funnel: {
      deduped,
      titled: titled ? titled.length : null,
      unknownLocation,
      located: located ? located.length : null,
      floorSurvivors: floorSurvivors.length,
      scoreCut: floorSurvivors.length - ranked.length,
      relevant: capped.length,
    },
  };
}
