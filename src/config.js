import 'dotenv/config'; import path from 'node:path';
const csv=v=>(v||'').split(',').map(s=>s.trim()).filter(Boolean);
const bool=(v,d=false)=>v==null?d:['1','true','yes','on'].includes(String(v).toLowerCase());
const localAI=url=>/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(url||'');
const validHttpUrl=value=>{try{const u=new URL(value);return (u.protocol==='https:'||u.protocol==='http:')&&Boolean(u.hostname);}catch{return false;}};
const positiveInt=(v,d)=>{const n=Number(v);return Number.isInteger(n)&&n>0?n:d;};
export const config={
  tz:process.env.TZ||'Asia/Kolkata',
  runEveryMinutes:Number(process.env.RUN_EVERY_MINUTES||30),
  runOnStart:bool(process.env.RUN_ON_START,true),
  dryRun:bool(process.env.DRY_RUN,true),
  resumePath:process.env.RESUME_PATH||'',
  naukriUrl:process.env.NAUKRI_URL||'https://www.naukri.com',
  headless:bool(process.env.NAUKRI_HEADLESS,false),
  profileDir:path.resolve(process.env.NAUKRI_PROFILE_DIR||'.naukri-profile'),
  autoLogin:bool(process.env.NAUKRI_AUTO_LOGIN,false),
  naukriUsername:process.env.NAUKRI_USERNAME||'',
  naukriPassword:process.env.NAUKRI_PASSWORD||'',
  maxAgeHours:Number(process.env.JOB_MAX_AGE_HOURS||48),
  minExperienceYears:Number(process.env.JOB_MIN_EXPERIENCE_YEARS||5),
  locations:csv(process.env.JOB_LOCATIONS),
  roles:csv(process.env.JOB_ROLES),
  searchQueries:csv(process.env.JOB_SEARCH_QUERIES).length ? csv(process.env.JOB_SEARCH_QUERIES) : ['Power BI','Data Analyst','Business Intelligence','Reporting Analyst','Fabric Analytics Engineer','Microsoft Fabric'],
  minMatchScore:Number(process.env.MIN_MATCH_SCORE||60),
  maxJobsPerRun:positiveInt(process.env.MAX_JOBS_PER_RUN,15),
  aiCandidateLimit:positiveInt(process.env.AI_CANDIDATE_LIMIT,30),
  // Scan multiple result pages; increase or decrease locally as needed (1-10).
  maxPagesPerSearch:positiveInt(process.env.MAX_PAGES_PER_SEARCH,5),
  // Conservative pacing for Naukri; runtime enforces a minimum 1500ms between searches.
  pageDelayMs:positiveInt(process.env.PAGE_DELAY_MS,1500),
  // User-configured value is logged for diagnostics; src/naukri.js enforces one active search.
  searchConcurrency:positiveInt(process.env.SEARCH_CONCURRENCY,1),
  searchBatchSize:positiveInt(process.env.JOB_SEARCH_BATCH_SIZE,1),
  telegramToken:process.env.TELEGRAM_BOT_TOKEN||'',
  telegramChatId:process.env.TELEGRAM_CHAT_ID||'',
  aiEnabled:bool(process.env.AI_ENABLED,false),
  aiConsent:bool(process.env.AI_CONSENT,false),
  aiBaseUrl:process.env.AI_BASE_URL||'http://localhost:20128/v1',
  aiApiKey:process.env.AI_API_KEY||'',
  aiModel:process.env.AI_MODEL||'cc/claude-haiku-4-20250514',
  maxRetries:positiveInt(process.env.MAX_RETRIES,2),
  retryDelayMs:positiveInt(process.env.RETRY_DELAY_MS,1500),
  navigationTimeoutMs:positiveInt(process.env.NAVIGATION_TIMEOUT_MS,25000),
  actionTimeoutMs:positiveInt(process.env.ACTION_TIMEOUT_MS,12000),
  httpTimeoutMs:positiveInt(process.env.HTTP_TIMEOUT_MS,20000)
};
export function validateConfig(){
  const m=[];
  for(const[k,v]of [['RESUME_PATH',config.resumePath],['TELEGRAM_BOT_TOKEN',config.telegramToken],['TELEGRAM_CHAT_ID',config.telegramChatId]])if(!v&&!config.dryRun)m.push(k);
  if(!config.roles.length)m.push('JOB_ROLES');
  if(!config.locations.length)m.push('JOB_LOCATIONS');
  if(!validHttpUrl(config.naukriUrl))m.push('NAUKRI_URL (must be a valid HTTP(S) URL)');
  if(!Number.isFinite(config.maxAgeHours)||config.maxAgeHours<=0)m.push('JOB_MAX_AGE_HOURS (finite number > 0)');
  if(!Number.isInteger(config.minExperienceYears)||config.minExperienceYears<0||config.minExperienceYears>40)m.push('JOB_MIN_EXPERIENCE_YEARS (integer 0-40)');
  if(!Number.isFinite(config.minMatchScore)||config.minMatchScore<0||config.minMatchScore>100)m.push('MIN_MATCH_SCORE (0-100)');
  if(!Number.isInteger(config.runEveryMinutes)||config.runEveryMinutes<10)m.push('RUN_EVERY_MINUTES (integer >= 10)');
  if(!Number.isInteger(config.maxPagesPerSearch)||config.maxPagesPerSearch<1||config.maxPagesPerSearch>10)m.push('MAX_PAGES_PER_SEARCH (1-10)');
  if(!Number.isInteger(config.searchConcurrency)||config.searchConcurrency<1||config.searchConcurrency>5)m.push('SEARCH_CONCURRENCY (1-5)');
  if(!Number.isInteger(config.searchBatchSize)||config.searchBatchSize<1||config.searchBatchSize>20)m.push('JOB_SEARCH_BATCH_SIZE (1-20)');
  if(!Number.isFinite(config.pageDelayMs)||config.pageDelayMs<0)m.push('PAGE_DELAY_MS (>= 0)');
  if(config.aiCandidateLimit<config.maxJobsPerRun)console.warn('AI_CANDIDATE_LIMIT is below MAX_JOBS_PER_RUN; increase it to preserve broad AI ranking.');
  if(config.autoLogin&&!config.naukriUsername)m.push('NAUKRI_USERNAME (required when NAUKRI_AUTO_LOGIN=true)');
  if(config.autoLogin&&!config.naukriPassword)m.push('NAUKRI_PASSWORD (required when NAUKRI_AUTO_LOGIN=true)');
  if(m.length)throw new Error('Missing or invalid configuration: '+m.join(', '));
}