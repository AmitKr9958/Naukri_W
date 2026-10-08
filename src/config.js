import 'dotenv/config'; import path from 'node:path';
const csv=v=>(v||'').split(',').map(s=>s.trim()).filter(Boolean); const bool=(v,d=false)=>v==null?d:['1','true','yes','on'].includes(String(v).toLowerCase());
export const config={
  tz:process.env.TZ||'Asia/Kolkata',
  runEveryMinutes:Number(process.env.RUN_EVERY_MINUTES||60),
  runOnStart:bool(process.env.RUN_ON_START,true),
  dryRun:bool(process.env.DRY_RUN,true),
  resumePath:process.env.RESUME_PATH||'',
  naukriUrl:process.env.NAUKRI_URL||'https://www.naukri.com',
  headless:bool(process.env.NAUKRI_HEADLESS,false),
  profileDir:path.resolve(process.env.NAUKRI_PROFILE_DIR||'.naukri-profile'),
  maxAgeHours:Number(process.env.JOB_MAX_AGE_HOURS||6),
  locations:csv(process.env.JOB_LOCATIONS),
  roles:csv(process.env.JOB_ROLES),
  minMatchScore:Number(process.env.MIN_MATCH_SCORE||60),
  maxJobsPerRun:Number(process.env.MAX_JOBS_PER_RUN||15),
  telegramToken:process.env.TELEGRAM_BOT_TOKEN||'',
  telegramChatId:process.env.TELEGRAM_CHAT_ID||'',aiEnabled:bool(process.env.AI_ENABLED,true),openRouterKey:process.env.OPENROUTER_API_KEY||'',openRouterModel:process.env.OPENROUTER_MODEL||'openrouter/free',
  aiEnabled:bool(process.env.AI_ENABLED,false),
  aiBaseUrl:process.env.AI_BASE_URL||'http://localhost:20128/v1',
  aiApiKey:process.env.AI_API_KEY||'',
  aiModel:process.env.AI_MODEL||'cc/claude-haiku-4-20250514',
  maxRetries:Number(process.env.MAX_RETRIES||3),
  retryDelayMs:Number(process.env.RETRY_DELAY_MS||5000),
  navigationTimeoutMs:Number(process.env.NAVIGATION_TIMEOUT_MS||45000),
  actionTimeoutMs:Number(process.env.ACTION_TIMEOUT_MS||20000)
};
export function validateConfig(){
  const m=[];
  for(const[k,v]of [['RESUME_PATH',config.resumePath],['TELEGRAM_BOT_TOKEN',config.telegramToken],['TELEGRAM_CHAT_ID',config.telegramChatId]])if(!v&&!config.dryRun)m.push(k);
  if(config.aiEnabled&&!config.aiApiKey)m.push('AI_API_KEY (when AI_ENABLED=true)');
  if(m.length)throw new Error('Missing required configuration: '+m.join(', '));
  if(config.runEveryMinutes<60)throw new Error('RUN_EVERY_MINUTES must be >= 60.');if(config.aiEnabled&&!config.openRouterKey)console.warn('AI enabled but OPENROUTER_API_KEY is empty; AI enrichment will be skipped.');
}