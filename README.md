# Naukri Job Watcher

A Windows-friendly Playwright job watcher for recent Naukri listings. It matches Power BI, BI, analytics, reporting, MIS, Power Platform, and Microsoft Fabric roles against a local resume using deterministic rule-based scoring only; and can send qualified job links to Telegram.

## Safety and operating limits

- The watcher never submits job applications.
- It does not bypass CAPTCHA, MFA, bot checks, or site access controls. It uses the browser's default identity and security sandbox.
- If Naukri blocks a request or asks for verification, stop and complete verification manually. Do not try to defeat the challenge.
- Keep `.env`, `.naukri-profile/`, `state.json`, logs, and credentials out of Git.
- The machine and internet must stay available for the Windows Task Scheduler watcher to run. It is not a cloud-hosted 24/7 service.

## Windows setup

1. Install a currently supported Node.js version (22 or 24).
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `RESUME_PATH` to your local PDF, DOCX, or TXT resume. Configure your preferred locations and roles.
5. No AI provider or model configuration is needed; matching and scoring run locally in JavaScript.
6. Run `npm run login` once and complete Naukri login interactively. The persistent profile is reused by the watcher.
7. Configure Telegram bot token and chat ID if you plan to use alerts.
8. Keep `DRY_RUN=true` during initial validation. Dry-run mode never sends Telegram messages or changes seen-job state.

## One-command local validation

After pulling the latest `main` branch, run the following from PowerShell in the project directory:

```powershell
.\scripts\validate-ready.ps1
```

The validation script checks the Node.js version, installs dependencies, syntax-checks every project JavaScript file, runs all automated tests, and verifies local configuration and resume extraction. It does not call an AI model. It does **not** open Naukri, search jobs, change `DRY_RUN`, or send Telegram messages.

For the complete first test in one step, use `scripts/test-once.ps1` instead. It runs all of the above, then starts exactly one Naukri dry-run cycle. It refuses to start unless `DRY_RUN=true`; it does not send Telegram messages or change seen-job state. It may take several minutes and requires a valid saved Naukri browser session. If Naukri blocks access or requests verification, stop and complete the challenge manually.

## Watcher settings

- `RUN_EVERY_MINUTES`: schedule interval; minimum 10 minutes.
- `JOB_MAX_AGE_HOURS`: maximum age for a job posting; default 48 hours. Labels that say only "today" remain unknown and are rejected because the watcher requires a parseable posting age.
- `JOB_MIN_EXPERIENCE_YEARS`: reject listings whose explicit experience range ends below this value; default 5. Missing experience ranges are not automatically rejected.
- `JOB_LOCATIONS`: preferred cities.
- `JOB_ROLES` and `JOB_SEARCH_QUERIES`: roles to search and accept.
- `MIN_MATCH_SCORE`: minimum final score for an alert.
- `MAX_JOBS_PER_RUN`: maximum alerts in a cycle.
- `AI_CANDIDATE_LIMIT`: maximum candidates evaluated by AI per cycle.
- `MAX_PAGES_PER_SEARCH`: 1-10 pages per query/location; default 5. The watcher follows Naukri's real Next link, stops on repeated URLs, and pauses at least 1500ms between page navigations.
- `SEARCH_CONCURRENCY`: requested browser tabs. **Safe mode currently enforces one active Naukri search at a time regardless of this setting**, because concurrent tabs can trigger CAPTCHA/security checks.
- `PAGE_DELAY_MS`: delay between search tasks. Runtime enforces at least 1500ms between tasks (default 1500ms); this reduces request bursts but cannot prevent or bypass a site-issued verification challenge.
- `JOB_SEARCH_BATCH_SIZE`: number of query categories to search each cycle; default 1 for conservative operation. Each query is searched across configured locations and may visit up to five pages per location. With six queries, one category rotates per cycle. Rotation is in-memory only, so a restarted watcher begins with the first batch again. This lowers the number of requests in a single cycle; it cannot guarantee Naukri will not request verification.
- The Naukri URL freshness filter is derived from `JOB_MAX_AGE_HOURS` (rounded up to whole days), and the local age parser remains authoritative. Multi-page searches attempt to sort by date where Naukri exposes that control and stop when a date-sorted page is outside the freshness window.

The watcher reports candidate titles before role filtering, scoring results, AI failures, and search diagnostics. If every search combination fails, the run now reports a failure instead of silently presenting an empty result as a successful search.

## Background operation

After the first manual dry-run is reviewed and Telegram delivery is verified separately, `scripts/install-background.ps1` can install a Windows Scheduled Task that starts at logon. The computer must remain powered on and connected to the internet. Do not run the production-enabling script until the dry-run, Naukri session, AI (if enabled), and Telegram checks are satisfactory.

## Useful commands

- `npm test` — automated regression tests.
- `npm run lint` — syntax-check all JavaScript under `src`, `scripts`, `test`, and `tests`.
- `npm run preflight` — validate local configuration and load the resume without starting a browser.
- `scripts/test-once.ps1` — complete validation plus one guarded end-to-end Naukri dry-run.
- `npm run ai-smoke-test` — test the configured AI endpoint with synthetic data only.
- `npm run telegram-test` — check Telegram configuration/delivery; this is separate from the dry-run validation.
- `npm run ai-9router-test` — checks the local 9Router service; it requires that service to be running locally.

Do not use `npm audit fix --force`; review dependency changes separately.
