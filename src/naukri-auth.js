import {withRetry} from './retry.js';

const loginUrl='https://www.naukri.com/nlogin/login';

async function visible(page,selector){
  const loc=page.locator(selector).first();
  return await loc.isVisible().catch(()=>false);
}

async function findFirst(page,selectors){
  for(const selector of selectors){
    const loc=page.locator(selector).first();
    if(await loc.count()&&await loc.isVisible().catch(()=>false))return loc;
  }
  return null;
}

export async function loginWithCredentials(page,c){
  if(!c.naukriUsername||!c.naukriPassword)return false;

  await withRetry(()=>page.goto(loginUrl,{waitUntil:'domcontentloaded',timeout:c.navigationTimeoutMs}),{retries:c.maxRetries,delayMs:c.retryDelayMs});
  await page.waitForTimeout(1200);

  const user=await findFirst(page,[
    'input[type="email"]',
    'input[name="email"]',
    'input[placeholder*="Email" i]',
    'input[placeholder*="Username" i]'
  ]);
  const pass=await findFirst(page,[
    'input[type="password"]',
    'input[name="password"]',
    'input[placeholder*="Password" i]'
  ]);

  if(!user||!pass)throw new Error('Naukri login form changed or is unavailable. Run npm run login and complete login manually.');

  await user.fill(c.naukriUsername);
  await pass.fill(c.naukriPassword);

  const submit=await findFirst(page,[
    'button[type="submit"]',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'input[type="submit"]'
  ]);
  if(!submit)throw new Error('Naukri login button not found. Run npm run login and complete login manually.');

  await submit.click();
  await page.waitForTimeout(2500);

  const current=page.url();
  const body=(await page.locator('body').innerText().catch(()=>'')).slice(0,12000);

  if(/captcha|security verification|verify you are human|robot/i.test(body)){
    throw new Error('Naukri requires CAPTCHA/security verification. Complete it with npm run login, then restart the watcher.');
  }
  if(/otp|one time password|verification code/i.test(body)){
    throw new Error('Naukri requires OTP verification. Complete it with npm run login, then restart the watcher.');
  }
  if(/login|register/i.test(current)){
    throw new Error('Automatic Naukri login did not complete. Run npm run login and complete login manually.');
  }
  return true;
}

export async function ensureLoggedIn(page,c){
  if(!/login|register/i.test(page.url()))return;
  if(c.autoLogin)await loginWithCredentials(page,c);
  else throw new Error('Naukri session is not authenticated. Run npm run login.');
}