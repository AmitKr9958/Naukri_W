import {existsSync} from 'node:fs';
import {withRetry} from './retry.js';

async function getChromium() {
  const mod = await import('playwright');
  return mod.chromium;
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const slugify = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Rotate in memory only: no cursor file is written, including during dry-run.
// The counter advances once per search cycle, even if a cycle takes longer than expected.
let searchBatchRunCounter = 0;
export function selectSearchBatch(queries, batchSize = 3, batchIndex = 0) {
  const unique = [...new Set((queries || []).map(value => String(value).trim()).filter(Boolean))];
  if (!unique.length) return [];
  const requestedSize = Number(batchSize);
  const size = Number.isInteger(requestedSize) && requestedSize > 0 ? requestedSize : 3;
  if (size >= unique.length) return unique;
  const batchCount = Math.ceil(unique.length / size);
  const requestedIndex = Number(batchIndex);
  const normalizedIndex = Number.isInteger(requestedIndex)
    ? ((requestedIndex % batchCount) + batchCount) % batchCount
    : 0;
  return unique.slice(normalizedIndex * size, (normalizedIndex + 1) * size);
}

// Naukri changes result-card class names periodically. Keep legacy selectors and
// add resilient class/semantic fallbacks for current job listing cards.
// CSS-module classes (styles_*) and generic job-listing anchors are included
// because the site regularly renames the tuple wrappers.
const JOB_CARD_SELECTOR = [
  '.cust-job-tuple',
  '.srp-jobtuple-wrapper',
  '[data-job-id]',
  '[class*="jobtuple" i]',
  '[class*="job-tuple" i]',
  '[class*="styles_jlc" i]',
  '[class*="styles_job-tuple" i]',
  '[class*="styles_tuple" i]',
  'article:has(a[href*="job-listings-"])',
  'div:has(> a[href*="job-listings-"])',
  'li:has(a[href*="job-listings-"])'
].join(',');

/**
 * Normalize a recognized posting-age label into approximate age in hours.
 *
 * Rules (documented, conservative):
 * - "just now" / "moments ago" → 0
 * - "few minutes" → 0.25
 * - explicit N minutes/hours/days/weeks/months → converted to hours
 * - "today" → 23 (worst-case same calendar day; always ≤ 24h and therefore
 *   within a typical JOB_MAX_AGE_HOURS of 48, but never treated as brand-new)
 * - "yesterday" → 24
 * - unrecognized / empty → null (caller must NOT treat null as fresh)
 *
 * Never confuses experience ranges or contract durations with posting age;
 * those are filtered by normalizeAgeLabel before this function runs.
 */
export function parseAgeHours(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!s) return null;
  if (/just now|moments? ago/.test(s)) return 0;
  // "Today" means posted on the current calendar day (0–24h). Use a conservative
  // upper bound of 23 hours so the listing remains eligible under the default
  // 48-hour window while remaining distinguishable from "just now".
  if (/\btoday\b/.test(s)) return 23;
  if (/yesterday/.test(s)) return 24;
  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:minute|minutes|min|mins)\s*(?:ago)?/);
  if (m) return Number(m[1]) / 60;
  if (/few\s+(?:minute|minutes)/.test(s)) return 0.25;
  m = s.match(/(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs)\s*(?:ago)?/);
  if (m) return Number(m[1]);
  if (/few\s+(?:hour|hours)/.test(s)) return 3;
  // Require end-of-string after unit so experience/contract text is not age.
  m = s.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:day|days|d)(?:\s+ago)?\s*$/);
  if (m) return Number(m[1]) * 24;
  m = s.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:week|weeks|wk|wks)(?:\s+ago)?\s*$/);
  if (m) return Number(m[1]) * 168;
  m = s.match(/(\d+(?:\.\d+)?)\s*(?:month|months|mo)(?:\s+ago)?\s*$/);
  if (m) return Number(m[1]) * 720;
  return null;
}

// Normalize only a standalone age label. Strip common UI prefixes/separators
// but never accept a title/description such as "3 months contract" as posting age.
export function normalizeAgeLabel(value) {
  const label = String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[•·|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^posted\s*:?\s*/i, '')
    .trim();
  if (!/^(?:just now|moments? ago|few\s+(?:minutes?|hours?)(?:\s+ago)?|\d+(?:\.\d+)?\+?\s*(?:minutes?|mins?|hours?|hrs?|days?|d|weeks?|wks?|months?|mos?)\s+ago|yesterday|today)$/i.test(label)) return '';
  return label;
}

async function textFromFirst(card, selectors) {
  for (const selector of selectors) {
    const loc = card.locator(selector).first();
    if (await loc.count()) {
      const text = (await loc.innerText().catch(() => '')).trim();
      if (text) return text;
      const title = await loc.getAttribute('title').catch(() => null);
      if (title) return title.trim();
    }
  }
  return '';
}

function cleanUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, 'https://www.naukri.com').href.split('#')[0];
  } catch {
    return null;
  }
}

// Strip tracking/query parameters so duplicate links to the same job collapse
// to one stable URL. Keep the full path because Naukri embeds the job ID there.
export function canonicalJobUrl(href) {
  const cleaned = cleanUrl(href);
  if (!cleaned) return null;
  try {
    const url = new URL(cleaned);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.href;
  } catch {
    return null;
  }
}
// Count distinct job URLs, not every matching anchor in a card (title, company, and apply links may repeat).
export function countUniqueListingLinks(hrefs) {
  return new Set((hrefs || []).map(canonicalJobUrl).filter(Boolean)).size;
}

export function nextSearchPageUrl(currentUrl, links) {
  for (const item of links) {
    const href = typeof item === 'string' ? item : item?.href;
    const text = typeof item === 'string' ? '' : item?.text;
    if (text && !/^\s*next\s*$/i.test(text)) continue;
    const url = cleanUrl(href);
    if (url && url !== currentUrl) return url;
  }
  return null;
}

async function nextPageUrl(page, currentUrl) {
  const next = page.locator('a').filter({hasText: /^\s*next\s*$/i}).first();
  if (await next.count()) {
    const href = await next.getAttribute('href').catch(() => null);
    const url = cleanUrl(href);
    if (url && url !== currentUrl) return url;
  }
  return null;
}

export function findPostedText(raw, preferred) {
  // Only trust a standalone posting-age label. Parsing arbitrary lines can
  // mistake titles such as "Data Analyst (3 months Contract)" for job age.
  const candidates = [preferred, ...String(raw || '').split(/\n+/).map(x => x.trim())].filter(Boolean);
  for (const value of candidates) {
    const label = normalizeAgeLabel(value);
    if (label && (parseAgeHours(label) !== null || /\btoday\b/i.test(label))) return label;
  }
  return '';
}

