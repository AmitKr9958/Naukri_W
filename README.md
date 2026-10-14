# Naukri Job Watcher

A Windows-friendly Playwright job watcher for recent Naukri listings. It matches Power BI, BI, analytics, reporting, MIS, Power Platform, and Microsoft Fabric roles against a local resume; optionally evaluates the best candidates with an OpenAI-compatible AI endpoint; and sends qualified job links to Telegram.

## Safety and operating limits

- The watcher never submits job applications.
- It does not bypass CAPTCHA, MFA, bot checks, or site access controls. It uses the browser's default identity and security sandbox.
- If Naukri blocks a request or asks for verification, stop and complete verification manually. Do not try to defeat the challenge.
- Keep `.env`, `.naukri-profile/`, `state.json`, logs, and credentials out of Git.
- AI is opt-in. Review the privacy note and set `AI_CONSENT=true` before enabling it.
- Before AI analysis, the watcher redacts common email, phone, government-ID, salary/CTC, address, and postal-code patterns. Automated redaction is not perfect; review the resume and provider privacy terms before opting in.
- The machine and internet must stay available for the Windows Task Scheduler watcher to run. It is not a cloud-hosted 24/7 service.

## Windows setup

1. Install a currently supported Node.js version (22 or 24).
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Set `RESUME_PATH` to your local PDF, DOCX, or TXT resume. Configure your preferred locations and roles.
5. For AI, configure `AI_BASE_URL`, `AI_MODEL`, and `AI_API_KEY` as appropriate. Never put API keys in Git or share them in logs.
6. Run `npm run login` once and complete Naukri login interactively. The persistent profile is reused by the watcher.
7. Configure Telegram bot token and chat ID if you plan to use alerts.
8. Keep `DRY_RUN=true` during initial validation. Dry-run mode never sends Telegram messages or changes seen-job state.

## One-command local validation

After pulling the latest `main` branch, run the following from PowerShell in the project directory:

```powershell
.\scripts\validate-ready.ps1
```

The validation script checks the Node.js version, installs dependencies, syntax-checks every project JavaScript file, runs all automated tests, verifies local configuration and resume extraction, and runs an AI smoke test with synthetic data only when AI is enabled and consented. It does **not** open Naukri, search jobs, change `DRY_RUN`, or send Telegram messages.

For the complete first test in one step, use `scripts/test-once.ps1` instead. It runs all of the above, then starts exactly one Naukri dry-run cycle. It refuses to start unless `DRY_RUN=true`; it does not send Telegram messages or change seen-job state. It may take several minutes and requires a valid saved Naukri browser session. If Naukri blocks access or requests verification, stop and complete the challenge manually.

## Watcher settings

- `RUN_EVERY_MINUTES`: schedule interval; minimum 10 minutes.
- `JOB_MAX_AGE_HOURS`: maximum age for a job posting; default 6. Labels that say only "today" are treated as unknown and rejected because they cannot prove a listing is within six hours.
- `JOB_MIN_EXPERIENCE_YEARS`: reject listings whose explicit experience range ends below this value; default 5. Missing experience ranges are not automatically rejected.
- `JOB_LOCATIONS`: preferred cities.
- `JOB_ROLES` and `JOB_SEARCH_QUERIES`: roles to search and accept.
- `MIN_MATCH_SCORE`: minimum final score for an alert.
- `MAX_JOBS_PER_RUN`: maximum alerts in a cycle.
- `AI_CANDIDATE_LIMIT`: maximum candidates evaluated by AI per cycle.
- `MAX_PAGES_PER_SEARCH`: 1 or 2 pages per query/location.
- `SEARCH_CONCURRENCY`: requested browser tabs. **Safe mode currently enforces one active Naukri search at a time regardless of this setting**, because concurrent tabs can trigger CAPTCHA/security checks.
- `PAGE_DELAY_MS`: delay between search tasks. Runtime enforces at least 1500ms between tasks (default 1500ms); this reduces request bursts but cannot prevent or bypass a site-issued verification challenge.
- `JOB_SEARCH_BATCH_SIZE`: number of query categories to search each cycle; default 3. With six queries, the two batches alternate on consecutive cycles. Rotation is in-memory only (no cursor file is written), so a restarted watcher begins with the first batch again.
- Speed optimization: when one page per search is configured, the watcher skips redundant Freshness/Sort UI clicks because the direct URL already requests last-day results. The strict `JOB_MAX_AGE_HOURS` check remains enforced on extracted listings.

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
