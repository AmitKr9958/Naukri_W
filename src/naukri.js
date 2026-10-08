import {chromium} from 'playwright'; import {withRetry} from './retry.js';

const slugify=s=>String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

export async function openNaukri(c){
  const context=await chromium.launchPersistentContext(c.profileDir,{headless:c.headless,viewport:{width:1440,height:1000}});
  context.setDefaultTimeout(c.actionTimeoutMs);
  const page=context.pages()[0]||await context.newPage();
  await withRetry(()=>page.goto(c.naukriUrl,{waitUntil:'domcontentloaded',timeout:c.navigationTimeoutMs}),{retries:c.maxRetries,delayMs:c.retryDelayMs});
  return {context,page};
}

export async function ensureLoggedIn(page){
  if(/login|register/i.test(page.url())) throw new Error('Naukri session is not authenticated. Run npm run login.');
}

export async function searchJobs(page,c){
  const out=[];
  for(const q of c.roles.slice(0,8)){
    for(const loc of c.locations.length?c.locations:['']){
      const url=loc
        ? `https://www.naukri.com/${slugify(q)}-jobs-in-${slugify(loc)}?k=${encodeURIComponent(q)}&l=${encodeURIComponent(loc)}`
        : `https://www.naukri.com/${slugify(q)}-jobs?k=${encodeURIComponent(q)}`;
      await withRetry(()=>page.goto(url,{waitUntil:'domcontentloaded',timeout:c.navigationTimeoutMs}),{retries:c.maxRetries,delayMs:c.retryDelayMs});
      const cards=await page.locator('article,.srp-jobtuple-wrapper,.cust-job-tuple,[data-job-id]').all();
      for(const card of cards.slice(0,50)){
        const raw=await card.innerText().catch(()=>''), anchors=await card.locator('a').all();
        let link=null;
        for(const a of anchors){const href=await a.getAttribute('href').catch(()=>null);if(href&&/naukri\.com\/job-listings-|\/job-listings-|\/job\//i.test(href)){link=href;break}}
        if(!link&&anchors[0]) link=await anchors[0].getAttribute('href').catch(()=>null);
        if(!link) continue;
        const lines=raw.split('\n').map(x=>x.trim()).filter(Boolean);
        const title=(await card.locator('a').first().innerText().catch(()=>'' )).trim()||lines[0]||'';
        const m=raw.match(/(\d+)\s*(minute|min|hour|hr)s?\s*ago/i);
        if(!m) continue;
        const ageHours=/min/i.test(m[2])?Number(m[1])/60:Number(m[1]);
        if(ageHours>c.maxAgeHours) continue;
        const location=lines.find(x=>c.locations.some(l=>x.toLowerCase().includes(l.toLowerCase())))||loc;
        out.push({title,company:lines[1]||'',location,description:raw,url:link.startsWith('http')?link:`https://www.naukri.com${link}`,ageHours});
      }
    }
  }
  const s=new Set();
  return out.filter(j=>!s.has(j.url)&&s.add(j.url));
}