/**
 * Only stop date-sorted pagination when all extracted ages support the decision.
 * Unknown ages are conservatively rejected as jobs, but they must not be
 * interpreted as evidence that later pages are also too old.
 */
export function shouldStopPaginationForOldPage({
  sortedByDate,
  unknownAgeCount = 0,
  newestAgeHours,
  allParsedOlderThanMax = false,
  maxAgeHours
}) {
  if (!sortedByDate || unknownAgeCount > 0) return false;
  return Boolean(
    allParsedOlderThanMax ||
    (newestAgeHours != null && newestAgeHours > maxAgeHours)
  );
}

// Remote jobs are only eligible when the listing itself mentions one of the configured target cities.
export function remoteJobMatchesPreferredLocation(job, locations = []) {
  const text = String([job?.title, job?.company, job?.location, job?.description].filter(Boolean).join(' ')).toLowerCase();
  const configured = locations.map(value => String(value).toLowerCase().replace(/[^a-z]/g, ''));
  const has = (names) => configured.some(value => names.includes(value));
  if (has(['delhi']) && /\bdelhi\b/.test(text)) return true;
  if (has(['gurgaon', 'gurugram']) && /\b(gurgaon|gurugram)\b/.test(text)) return true;
  if (has(['noida']) && /\bnoida\b/.test(text)) return true;
  if (has(['jaipur']) && /\bjaipur\b/.test(text)) return true;
  return false;
}

async function recognizedJobCardCount(page) {
  // Naukri has used both "job-listings-<slug>" and "job-listings/<slug>"
  // URL shapes. Count listing links first so unrelated wrappers/filters cannot
  // hide a valid results page just because an old card class is present.
  const linkSelectors = [
    'a[href*="job-listings-"]',
    'a[href*="job-listings"]',
    'a[href*="/job/"]',
    'a[href*="jobid="]',
    'a[href*="jd="]'
  ].join(',');
  const listingHrefs = await page.locator(linkSelectors)
    .evaluateAll(elements => elements.map(element => element.getAttribute('href')).filter(Boolean))
    .catch(() => []);
  const listingLinks = countUniqueListingLinks(listingHrefs);
  if (listingLinks) return listingLinks;

  // Fallback for layouts where card wrappers render before their anchors.
  const structured = await page.locator(JOB_CARD_SELECTOR).count().catch(() => 0);
  if (structured) return structured;

  // Text-based fallback: results header ("1 - 20 of 12488") or multiple
  // posted-age labels mean the listings are on the page even when selectors lag.
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 6000);
  if (/\b\d+\s*[-–]\s*\d+\s+of\s+\d+/i.test(body)) return 1;
  const ageHits = (body.match(/\b(?:just now|today|yesterday|\d+\s*(?:minute|min|hour|hr|day|week|month)s?\s*ago)\b/gi) || []).length;
  if (ageHits >= 2) return ageHits;
  return 0;
}

