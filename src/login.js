import {config} from './config.js';

async function getChromium() {
  const mod = await import('playwright');
  return mod.chromium;
}

const chromium = await getChromium();
const launchOpts = {
  headless: false,
  viewport: {width: 1440, height: 900},
  locale: 'en-IN',
  timezoneId: 'Asia/Kolkata',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  args: ['--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
  ignoreDefaultArgs: ['--enable-automation']
};

let context;
try {
  context = await chromium.launchPersistentContext(config.profileDir, {...launchOpts, channel: 'chrome'});
} catch {
  console.warn('System Chrome not found; using Chromium. Install Google Chrome if Access Denied continues.');
  context = await chromium.launchPersistentContext(config.profileDir, launchOpts);
}

const p = context.pages()[0] || (await context.newPage());
await p.goto(config.naukriUrl, {waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs});
console.log('Browser opened. If you see Access Denied or login/CAPTCHA, complete it manually.');
console.log('When Naukri homepage loads normally (search bar visible), press Enter here to save the session.');
await new Promise(r => process.stdin.once('data', r));
await context.close();
console.log('Session saved to', config.profileDir);
