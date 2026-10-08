# Naukri Job Watcher

Production-oriented Playwright worker that runs on a configurable cadence while the Windows machine is on and connected, uses a persistent Naukri browser profile, discovers jobs posted in the last 6 hours, scores them against the local resume/profile, optionally uses AI as a second-stage evaluator, and sends the best matches to Telegram.

## Important
- Does not auto-apply to jobs.
- Does not bypass CAPTCHA, MFA, bot checks, or access controls.
- Prefer the persistent authenticated browser session after the first successful login.
- Optional automatic credential login is supported as a fallback when the session expires.
- Keep .env and .naukri-profile out of Git.
- The local machine must be on and connected to the internet for the worker to run.
- Frequent automated browsing can trigger site rate limits or bot protections. The watcher does not bypass those protections.

## Windows
1. Create or clone to E:\naukri_W.
2. Install Node.js 20+.
3. Run npm install.
4. Run npx playwright install chromium.
5. Copy .env.example to .env and configure Telegram plus resume path.
6. For the safest setup, run npm run login once and complete Naukri login interactively; the persistent session is then reused by the worker.
7. Optional automatic login fallback: set NAUKRI_AUTO_LOGIN=true, NAUKRI_USERNAME and NAUKRI_PASSWORD in the local .env. Never commit these values.
8. If Naukri requests OTP, CAPTCHA, security verification, or another interactive challenge, automatic login stops and npm run login must be used to complete it.
9. Test with DRY_RUN=true.
10. For production, set DRY_RUN=false and NAUKRI_HEADLESS=true, configure Telegram, and enable AI only after consent is recorded.
11. Run scripts/install-background.ps1 from an elevated PowerShell session.

## Matching
Jobs older than 6 hours are rejected. Scoring uses role, skills, location and recency. Duplicate jobs are suppressed. When AI is enabled, up to AI_CANDIDATE_LIMIT fresh unseen candidates (default 30) are evaluated, then only the top MAX_JOBS_PER_RUN matches (default 15) are sent to Telegram.

## Scheduling
RUN_EVERY_MINUTES controls the interval; the production example uses 30 minutes. Windows Task Scheduler starts the worker at logon and restarts it after process failures. 24/7 operation requires the Windows PC and internet connection to remain available.

## Telegram
Create a bot with BotFather, send /start to the bot, set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then test delivery before enabling normal delivery.

## AI matching and privacy
The AI is an optional second-stage evaluator using an OpenAI-compatible endpoint. Local 9Router is supported. Before AI analysis, resume and job text is redacted for email, phone, obvious IDs, salary/CTC, and address fields. AI consent is required. AI failure falls back to the deterministic score and does not stop the watcher.

## Validation
Run npm test
Run npm run lint
Run npm run ai-9router-test

Do not use npm audit fix --force; review dependency updates separately.