import fs from 'node:fs/promises';
import {config,validateConfig} from './config.js';
import {logger} from './logger.js';
import {loadResume} from './resume.js';
import {buildProfile,scoreJob} from './matcher.js';
import {analyzeJobs} from './ai.js';
import {openNaukri,ensureLoggedIn,searchJobs} from './naukri.js';
import {loadSeen,saveSeen} from './state.js';
import {sendTelegram} from './telegram.js';

await fs.mkdir('logs',{recursive:true});
validateConfig();
let stopping=false;
process.on('SIGINT',()=>stopping=true);
process.on('SIGTERM',()=>stopping=true);

async function runOnce(){
  const start=Date.now();
  logger.info({aiEnabled:config.aiEnabled},'Run started');
  const resume=await loadResume(config.resumePath);
  const profile=buildProfile(resume.text,config);
  const seen=await loadSeen();
  const {context,page}=await openNaukri(config);
  try{
    await ensureLoggedIn(page);
    const candidates=await searchJobs(page,config);
    const unseen=candidates.filter(j=>!seen.has(j.url));
    const scored=unseen
      .map(j=>({...j,...scoreJob(j,profile)}))
      .sort((a,b)=>b.score-a.score);
    const aiEnabled=config.aiEnabled&&config.aiConsent;
    const pool=aiEnabled?scored.slice(0,config.aiCandidateLimit):scored.slice(0,config.maxJobsPerRun);
    if(aiEnabled)await analyzeJobs(config,pool,resume.text);

    const ranked=pool.filter(j=>{
      const score=j.finalScore??j.score;
      if(aiEnabled&&j.relevant===false)return false;
      return score>=config.minMatchScore;
    }).sort((a,b)=>(b.finalScore??b.score)-(a.finalScore??a.score));
    const matches=ranked.slice(0,config.maxJobsPerRun);

    if(matches.length)await sendTelegram(config,matches);
    // Mark jobs seen only after notification succeeds. If Telegram fails,
    // jobs remain eligible for the next hourly run instead of being lost.
    for(const j of candidates)seen.add(j.url);
    await saveSeen(seen);
    logger.info({candidates:candidates.length,unseen:unseen.length,aiCandidates:aiEnabled?pool.length:0,matches:matches.length,durationMs:Date.now()-start},'Run complete');
  }finally{await context.close().catch(()=>{})}
}

if(config.runOnStart)await runOnce().catch(e=>logger.error({err:e},'Run failed'));
while(!stopping){
  await new Promise(r=>setTimeout(r,config.runEveryMinutes*60000));
  if(!stopping)await runOnce().catch(e=>logger.error({err:e},'Run failed'));
}