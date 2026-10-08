import {chromium} from 'playwright'; import {withRetry} from './retry.js';

const slugify=s=>String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

function parseAgeHours(raw){
  const s=String(raw||'').replace(/\s+/g,' ');
  if(/just now|today/i.test(s))return 0;
  if(/yesterday/i.test(s))return 24;
  let m=s.match(/(\d+)\s*(minute|min|minutes)\s*(?:ago)?/i);
  if(m)return Number(m[1])/60;
  if(/few\s+minutes?/i.test(s))return 0.25;
  m=s.match(/(\d+(?:\.\d+)?)\s*(hour|hr|hours|hrs)\s*(?:ago)?/i);
  if(m)return Number(m[1]);
  if(/few\s+hours?/i.test(s))return 3;
  m=s.match(/(\d+(?:\.\d+)?)\s*(day|days|d)\s*(?:ago)?/i);
  if(m)return Number(m[1])*24;
  m=s.match(/(\d+(?:\.\d+)?)\s*(week|weeks|wk|wks)\s*(?:ago)?/i);
  if(m)return Number(m[1])*168;
  m=s.match(/(\d+(?:\.\d+)?)\s*(month|months|mo)\s*(?:ago)?/i);
  if(m)return Number(m[1])*720;
  return null;
}

function cleanUrl(href){
  if(!href)return null;
  try{return new URL(href,'https://www.naukri.com').href.split('#')[0];}
  catch{return null;}
}

async function applyFreshness(page){
  const button=page.locator('#filter-freshness');
  if(await button.count()){
    await button.click().catch(()=>{});
    const option=page.locator('a[data-id="filter-freshness-1"]');
    if(await option.count()){
      await option.click().catch(()=>{});
      await page.waitForTimeout(1200);
      return true;
    }
  }
  return false;
}

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
      const base=loc
        ? `https://www.naukri.com/${slugify(q)}-jobs-in-${slugify(loc)}?k=${encodeURIComponent(q)}&l=${encodeURIComponent(loc)}`
        : `https://www.naukri.com/${slugify(q)}-jobs?k=${encodeURIComponent(q)}`;
      const url=base+(base.includes('?')?'&':'?')+'jobAge=1&sort=date';
      await withRetry(()=>page.goto(url,{waitUntil:'domcontentloaded',timeout:c.navigationTimeoutMs}),{retries:c.maxRetries,delayMs:c.retryDelayMs});
      await page.waitForTimeout(1000);
      await applyFreshness(page);
      const cards=await page.locator('.srp-jobtuple-wrapper,.cust-job-tuple,[data-job-id]').all();
      for(const card of cards.slice(0,50)){
        const raw=await card.innerText().catch(()=>''), anchors=await card.locator('a').all();
        let link=null;
        for(const a of anchors){
          const href=await a.getAttribute('href').catch(()=>null);
          if(href&&/job-listings-|\/job\//i.test(href)){link=href;break}
        }
        if(!link&&anchors[0])link=await anchors[0].getAttribute('href').catch(()=>null);
        link=cleanUrl(link);
        if(!link)continue;
        const lines=raw.split('\n').map(x=>x.trim()).filter(Boolean);
        const title=(await card.locator('a').first().innerText().catch(()=>'' )).trim()||lines[0]||'';
        const ageHours=parseAgeHours(raw);
        if(ageHours==null||ageHours>c.maxAgeHours)continue;
        const location=lines.find(x=>c.locations.some(l=>x.toLowerCase().includes(l.toLowerCase())))||loc;
        const company=lines.find(x=>x!==title&&x.length>1&&!/^(save|apply|posted|\d+\s*(minute|min|hour|hr|day|days|d)\b)/i.test(x))||'';
        out.push({title,company,location,description:raw,url:link,ageHours});
      }
    }
  }
  const s=new Set();
  return out.filter(j=>!s.has(j.url)&&s.add(j.url));
}