import {withRetry} from './retry.js';

async function getChromium() {
  const mod = await import('playwright');
  return mod.chromium;
}

const slugify = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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

async function extractFreshCards(page, c) {
  const fresh = [];
  let rejectedByFreshness = 0;
  const diagnostics = [];
  const cards = await page.locator('.cust-job-tuple,.srp-jobtuple-wrapper,[data-job-id]').all();
  const seenCardUrls = new Set();
  let parsedAges = [];

  for (const card of cards.slice(0, 50)) {
    const raw = await card.innerText().catch(() => '');
    const anchors = await card.locator('a').all();
    let link = null;
    for (const a of anchors) {
      const href = await a.getAttribute('href').catch(() => null);
      if (href && /job-listings-|\/job\//i.test(href)) {
        link = href;
        break;
      }
    }
    if (!link && anchors[0]) link = await anchors[0].getAttribute('href').catch(() => null);
    link = cleanUrl(link);
    if (!link || seenCardUrls.has(link)) continue;
    seenCardUrls.add(link);

    const lines = raw.split('\n').map(x => x.trim()).filter(Boolean);
    const title = (await card.locator('a').first().innerText().catch(() => '')).trim() || lines[0] || '';
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

  try {
    return await chromium.launchPersistentContext(c.profileDir, {
      ...base,
      channel: 'chrome'
    });
  } catch (e) {
    // Fallback to bundled Chromium if Chrome is not installed
    console.warn(
      JSON.stringify({
        msg: 'System Chrome not available; falling back to Chromium (more likely to hit Access Denied)',
        error: String(e?.message || e)
      })
    );
    return await chromium.launchPersistentContext(c.profileDir, base);
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
  const dismissers = [
    'button:has-text("Accept")',
    'button:has-text("Accept All")',
    'button:has-text("I Agree")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    'button:has-text("Close")',
    '[aria-label="Close"]',
    '.cross',
    '.btn-close',
    '#close-popup',
    '.naukri-cookie-accept'
  ];
  for (const sel of dismissers) {
    const btn = page.locator(sel).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click({force: true}).catch(() => {});
      await page.waitForTimeout(200);
    }
  }
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

async function runSearchFromHomepage(page, c, q, loc) {
  await withRetry(
    () => page.goto(c.naukriUrl, {waitUntil: 'domcontentloaded', timeout: c.navigationTimeoutMs}),
    {retries: c.maxRetries, delayMs: c.retryDelayMs}
  );
  await page.waitForTimeout(c.pageDelayMs);
  await assertNaukriReachable(page);
  await dismissOverlays(page);

  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 12000);
  if (/captcha|security verification|verify you are human|robot/i.test(body)) {
    throw new Error(
      'Naukri requires CAPTCHA/security verification. Complete it with npm run login, then restart the watcher.'
    );
  }
  if (/login|register/i.test(page.url())) {
    throw new Error('Naukri session expired during search. Automatic login did not restore the session.');
  }

  const keyword = await openSearchForm(page, c);
  await fillNaukriField(keyword, q);

  const location = await findNaukriSearchInput(page, 'location');
  if (!location) throw new Error('Naukri location search field is unavailable after keyword fill.');
  await fillNaukriField(location, loc);

  const searchButton = await findVisible(page, [
    'button[aria-label="Search"]',
    '.nI-gNb-sb__icon-wrapper[aria-label="Search"]',
    '.nI-gNb-sb__icon-wrapper',
    '#qsbFormBtn',
    'button.qsbSrch',
    'button[type="submit"]:has-text("Search")',
    'button:has-text("Search")',
    'input[type="submit"]',
    '[class*="search"] button'
  ]);
  if (!searchButton) throw new Error('Naukri search button is unavailable.');

  await searchButton.click({force: true});
  await page.waitForTimeout(Math.max(2000, c.pageDelayMs));

  // Wait for either results or an error page
  await page
    .waitForSelector('.srp-jobtuple-wrapper,.cust-job-tuple,[data-job-id],.styles_jlc__main,text=/Oops! Something went wrong/i', {
      timeout: 15000
    })
    .catch(() => {});

  const resultBody = (await page.locator('body').innerText().catch(() => '')).slice(0, 12000);
  if (/Oops! Something went wrong/i.test(resultBody)) {
    throw new Error(
      'Naukri search returned its "Oops! Something went wrong" page even when submitted through the homepage search form.'
    );
  }

  const sortedByDate = await selectSortByDate(page);
  const freshnessFilterApplied = await selectFreshnessLastDay(page);
  console.info(JSON.stringify({
    search: q,
    location: loc || 'ALL',
    sortedByDate,
    freshnessFilterApplied,
    maxAgeHours: c.maxAgeHours
  }));
  return page.url();
}

export async function searchJobs(page, c) {
  const out = [];
  const seen = new Set();

  for (const q of c.roles.slice(0, 8)) {
    for (const loc of c.locations.length ? c.locations : ['']) {
      let url = await runSearchFromHomepage(page, c, q, loc);
      const visitedPages = new Set();

      for (let pageNo = 1; pageNo <= c.maxPagesPerSearch && url; pageNo++) {
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

        let cards = await page.locator('.srp-jobtuple-wrapper,.cust-job-tuple,[data-job-id]').count();
        if (!cards) {
          await page.waitForTimeout(2500);
          cards = await page.locator('.srp-jobtuple-wrapper,.cust-job-tuple,[data-job-id]').count();
        }
        if (!cards) {
          console.warn(
            JSON.stringify(
              {
                search: q,
                location: loc || 'ALL',
                page: pageNo,
                cards: 0,
                message: 'No Naukri job cards found after homepage form search',
                url: page.url()
              },
              null,
              0
            )
          );
          break;
        }

        const extracted = await extractFreshCards(page, c);
        if (!extracted.fresh.length) {
          console.warn(
            JSON.stringify(
              {
                search: q,
                location: loc || 'ALL',
                page: pageNo,
                cards,
                freshCards: extracted.fresh.length,
                rejectedByFreshness: extracted.rejectedByFreshness,
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
            freshCards: extracted.fresh.length,
            rejectedByFreshness: extracted.rejectedByFreshness,
            newestAgeHours: extracted.newestAgeHours,
            oldestAgeHours: extracted.oldestAgeHours,
            maxAgeHours: c.maxAgeHours
          })
        );

        for (const job of extracted.fresh) {
          if (!seen.has(job.url)) {
            seen.add(job.url);
            out.push(job);
          }
        }

        // Results are sorted newest-first when the Naukri sort control succeeds.
        // If every parsed posting on this page is already older than the configured
        // freshness window, later pages cannot contain a valid fresh match.
        if (extracted.allParsedOlderThanMax) {
          console.info(JSON.stringify({
            search: q,
            location: loc || 'ALL',
            page: pageNo,
            message: 'Stopping pagination because this page is entirely older than the freshness window.',
            maxAgeHours: c.maxAgeHours
          }));
          break;
        }

        const next = pageNo < c.maxPagesPerSearch ? await nextPageUrl(page, url) : null;
        if (!next) break;
        await page.goto(next, {waitUntil: 'domcontentloaded', timeout: c.navigationTimeoutMs});
        await page.waitForTimeout(c.pageDelayMs);
        url = page.url();
      }
    }
  }

  return out;
}