async function collectJobCards(page) {
  // Read all listing-card fields in one browser-side pass. The previous
  // implementation made hundreds of separate Playwright calls per results
  // page while climbing every link's ancestors.
  return page.evaluate(() => {
    const linkSelector = 'a[href*="job-listings-"],a[href*="job-listings"],a[href*="/job/"],a[href*="jobid="],a[href*="jd="]';
    const cardSelector = [
      '.cust-job-tuple','.srp-jobtuple-wrapper','[data-job-id]',
      '[class*="jobtuple" i]','[class*="job-tuple" i]',
      '[class*="styles_jlc" i]','[class*="styles_job-tuple" i]',
      '[class*="styles_tuple" i]','article:has(a[href*="job-listings-"])',
      'div:has(> a[href*="job-listings-"])','li:has(a[href*="job-listings-"])'
    ].join(',');
    const ageLine = value => {
      const label = String(value || '').replace(/\u00a0/g, ' ').replace(/[•·|]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^posted\s*:?\s*/i, '').trim();
      return /^(?:just now|moments? ago|few\s+(?:minutes?|hours?)(?:\s+ago)?|\d+(?:\.\d+)?\+?\s*(?:minutes?|mins?|hours?|hrs?|days?|d|weeks?|wks?|months?|mos?)\s+ago|yesterday|today)$/i.test(label);
    };
    const read = (card, href) => {
      if (!card || !href) return null;
      const raw = String(card.innerText || '').trim();
      // Accept cards even when the age label has not rendered yet; the caller
      // will mark age as unknown and apply the conservative freshness policy.
      if (raw.length < 12 || raw.length > 8000) return null;
      const first = selectors => {
        for (const selector of selectors) {
          const el = card.querySelector(selector);
          const value = String(el?.innerText || el?.getAttribute('title') || '').trim();
          if (value) return value;
        }
        return '';
      };
      const lines = raw.split(/\n+/).map(x => x.trim()).filter(Boolean);
      const title = first(['a[href*="job-listings"]','a[href*="/job/"]']) || lines[0] || '';
      // Require a plausible title so filter/pagination chrome is not treated as a job.
      if (!title || title.length < 3) return null;
      const preferredPosted = first(['.job-post-day','.job-posted-date','.job-posted','[class*="job-post-day"]','[class*="posted"]']);
      const hasAgeLabel = ageLine(preferredPosted) || lines.some(ageLine);
      const location = first(['.locWdth','.loc-wrap [title]','.location','.loc']);
      const company = first(['.comp-name','.companyInfo a','.companyInfo','.comp-name a']);
      const description = first(['.job-desc','.job-desc-container']) || raw;
      return {href,raw,title,preferredPosted,location,company,description,hasAgeLabel};
    };

    const output = [];
    const seen = new Set();
    for (const link of document.querySelectorAll(linkSelector)) {
      const href = link.getAttribute('href');
      if (!href) continue;
      let candidate = link;
      let found = null;
      for (let depth = 0; depth < 16 && candidate; depth++, candidate = candidate.parentElement) {
        found = read(candidate, href);
        if (found) break;
      }
      if (!found) continue;
      const key = new URL(href, location.href).pathname.replace(/\/$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(found);
    }

    // Fallback for cards where the posting-age label is in a wrapper that is
    // not an ancestor of the listing link.
    for (const card of document.querySelectorAll(cardSelector)) {
      const link = card.querySelector(linkSelector);
      if (!link) continue;
      const href = link.getAttribute('href');
      if (!href) continue;
      const key = new URL(href, location.href).pathname.replace(/\/$/, '');
      if (seen.has(key)) continue;
      const found = read(card, href);
      if (!found) continue;
      seen.add(key);
      output.push(found);
    }
    return output.slice(0, 100);
  }).catch(err => {
    console.warn(JSON.stringify({
      message: 'Browser-side job-card extraction failed',
      error: String(err?.message || err).slice(0, 300)
    }));
    return [];
  });
}

async function extractFreshCards(page, c) {
  const startedAt = Date.now();
  const fresh = [];
  let rejectedByFreshness = 0;
  let rejectedIncomplete = 0;
  let recognizedAgeCount = 0;
  let unknownAgeCount = 0;
  const diagnostics = [];
  const cards = await collectJobCards(page);
  const seenCardUrls = new Set();
  const parsedAges = [];
  const rawCardCount = cards.length;

  for (const entry of cards.slice(0, 50)) {
    const link = canonicalJobUrl(entry.href);
    if (!link || seenCardUrls.has(link)) continue;
    seenCardUrls.add(link);

    const raw = String(entry.raw || '');
    const lines = raw.split('\n').map(x => x.trim()).filter(Boolean);
    const title = String(entry.title || '').trim() || lines[0] || '';
    // Never invent a title; reject incomplete extractions instead.
    if (!title || title.length < 3) {
      rejectedIncomplete++;
      continue;
    }
    const preferredPosted = String(entry.preferredPosted || '').trim();
    const postedText = findPostedText(raw, preferredPosted);
    const ageHours = parseAgeHours(postedText);

    if (ageHours != null) {
      parsedAges.push(ageHours);
      recognizedAgeCount++;
    } else {
      unknownAgeCount++;
    }
    if (diagnostics.length < 5) {
      diagnostics.push({
        title: title.slice(0, 80),
        postedText: postedText || preferredPosted || 'NOT_FOUND',
        ageHours,
        agePolicy: ageHours == null ? 'unknown-rejected' : (ageHours > c.maxAgeHours ? 'too-old' : 'fresh')
      });
    }

    // Unknown posting age is never considered fresh (conservative policy).
    // "today" is normalized to 23h by parseAgeHours and therefore evaluated here.
    if (ageHours == null || ageHours > c.maxAgeHours) {
      rejectedByFreshness++;
      continue;
    }

    const location =
      String(entry.location || '').trim() ||
      lines.find(x => c.locations.some(l => x.toLowerCase().includes(l.toLowerCase()))) ||
      '';
    const company =
      String(entry.company || '').trim() ||
      lines.find(x => x !== title && x.length > 1 && !/^(save|apply|posted|\d+\s*(minute|min|hour|hr|day|days|d)\b)/i.test(x)) ||
      '';
    const description = String(entry.description || '').trim() || raw;

    fresh.push({title, company, location, description, url: link, ageHours, postedText});
  }

  const newestAgeHours = parsedAges.length ? Math.min(...parsedAges) : null;
  const oldestAgeHours = parsedAges.length ? Math.max(...parsedAges) : null;

  return {
    fresh,
    diagnostics,
    rejectedByFreshness,
    rejectedIncomplete,
    recognizedAgeCount,
    unknownAgeCount,
    extractedCardCount: rawCardCount,
    uniqueCards: seenCardUrls.size,
    uniqueJobs: seenCardUrls.size,
    parsedAges,
    newestAgeHours,
    oldestAgeHours,
    extractionMs: Date.now() - startedAt,
    allParsedOlderThanMax: parsedAges.length > 0 && parsedAges.every(age => age > c.maxAgeHours)
  };
}

function isAccessDeniedPage(title, body, url) {
  const t = String(title || '');
  const b = String(body || '').slice(0, 4000);
  const u = String(url || '');
  return (
    /access\s*denied/i.test(t) ||
    /access\s*denied/i.test(b) ||
    /you don.?t have permission to access/i.test(b) ||
    /errors\.edgesuite\.net/i.test(b) ||
    /reference\s*#\s*[\w.]+/i.test(b) && /permission/i.test(b)
  );
}

export async function assertNaukriReachable(page) {
  const title = await page.title().catch(() => '');
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 4000);
  const url = page.url();
  if (isAccessDeniedPage(title, body, url)) {
    throw new Error(
      'Naukri returned Access Denied (bot/edge protection). ' +
        'This is not a search-form bug — the real homepage never loaded. ' +
        'Fix: 1) Set NAUKRI_HEADLESS=false  2) Prefer system Chrome (default)  ' +
        '3) Run npm run login and complete any challenge manually in the opened window  ' +
        '4) If it keeps happening, delete the .naukri-profile folder and login again from your normal network. ' +
        `title=${JSON.stringify(title)} url=${url}`
    );
  }
}

async function launchContext(c) {
  const chromium = await getChromium();
  // Prefer installed Google Chrome — Chromium is blocked by Naukri/Akamai much more often.
  // Use the browser's real default user agent and security sandbox.
  // Do not disguise automation or bypass Naukri's access controls.
  const base = {
    headless: c.headless,
    viewport: {width: 1440, height: 900},
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata'
  };

  const isProfileLockError = err => {
    const msg = String(err?.message || err || '');
    return (
      /Target page, context or browser has been closed/i.test(msg) ||
      /exitCode=21/i.test(msg) ||
      /user data directory is already in use/i.test(msg) ||
      /SingletonLock/i.test(msg) ||
      /ProcessSingleton/i.test(msg)
    );
  };

  try {
    return await chromium.launchPersistentContext(c.profileDir, {
      ...base,
      channel: 'chrome'
    });
  } catch (e) {
    if (isProfileLockError(e)) {
      throw new Error(
        'Could not open the Naukri Chrome profile (likely locked by another Chrome/watcher process). ' +
          'Fix: 1) Stop any running naukri watcher / background task  ' +
          '2) Close all Chrome windows that used this profile  ' +
          '3) If needed, delete E:\\naukri_W\\.naukri-profile\\SingletonLock (and SingletonCookie/Socket) then retry  ' +
          '4) Prefer NAUKRI_HEADLESS=false and run: npm run login  ' +
          `profileDir=${c.profileDir} detail=${String(e?.message || e).slice(0, 300)}`
      );
    }

    // channel=chrome failed but Chrome may still be installed — try explicit path.
    const executablePath = resolveChromeExecutable();
    if (executablePath) {
      try {
        console.info(JSON.stringify({msg: 'Using system Chrome via executablePath', executablePath}));
        return await chromium.launchPersistentContext(c.profileDir, {...base, executablePath});
      } catch (ePath) {
        if (isProfileLockError(ePath)) {
          throw new Error(
            'Could not open the Naukri Chrome profile (likely locked by another Chrome/watcher process). ' +
              'Stop other watcher/Chrome processes, clear SingletonLock files, then retry. ' +
              `detail=${String(ePath?.message || ePath).slice(0, 300)}`
          );
        }
        console.warn(
          JSON.stringify({
            msg: 'System Chrome executablePath launch failed; falling back to Chromium',
            error: String(ePath?.message || ePath)
          })
        );
      }
    }

    // Last resort: bundled Chromium (more likely to hit Access Denied).
    console.warn(
      JSON.stringify({
        msg: 'System Chrome not available; falling back to Chromium (more likely to hit Access Denied)',
        error: String(e?.message || e)
      })
    );
    try {
      return await chromium.launchPersistentContext(c.profileDir, base);
    } catch (e2) {
      if (isProfileLockError(e2)) {
        throw new Error(
          'Browser profile is locked. Stop other watcher/Chrome processes using .naukri-profile, then retry. ' +
            `detail=${String(e2?.message || e2).slice(0, 300)}`
        );
      }
      throw e2;
    }
  }
}

