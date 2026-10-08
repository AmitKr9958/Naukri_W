import {chromium} from 'playwright'; import {withRetry} from './retry.js';

const slugify=s=>String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

export function parseAgeHours(raw){
  const s=String(raw||'').replace(/\s+/g,' ').trim().toLowerCase();
  if(!s)return null;
  if(/just now|moments? ago|today/.test(s))return 0;
  if(/yesterday/.test(s))return 24;
  let m=s.match(/(\d+(?:\.\d+)?)\s*(?:minute|minutes|min|mins)\s*(?:ago)?/);
  if(m)return Number(m[1])/60;
  if(/few\s+(?:minute|minutes)/.test(s))return 0.25;
  m=s.match(/(\d+(?:\.\d+)?)\s*(?:hour|hours|hr|hrs)\s*(?:ago)?/);
  if(m)return Number(m[1]);
  if(/few\s+(?:hour|hours)/.test(s))return 3;
  m=s.match(/(\d+(?:\.\d+)?)\s*(?:day|days|d)\s*(?:ago)?/);
  if(m)return Number(m[1])*24;
  m=s.match(/(\d+(?:\.\d+)?)\s*(?:week|weeks|wk|wks)\s*(?:ago)?/);
  if(m)return Number(m[1])*168;
  m=s.match(/(\d+(?:\.\d+)?)\s*(?:month|months|mo)\s*(?:ago)?/);
  if(m)return Number(m[1])*720;
  return null;
}

async function textFromFirst(card,selectors){
  for(const selector of selectors){
    const loc=card.locator(selector).first();
    if(await loc.count()){
      const text=(await loc.innerText().catch(()=>'' )).trim();
      if(text)return text;
      const title=await loc.getAttribute('title').catch(()=>null);
      if(title)return title.trim();
    }
  }
  return '';
}

function cleanUrl(href){
  if(!href)return null;
  try{return new URL(href,'https://www.naukri.com').href.split('#')[0];}
  catch{return null;}
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
      const url=loc
        ? `https://www.naukri.com/${slugify(q)}-jobs-in-${slugify(loc)}?k=${encodeURIComponent(q)}&l=${encodeURIComponent(loc)}`
        : `https://www.naukri.com/${slugify(q)}-jobs?k=${encodeURIComponent(q)}`;
      await withRetry(()=>page.goto(url,{waitUntil:'domcontentloaded',timeout:c.navigationTimeoutMs}),{retries:c.maxRetries,delayMs:c.retryDelayMs});
      await page.waitForTimeout(1500);

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
        const postedText=await textFromFirst(card,['.job-post-day','.job-posted-date','.job-posted','[class*="job-post-day"]','[class*="posted"]']);
        const ageHours=parseAgeHours(postedText||raw);
        if(ageHours==null||ageHours>c.maxAgeHours)continue;

        const location=await textFromFirst(card,['.locWdth','.loc-wrap [title]','.location','.loc'])||lines.find(x=>c.locations.some(l=>x.toLowerCase().includes(l.toLowerCase())))||loc;
        const company=await textFromFirst(card,['.comp-name','.companyInfo a','.companyInfo','.comp-name a'])||lines.find(x=>x!==title&&x.length>1&&!/^(save|apply|posted|\d+\s*(minute|min|hour|hr|day|days|d)\b)/i.test(x))||'';
        const description=await textFromFirst(card,['.job-desc','.job-desc-container'])||raw;

        out.push({title,company,location,description,url:link,ageHours,postedText});
      }
    }
  }
  const s=new Set();
  return out.filter(j=>!s.has(j.url)&&s.add(j.url));
}