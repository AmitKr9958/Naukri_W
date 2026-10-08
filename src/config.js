import 'dotenv/config'; import path from 'node:path';
const csv=v=>(v||'').split(',').map(s=>s.trim()).filter(Boolean);
const bool=(v,d=false)=>v==null?d:['1','true','yes','on'].includes(String(v).toLowerCase());
const localAI=url=>/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(?:\/|$)/i.test(url||'');
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
  maxAgeHours:Number(process.env.JOB_MAX_AGE_HOURS||6),
  locations:csv(process.env.JOB_LOCATIONS),
  roles:csv(process.env.JOB_ROLES),
  minMatchScore:Number(process.env.MIN_MATCH_SCORE||60),
  maxJobsPerRun:positiveInt(process.env.MAX_JOBS_PER_RUN,15),
  aiCandidateLimit:positiveInt(process.env.AI_CANDIDATE_LIMIT,30),
  maxPagesPerSearch:positiveInt(process.env.MAX_PAGES_PER_SEARCH,5),
  pageDelayMs:positiveInt(process.env.PAGE_DELAY_MS,1200),
  telegramToken:process.env.TELEGRAM_BOT_TOKEN||'',
  telegramChatId:process.env.TELEGRAM_CHAT_ID||'',
  aiEnabled:bool(process.env.AI_ENABLED,false),
  aiConsent:bool(process.env.AI_CONSENT,false),
  aiBaseUrl:process.env.AI_BASE_URL||'http://localhost:20128/v1',
  aiApiKey:process.env.AI_API_KEY||'',
  aiModel:process.env.AI_MODEL||'cc/claude-haiku-4-20250514',
  maxRetries:positiveInt(process.env.MAX_RETRIES,3),
  retryDelayMs:positiveInt(process.env.RETRY_DELAY_MS,5000),
  navigationTimeoutMs:positiveInt(process.env.NAVIGATION_TIMEOUT_MS,45000),
  actionTimeoutMs:positiveInt(process.env.ACTION_TIMEOUT_MS,20000),
  httpTimeoutMs:positiveInt(process.env.HTTP_TIMEOUT_MS,30000)
};
export function validateConfig(){
  const m=[];
  for(const[k,v]of [['RESUME_PATH',config.resumePath],['TELEGRAM_BOT_TOKEN',config.telegramToken],['TELEGRAM_CHAT_ID',config.telegramChatId]])if(!v&&!config.dryRun)m.push(k);
  if(!config.roles.length)m.push('JOB_ROLES');
  if(!config.locations.length)m.push('JOB_LOCATIONS');
  if(config.maxAgeHours<=0)m.push('JOB_MAX_AGE_HOURS (> 0)');
  if(config.minMatchScore<0||config.minMatchScore>100)m.push('MIN_MATCH_SCORE (0-100)');
  if(config.maxPagesPerSearch<1)m.push('MAX_PAGES_PER_SEARCH (>= 1)');
  if(config.pageDelayMs<0)m.push('PAGE_DELAY_MS (>= 0)');
  if(config.aiCandidateLimit<config.maxJobsPerRun)console.warn('AI_CANDIDATE_LIMIT is below MAX_JOBS_PER_RUN; increase it to preserve broad AI ranking.');
  if(config.aiEnabled&&!config.aiConsent)console.warn('AI is enabled but AI_CONSENT=false; AI analysis will be skipped.');
  if(config.aiEnabled&&!localAI(config.aiBaseUrl)&&!config.aiApiKey)m.push('AI_API_KEY (required for non-local AI endpoint)');
  if(config.autoLogin&&!config.naukriUsername)m.push('NAUKRI_USERNAME (required when NAUKRI_AUTO_LOGIN=true)');
  if(config.autoLogin&&!config.naukriPassword)m.push('NAUKRI_PASSWORD (required when NAUKRI_AUTO_LOGIN=true)');
  if(m.length)throw new Error('Missing or invalid configuration: '+m.join(', '));
  if(!Number.isInteger(config.runEveryMinutes)||config.runEveryMinutes<10)throw new Error('RUN_EVERY_MINUTES must be an integer >= 10.');
}