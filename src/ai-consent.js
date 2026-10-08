import readline from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import fs from 'node:fs/promises';

const rl=readline.createInterface({input,output});
const answer=(await rl.question('AI matching will send a redacted copy of your resume text to the configured AI provider. Continue? Type YES to consent: ')).trim().toUpperCase();
rl.close();

if(answer!=='YES'){
  console.log('AI consent not granted. AI remains disabled.');
  process.exit(0);
}

await fs.writeFile('.ai-consent',JSON.stringify({consentedAt:new Date().toISOString(),scope:'redacted resume text for job matching'},null,2));
console.log('AI consent saved locally. You must still set AI_CONSENT=true and AI_ENABLED=true in .env before AI is used.');
