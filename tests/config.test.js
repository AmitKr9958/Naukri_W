test('rejects invalid rotating search batch sizes',()=>{
  setValidConfig();
  config.searchBatchSize=0;
  assert.throws(()=>validateConfig(),/JOB_SEARCH_BATCH_SIZE/);
  setValidConfig();
  config.searchBatchSize=21;
  assert.throws(()=>validateConfig(),/JOB_SEARCH_BATCH_SIZE/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {config,validateConfig} from '../src/config.js';

function setValidConfig(){
  Object.assign(config,{
    resumePath:'C:\\resume.docx',
    naukriUrl:'https://www.naukri.com',
    dryRun:true,
    roles:['Power BI Developer'],
    locations:['Delhi'],
    maxAgeHours:6,
    minExperienceYears:5,
    minMatchScore:60,
    runEveryMinutes:30,
    maxPagesPerSearch:1,
    searchConcurrency:5,
    searchBatchSize:3,
    pageDelayMs:400,
    aiEnabled:false,
    aiConsent:false,
    aiBaseUrl:'http://localhost:20128/v1',
    aiApiKey:'',
    aiCandidateLimit:30,
    maxJobsPerRun:15,
    autoLogin:false,
    naukriUsername:'',
    naukriPassword:'',
    telegramToken:'',
    telegramChatId:''
  });
}

test('accepts a safe dry-run configuration',()=>{
  setValidConfig();
  assert.doesNotThrow(()=>validateConfig());
});

test('rejects invalid freshness, experience, and match-score ranges',()=>{
  setValidConfig();
  config.maxAgeHours=0;
  assert.throws(()=>validateConfig(),/JOB_MAX_AGE_HOURS/);
  setValidConfig();
  config.minExperienceYears=-1;
  assert.throws(()=>validateConfig(),/JOB_MIN_EXPERIENCE_YEARS/);
  setValidConfig();
  config.minMatchScore=101;
  assert.throws(()=>validateConfig(),/MIN_MATCH_SCORE/);
});

test('rejects invalid search concurrency and page cap',()=>{
  setValidConfig();
  config.searchConcurrency=6;
  assert.throws(()=>validateConfig(),/SEARCH_CONCURRENCY/);
  setValidConfig();
  config.maxPagesPerSearch=3;
  assert.throws(()=>validateConfig(),/MAX_PAGES_PER_SEARCH/);
});

test('requires an AI key only when opted-in remote AI is enabled',()=>{
  setValidConfig();
  config.aiEnabled=true;
  config.aiConsent=true;
  config.aiBaseUrl='https://openrouter.ai/api/v1';
  assert.throws(()=>validateConfig(),/AI_API_KEY/);
  config.aiConsent=false;
  assert.doesNotThrow(()=>validateConfig());
});

test('requires Telegram credentials outside dry-run mode',()=>{
  setValidConfig();
  config.dryRun=false;
  assert.throws(()=>validateConfig(),/TELEGRAM_BOT_TOKEN/);
});
