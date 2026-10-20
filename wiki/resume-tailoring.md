---
type: how-to
title: LaTeX Resume Tailoring
description: Review job-specific changes to a separate LaTeX Git repository, build its PDF, and commit the selected version.
feature: profile
tags: [resume, latex, tailoring, optimization, git, branches, pdf, matching]
aliases: [optimize resume, tailor resume, Resume-CV]
status: stable
stale_after: 2027-10-13
---

# LaTeX Resume Tailoring

## How do I start a job-specific resume?

Open a saved job and select **Tailor LaTeX resume**. The job needs a complete description. Choose a base branch, normally `main`, the resume document, and a new job branch name such as `company/role`. Alternatively, select **Continue existing branch**.

JobSync captures committed source and the job posting. Uncommitted edits in your normal checkout are not included. Resume-CV remains a separate repository. The adapter supports flat `.tex` files, section composition, and reusable `\NewDocumentCommand` content macros used by the Resume-CV template.

## How do I review suggested changes?

Select **Analyze & suggest** to compile and match the baseline, then generate proposals. The two stages stream progress separately. The baseline score is saved before suggestions start, so a failed suggestion can be retried with **Suggest changes** without redoing matching. **Stop analysis** cancels the current request. Timeout messages identify the stage and provider/model. Suggestions request at most six concise edits with a larger output budget than matching. If the model hits that limit, incomplete JSON is discarded and the saved baseline remains available; retry **Suggest changes**. Deployment can adjust `RESUME_SUGGESTION_MAX_TOKENS` to suit the model server's context limit. Suggestions start unaccepted. Review the original content, edit the proposed LaTeX if needed, select **Use this change**, and confirm its factual claims.

The structure panel lets you rename or move sections, reorder entries within a section, select existing entries and starred/unstarred variants, and add sections. Existing variants can contain different facts and wording; inspect them before selecting. **Use AI-proposed structure** is a separate choice. You can also select a source block and edit it manually.

**Save draft** persists decisions. Changing the draft invalidates its PDF and candidate score. **Reload** replaces unsaved screen edits with the saved version. History retains earlier drafts and committed variants.

## How do I change my expected graduation date for a job?

After generating suggestions, use **Education graduation date**. The latest included degree is selected first; you can choose another included degree explicitly. Select **Full-time: Aug 2027** for `Expected Aug 2027`, **Internship: Dec 2027** for `Expected Dec 2027`, or type a custom date. Click **Apply graduation date**, then confirm its factual claims in **Content review** before saving or building.

The change belongs to the selected job draft and becomes part of that job branch when committed. The adapter preserves the earlier degree, the opposite starred/unstarred date, and the start of an existing date range. Rebuild and re-score after a date change. Generating AI suggestions comes before manual edits; matching keeps its original baseline for comparison.

## How do I preview, score, and export the result?

Select **Build preview**. JobSync compiles the selected source with your LaTeX template. Shared content changes also trigger a CV build when `CV_Winston.tex` exists. Review warnings, page count, and the PDF; successful compilation does not guarantee good layout.

**Re-score** compares the candidate against the captured posting using the same provider, model, and match prompt as the baseline. Scores are advisory. Baseline and candidate matching use `RESUME_MATCH_MAX_TOKENS` (default 4096, range 1024 to 32768), independently of the suggestion budget. **Review source changes** shows original and selected source side by side.

After reviewing the PDF and acknowledging warnings, **Commit & export** creates a local commit containing source and its matching PDF, then downloads it. Your normal checkout remains in place. Pushing and merging into `main` remain separate Git actions. If the target branch is checked out elsewhere, switch that checkout to another branch before committing through JobSync.

## What happens if the source changes during review?

Draft revisions prevent simultaneous tabs from overwriting each other. Git branch updates require the original parent commit to match. If the branch changes externally, start a fresh draft from its latest commit and review the changes again. This version detects conflicts; it does not automatically merge them.

Optimization history, source snapshots, and PDFs are included in JobSync backups. The external Git repository itself must be backed up separately.

## How is repository access configured?

The server uses `RESUME_REPO_PATH` and a comma-separated `RESUME_REPO_ALLOWED_EMAILS` list. Other accounts cannot access the repository or optimization files. Setup requires Git, Linux `prlimit`, pdfLaTeX, and the template's packages and fonts.

For Docker setup and repository mount permissions, see [the project README](https://github.com/Gsync/jobsync#latex-resume-tailoring). This feature uses a direct repository adapter; it does not add MCP tools yet.
