import fs from 'node:fs/promises';
import {config,validateConfig} from './config.js';
import {logger} from './logger.js';
import {loadResume} from './resume.js';
import {buildProfile,scoreJob} from './matcher.js';
import {analyzeJobs} from './ai.js';
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
  logger.info({aiEnabled:config.aiEnabled,autoLogin:config.autoLogin,dryRun:config.dryRun,once,ignoreSeen},'Run started');
  const resume=await loadResume(config.resumePath);
  const profile=buildProfile(resume.text,config);
  const seen=await loadSeen();
  const {context,page}=await openNaukri(config);
  try{
    await ensureLoggedIn(page,config);
    const candidates=await searchJobs(page,config);
    const seenCandidates=candidates.filter(j=>seen.has(j.url));
    const unseen=ignoreSeen?candidates:candidates.filter(j=>!seen.has(j.url));
    const alreadySeen=seenCandidates.length;
    const scored=unseen.map(j=>({...j,...scoreJob(j,profile)})).sort((a,b)=>b.score-a.score);
    const aiEnabled=config.aiEnabled&&config.aiConsent;
    let pool=aiEnabled?scored.slice(0,config.aiCandidateLimit):scored.slice(0,config.maxJobsPerRun);
    logger.info({
      freshCandidates:candidates.length,
      unseenCandidates:unseen.length,
      alreadySeen,
      ignoreSeen,
      ruleScoreCandidates:scored.length,
      aiEnabled,
      aiPoolBeforeAnalysis:pool.length
    },'Pipeline candidates');
    if(aiEnabled)pool=await analyzeJobs(config,pool,resume.text);
    logger.info({
      candidates:pool.map(j=>({
        title:j.title,
        url:j.url,
        company:j.company,
        location:j.location,
        ruleScore:j.score,
        finalScore:j.finalScore??j.score,
        relevant:j.relevant,
        aiFit:j.aiFit,
        roleFit:j.roleFit,
        reason:j.aiReason
      })),
      minimumScore:config.minMatchScore
    },'Candidate scoring diagnostics');
    const ranked=pool.filter(j=>{
      const score=j.finalScore??j.score;
      if(aiEnabled&&j.relevant===false)return false;
      return score>=config.minMatchScore;
    }).sort((a,b)=>(b.finalScore??b.score)-(a.finalScore??a.score));
    const matches=ranked.slice(0,config.maxJobsPerRun);
    if(matches.length)await sendTelegram(config,matches);

    // A dry-run must be observational: do not mark jobs as seen, otherwise
    // a test could suppress those jobs in the next real alerting run.
    if(config.dryRun){
      logger.info({dryRun:true,stateUpdated:false},'Dry-run: seen-job state was not changed');
    }else{
      for(const j of candidates)seen.add(j.url);
      await saveSeen(seen);
    }
    logger.info({
      candidates:candidates.length,
      unseen:unseen.length,
      alreadySeen,
      ignoreSeen,
      ruleScoreCandidates:scored.length,
      aiCandidates:aiEnabled?pool.length:0,
      aiRelevant:aiEnabled?pool.filter(j=>j.relevant!==false).length:0,
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