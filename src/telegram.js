import {withRetry} from './retry.js';
import {logger} from './logger.js';

const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const escAttr=s=>esc(s).replace(/'/g,'&#39;');

export async function sendTelegram(c,jobs){
  if(c.dryRun){
    logger.info({jobs:jobs.length,dryRun:true},'Telegram delivery skipped in dry-run mode');
    return;
  }
  logger.info({jobs:jobs.length,dryRun:false},'Sending Telegram job alerts');
  for(let i=0;i<jobs.length;i+=5){
    const text=(i===0?'<b>Naukri matches — last 6 hours</b>\n\n':'')+jobs.slice(i,i+5).map(j=>{
      const score=j.finalScore??j.score;
      const ai=j.aiFit!=null?'\n<b>AI fit:</b> '+j.aiFit+'%\n<b>Why:</b> '+esc(j.aiReason||'Not provided')+(j.aiMissing?.length?'\n<b>Missing:</b> '+esc(j.aiMissing.join(', ')):''):'';
      return '<b>'+esc(j.title)+'</b> — '+esc(j.company)+'\n<b>Match:</b> '+score+'%'+ai+'\n<b>Location:</b> '+esc(j.location)+'\n<b>Posted:</b> '+(j.ageHours<1?Math.max(1,Math.round(j.ageHours*60))+' min ago':Math.round(j.ageHours*10)/10+' hr ago')+'\n<a href="'+escAttr(j.url)+'">Open job</a>';
    }).join('\n\n');
    await withRetry(async()=>{
      const r=await fetch(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:c.telegramChatId,text,parse_mode:'HTML',disable_web_page_preview:true}),signal:AbortSignal.timeout(c.httpTimeoutMs)});
      if(!r.ok){
        const detail=await r.text().catch(()=>'');
        throw new Error('Telegram error '+r.status+(detail?' '+detail.slice(0,300):''));
      }
      logger.info({batchStart:i+1,batchSize:Math.min(5,jobs.length-i)},'Telegram batch delivered');
    },{retries:2,delayMs:c.retryDelayMs});
  }
}