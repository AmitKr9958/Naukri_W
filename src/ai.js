import {withRetry} from './retry.js';

const redact=s=>String(s||'')
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[EMAIL REDACTED]')
  .replace(/(?:\+?91[-\s]?)?[6-9]\d{9}/g,'[PHONE REDACTED]')
  .replace(/\b(?:aadhaar|aadhar|pan|passport|account|bank)\s*(?:no|number|#)?\s*[:\-]?\s*[A-Z0-9-]{4,}\b/gi,'[ID REDACTED]')
  .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/gi,'[ID REDACTED]')
  .replace(/\b\d{4}\s?\d{4}\s?\d{4}\b/g,'[ID REDACTED]')
  .replace(/\b(?:salary|ctc|compensation|expected package)\b[^.\n]{0,100}/gi,'[SALARY REDACTED]')
  .replace(/\b(?:address|residential address|home address)\b[^.\n]{0,150}/gi,'[ADDRESS REDACTED]')
  .replace(/\b\d{1,5}\s+(?:[A-Za-z0-9.'-]+\s+){0,5}(?:road|rd|street|st|lane|marg|nagar|colony|sector|block|phase|extension|extn|apartment|flat|floor|house|plot|society|residency)\b[^.\n]{0,100}/gi,'[ADDRESS REDACTED]')
  .replace(/\b[1-9]\d{5}\b/g,'[POSTAL CODE REDACTED]');

const clip=s=>String(s||'').slice(0,12000);
export function redactForAI(text){return clip(redact(text));}

function parseJson(raw){
  const cleaned=String(raw||'').replace(/```json|\`\`\`/gi,'').trim();
  const start=cleaned.indexOf('{');
  const end=cleaned.lastIndexOf('}');
  if(start<0||end<=start)throw new Error('AI returned no JSON object (content may be empty or reasoning-only)');
  let parsed;
  try{parsed=JSON.parse(cleaned.slice(start,end+1));}
  catch{throw new Error('AI returned invalid JSON');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('AI JSON must be an object');
  return parsed;
}

function messageText(message){
  if(typeof message?.content==='string'&&message.content.trim())return message.content;
  if(Array.isArray(message?.content)){
    const text=message.content.filter(part=>typeof part?.text==='string').map(part=>part.text).join('\n');
    if(text.trim())return text;
  }
  // Some reasoning models place the answer in a separate field when content is empty.
  if(typeof message?.reasoning==='string'&&message.reasoning.trim())return message.reasoning;
  if(Array.isArray(message?.reasoning_details)){
    const text=message.reasoning_details.filter(part=>typeof part?.text==='string').map(part=>part.text).join('\n');
    if(text.trim())return text;
  }
  throw new Error('AI response had empty message content');
}

async function analyzeOne(c,job,resume){
  const body={model:c.aiModel,messages:[
    {role:'system',content:'You are a strict job-matching evaluator. Reply with ONE valid JSON object only: {"relevant":true,"fit":0,"roleFit":0,"reason":"short sentence","missing":[]}. Keys required: relevant (boolean), fit (number 0-100), roleFit (number 0-100), reason (short non-empty string), missing (array of up to 3 strings). Judge fit against the candidate resume only. Do not infer private information. Relevant must be false for a clearly unrelated role even if transferable skills exist. Do not include markdown, code fences, preamble, or chain-of-thought.'},
    {role:'user',content:JSON.stringify({
      resume,
      job:{title:redact(job.title),company:redact(job.company),location:redact(job.location),description:redactForAI(job.description)},
      task:'Evaluate this job for the candidate and return the required JSON object.'
    })}
  ],temperature:0.1,max_tokens:1200,stream:false};

  const data=await withRetry(async()=>{
    const r=await fetch(c.aiBaseUrl.replace(/\/$/,'')+'/chat/completions',{
      method:'POST',
      headers:{Authorization:'Bearer '+c.aiApiKey,'Content-Type':'application/json'},
      body:JSON.stringify(body),
      signal:AbortSignal.timeout(c.httpTimeoutMs)
    });
    const responseText=await r.text();
    if(!r.ok){
      let detail='';
      try{detail=String(JSON.parse(responseText)?.error?.message||'');}catch{}
      detail=detail.replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0,180);
      throw new Error('AI HTTP '+r.status+(detail?': '+detail:''));
    }
    let response;
    try{response=JSON.parse(responseText);}
    catch{throw new Error('AI endpoint returned invalid response JSON');}
    return response;
  },{retries:1,delayMs:c.retryDelayMs});

  const choice=data?.choices?.[0];
  let message=choice?.message;
  if(!message&&typeof choice?.text==='string')message={content:choice.text};
  if(!message&&typeof data?.output_text==='string')message={content:data.output_text};
  if(!message){
    const providerError=String(data?.error?.message||data?.message||data?.detail||'').replace(/Bearer\\s+\\S+/gi,'Bearer [REDACTED]').slice(0,180);
    const keys=data&&typeof data==='object'?Object.keys(data).slice(0,12).join(','):'non-object';
    const choiceKeys=choice&&typeof choice==='object'?Object.keys(choice).slice(0,12).join(','):'none';
    throw new Error('AI response has no usable assistant message (topLevelKeys='+keys+'; choiceKeys='+choiceKeys+(providerError?'; providerError='+providerError:'')+')');
  }
  const parsed=parseJson(messageText(message));
  if(typeof parsed.relevant!=='boolean')throw new Error('AI relevant must be boolean');
  const aiFit=Number(parsed.fit);
  const roleFit=Number(parsed.roleFit);
  if(!Number.isFinite(aiFit)||aiFit<0||aiFit>100)throw new Error('AI fit must be 0-100');
  if(!Number.isFinite(roleFit)||roleFit<0||roleFit>100)throw new Error('AI roleFit must be 0-100');
  if(typeof parsed.reason!=='string'||!parsed.reason.trim())throw new Error('AI reason is missing');
  const relevant=parsed.relevant;
  const finalScore=relevant?Math.round(job.score*0.4+aiFit*0.45+roleFit*0.15):Math.min(job.score,Math.round(aiFit*0.4));
  return {...job,relevant,aiFit,roleFit,aiReason:parsed.reason.trim(),aiMissing:Array.isArray(parsed.missing)?parsed.missing.filter(x=>typeof x==='string').slice(0,3):[],finalScore};
}

export async function analyzeJobs(c,jobs,resumeText){
  if(!c.aiEnabled||!c.aiConsent||!jobs.length)return jobs;
  const resume=redactForAI(resumeText);
  const results=new Array(jobs.length);
  const concurrency=Math.min(3,jobs.length);
  let next=0;
  const worker=async()=>{
    while(true){
      const i=next++;
      if(i>=jobs.length)return;
      try{results[i]=await analyzeOne(c,jobs[i],resume);}
      catch(err){
        const error=String(err?.message||err||'Unknown AI error').replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]').slice(0,300);
        console.warn(JSON.stringify({event:'ai-scoring-failed',title:String(jobs[i].title||'').slice(0,120),model:c.aiModel,error}));
        results[i]={...jobs[i],relevant:null,aiFit:null,roleFit:null,aiReason:'AI unavailable; rule-based score retained.',aiMissing:[],finalScore:jobs[i].score};
      }
    }
  };
  await Promise.all(Array.from({length:concurrency},()=>worker()));
  return results;
}
