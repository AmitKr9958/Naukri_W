import {existsSync} from 'node:fs';
import {config} from './config.js';

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
  console.log('Using system Chrome (channel=chrome).');
} catch (channelErr) {
  const executablePath = resolveChromeExecutable();
  if (executablePath) {
    try {
      context = await chromium.launchPersistentContext(config.profileDir, {
        ...launchOpts,
        executablePath
      });
      console.log('Using system Chrome via executablePath:', executablePath);
    } catch (execErr) {
      console.warn(
        'System Chrome launch failed; using Chromium (Access Denied more likely).',
        String(execErr?.message || execErr).slice(0, 200)
      );
      context = await chromium.launchPersistentContext(config.profileDir, launchOpts);
    }
  } else {
    console.warn(
      'System Chrome not found; using Chromium. Install Google Chrome if Access Denied continues.',
      String(channelErr?.message || channelErr).slice(0, 200)
    );
    context = await chromium.launchPersistentContext(config.profileDir, launchOpts);
  }
}

const p = context.pages()[0] || (await context.newPage());
await p.goto(config.naukriUrl, {waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs});
console.log('Browser opened. If you see Access Denied or login/CAPTCHA, complete it manually.');
console.log('When Naukri homepage loads normally (search bar visible), press Enter here to save the session.');
await new Promise(r => process.stdin.once('data', r));
await context.close();
console.log('Session saved to', config.profileDir);
