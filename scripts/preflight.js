import fs from 'node:fs/promises';
import {config,validateConfig} from '../src/config.js';
import {loadResume} from '../src/resume.js';

validateConfig();
if(!config.resumePath)throw new Error('RESUME_PATH is missing from local .env.');
const resume=await loadResume(config.resumePath);
if(!resume.text||resume.text.length<30)throw new Error('Resume text is empty or unexpectedly short; check the local resume file.');
const envExists=await fs.access('.env').then(()=>true).catch(()=>false);
if(!envExists)throw new Error('Local .env file is missing.');
console.log(JSON.stringify({
  event:'local-preflight-passed',
  environmentFilePresent:true,
  resumeLoaded:true,
  resumeCharacterCount:resume.text.length,
  dryRun:config.dryRun,
  aiEnabled:config.aiEnabled,
  aiConsent:config.aiConsent,
  aiEndpointConfigured:Boolean(config.aiBaseUrl),
  aiApiKeyConfigured:Boolean(config.aiApiKey),
  telegramConfigured:Boolean(config.telegramToken&&config.telegramChatId),
  targetRoleCount:config.roles.length,
  targetLocationCount:config.locations.length,
  searchQueryCount:config.searchQueries.length,
  browserLaunchPerformed:false,
  naukriSearched:false,
  telegramMessageSent:false
},null,2));
