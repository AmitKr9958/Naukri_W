import {withRetry} from './retry.js';

const redact=s=>String(s||'')
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[EMAIL REDACTED]')
  .replace(/(?:\+?91[-\s]?)?[6-9]\d{9}/g,'[PHONE REDACTED]')
  .replace(/\b(?:aadhaar|aadhar|pan|passport|account|bank)\s*(?:no|number|#)?\s*[:\-]?\s*[A-Z0-9-]{4,}\b/gi,'[ID REDACTED]')
  .replace(/\b(?:salary|ctc|compensation|expected package)\b[^.\n]{0,100}/gi,'[SALARY REDACTED]')
  .replace(/\b(?:address|residential address|home address)\b[^.\n]{0,150}/gi,'[ADDRESS REDACTED]');

const clip=s=>String(s||'').slice(0,12000);
export function redactForAI(text){return clip(redact(text));}

function parseJson(raw){
  const cleaned=String(raw||'').replace(/```json|```/gi,'').trim();
  const start=cleaned.indexOf('{');
  const end=cleaned.lastIndexOf('}');
  if(start<0||end<=start)throw new Error('AI did not return JSON');
  return JSON.parse(cleaned.slice(start,end+1));
}

export async function analyzeJobs(c,jobs,resumeText){
  if(!c.aiEnabled||!c.aiConsent||!jobs.length)return jobs;
  const resume=redactForAI(resumeText);
  const results=[];
  for(const job of jobs){
    try{
      const body={model:c.aiModel,messages:[
        {role:'system',content:'You are a strict job-matching evaluator. Return valid JSON only. Judge fit against the candidate resume, not generic desirability. Do not infer private information.'},
        {role:'user',content:JSON.stringify({
          resume,
          job:{title:redact(job.title),company:redact(job.company),location:redact(job.location),description:redactForAI(job.description)},
          task:'Evaluate this job for the candidate. Return JSON: relevant (boolean), fit (0-100), roleFit (0-100), reason (one short sentence), missing (up to 3 skills). Relevant must be false for a clearly unrelated role even if transferable skills exist.'
        })}
      ],temperature:0.1,max_tokens:260};
      const data=await withRetry(async()=>{
        const r=await fetch(c.aiBaseUrl.replace(/\/$/,'')+'/chat/completions',{
          method:'POST',
          headers:{Authorization:'Bearer '+c.aiApiKey,'Content-Type':'application/json'},
          body:JSON.stringify(body)
        });
        if(!r.ok)throw new Error('AI HTTP '+r.status);
        return r.json();
      },{retries:1,delayMs:c.retryDelayMs});
      const parsed=parseJson(data?.choices?.[0]?.message?.content||'');
      const aiFit=Math.max(0,Math.min(100,Number(parsed.fit)||0));
      const roleFit=Math.max(0,Math.min(100,Number(parsed.roleFit)||0));
      const relevant=parsed.relevant===true;
      const finalScore=relevant?Math.round(job.score*0.4+aiFit*0.45+roleFit*0.15):Math.min(job.score,Math.round(aiFit*0.4));
      results.push({...job,relevant,aiFit,roleFit,aiReason:String(parsed.reason||''),aiMissing:Array.isArray(parsed.missing)?parsed.missing.slice(0,3):[],finalScore});
    }catch{
      results.push({...job,relevant:null,aiFit:null,roleFit:null,aiReason:'AI unavailable; rule-based score retained.',aiMissing:[],finalScore:job.score});
    }
  }
  return results;
}
