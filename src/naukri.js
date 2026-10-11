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

export function parseAgeHours(raw) {
  const s = String(raw || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!s) return null;
  if (/just now|moments? ago|today/.test(s)) return 0;
  if (/yesterday/.test(s)) return 24;
  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:minute|minutes|min|mins)\s*(?:ago)?/);
  if (m) return Number(m[1]) / 60;
  if (/few\s+(?:minute|minutes)/.test(s)) return 0.25;
  m = s.match(/(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs)\s*(?:ago)?/);
  if (m) return Number(m[1]);
  if (/few\s+(?:hour|hours)/.test(s)) return 3;
  m = s.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:day|days|d)\s*(?:ago)?/);
  if (m) return Number(m[1]) * 24;
  m = s.match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:week|weeks|wk|wks)\s*(?:ago)?/);
  if (m) return Number(m[1]) * 168;
  m = s.match(/(\d+(?:\.\d+)?)\s*(?:month|months|mo)\s*(?:ago)?/);
  if (m) return Number(m[1]) * 720;
  return null;
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

function findPostedText(raw, preferred) {
  const candidates = [preferred, ...String(raw || '').split(/\n+/).map(x => x.trim())].filter(Boolean);
  for (const value of candidates) {
    if (parseAgeHours(value) !== null) return value;
  }
  return '';
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
  const listingLinks = await page.locator(linkSelectors).count().catch(() => 0);
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

async function collectJobCardLocators(page) {
  // Bind each result card to the exact listing URL that identified it. Naukri
  // nests several links inside cards, so rediscovering the first link later can
  // assign a different job URL to the card and lose valid listings.
  const structured = await page.locator(JOB_CARD_SELECTOR).all();
  // Prefer the canonical job-listings path; also accept /job/ deep links and id params.
  const links = await page
    .locator('a[href*="job-listings-"],a[href*="job-listings"],a[href*="/job/"],a[href*="jobid="],a[href*="jd="]')
    .all();
  const cards = [];
  const seen = new Set();

  for (const link of links) {
    const rawHref = await link.getAttribute('href').catch(() => null);
    const url = canonicalJobUrl(rawHref);
    if (!url || seen.has(url)) continue;

    let candidate = link;
    let best = null;
    let bestText = '';
    // Select the smallest ancestor containing both useful card text and posted age.
    for (let depth = 0; depth < 10; depth++) {
      const raw = (await candidate.innerText().catch(() => '')).trim();
      const age = parseAgeHours(findPostedText(raw, ''));
      if (raw.length >= 35 && raw.length <= 3500 && age !== null) {
        best = candidate;
        bestText = raw;
        break;
      }
      const parent = candidate.locator('xpath=..');
      if (!(await parent.count().catch(() => 0))) break;
      candidate = parent;
    }
    if (!best) continue;
    seen.add(url);
    cards.push({card: best, url, cardText: bestText});
  }

  // Supplement links whose posted-age label is outside their immediate ancestry.
  // Some current Naukri cards expose the date only in a legacy wrapper.
  for (const card of structured) {
    const raw = (await card.innerText().catch(() => '')).trim();
    if (raw.length < 35 || raw.length > 3500 || parseAgeHours(findPostedText(raw, '')) === null) continue;
    const anchors = await card.locator('a[href]').all();
    let url = null;
    for (const anchor of anchors) {
      const href = await anchor.getAttribute('href').catch(() => null);
      if (/job-listings|\/job\//i.test(String(href || ''))) {
        url = canonicalJobUrl(href);
        if (url) break;
      }
    }
    if (!url || seen.has(url)) continue;
    seen.add(url);
    cards.push({card, url, cardText: raw});
  }
  return cards;
}
async function extractFreshCards(page, c) {
  const fresh = [];
  let rejectedByFreshness = 0;
  const diagnostics = [];
  const cards = await collectJobCardLocators(page);
  const seenCardUrls = new Set();
  let parsedAges = [];

  for (const entry of cards.slice(0, 50)) {
    const card = entry.card;
    const raw = entry.cardText || await card.innerText().catch(() => '');
    const link = entry.url;
    if (!link || seenCardUrls.has(link)) continue;
    seenCardUrls.add(link);

    const lines = raw.split('\n').map(x => x.trim()).filter(Boolean);
    const titleAnchor = card.locator('a[href*="job-listings"],a[href*="/job/"]').first();
    const title = (await titleAnchor.innerText().catch(() => '')).trim() || lines[0] || '';
    const preferredPosted = await textFromFirst(card, [
      '.job-post-day',
      '.job-posted-date',
      '.job-posted',
      '[class*="job-post-day"]',
      '[class*="posted"]'
    ]);
    const postedText = findPostedText(raw, preferredPosted);
    const ageHours = parseAgeHours(postedText);

    if (ageHours != null) parsedAges.push(ageHours);
    if (diagnostics.length < 5) {
      diagnostics.push({title, postedText: postedText || preferredPosted || 'NOT_FOUND', ageHours});
    }

    // Unknown posting age is never considered fresh.
    if (ageHours == null || ageHours > c.maxAgeHours) {
      rejectedByFreshness++;
      continue;
    }

    const location =
      (await textFromFirst(card, ['.locWdth', '.loc-wrap [title]', '.location', '.loc'])) ||
      lines.find(x => c.locations.some(l => x.toLowerCase().includes(l.toLowerCase()))) ||
      '';
    const company =
      (await textFromFirst(card, ['.comp-name', '.companyInfo a', '.companyInfo', '.comp-name a'])) ||
      lines.find(x => x !== title && x.length > 1 && !/^(save|apply|posted|\d+\s*(minute|min|hour|hr|day|days|d)\b)/i.test(x)) ||
      '';
    const description = (await textFromFirst(card, ['.job-desc', '.job-desc-container'])) || raw;

    fresh.push({title, company, location, description, url: link, ageHours, postedText});
  }

  const newestAgeHours = parsedAges.length ? Math.min(...parsedAges) : null;
  const oldestAgeHours = parsedAges.length ? Math.max(...parsedAges) : null;

  return {
    fresh,
    diagnostics,
    rejectedByFreshness,
    uniqueCards: seenCardUrls.size,
    parsedAges,
    newestAgeHours,
    oldestAgeHours,
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
  const base = {
    headless: c.headless,
    viewport: {width: 1440, height: 900},
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage'
    ],
    ignoreDefaultArgs: ['--enable-automation']
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
    const sort = page.getByText('Sort by:', {exact: false}).first();
    if (!(await sort.count())) return false;
    await sort.click().catch(() => {});
    await page.waitForTimeout(300);
    const date = page.getByText('Date', {exact: true}).first();
    if (!((await date.count()) && (await date.isVisible().catch(() => false)))) return false;
    await date.click().catch(() => {});
    await page.waitForTimeout(1000);
    return true;
  } catch {
    return false;
  }
}

async function selectFreshnessLastDay(page) {
  try {
    const freshness = page.getByText('Freshness', {exact: true}).first();
    if (!(await freshness.count())) return false;
    await freshness.click().catch(() => {});
    await page.waitForTimeout(300);

    const candidates = [
      page.getByText('Last 1 day', {exact: true}).first(),
      page.getByText('Last 1 Day', {exact: true}).first(),
      page.getByText(/Last 1 day/i).first()
    ];
    for (const lastDay of candidates) {
      if ((await lastDay.count()) && (await lastDay.isVisible().catch(() => false))) {
        await lastDay.click().catch(() => {});
        await page.waitForTimeout(1000);
        return true;
      }
    }
  } catch {}
  return false;
}

function buildNaukriSearchUrl(query, locationLabel) {
  const pathQ = slugify(query || 'jobs') || 'jobs';
  const pathL = slugify(locationLabel || '') || 'india';
  const u = new URL(`https://www.naukri.com/${pathQ}-jobs-in-${pathL}`);
  u.searchParams.set('k', String(query || '').trim());
  if (locationLabel) u.searchParams.set('l', String(locationLabel).trim());
  u.searchParams.set('nignbevent_src', 'jobsearchDeskGNB');
  // Prefer last-1-day results; strict maxAgeHours filter still applies client-side.
  u.searchParams.set('nDate', '1');
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
  const directUrl = buildNaukriSearchUrl(q, loc);
  console.info(JSON.stringify({
    search: q,
    location: loc || 'ALL',
    message: 'Opening Naukri search results URL',
    directUrl
  }));

  await withRetry(
    () => page.goto(directUrl, {waitUntil: 'domcontentloaded', timeout: c.navigationTimeoutMs}),
    {retries: c.maxRetries, delayMs: c.retryDelayMs}
  );
  await page.waitForTimeout(Math.max(c.pageDelayMs, 1800));
  await assertNaukriReachable(page);
  await dismissOverlays(page);
  await page.waitForTimeout(800);
  await dismissOverlays(page);

  // If Naukri bounced us back to the homepage, retry once via homepage form then direct again.
  if (isNaukriHomepageUrl(page.url()) && attempt < 1) {
    console.warn(JSON.stringify({
      search: q,
      location: loc || 'ALL',
      message: 'Search URL redirected to homepage; retrying once'
    }));
    await page.waitForTimeout(1500);
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

  // Wait for either results or an error page. Naukri often paints the filter
  // chrome first and hydrates job cards a moment later; give it extra time.
  await page
    .waitForSelector(
      `${JOB_CARD_SELECTOR},a[href*="job-listings"],a[href*="/job/"],.styles_jlc__main,[class*="styles_jlc" i],text=/Oops! Something went wrong/i,text=/\\d+\\s*[-–]\\s*\\d+\\s+of\\s+\\d+/i`,
      {timeout: 20000}
    )
    .catch(() => {});

  // Trigger lazy-loaded cards that appear only after a small scroll.
  await page.evaluate(() => window.scrollBy(0, 400)).catch(() => {});
  await page.waitForTimeout(1500);

  let resultCountAfterSubmit = await recognizedJobCardCount(page);
  if (!resultCountAfterSubmit) {
    // One extra hydration window before declaring failure.
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollBy(0, 600)).catch(() => {});
    await page.waitForTimeout(1000);
    resultCountAfterSubmit = await recognizedJobCardCount(page);
  }

  if (!resultCountAfterSubmit) {
    const retryBody = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 1800);
    if (attempt < 1 && /cookie policy|privacy policy/i.test(retryBody) && /got it/i.test(retryBody)) {
      await dismissOverlays(page);
      await page.waitForTimeout(1000);
      console.warn(JSON.stringify({search:q,location:loc,attempt,message:'Cookie consent blocked result rendering; retrying search once'}));
      return runSearchFromHomepage(page,c,q,loc,attempt+1);
    }
    // Retry once when the results header is present but cards have not painted yet.
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

  // Prefer Naukri's real Freshness -> Last 1 day UI control first.
  // Only fall back to the public freshness URL parameter when the UI control
  // is not exposed. The strict 6-hour parser below remains authoritative.
  let resultUrl = page.url();
  const freshnessUiApplied = await selectFreshnessLastDay(page);
  if (!freshnessUiApplied) {
    try {
      const u = new URL(resultUrl);
      // Naukri's search endpoint uses nDate=1 for its one-day freshness filter.
      // Keep the strict maxAgeHours parser as the final six-hour gate.
      u.searchParams.set('nDate', '1');
      await page.goto(u.href, {waitUntil: 'domcontentloaded', timeout: c.navigationTimeoutMs});
      await page.waitForTimeout(Math.max(800, Math.min(c.pageDelayMs, 1200)));
      resultUrl = page.url();
    } catch {}
  } else {
    resultUrl = page.url();
  }

  const sortedByDate = await selectSortByDate(page);
  const freshnessFilterApplied =
    freshnessUiApplied || /(?:^|[?&])(?:nDate|freshness)=1(?:&|$)/i.test(resultUrl);
  console.info(JSON.stringify({
    search: q,
    location: loc || 'ALL',
    sortedByDate,
    freshnessFilterApplied,
    maxAgeHours: c.maxAgeHours,
    freshnessParam: 'nDate=1',
    resultUrl
  }));
  return {url: resultUrl, sortedByDate};
}

export async function searchJobs(page, c) {
  const out = [];
  const seen = new Set();

  // Search broadly, then let the deterministic matcher + AI do the precise role fit.
  // This avoids repeatedly searching near-identical Naukri result sets for
  // Power BI Developer/Lead/Engineer/Consultant separately.
  const searchQueries = [...new Set((c.searchQueries || c.roles).map(x => String(x).trim()).filter(Boolean))].slice(0, 4);
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

  for (const q of searchQueries) {
    for (const loc of searchLocations) {
      const searchResult = await runSearchFromHomepage(page, c, q, loc);
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

      for (let pageNo = 1; pageNo <= Math.min(c.maxPagesPerSearch, 2) && url; pageNo++) {
        if (visitedPages.has(url)) break;
        visitedPages.add(url);

        const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 12000);
        if (/captcha|security verification|verify you are human|robot/i.test(body)) {
          throw new Error(
            'Naukri requires CAPTCHA/security verification. Complete it with npm run login, then restart the watcher.'
          );
        }
        if (/login|register/i.test(page.url())) {
          throw new Error('Naukri session expired during search. Automatic login did not restore the session.');
        }

        let cards = await recognizedJobCardCount(page);
        if (!cards) {
          await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
          await page.waitForTimeout(2500);
          cards = await recognizedJobCardCount(page);
        }
        if (!cards) {
          console.warn(
            JSON.stringify(
              {
                search: q,
                location: loc || 'ALL',
                page: pageNo,
                cards: 0,
                message: 'No Naukri job cards or job-listing links found after homepage form search',
                url: page.url()
              },
              null,
              0
            )
          );
          break;
        }

        const extracted = await extractFreshCards(page, c);
        const isRemoteSearch = /^remote$/i.test(String(loc).trim());
        const eligibleFresh = isRemoteSearch
          ? extracted.fresh.filter(job => remoteJobMatchesPreferredLocation(job, c.locations))
          : extracted.fresh;
        const rejectedByRemoteLocation = extracted.fresh.length - eligibleFresh.length;

        if (!eligibleFresh.length) {
          console.warn(
            JSON.stringify(
              {
                search: q,
                location: loc || 'ALL',
                page: pageNo,
                cards,
                freshCards: eligibleFresh.length,
                freshnessQualifiedCards: extracted.fresh.length,
                rejectedByFreshness: extracted.rejectedByFreshness,
                rejectedByRemoteLocation,
                diagnostics: extracted.diagnostics
              },
              null,
              0
            )
          );
        }
        console.info(
          JSON.stringify({
            search: q,
            location: loc || 'ALL',
            page: pageNo,
            cards,
            uniqueCards: extracted.uniqueCards,
            freshCards: eligibleFresh.length,
            freshnessQualifiedCards: extracted.fresh.length,
            rejectedByFreshness: extracted.rejectedByFreshness,
            rejectedByRemoteLocation,
            newestAgeHours: extracted.newestAgeHours,
            oldestAgeHours: extracted.oldestAgeHours,
            maxAgeHours: c.maxAgeHours
          })
        );

        for (const job of eligibleFresh) {
          if (!seen.has(job.url)) {
            seen.add(job.url);
            out.push(job);
          }
        }

        // Only stop early when Naukri confirmed newest-first sorting. When the
        // sort control is unavailable, page 2 may still contain newer jobs, so
        // continue within the configured page cap even if page 1 is stale.
        if (sortedByDate && extracted.allParsedOlderThanMax) {
          console.info(JSON.stringify({
            search: q,
            location: loc || 'ALL',
            page: pageNo,
            message: 'Stopping pagination because this page is entirely older than the freshness window.',
            maxAgeHours: c.maxAgeHours
          }));
          break;
        }

        const next = pageNo < Math.min(c.maxPagesPerSearch, 2) ? await nextPageUrl(page, url) : null;
        if (!next) break;
        await page.goto(next, {waitUntil: 'domcontentloaded', timeout: c.navigationTimeoutMs});
        await page.waitForTimeout(c.pageDelayMs);
        url = page.url();
      }
    }
  }

  return out;
}
