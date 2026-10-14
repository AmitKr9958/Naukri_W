import fs from 'node:fs/promises';
import {config,validateConfig} from './config.js';
import {logger} from './logger.js';
import {loadResume} from './resume.js';
import {buildProfile,isTargetRole,scoreJob} from './matcher.js';
import {openNaukri,searchJobs} from './naukri.js';
import {ensureLoggedIn} from './naukri-auth.js';
import {loadSeen,saveSeen} from './state.js';
import {sendTelegram} from './telegram.js';

await fs.mkdir('logs',{recursive:true});
validateConfig();
const once=process.argv.includes('--once');
const ignoreSeenRequested=process.argv.includes('--ignore-seen');
if(ignoreSeenRequested&&!config.dryRun)throw new Error('--ignore-seen is permitted only when DRY_RUN=true.');
const ignoreSeen=ignoreSeenRequested&&config.dryRun;
let stopping=false;
process.on('SIGINT',()=>stopping=true);
process.on('SIGTERM',()=>stopping=true);

async function runOnce(){
  const start=Date.now();
  logger.info({aiEnabled:false,scoringMode:'rule-based',autoLogin:config.autoLogin,dryRun:config.dryRun,once,ignoreSeen},'Run started');
  const resume=await loadResume(config.resumePath);
  const profile=buildProfile(resume.text,config);
  const seen=await loadSeen();
  const {context,page}=await openNaukri(config);
  try{
    await ensureLoggedIn(page,config);
    const candidates=await searchJobs(page,config);
    logger.info({scrapedCandidates:candidates.map(j=>({title:j.title,company:j.company,location:j.location,url:j.url}))},'Scraped candidates before role filter');
    const targetCandidates=candidates.filter(j=>isTargetRole(j,config.minExperienceYears));
    const rejectedRoleCandidates=candidates.length-targetCandidates.length;
    const seenCandidates=targetCandidates.filter(j=>seen.has(j.url));
    const unseen=ignoreSeen?targetCandidates:targetCandidates.filter(j=>!seen.has(j.url));
    const alreadySeen=seenCandidates.length;
    const scored=unseen.map(j=>({...j,...scoreJob(j,profile)})).sort((a,b)=>b.score-a.score);
    // This watcher is intentionally rule-based only: no AI module import,
    // model request, API key, or resume transmission to an AI provider.
    const pool=scored.slice(0,config.maxJobsPerRun);
    logger.info({
      candidates:pool.map(j=>({
        title:j.title,
        url:j.url,
        company:j.company,
        location:j.location,
        ruleScore:j.score,
        finalScore:j.score
      })),
      scoringMode:'rule-based',
      minimumScore:config.minMatchScore
    },'Candidate scoring diagnostics');
    const ranked=pool.filter(j=>j.score>=config.minMatchScore)
      .sort((a,b)=>b.score-a.score);
    const matches=ranked.slice(0,config.maxJobsPerRun);
    if(matches.length)await sendTelegram(config,matches);

    // A dry-run must be observational: do not mark jobs as seen, otherwise
    // a test could suppress those jobs in the next real alerting run.
    if(config.dryRun){
      logger.info({dryRun:true,stateUpdated:false},'Dry-run: seen-job state was not changed');
    }else{
      // In rule-based mode, mark only candidates that passed the target-role filter.
      for(const j of targetCandidates)seen.add(j.url);
      await saveSeen(seen);
    }
    logger.info({
      candidates:candidates.length,
      unseen:unseen.length,
      alreadySeen,
      ignoreSeen,
      ruleScoreCandidates:scored.length,
      scoringMode:'rule-based',
      rejectedRoleCandidates,
      matches:matches.length,
      dryRun:config.dryRun,
      durationMs:Date.now()-start
    },'Run complete');
  }finally{await context.close().catch(()=>{})}
}

if(once){
  try{await runOnce()}
  catch(e){logger.error({err:e},'Single run failed');process.exitCode=1}
}else{
  if(config.runOnStart)await runOnce().catch(e=>logger.error({err:e},'Run failed'));
  while(!stopping){
    await new Promise(r=>setTimeout(r,config.runEveryMinutes*60000));
    if(!stopping)await runOnce().catch(e=>logger.error({err:e},'Run failed'));
  }
}