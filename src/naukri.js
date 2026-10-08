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

export function nextSearchPageUrl(currentUrl,links){
  for(const item of links){
    const href=typeof item==='string'?item:item?.href;
    const text=typeof item==='string'?'':item?.text;
    if(text&&!/^\s*next\s*$/i.test(text))continue;
    const url=cleanUrl(href);
    if(url&&url!==currentUrl)return url;
  }
  return null;
}

async function nextPageUrl(page,currentUrl){
  const next=page.locator('a').filter({hasText:/^\s*next\s*$/i}).first();
  if(await next.count()){
    const href=await next.getAttribute('href').catch(()=>null);
    const url=cleanUrl(href);
    if(url&&url!==currentUrl)return url;
  }
  return null;
}

function findPostedText(raw,preferred){
  const candidates=[preferred,...String(raw||'').split(/\n+/).map(x=>x.trim())].filter(Boolean);
  for(const value of candidates){
    if(parseAgeHours(value)!==null)return value;
  }
  return '';
}

async function extractFreshCards(page,c){
  const fresh=[];
  const diagnostics=[];
  const cards=await page.locator('.cust-job-tuple,.srp-jobtuple-wrapper,[data-job-id]').all();
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
    const preferredPosted=await textFromFirst(card,['.job-post-day','.job-posted-date','.job-posted','[class*="job-post-day"]','[class*="posted"]']);
    const postedText=findPostedText(raw,preferredPosted);
    const ageHours=parseAgeHours(postedText);
    if(diagnostics.length<5)diagnostics.push({title,postedText:postedText||preferredPosted||'NOT_FOUND',ageHours});
    if(ageHours==null||ageHours>c.maxAgeHours)continue;

    const location=await textFromFirst(card,['.locWdth','.loc-wrap [title]','.location','.loc'])||lines.find(x=>c.locations.some(l=>x.toLowerCase().includes(l.toLowerCase())))||'';
    const company=await textFromFirst(card,['.comp-name','.companyInfo a','.companyInfo','.comp-name a'])||lines.find(x=>x!==title&&x.length>1&&!/^(save|apply|posted|\d+\s*(minute|min|hour|hr|day|days|d)\b)/i.test(x))||'';
    const description=await textFromFirst(card,['.job-desc','.job-desc-container'])||raw;

    fresh.push({title,company,location,description,url:link,ageHours,postedText});
  }
  return {fresh,diagnostics};
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

async function findVisible(page,selectors){
  for(const selector of selectors){
    const loc=page.locator(selector).first();
    if(await loc.count()&&await loc.isVisible().catch(()=>false))return loc;
  }
  return null;
}

async function openSearchForm(page,c){
  let keyword=await findVisible(page,[
    'input[name="qp"]',
    'input[placeholder*="Skills, Designations, Companies" i]',
    'input[placeholder*="keyword" i]',
    'input[placeholder*="Search jobs here" i]'
  ]);
  if(keyword)return keyword;

  const trigger=await findVisible(page,[
    'input[placeholder*="Search jobs here" i]',
    'text=Search jobs here',
    '[aria-label*="search" i]',
    'button:has-text("Search Jobs")',
    'button:has-text("Search")'
  ]);
  if(trigger)await trigger.click().catch(()=>{});
  await page.waitForTimeout(500);

  keyword=await findVisible(page,[
    'input[name="qp"]',
    'input[placeholder*="Skills, Designations, Companies" i]',
    'input[placeholder*="keyword" i]'
  ]);
  if(!keyword)throw new Error('Naukri search form is unavailable. Open Naukri in Chrome and verify the homepage search box is working.');
  return keyword;
}

async function selectSortByDate(page){
  try{
    const sort=page.getByText('Sort by:',{exact:false}).first();
    if(await sort.count())await sort.click().catch(()=>{});
    await page.waitForTimeout(250);
    const date=page.getByText('Date',{exact:true}).first();
    if(await date.count()&&await date.isVisible().catch(()=>false)){
      await date.click().catch(()=>{});
      await page.waitForTimeout(1000);
    }
  }catch{}
}