export async function openNaukri(c) {
  const context = await launchContext(c);
  context.setDefaultTimeout(c.actionTimeoutMs);
  const page = context.pages()[0] || (await context.newPage());
  await withRetry(
    () => page.goto(c.naukriUrl, {waitUntil: 'domcontentloaded', timeout: c.navigationTimeoutMs}),
    {retries: c.maxRetries, delayMs: c.retryDelayMs}
  );
  await page.waitForTimeout(1500);
  await assertNaukriReachable(page);
  return {context, page};
}

async function dismissOverlays(page) {
  const selectors = [
    'button:has-text("Accept All")',
    'button:has-text("Accept")',
    'button:has-text("I Agree")',
    'button:has-text("Got it")',
    '[role="button"]:has-text("Got it")',
    '[aria-label="Close"]',
    '.cross',
    '.btn-close',
    '#close-popup',
    '.naukri-cookie-accept'
  ];

  for (const selector of selectors) {
    const control = page.locator(selector).first();
    if (await control.isVisible().catch(() => false)) {
      const clicked = await control.click({timeout: 2500}).then(() => true).catch(() => false);
      if (clicked) await page.waitForTimeout(500);
    }
  }

  // Naukri's current consent banner may render "Got it" as plain text inside
  // a clickable div. Click its nearest interactive ancestor using the page DOM.
  await page.evaluate(() => {
    const norm = value => String(value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
    const nodes = [...document.querySelectorAll('body *')];
    const gotIt = nodes.find(el => norm(el.textContent) === 'got it' && el.children.length === 0);
    if (!gotIt) return;
    let target = gotIt;
    for (let depth = 0; depth < 6 && target; depth++, target = target.parentElement) {
      const style = window.getComputedStyle(target);
      const interactive = target.matches('button,a,[role="button"],[tabindex="0"]') ||
        style.cursor === 'pointer' || typeof target.onclick === 'function';
      if (interactive) {
        target.click();
        return;
      }
    }
    gotIt.click();
  }).catch(() => {});

  await page.waitForTimeout(900);
}

async function findVisible(page, selectors) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count()) && (await loc.isVisible().catch(() => false))) return loc;
  }
  return null;
}

/**
 * Root-cause fix for openSearchForm:
 * Naukri's authenticated homepage often keeps the keyword/location fields collapsed
 * inside the global nav search bar (nI-gNb-sb*). The previous code only waited for
 * already-visible inputs and used a narrow set of expand selectors, so the real
 * runtime DOM (collapsed bar + React hydration) never exposed the fields.
 *
 * Strategy:
 * 1. Dismiss overlays
 * 2. Wait for the global search bar container
 * 3. Actively expand the bar (multiple click targets + click coordinates)
 * 4. Resolve keyword input via placeholder / aria / suggestor classes across main + frames
 * 5. Rich diagnostics if still missing
 */
async function expandSearchBar(page) {
  const expandSelectors = [
    '.nI-gNb-sb__main',
    '.nI-gNb-sb',
    '.nI-gNb-sb__expand',
    '[class*="nI-gNb-sb"]',
    'div[class*="search"][class*="bar"]',
    'button[aria-label="Search jobs here"]',
    '[aria-label="Search jobs here"]',
    '.nI-gNb-sb__icon-wrapper',
    'div.qsb',
    '#qsb'
  ];

  for (const sel of expandSelectors) {
    const el = page.locator(sel).first();
    if (await el.count()) {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({force: true}).catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  // Click near the top-center where the collapsed search placeholder usually sits
  try {
    const box = await page.locator('body').boundingBox();
    if (box) {
      await page.mouse.click(box.width * 0.45, Math.min(120, box.height * 0.12));
      await page.waitForTimeout(300);
    }
  } catch {}
}

async function collectInputDiagnostics(page) {
  return page
    .locator('input, textarea, [contenteditable="true"]')
    .evaluateAll(els =>
      els.slice(0, 20).map(e => ({
        tag: e.tagName,
        type: e.type || '',
        placeholder: e.placeholder || '',
        aria: e.getAttribute('aria-label') || '',
        name: e.name || '',
        id: e.id || '',
        className: String(e.className || '').slice(0, 80),
        visible: !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)
      }))
    )
    .catch(() => []);
}

async function findNaukriSearchInput(page, kind) {
  const patterns =
    kind === 'keyword'
      ? /keyword|designation|companies|skills|job title/i
      : /location|city|area/i;

  // Prefer Playwright semantic locators first (most stable)
  if (kind === 'keyword') {
    const byPh = page.getByPlaceholder(/keyword|designation|companies/i).first();
    if ((await byPh.count()) && (await byPh.isVisible().catch(() => false))) return byPh;
    const byAria = page.getByLabel(/keyword|designation|companies/i).first();
    if ((await byAria.count()) && (await byAria.isVisible().catch(() => false))) return byAria;
  } else {
    const byPh = page.getByPlaceholder(/location/i).first();
    if ((await byPh.count()) && (await byPh.isVisible().catch(() => false))) return byPh;
    const byAria = page.getByLabel(/location/i).first();
    if ((await byAria.count()) && (await byAria.isVisible().catch(() => false))) return byAria;
  }

  const exactSelectors =
    kind === 'keyword'
      ? [
          'input[placeholder*="keyword" i]',
          'input[placeholder*="designation" i]',
          'input[placeholder*="companies" i]',
          'input[aria-label*="keyword" i]',
          'input[aria-label*="designation" i]',
          'input.suggestor-input',
          '.nI-gNb-sb input[type="text"]',
          '.suggestor-input'
        ]
      : [
          'input[placeholder*="location" i]',
          'input[aria-label*="location" i]',
          'input.suggestor-input',
          '.nI-gNb-sb input[type="text"]',
          '.suggestor-input'
        ];

  const roots = [page, ...page.frames().filter(f => f !== page.mainFrame())];

  for (const root of roots) {
    for (const selector of exactSelectors) {
      const inputs = await root.locator(selector).all().catch(() => []);
      for (const input of inputs) {
        const visible = await input.isVisible().catch(() => false);
        // Accept attached inputs even if not yet "visible" after expand — try to focus them
        const placeholder = (await input.getAttribute('placeholder').catch(() => '')) || '';
        const aria = (await input.getAttribute('aria-label').catch(() => '')) || '';
        if (patterns.test(placeholder) || patterns.test(aria)) {
          if (!visible) {
            await input.scrollIntoViewIfNeeded().catch(() => {});
            await input.focus().catch(() => {});
          }
          return input;
        }
        // For suggestor-input without matching placeholder, still consider keyword first field
        if (kind === 'keyword' && /suggestor/i.test(selector) && visible) {
          if (!/experience|location/i.test(placeholder + ' ' + aria)) return input;
        }
      }
    }

    const inputs = await root.locator('input[type="text"],input:not([type]),input[type="search"]').all().catch(() => []);
    const visible = [];
    for (const input of inputs) {
      const isVis = await input.isVisible().catch(() => false);
      const placeholder = (await input.getAttribute('placeholder').catch(() => '')) || '';
      const aria = (await input.getAttribute('aria-label').catch(() => '')) || '';
      const name = (await input.getAttribute('name').catch(() => '')) || '';
      if (isVis) visible.push({input, placeholder, aria, name});
      if (patterns.test(placeholder) || patterns.test(aria) || patterns.test(name)) {
        return input;
      }
    }

    if (kind === 'keyword') {
      const candidate = visible.find(
        x => !/experience|location|exp/i.test(x.placeholder + ' ' + x.aria + ' ' + x.name)
      );
      if (candidate) return candidate.input;
    } else {
      const candidate = visible.find(x =>
        /location|city|area/i.test(x.placeholder + ' ' + x.aria + ' ' + x.name)
      );
      if (candidate) return candidate.input;
      // Often the second text input is location
      if (visible.length >= 2) return visible[1].input;
    }
  }
  return null;
}

async function openSearchForm(page, c) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await assertNaukriReachable(page);
  await dismissOverlays(page);

  // Give React / global-nav time to paint the search bar
  await page
    .waitForSelector('.nI-gNb-sb, .nI-gNb-sb__main, input.suggestor-input, input[placeholder*="keyword" i], [aria-label*="Search" i]', {
      timeout: Math.min(c.navigationTimeoutMs, 15000)
    })
    .catch(() => {});

  const deadline = Date.now() + Math.min(Math.max(c.navigationTimeoutMs, 20000), 35000);
  let lastExpand = 0;

  while (Date.now() < deadline) {
    const keyword = await findNaukriSearchInput(page, 'keyword');
    if (keyword) {
      await keyword.scrollIntoViewIfNeeded().catch(() => {});
      await keyword.focus().catch(() => {});
      return keyword;
    }

    // Expand at most every ~1s
    if (Date.now() - lastExpand > 900) {
      await expandSearchBar(page);
      lastExpand = Date.now();
    }

    await page.waitForTimeout(500);
  }

  const inputs = await collectInputDiagnostics(page);
  const url = page.url();
  const title = await page.title().catch(() => '');
  throw new Error(
    'Naukri search form is unavailable after expand attempts. ' +
      `url=${url} title=${JSON.stringify(title)} inputs=${JSON.stringify(inputs)}`
  );
}

