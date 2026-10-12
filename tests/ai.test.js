import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeJobs,redactForAI} from '../src/ai.js';

const baseConfig={
  aiEnabled:true,
  aiConsent:true,
  aiBaseUrl:'https://openrouter.ai/api/v1',
  aiApiKey:'test-key-not-real',
  aiModel:'test/model:free',
  httpTimeoutMs:1000,
  retryDelayMs:1
};
const job={title:'Power BI Developer',company:'Example Co',location:'Gurugram',description:'Power BI, DAX and SQL reporting.',url:'https://example.com/job',score:80};
const resume='Power BI developer with DAX, SQL and Power Query experience.';

function mockResponse(payload,status=200){
  return new Response(JSON.stringify(payload),{status,headers:{'Content-Type':'application/json'}});
}

test('redacts common personal data before AI use',()=>{
  const text=redactForAI('Email amit@example.com, phone 9876543210, salary 12 LPA.');
  assert.doesNotMatch(text,/amit@example\.com/);
  assert.doesNotMatch(text,/9876543210/);
  assert.match(text,/\[EMAIL REDACTED\]/);
  assert.match(text,/\[PHONE REDACTED\]/);
});

test('scores a valid structured AI response and disables streaming',async()=>{
  const originalFetch=globalThis.fetch;
  let request;
  globalThis.fetch=async(url,options)=>{
    request={url:String(url),body:JSON.parse(options.body),authorization:options.headers.Authorization};
    return mockResponse({choices:[{message:{role:'assistant',content:JSON.stringify({
      relevant:true,fit:90,roleFit:80,reason:'Strong match for Power BI and SQL.',missing:['Fabric']
    })}}]});
  };
  try{
    const [result]=await analyzeJobs(baseConfig,[job],resume);
    assert.equal(result.relevant,true);
    assert.equal(result.aiFit,90);
    assert.equal(result.roleFit,80);
    assert.equal(result.finalScore,85);
    assert.equal(request.url,'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(request.body.stream,false);
    assert.deepEqual(request.body.response_format,{type:'json_object'});
    assert.equal(request.body.model,baseConfig.aiModel);
    assert.equal(request.authorization,'Bearer test-key-not-real');
  }finally{globalThis.fetch=originalFetch;}
});

test('logs a useful diagnostic and falls back safely when AI content is empty',async()=>{
  const originalFetch=globalThis.fetch;
  const originalWarn=console.warn;
  const warnings=[];
  globalThis.fetch=async()=>mockResponse({choices:[{message:{role:'assistant',content:null}}]});
  console.warn=(message)=>warnings.push(String(message));
  try{
    const [result]=await analyzeJobs(baseConfig,[job],resume);
    assert.equal(result.relevant,null);
    assert.equal(result.aiFit,null);
    assert.equal(result.finalScore,job.score);
    assert.equal(result.aiReason,'AI unavailable; rule-based score retained.');
    assert.equal(warnings.length,1);
    assert.match(warnings[0],/ai-scoring-failed/);
    assert.match(warnings[0],/AI response had empty assistant content/);
    assert.doesNotMatch(warnings[0],/test-key-not-real/);
  }finally{globalThis.fetch=originalFetch;console.warn=originalWarn;}
});


test('accepts OpenAI-compatible choice text responses',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>mockResponse({choices:[{text:JSON.stringify({
    relevant:true,fit:85,roleFit:90,reason:'Strong match.',missing:[]
  })}]});
  try{
    const [result]=await analyzeJobs(baseConfig,[job],resume);
    assert.equal(result.relevant,true);
    assert.equal(result.aiFit,85);
    assert.equal(result.roleFit,90);
  }finally{globalThis.fetch=originalFetch;}
});

test('reports safe response-shape diagnostics when endpoint returns no choices',async()=>{
  const originalFetch=globalThis.fetch;
  const originalWarn=console.warn;
  const warnings=[];
  globalThis.fetch=async()=>mockResponse({error:{message:'model temporarily unavailable'},request_id:'synthetic-id'});
  console.warn=(message)=>warnings.push(String(message));
  try{
    const [result]=await analyzeJobs(baseConfig,[job],resume);
    assert.equal(result.relevant,null);
    assert.match(warnings[0],/topLevelKeys=error,request_id/);
    assert.match(warnings[0],/providerError=model temporarily unavailable/);
    assert.doesNotMatch(warnings[0],/test-key-not-real/);
  }finally{globalThis.fetch=originalFetch;console.warn=originalWarn;}
});


test('retries once without JSON mode when the provider returns reasoning-only content',async()=>{
  const originalFetch=globalThis.fetch;
  const requests=[];
  const answer={relevant:true,fit:88,roleFit:90,reason:'Strong Power BI and SQL match.',missing:[]};
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    requests.push(body);
    if(requests.length===1)return mockResponse({choices:[{message:{role:'assistant',content:'',reasoning:'I should evaluate the candidate carefully.'}}]});
    return mockResponse({choices:[{message:{role:'assistant',content:JSON.stringify(answer)}}]});
  };
  try{
    const [result]=await analyzeJobs(baseConfig,[job],resume);
    assert.equal(result.relevant,true);
    assert.equal(result.aiFit,88);
    assert.equal(result.roleFit,90);
    assert.equal(requests.length,2);
    assert.deepEqual(requests[0].response_format,{type:'json_object'});
    assert.equal('response_format' in requests[1],false);
    assert.match(requests[1].messages.at(-1).content,/Return exactly one compact JSON object/);
  }finally{globalThis.fetch=originalFetch;}
});

test('does not call AI when consent is disabled',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error('fetch must not be called');};
  try{
    const [result]=await analyzeJobs({...baseConfig,aiConsent:false},[job],resume);
    assert.equal(result,job);
  }finally{globalThis.fetch=originalFetch;}
});