async function selectFreshnessLastDay(page){
  try{
    const freshness=page.getByText('Freshness',{exact:true}).first();
    if(await freshness.count())await freshness.click().catch(()=>{});
    await page.waitForTimeout(250);
    const lastDay=page.getByText('Last 1 day',{exact:true}).first();
    if(await lastDay.count()&&await lastDay.isVisible().catch(()=>false)){
      await lastDay.click().catch(()=>{});
      await page.waitForTimeout(1000);
    }
  }catch{}
}

async function runSearchFromHomepage(page,c,q,loc){
  await withRetry(()=>page.goto(c.naukriUrl,{waitUntil:'domcontentloaded',timeout:c.navigationTimeoutMs}),{retries:c.maxRetries,delayMs:c.retryDelayMs});
  await page.waitForTimeout(c.pageDelayMs);

  const body=(await page.locator('body').innerText().catch(()=>'')).slice(0,12000);
  if(/captcha|security verification|verify you are human|robot/i.test(body)){
    throw new Error('Naukri requires CAPTCHA/security verification. Complete it with npm run login, then restart the watcher.');
  }
  if(/login|register/i.test(page.url())){
    throw new Error('Naukri session expired during search. Automatic login did not restore the session.');
  }

  const keyword=await openSearchForm(page,c);
  await keyword.fill(q);

  const location=await findVisible(page,[
    'input[name="ql"]',
    'input[placeholder="Location" i]',
    'input[placeholder*="location" i]',
    'input[aria-label*="location" i]'
  ]);
  if(!location)throw new Error('Naukri location search field is unavailable.');
  await location.fill(loc);

  const searchButton=await findVisible(page,[
    '#qsbFormBtn',
    'button.qsbSrch',
    'button[type="submit"]:has-text("Search")',
    'button:has-text("Search")',
    'input[type="submit"]'
  ]);
  if(!searchButton)throw new Error('Naukri search button is unavailable.');

  await searchButton.click();
  await page.waitForTimeout(Math.max(1500,c.pageDelayMs));

  const resultBody=(await page.locator('body').innerText().catch(()=>'')).slice(0,12000);
  if(/Oops! Something went wrong/i.test(resultBody)){
    throw new Error('Naukri search returned its "Oops! Something went wrong" page even when submitted through the homepage search form.');
  }

  await selectSortByDate(page);
  await selectFreshnessLastDay(page);
  return page.url();
}

export async function searchJobs(page,c){
  const out=[];
  const seen=new Set();

  for(const q of c.roles.slice(0,8)){
    for(const loc of c.locations.length?c.locations:['']){
      let url=await runSearchFromHomepage(page,c,q,loc);
      const visitedPages=new Set();

      for(let pageNo=1;pageNo<=c.maxPagesPerSearch&&url;pageNo++){
        if(visitedPages.has(url))break;
        visitedPages.add(url);

        const body=(await page.locator('body').innerText().catch(()=>'')).slice(0,12000);
        if(/captcha|security verification|verify you are human|robot/i.test(body)){
          throw new Error('Naukri requires CAPTCHA/security verification. Complete it with npm run login, then restart the watcher.');
        }
        if(/login|register/i.test(page.url())){
          throw new Error('Naukri session expired during search. Automatic login did not restore the session.');
        }

        let cards=await page.locator('.srp-jobtuple-wrapper,.cust-job-tuple,[data-job-id]').count();
        if(!cards){
          await page.waitForTimeout(2500);
          cards=await page.locator('.srp-jobtuple-wrapper,.cust-job-tuple,[data-job-id]').count();
        }
        if(!cards){
          console.warn(JSON.stringify({search:q,location:loc||'ALL',page:pageNo,cards:0,message:'No Naukri job cards found after homepage form search',url:page.url()},null,0));
          break;
        }

        const extracted=await extractFreshCards(page,c);
        if(!extracted.fresh.length)console.warn(JSON.stringify({search:q,location:loc||'ALL',page:pageNo,cards,diagnostics:extracted.diagnostics},null,0));
        for(const job of extracted.fresh){
          if(!seen.has(job.url)){
            seen.add(job.url);
            out.push(job);
          }
        }

        const next=pageNo<c.maxPagesPerSearch?await nextPageUrl(page,url):null;
        if(!next)break;
        await page.goto(next,{waitUntil:'domcontentloaded',timeout:c.navigationTimeoutMs});
        await page.waitForTimeout(c.pageDelayMs);
        url=page.url();
      }
    }
  }

  return out;
}