async function fillNaukriField(field, value) {
  await field.scrollIntoViewIfNeeded().catch(() => {});
  await field.click({force: true}).catch(() => {});
  await field.fill('').catch(() => {});
  // Type character-by-character to trigger Naukri suggestor
  await field.pressSequentially(String(value), {delay: 40}).catch(async () => {
    await field.fill(value);
  });
  await pageWaitShort(field);
  // Accept first suggestion if dropdown appears
  await field.press('ArrowDown').catch(() => {});
  await field.press('Enter').catch(() => {});
}

async function pageWaitShort(field) {
  try {
    const page = field.page();
    await page.waitForTimeout(350);
  } catch {
    await new Promise(r => setTimeout(r, 350));
  }
}

async function selectSortByDate(page) {
  try {
    // 1) Native <select>
    const selects = page.locator('select');
    const selectCount = await selects.count().catch(() => 0);
    for (let i = 0; i < selectCount; i++) {
      const sel = selects.nth(i);
      const optionTexts = await sel.locator('option').allTextContents().catch(() => []);
      const dateOpt = optionTexts.find(o => /^\s*date\b/i.test(String(o).trim()));
      if (!dateOpt) continue;
      await sel.selectOption({label: dateOpt.trim()}).catch(async () => {
        await sel.selectOption({label: 'Date'}).catch(() => {});
      });
      await page.waitForTimeout(600);
      return true;
    }

    // 2) Open "Sort by" control then choose Date
    const triggerCandidates = [
      page.getByText(/Sort by\s*:?\s*(Recommended|Relevance|Date)?/i).first(),
      page.locator('[class*="sort" i]').filter({hasText: /sort/i}).first(),
      page.locator('button,div,span').filter({hasText: /^Sort by/i}).first()
    ];
    for (const trigger of triggerCandidates) {
      if (!(await trigger.count()) || !(await trigger.isVisible().catch(() => false))) continue;
      await trigger.click({force: true}).catch(() => {});
      await page.waitForTimeout(350);

      const dateOptions = [
        page.getByRole('option', {name: /^Date$/i}).first(),
        page.getByRole('menuitem', {name: /^Date$/i}).first(),
        page.locator('[role="option"],[role="menuitem"],li,button,a,div,span').filter({hasText: /^Date$/i}).first(),
        page.getByText(/^Date$/i).first()
      ];
      for (const date of dateOptions) {
        if ((await date.count()) && (await date.isVisible().catch(() => false))) {
          await date.click({force: true}).catch(() => {});
          await page.waitForTimeout(600);
          return true;
        }
      }
    }

    // 3) DOM fallback
    const clicked = await page.evaluate(() => {
      const visible = el => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const nodes = [...document.querySelectorAll('button,a,li,div,span,label,[role="option"],[role="menuitem"]')];
      const dateNode = nodes.find(el => visible(el) && /^\s*Date\s*$/i.test((el.textContent || '').trim()));
      if (dateNode) {
        dateNode.click();
        return true;
      }
      return false;
    }).catch(() => false);
    if (clicked) {
      await page.waitForTimeout(600);
      return true;
    }
  } catch {}
  return false;
}

