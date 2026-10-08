import {withRetry} from './retry.js';

const redact=s=>String(s||'')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[EMAIL]')
  .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g,'[PHONE]')
  .replace(/\b(?:address|location)\s*[:=-].{0,120}/gi,'[ADDRESS]')
  .slice(0,12000);

function extractJson(text){
  const t=String(text||'').trim().replace(/^\`\`\`json\s*/i,'').replace(/^\`\`\`\s*/,'').replace(/\s*\`\`\`$/,'');
  const start=t.indexOf('{'),end=t.lastIndexOf('}');
  if(start<0||end<start) throw new Error('AI returned non-JSON output');
  return JSON.parse(t.slice(start,end+1));
}

export async function analyzeJobWithAI(c,job,resumeText){
  if(!c.aiEnabled||!c.aiApiKey) return null;
  const prompt={
    resume:redact(resumeText),
    job:{title:job.title,company:job.company,location:job.location,description:redact(job.description)}
  };
  const body={
    model:c.aiModel,
    temperature:0.1,
    max_tokens:500,
    messages:[
      {role:'system',content:'You are a strict job-fit evaluator. Return JSON only: {"score":0-100,"fit":"strong|moderate|weak","reasons":["..."],"missing":["..."],"experience_match":true|false}. Score actual fit, not keyword density. Do not invent facts.'},
      {role:'user',content:JSON.stringify(prompt)}
    ]
  };
  const r=await withRetry(()=>fetch(c.aiBaseUrl.replace(/\/$/, '')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+c.aiApiKey},body:JSON.stringify(body)}),{retries:c.maxRetries,delayMs:c.retryDelayMs});
  if(!r.ok) throw new Error('AI provider error '+r.status);
  const data=await r.json();
  const content=data?.choices?.[0]?.message?.content;
  if(!content) throw new Error('AI provider returned no content');
  return extractJson(content);
}

export async function analyzeJobs(c,jobs,resumeText){
  if(!c.aiEnabled||!c.aiApiKey) return jobs;
  const out=[];
  for(const job of jobs){
    try{
      const ai=await analyzeJobWithAI(c,job,resumeText);
      if(ai) out.push({...job,aiScore:Number(ai.score)||0,aiFit:ai.fit||'weak',aiReasons:Array.isArray(ai.reasons)?ai.reasons.slice(0,3):[],aiMissing:Array.isArray(ai.missing)?ai.missing.slice(0,3):[],finalScore:Math.round(job.score*0.4+(Number(ai.score)||0)*0.6)});
      else out.push(job);
    }catch(err){
      out.push({...job,aiError:err.message});
    }
  }
  return out;
}