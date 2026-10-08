# Naukri Job Watcher

Production-oriented Playwright worker that runs every 10 minutes while the Windows machine is on and connected, uses a persistent Naukri browser profile, discovers jobs posted in the last 6 hours, scores them against the local resume/profile, optionally uses AI as a second-stage evaluator, and sends the best matches to Telegram.

## Important
- Does not auto-apply to jobs.
- Does not bypass CAPTCHA, MFA, bot checks, or access controls.
- Prefer a persistent authenticated browser session instead of storing a Naukri password.
- Keep .env and .naukri-profile out of Git.
- The local machine must be on and connected to the internet for the worker to run.
- A 10-minute cadence is technically supported, but frequent automated browsing can trigger site rate limits or bot protections. The watcher does not bypass those protections.

## Windows
1. Create or clone to E:\naukri_W.
2. Install Node.js 20+.
3. Run npm install.
4. Run npx playwright install chromium.
5. Copy .env.example to .env and configure Telegram plus resume path.
6. Run npm run login and complete Naukri login interactively.
7. Test with DRY_RUN=true.
8. For production, set DRY_RUN=false and NAUKRI_HEADLESS=true, configure Telegram, and enable AI only after consent is recorded.
9. Run scripts/install-background.ps1 from an elevated PowerShell session.

## Matching
Jobs older than 6 hours are rejected. Scoring uses role, skills, location and recency. Duplicate jobs are suppressed. When AI is enabled, up to AI_CANDIDATE_LIMIT fresh unseen candidates (default 30) are evaluated, then only the top MAX_JOBS_PER_RUN matches (default 15) are sent to Telegram.

## Scheduling
RUN_EVERY_MINUTES=10 means a new run approximately every 10 minutes. Windows Task Scheduler starts the worker at logon and restarts it after process failures. 24/7 operation requires the Windows PC and internet connection to remain available.

## Telegram
Create a bot with BotFather, send /start to the bot, set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then test delivery before enabling normal delivery.

## AI matching and privacy
The AI is an optional second-stage evaluator using an OpenAI-compatible endpoint. Local 9Router is supported. Before AI analysis, resume and job text is redacted for email, phone, obvious IDs, salary/CTC, and address fields. AI consent is required. AI failure falls back to the deterministic score and does not stop the watcher.

## Validation
Run npm test
Run npm run lint
Run npm run ai-9router-test

Do not use npm audit fix --force; review dependency updates separately.