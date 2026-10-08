# Naukri Hourly Job Watcher

Production-oriented Playwright worker that runs every hour, uses a persistent Naukri browser profile, discovers jobs posted in the last 6 hours, scores them against the local resume/profile, and sends high-confidence matches to Telegram.

## Important
- Does not auto-apply to jobs.
- Does not bypass CAPTCHA, MFA, bot checks, or access controls.
- Prefer a persistent authenticated browser session instead of storing a Naukri password.
- Keep .env and .naukri-profile out of Git.

## Windows
1. Create/clone to E:\naukri_W.
2. Install Node.js 20+.
3. npm install
4. npx playwright install chromium
5. Copy .env.example .env and configure Telegram plus resume path.
6. npm run login and complete Naukri login interactively.
7. Test with DRY_RUN=true.
8. Install scripts/install-task.ps1 for the hourly background task.

## Resume
RESUME_PATH can include an extension or omit it; common PDF/DOCX/TXT extensions are tried.

## Matching
Jobs older than 6 hours are rejected. Scoring uses role, skills, experience, location and recency. Duplicate jobs are suppressed.

## Telegram
Create a bot with BotFather, set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then run a dry test before enabling normal delivery.

## Linux/server
Mount or copy the resume to the server and set RESUME_PATH accordingly. Use systemd or another supervisor. Persistent browser state must remain on the host.

## Scheduling
The worker itself checks on an hourly cadence; Windows Task Scheduler adds process recovery/restart resilience.