async function selectFreshnessLastDay(page) {
  try {
    const directSelectors = () => [
      page.getByText(/^Last\s*1\s*day$/i).first(),
      page.getByText(/Last\s*1\s*day/i).first(),
      page.locator('label').filter({hasText: /Last\s*1\s*day/i}).first(),
      page.locator('[class*="filter" i], [class*="fresh" i]').getByText(/Last\s*1\s*day/i).first()
    ];

    for (const lastDay of directSelectors()) {
      if ((await lastDay.count()) && (await lastDay.isVisible().catch(() => false))) {
        await lastDay.click({force: true}).catch(() => {});
        await page.waitForTimeout(600);
        return true;
      }
    }

    const freshnessTriggers = [
      page.getByText(/^Freshness$/i).first(),
      page.getByText(/Freshness/i).first(),
      page.locator('[class*="filter" i]').filter({hasText: /Freshness/i}).first()
    ];
    for (const freshness of freshnessTriggers) {
      if (!(await freshness.count()) || !(await freshness.isVisible().catch(() => false))) continue;
      await freshness.click({force: true}).catch(() => {});
      await page.waitForTimeout(350);
      break;
    }

    for (const lastDay of directSelectors()) {
      if ((await lastDay.count()) && (await lastDay.isVisible().catch(() => false))) {
        await lastDay.click({force: true}).catch(() => {});
        await page.waitForTimeout(600);
        return true;
      }
    }

    const clicked = await page.evaluate(() => {
      const visible = el => {
        const r = el.getBoundingClientRect();
        const s = window.getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const nodes = [...document.querySelectorAll('label,button,a,li,div,span,input')];
      const target = nodes.find(el =>
        visible(el) && /last\s*1\s*day/i.test((el.textContent || el.getAttribute('aria-label') || '').trim())
      );
      if (target) {
        target.click();
        return true;
      }
      return false;
    }).catch(() => false);
    if (clicked) {
      await page.waitForTimeout(600);
      return true;
    }
  } catch {}
  return false;
}

function buildNaukriSearchUrl(query, locationLabel, maxAgeHours = 24) {
  const pathQ = slugify(query || 'jobs') || 'jobs';
  const pathL = slugify(locationLabel || '') || 'india';
  const u = new URL(`https://www.naukri.com/${pathQ}-jobs-in-${pathL}`);
  u.searchParams.set('k', String(query || '').trim());
  if (locationLabel) u.searchParams.set('l', String(locationLabel).trim());
  u.searchParams.set('nignbevent_src', 'jobsearchDeskGNB');
  // Match the site-side freshness window to the configured local age filter.
  const freshnessDays = Math.max(1, Math.min(30, Math.ceil(Number(maxAgeHours || 24) / 24)));
  u.searchParams.set('nDate', String(freshnessDays));
  return u.href;
}

function isNaukriHomepageUrl(url) {
  try {
    const parsed = new URL(url);
    const path = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
    return path === '/' && !parsed.searchParams.has('k');
  } catch {
    return false;
  }
}

async function runSearchFromHomepage(page, c, q, loc, attempt = 0) {
  // Production path: go straight to the search results URL.
  // Homepage form interaction is fragile (suggestors, overlays, SPA timing).
  const directUrl = buildNaukriSearchUrl(q, loc, c.maxAgeHours);
  console.info(JSON.stringify({
    search: q,
    location: loc || 'ALL',
    message: 'Opening Naukri search results URL',
    directUrl
  }));

  const settleMs = Math.min(Math.max(c.pageDelayMs, 250), 800);
  await withRetry(
    () => page.goto(directUrl, {waitUntil: 'domcontentloaded', timeout: c.navigationTimeoutMs}),
    {retries: Math.min(c.maxRetries, 2), delayMs: Math.min(c.retryDelayMs, 1500)}
  );
  await page.waitForTimeout(settleMs);
  await assertNaukriReachable(page);
  await dismissOverlays(page);

  // Parallel tabs sometimes land on a blank intermediate document; wait/reload once.
  let earlyBody = (await page.locator('body').innerText().catch(() => '')).trim();
  if (!earlyBody) {
    await page.waitForTimeout(Math.max(settleMs, 600));
    earlyBody = (await page.locator('body').innerText().catch(() => '')).trim();
    if (!earlyBody) {
      await page.reload({waitUntil: 'domcontentloaded', timeout: c.navigationTimeoutMs}).catch(() => {});
      await page.waitForTimeout(settleMs);
      await dismissOverlays(page);
    }
  }

  // If Naukri bounced us back to the homepage, retry once.
  if (isNaukriHomepageUrl(page.url()) && attempt < 1) {
    console.warn(JSON.stringify({
      search: q,
      location: loc || 'ALL',
      message: 'Search URL redirected to homepage; retrying once'
    }));
    await page.waitForTimeout(settleMs);
    return runSearchFromHomepage(page, c, q, loc, attempt + 1);
  }

  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 12000);
  if (/captcha|security verification|verify you are human|robot/i.test(body)) {
    throw new Error(
      'Naukri requires CAPTCHA/security verification. Complete it with npm run login, then restart the watcher.'
    );
  }
  if (/login|register/i.test(page.url()) && !/job/i.test(page.url())) {
    throw new Error('Naukri session expired during search. Automatic login did not restore the session.');
  }

  // Direct result URLs usually paint quickly — keep the wait short.
  await page
    .waitForSelector(
      `${JOB_CARD_SELECTOR},a[href*="job-listings"],a[href*="/job/"],.styles_jlc__main,[class*="styles_jlc" i],text=/Oops! Something went wrong/i,text=/\\d+\\s*[-–]\\s*\\d+\\s+of\\s+\\d+/i`,
      {timeout: 8000}
    )
    .catch(() => {});

  let resultCountAfterSubmit = await recognizedJobCardCount(page);
  if (!resultCountAfterSubmit) {
    await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
    await page.waitForTimeout(settleMs);
    resultCountAfterSubmit = await recognizedJobCardCount(page);
  }

  if (!resultCountAfterSubmit) {
    const retryBody = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1800);
    if (attempt < 1 && /cookie policy|privacy policy/i.test(retryBody) && /got it/i.test(retryBody)) {
      await dismissOverlays(page);
      await page.waitForTimeout(settleMs);
      console.warn(JSON.stringify({search:q,location:loc,attempt,message:'Cookie consent blocked result rendering; retrying search once'}));
      return runSearchFromHomepage(page,c,q,loc,attempt+1);
    }
    if (attempt < 1 && /\b\d+\s*[-–]\s*\d+\s+of\s+\d+/i.test(retryBody)) {
      console.warn(JSON.stringify({
        search: q,
        location: loc,
        attempt,
        message: 'Results header present but job cards not yet recognized; retrying search once'
      }));
      return runSearchFromHomepage(page, c, q, loc, attempt + 1);
    }
    const inputs = await collectInputDiagnostics(page);
    const title = await page.title().catch(() => '');
    const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1800);
    const pageUrl = page.url();
    const pageKind = /captcha|security verification|verify you are human|robot/i.test(body)
      ? 'verification-required'
      : /access denied|errors\.edgesuite\.net|permission to access/i.test(title + ' ' + body)
        ? 'access-denied'
        : /oops! something went wrong/i.test(body)
          ? 'naukri-error-page'
          : /no jobs found|did not find any jobs|no results/i.test(body)
            ? 'no-results'
            : 'unknown-results-page';
    throw new Error(
      'Naukri search returned no recognized job cards. ' +
      `pageKind=${pageKind} search=${JSON.stringify(q)} location=${JSON.stringify(loc)} ` +
      `title=${JSON.stringify(title)} url=${pageUrl} bodyExcerpt=${JSON.stringify(body)} ` +
      `inputs=${JSON.stringify(inputs)}`
    );
  }

  const resultBody = (await page.locator('body').innerText().catch(() => '')).slice(0, 12000);
  if (/Oops! Something went wrong/i.test(resultBody)) {
    throw new Error(
      'Naukri search returned its "Oops! Something went wrong" page even when submitted through the homepage search form.'
    );
  }

  // Prefer Naukri's real freshness UI only when the URL does not already carry the requested age window.
  // The strict local JOB_MAX_AGE_HOURS parser remains authoritative.
  let resultUrl = page.url();
  const alreadyHasNDate = /(?:^|[?&])(?:nDate|freshness)=\d+(?:&|$)/i.test(resultUrl);
  // Direct search URLs already request the configured age window. Avoid repeatedly opening
  // the Freshness UI on every tab unless the URL lacks that filter.
  let freshnessUiApplied = false;
  if (!alreadyHasNDate) {
    freshnessUiApplied = await selectFreshnessLastDay(page);
    if (!freshnessUiApplied) {
      try {
        const u = new URL(resultUrl);
        u.searchParams.set('nDate', '1');
        await page.goto(u.href, {waitUntil: 'domcontentloaded', timeout: c.navigationTimeoutMs});
        await page.waitForTimeout(Math.min(c.pageDelayMs, 500));
        resultUrl = page.url();
      } catch {}
    } else {
      resultUrl = page.url();
    }
  } else {
    resultUrl = page.url();
  }

  // Sort results by date before walking multiple pages, when Naukri exposes the control.
  const singlePageSearch = c.maxPagesPerSearch <= 1;
  const sortedByDate = singlePageSearch ? false : await selectSortByDate(page);
  const freshnessFilterApplied =
    freshnessUiApplied || /(?:^|[?&])(?:nDate|freshness)=\d+(?:&|$)/i.test(resultUrl);
  console.info(JSON.stringify({
    search: q,
    location: loc || 'ALL',
    sortedByDate,
    freshnessFilterApplied,
    maxAgeHours: c.maxAgeHours,
    freshnessParam: new URL(resultUrl).searchParams.get('nDate') || 'site-default',
    resultUrl
  }));
  return {url: resultUrl, sortedByDate};
}

