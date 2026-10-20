---
type: how-to
title: Automations
description: Setting up a scheduled ATS search over company job boards, filling in the filters and resume skills that make it return good matches, and handling the jobs it discovers.
feature: automations
tags: [automations, job search, scheduled search, greenhouse, lever, ashby, ats, company boards, watchlist, discovered jobs, match score, keywords, target titles, title fragments, strict title filter, location aliases, locations, resume skills, filters, notifications]
aliases: [automated job search, job discovery, scheduled job search, job scraper, run a search, discovered jobs]
status: stable
stale_after: 2027-09-30
---

# Automations

## What does an automation do?

An automation is a saved search that runs once a day and brings new job postings to you. It reads the public job boards of the companies you pick, drops the listings that have nothing to do with what you asked for, sends the most promising ones to your AI provider to be scored against one of your resumes, and saves the results as **discovered jobs** you can accept into your tracker or dismiss.

Choose employers using **Greenhouse**, **Lever**, **Ashby**, **Workday**, or **Company careers URL**. Each automation uses one source.

An automation needs an AI provider and model set under **Settings → AI Provider**, and a resume in your profile to match against.

## How do I create an automation?

Open **Automations** in the sidebar and click **Create Automation**. The wizard has six steps:

1. **Basics** — a name, and which source the companies use.
2. **Search** — the companies to track, then your filters: strict title fragments, target job titles, keywords/skills, locations, and how many listings get full AI analysis per run. This is the step that decides how useful the automation is; see the next two sections.
3. **Resume** — the resume every discovered job is scored against. Resumes with fewer than two sections are shown greyed out with an alert icon until you fill them in under **Profile**; an attached file does not count.
4. **Matching** — a match threshold. Only listings whose AI match score reaches it are saved; anything analyzed and scored below it is discarded.
5. **Schedule** — the hour of the day the automation runs (server time). Only one automation may occupy an hour, so hours already taken are marked **In use** and rejected.
6. **Review** — confirm and save.

At least one company is required. Everything else has a working default, but defaults alone will not give you good results.

If you have built a watchlist, the company picker in step 2 shows a **Watched** group at the top listing the companies you watch on that automation's job board, with an **Add all watched** button that selects them in one click. Only companies on the matching board appear — a watchlist spanning multiple providers contributes a different subset to each automation.

## Which companies can I track, and how many?

Track up to **25 companies** per automation. For Greenhouse, Lever and Ashby, search the built-in directory and select employers. The counter shows how many slots are used.

To add a company outside the directory, paste its board URL or token below the picker and press **+**. JobSync validates the board and adds a chip; remove it with **×**.

For **Workday**, paste a full careers URL, such as `https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite`. Locale-prefixed URLs and individual job links also work. Standard `myworkdayjobs.com` sites are supported; custom domains require their underlying Workday URL. No account or API key is needed.

Workday retrieves up to 2,000 listings per company and skips saved jobs. When strict title fragments are configured, known off-title listings are excluded before fetching descriptions. Incomplete titles are checked after fetching details. Final title and location checks always run before ranking and AI matching; location filtering waits for complete details. Description fetching has a three-minute deadline. Retrieval limits and failures are reported; successful descriptions are processed and closed postings skipped.

For **Company careers URL**, paste a public HTTPS job search URL. Google, Phenom (including BCG), Waymo, embedded ATS boards, and pages with structured JobPosting data are supported. Google/Phenom URL filters are preserved; ATS-backed sites require automation filters. Other pages need public structured descriptions and recognizable job links. Browser-only sites and Meta are unsupported. Custom pages retrieve up to 50 pages/1,000 jobs per company, with a 90-second search deadline; partial results and failures are reported. Narrow URL filters if limits are reached.

