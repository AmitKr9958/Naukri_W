import {withRetry} from './retry.js';
const redact=s=>String(s||'').replace(/[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}/g,'[EMAIL REDACTED]').replace(/(?:\\+?91[-\\s]?)?[6-9]\\d{9}/g,'[PHONE REDACTED]').replace(/\\b(?:aadhaar|aadhar|pan|passport|account|bank)\\s*(?:no|number|#)?\\s*[:\\-]?\\s*[A-Z0-9-]{4,}\\b/gi,'[ID REDACTED]').replace(/\\b(?:salary|ctc|compensation|expected package)\\b[^.\\n]{0,100}/gi,'[SALARY REDACTED]').replace(/\\b(?:address|residential address|home address)\\b[^.\\n]{0,150}/gi,'[ADDRESS REDACTED]');
const clip=s=>String(s||'').slice(0,12000);
export function redactForAI(text){return clip(redact(text));}
export async function analyzeJobs(c,jobs,resumeText){
 if(!c.aiEnabled||!c.aiApiKey||!jobs.length)return jobs;
 const resume=redactForAI(resumeText); const results=[];
 for(const job of jobs){
  try{
   const body={model:c.aiModel,messages:[{role:'system',content:'You are a concise job-matching assistant. Return valid JSON only.'},{role:'user',content:JSON.stringify({resume,job:{title:job.title,company:job.company,location:job.location,description:clip(job.description)},task:'Return JSON: {"fit":0-100,"reason":"one short sentence","missing":["up to 3 skills"]}. Do not infer private information.'})}],temperature:0.1,max_tokens:220};
   const data=await withRetry(async()=>{const r=await fetch(c.aiBaseUrl.replace(/\\/$/,'')+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+c.aiApiKey,'Content-Type':'application/json'},body:JSON.stringify(body)});if(!r.ok)throw new Error('AI HTTP '+r.status);return r.json()},{retries:1,delayMs:c.retryDelayMs});
   const raw=data?.choices?.[0]?.message?.content||''; const parsed=JSON.parse(raw.replace(/^\\s*```json\\s*|\\s*```\\s*$/g,''));
   results.push({...job,aiFit:Number(parsed.fit)||0,aiReason:String(parsed.reason||''),aiMissing:Array.isArray(parsed.missing)?parsed.missing.slice(0,3):[]});
  }catch{results.push({...job,aiFit:null,aiReason:'AI analysis unavailable; rule-based score retained.',aiMissing:[]});}
 } return results;
}