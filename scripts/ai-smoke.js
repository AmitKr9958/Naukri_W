import {config} from '../src/config.js';
import {analyzeJobs} from '../src/ai.js';

if(!config.aiEnabled){
  console.error('AI smoke test skipped: set AI_ENABLED=true in your local .env.');
  process.exitCode=1;
}else if(!config.aiConsent){
  console.error('AI smoke test skipped: set AI_CONSENT=true after reviewing the privacy note.');
  process.exitCode=1;
}else{
  const job={
    title:'Power BI Developer',
    company:'Synthetic Test Company',
    location:'Gurugram',
    description:'Build Power BI dashboards, DAX measures, Power Query transformations, SQL queries and data models.',
    url:'https://example.invalid/synthetic-test-job',
    score:80
  };
  console.log(JSON.stringify({event:'ai-smoke-test-started',model:config.aiModel,endpointConfigured:Boolean(config.aiBaseUrl),apiKeyConfigured:Boolean(config.aiApiKey),syntheticJobOnly:true},null,2));
  const [result]=await analyzeJobs(config,[job],
    'Power BI developer experienced in DAX, SQL, Power Query, data modelling and dashboard development.');
  const output={
    title:result.title,
    relevant:result.relevant,
    aiFit:result.aiFit,
    roleFit:result.roleFit,
    finalScore:result.finalScore,
    reason:result.aiReason
  };
  console.log(JSON.stringify(output,null,2));
  if(result.relevant===null||result.aiFit===null||result.roleFit===null){
    console.error('AI smoke test failed. Read the ai-scoring-failed diagnostic above; no Naukri search or Telegram message was sent.');
    process.exitCode=1;
  }else{
    console.log('AI smoke test passed. No Naukri search or Telegram message was sent.');
  }
}