Under **Library → Companies**, browse directories or select **Workday**/**Company careers** to add URLs. Watched companies are available in the wizard.

Watching a company adds it to your Library. Linking an existing company requires confirmation. Unwatching preserves the company and its jobs.

## How do I set up filters so the automation returns good results?

The same filters work across all supported sources:

- **Title contains any of** — requires a title match. Add up to 20 fragments with Enter or +. **Partial text** matches `robot` in “Robotics Engineer.” **Whole word or phrase** matches `intern` in “Engineering Intern,” excluding “Internal Tools Engineer.” Matching ignores case, repeated spaces, and dash differences. Descriptions cannot satisfy this filter. Empty means unrestricted. Fragments stay in this automation.
- **Target job titles** — ranking preferences, e.g. `Frontend Engineer`; these do not require a title match.
- **Keywords / skills** — terms such as `React` or `Kubernetes`, matched against titles and full descriptions for ranking. Specific terms count more than generic ones.
- **Locations** — cities, states/provinces, or countries. Enable **Only show jobs in these locations** to enforce them; they do not affect ranking. Unknown locations are excluded and counted in the log. Remote jobs must also match; adding `Remote` permits remote jobs anywhere.

Multiple entries within either strict filter use OR; title and location filters must both pass. They apply before AI matching and additional unscored saves. Run History shows a **Title match** stage when enabled.

Country aliases work in both directions: United States / US / USA / U.S. / U.S.A.; Taiwan / TW / TWN / 台灣 / 臺灣 / 台湾; United Kingdom / UK / U.K. Country names are not inferred from cities: `United States` accepts “Austin, USA,” but not “Seattle, WA.” `CA` is not treated as Canada.

An explicit strict title match supplies relevance evidence even without keyword hits. Resume skills also contribute. The wizard warns when title fragments, target titles, and keywords are all empty; that search relies entirely on resume skills.

## Why does my matching resume need a skills section?

Skills from your resume's **Skills** section become extra ranking keywords alongside those entered in the wizard. They also reach the AI for match scoring, helping it assess relevant experience without you retyping each term.

Resume skills also become job tags when the posting's title or description mentions them. Each saved job gets at most ten tags, drawn only from your resume; a run never invents a new tag.

Write skills the way job ads do. A bracketed note is ignored, so **Angular (v10–14)** matches “Angular.” Combined labels such as **C# / .NET** or **Agile/Scrum** match poorly because postings rarely spell them that way. Enter those as separate skills for better ranking and tagging.

Under **Profile**, open the matching resume and click **Add Skills**. Use up to eight categories with twenty skills each, such as *Languages*, *Frameworks*, and *Cloud*.

Without resume skills, ranking relies on your title fragments, target titles, and keywords. Fill those in, or add a skills section, before expecting useful results.

## How many listings does each run analyze?

Two tiers. **Jobs analyzed per run** (the slider in the Search step, default 10, maximum 50) is how many top-ranked listings get a full AI match score. Higher means more coverage but slower and, on a paid provider, costlier runs.

**Save additional relevant listings** is on by default. With it on, relevant listings that did not make the cut are still saved, ranked but not yet AI-scored — they show a lexical relevance percentage and an **Analyze** button so you can score one on demand. Turn it off if you only want the scored shortlist.

Listings only reach AI analysis if they are related to your search strongly enough to be worth the call — clearing the relevance floor on a single generic word is not enough. Of the ones that are analyzed, only those meeting your match threshold are saved. So a run can fetch hundreds of listings and save none: the run log shows how many were skipped as too weakly related and how many were analyzed but fell below the threshold.

## When does it run, and can I run one now?

An automation runs daily at the hour you chose, in the server's timezone, as long as its status is **active**. Open an automation to run it immediately with **Run Now** — manual runs are limited to **5 per hour**. A run in progress can be stopped with **Abort Run**.

The automation's page has three tabs: **Logs** (live output from the current or most recent run), **Discovered Jobs**, and **Run History** (past runs with counts and timings).

## What do I do with a discovered job?

Every discovered job starts as **new**, with a due date three days from the day it was found — the same default as a job you add by hand, and accepting it keeps that date. Open the **Discovered Jobs** tab and, for each one, choose:

- **Accept** — copies it into your tracked jobs, where it behaves like any job you added by hand.
- **Dismiss** — marks it dismissed so it stops cluttering the list. It is not deleted.
- **Analyze** — appears on listings that were saved without an AI score, and scores one on demand.

Click a job to open its details, including the AI match breakdown and, for unscored listings, the relevance breakdown that explains which of your titles and keywords it hit. The **Status** filter in the header narrows the list to new, accepted or dismissed, and **Clear** removes discovered jobs in bulk.

## How do I pause, edit or delete an automation?

From the list, use the **⋮** menu on any automation; from its own page, use the buttons in the header. **Pause** stops the daily schedule without losing the automation or the jobs it found — **Resume** starts it again. **Edit** reopens the wizard with everything pre-filled, which is where you go to widen filters that are returning too little.

**Delete** removes the automation permanently, along with its runs and discovered jobs, after a confirmation. Accept anything you want to keep first.

If an automation shows **Resume missing**, the resume it matched against was deleted — edit it and pick a new one before it can run again.

## How do I know when a run finishes or a job board fails?

The bell in the header tells you: it shows a count of unread notifications, red when something failed. The same count appears on **Notifications** in the account menu.

Every finished run posts a summary of what it found, with a link to any new jobs; cancelled runs post nothing. A company board that could not be reached (removed, timed out or rate-limited) gets its own row, which comes back after each run until you fix it — **Edit watchlist** opens the automation's editor. If every board fails, the run is marked failed.

The **×** in the bell only hides a row, and **Clear all** hides every row at once; the Notifications page (**View all notifications**, or the account menu) still lists it. On the page, **×** and **Clear read** delete for good, after asking you to confirm. Notifications are kept for 30 days.