export async function searchJobs(page, c) {
  const out = [];
  const seen = new Set();

  // Search all configured query categories over time, but only half per cycle.
  // The scheduler interval drives rotation; no cursor file is written in dry-run.
  const allSearchQueries = [...new Set((c.searchQueries || c.roles).map(x => String(x).trim()).filter(Boolean))];
  const activeBatchIndex = searchBatchRunCounter++;
  const searchQueries = selectSearchBatch(allSearchQueries, c.searchBatchSize, activeBatchIndex);
  // Gurgaon and Gurugram are the same target for this watcher; searching both
  // produces almost identical Naukri pages and wastes a full search cycle.
  const configuredLocations = c.locations.length ? [...c.locations] : [''];
  // Add a separate Remote search; remote results are gated below against the preferred cities.
  if (!configuredLocations.some(loc => /^remote$/i.test(String(loc).trim()))) configuredLocations.push('Remote');
  const searchLocations = [...new Map(configuredLocations.map(loc => {
    const key = String(loc).toLowerCase().replace(/[^a-z0-9]/g, '');
    const canonical = key === 'gurugram' ? 'gurgaon' : key;
    return [canonical, loc];
  })).values()];

  const tasks = [];
  for (const q of searchQueries) {
    for (const loc of searchLocations) {
      tasks.push({q, loc});
    }
  }

  // Naukri is already challenging this account. Run only one search at a time,
  // even if an old .env still requests 5 tabs. This is a conservative pacing
  // measure, not a CAPTCHA bypass; verification still requires a human.
  const requestedConcurrency = Math.max(1, Math.min(Number(c.searchConcurrency) || 1, 5));
  const concurrency = 1;
  const context = page.context();
  console.info(JSON.stringify({
    message: 'Sequential search starting (safe mode)',
    tabs: concurrency,
    requestedConcurrency,
    concurrencyCapReason: 'Naukri security verification risk',
    tasks: tasks.length,
    queries: searchQueries,
    totalConfiguredQueries: allSearchQueries.length,
    queryBatchSize: c.searchBatchSize,
    queryBatchIndex: allSearchQueries.length > searchQueries.length
      ? activeBatchIndex % Math.ceil(allSearchQueries.length / Math.max(1, Number(c.searchBatchSize) || 3))
      : 0,
    locations: searchLocations
  }));

  async function runOneSearch(tab, q, loc) {
    const jobs = [];
    const searchResult = await runSearchFromHomepage(tab, c, q, loc);
    let url = searchResult.url;
    const sortedByDate = searchResult.sortedByDate;
    console.info(JSON.stringify({
      search: q,
      location: loc || 'ALL',
      sortedByDate,
      maxAgeHours: c.maxAgeHours,
      message: 'Search result page ready'
    }));
    const visitedPages = new Set();

    for (let pageNo = 1; pageNo <= c.maxPagesPerSearch && url; pageNo++) {
      if (visitedPages.has(url)) break;
      visitedPages.add(url);

      const body = (await tab.locator('body').innerText().catch(() => '')).slice(0, 12000);
      if (/captcha|security verification|verify you are human|robot/i.test(body)) {
        throw new Error(
          'Naukri requires CAPTCHA/security verification. Complete it with npm run login, then restart the watcher.'
        );
      }
      if (/login|register/i.test(tab.url()) && !/job/i.test(tab.url())) {
        throw new Error('Naukri session expired during search. Automatic login did not restore the session.');
      }

      // initialUniqueListingLinks: unique job URLs before any scroll/retry (diagnostic only)
      const initialUniqueListingLinks = await recognizedJobCardCount(tab);
      let cards = initialUniqueListingLinks;
      if (!cards) {
        await tab.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
        // Bounded wait for progressive rendering — not an arbitrary long sleep.
        await tab.waitForTimeout(Math.min(Math.max(Number(c.pageDelayMs) || 600, 400), 900));
        cards = await recognizedJobCardCount(tab);
      }
      if (!cards) {
        console.warn(JSON.stringify({
          search: q,
          location: loc || 'ALL',
          page: pageNo,
          pageUrl: tab.url(),
          validResultsPage: false,
          initialUniqueListingLinks: 0,
          finalUniqueListingLinks: 0,
          extractedCardCount: 0,
          uniqueJobs: 0,
          retryCount: 0,
          message: 'No Naukri job cards or job-listing links found after homepage form search'
        }));
        break;
      }

      let extracted = await extractFreshCards(tab, c);
      let retryCount = 0;
      // Retry only when listing links exist but zero usable cards were extracted
      // (common while Naukri finishes progressive rendering). Single bounded retry.
      if (cards > 0 && extracted.uniqueCards === 0) {
        retryCount = 1;
        console.warn(JSON.stringify({
          search: q,
          location: loc || 'ALL',
          page: pageNo,
          pageUrl: tab.url(),
          initialUniqueListingLinks,
          recognizedListingLinks: cards,
          extractedCardCount: extracted.extractedCardCount,
          uniqueJobs: extracted.uniqueCards,
          retryCount,
          message: 'Listing links found but no cards extracted; waiting and retrying extraction once'
        }));
        await tab.evaluate(() => window.scrollBy(0, 400)).catch(() => {});
        await tab.waitForTimeout(Math.min(Math.max(Number(c.pageDelayMs) || 700, 500), 1200));
        extracted = await extractFreshCards(tab, c);
      }
      // Recount after extraction/retry: Naukri may hydrate cards after the first link probe.
      cards = await recognizedJobCardCount(tab);
      const finalUniqueListingLinks = cards;
      const isRemoteSearch = /^remote$/i.test(String(loc).trim());
      const eligibleFresh = isRemoteSearch
        ? extracted.fresh.filter(job => remoteJobMatchesPreferredLocation(job, c.locations))
        : extracted.fresh;
      const rejectedByRemoteLocation = extracted.fresh.length - eligibleFresh.length;

      const pageMetrics = {
        search: q,
        location: loc || 'ALL',
        page: pageNo,
        pageUrl: tab.url(),
        validResultsPage: finalUniqueListingLinks > 0 || extracted.uniqueCards > 0,
        initialUniqueListingLinks,
        finalUniqueListingLinks,
        // Backward-compatible aliases used by earlier diagnostics on this branch
        initialRecognizedListingLinks: initialUniqueListingLinks,
        recognizedListingLinks: finalUniqueListingLinks,
        extractedCardCount: extracted.extractedCardCount,
        uniqueJobs: extracted.uniqueCards,
        uniqueCards: extracted.uniqueCards,
        retryCount,
        retryOutcome: retryCount === 0 ? 'none' : (extracted.uniqueCards > 0 ? 'recovered' : 'still-empty'),
        recognizedAgeCount: extracted.recognizedAgeCount,
        unknownAgeCount: extracted.unknownAgeCount,
        rejectedByFreshness: extracted.rejectedByFreshness,
        rejectedIncomplete: extracted.rejectedIncomplete,
        freshnessQualifiedCards: extracted.fresh.length,
        rejectedByRemoteLocation,
        freshCards: eligibleFresh.length,
        finalMatchesOnPage: eligibleFresh.length,
        extractionMs: extracted.extractionMs,
        newestAgeHours: extracted.newestAgeHours,
        oldestAgeHours: extracted.oldestAgeHours,
        maxAgeHours: c.maxAgeHours
      };

      if (!eligibleFresh.length) {
        console.warn(JSON.stringify({
          ...pageMetrics,
          diagnostics: extracted.diagnostics,
          message: 'No freshness-qualified eligible jobs on this page'
        }));
      }
      console.info(JSON.stringify(pageMetrics));

      for (const job of eligibleFresh) jobs.push(job);

      if (shouldStopPaginationForOldPage({
        sortedByDate,
        unknownAgeCount: extracted.unknownAgeCount,
        newestAgeHours: extracted.newestAgeHours,
        allParsedOlderThanMax: extracted.allParsedOlderThanMax,
        maxAgeHours: c.maxAgeHours
      })) {
        console.info(JSON.stringify({
          search: q,
          location: loc || 'ALL',
          page: pageNo,
          message: 'Stopping pagination — date-sorted page is older than the freshness window.',
          newestAgeHours: extracted.newestAgeHours,
          maxAgeHours: c.maxAgeHours,
          sortedByDate
        }));
        break;
      }

      // Respect the configured page cap for both date-sorted and ordinary searches.
      const pageCap = c.maxPagesPerSearch;
      const next = pageNo < pageCap ? await nextPageUrl(tab, url) : null;
      if (!next) break;
      await tab.goto(next, {waitUntil: 'domcontentloaded', timeout: c.navigationTimeoutMs});
      await tab.waitForTimeout(Math.min(Math.max(Number(c.pageDelayMs) || 1500, 1500), 5000));
      url = tab.url();
    }
    return jobs;
  }

  // Worker pool: reuse tabs across tasks.
  let cursor = 0;
  let failedTasks = 0;
  let verificationRequired = false;
  async function worker(workerId) {
    const tab = workerId === 0 ? page : await context.newPage();
    tab.setDefaultTimeout(c.actionTimeoutMs);
    try {
      while (true) {
        if (verificationRequired) break;
        const idx = cursor++;
        if (idx >= tasks.length) break;
        const {q, loc} = tasks[idx];
        try {
          const jobs = await runOneSearch(tab, q, loc);
          for (const job of jobs) {
            if (!seen.has(job.url)) {
              seen.add(job.url);
              out.push(job);
            }
          }
        } catch (err) {
          failedTasks++;
          const error = String(err?.message || err);
          if (/CAPTCHA|security verification|verify you are human/i.test(error)) {
            verificationRequired = true;
            console.warn(JSON.stringify({
              search: q,
              location: loc || 'ALL',
              message: 'Human verification required; stopping queued searches for this cycle',
              error: error.slice(0, 400)
            }));
          } else {
            console.warn(JSON.stringify({
              search: q,
              location: loc || 'ALL',
              message: 'Search combo failed',
              error: error.slice(0, 400)
            }));
          }
        }
        // Pace requests between search tasks, even when a user has configured
        // multiple tabs. This reduces bursts; it does not bypass site controls.
        if (!verificationRequired) {
          const taskDelayMs = Math.min(Math.max(Number(c.pageDelayMs) || 1500, 1500), 5000);
          await tab.waitForTimeout(taskDelayMs).catch(() => {});
        }
      }
    } finally {
      if (workerId !== 0) await tab.close().catch(() => {});
    }
  }

  await Promise.all(Array.from({length: Math.min(concurrency, tasks.length)}, (_, i) => worker(i)));
  if (verificationRequired) {
    throw new Error('Naukri requires manual CAPTCHA/security verification. Remaining queued searches were stopped; run npm run login, complete verification manually, then retry.');
  }
  if (tasks.length > 0 && failedTasks === tasks.length) {
    throw new Error(`All ${tasks.length} Naukri search combinations failed. Review the preceding search diagnostics; no jobs were returned.`);
  }
  return out;
}

