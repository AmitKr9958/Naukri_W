const esc=s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export async function sendTelegram(c,jobs){
  if(c.dryRun)return;
  for(let i=0;i<jobs.length;i+=5){
    const text=(i===0?'<b>Naukri matches — last 6 hours</b>\n\n':'')+jobs.slice(i,i+5).map(j=>{
      const score=j.finalScore??j.score;
      const ai=j.aiScore!=null?'\n<b>AI fit:</b> '+j.aiScore+'% ('+esc(j.aiFit)+')\n<b>Why:</b> '+esc((j.aiReasons||[]).join('; ')||'Not provided'):'';
      return '<b>'+esc(j.title)+'</b> — '+esc(j.company)+'\n<b>Match:</b> '+score+'%'+ai+'\n<b>Location:</b> '+esc(j.location)+'\n<b>Posted:</b> '+(j.ageHours<1?Math.max(1,Math.round(j.ageHours*60))+' min ago':Math.round(j.ageHours*10)/10+' hr ago')+'\n<a href="'+j.url+'">Open job</a>';
    }).join('\n\n');
    const r=await fetch(`https://api.telegram.org/bot${c.telegramToken}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:c.telegramChatId,text,parse_mode:'HTML',disable_web_page_preview:true})});
    if(!r.ok)throw new Error('Telegram error '+r.status);
  }
}