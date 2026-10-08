import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';

const appData=process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming');
const dbPath=path.join(appData,'9router','db','data.sqlite');
const sqlitePath=path.join(appData,'9router','runtime','node_modules','better-sqlite3');
const require=createRequire(import.meta.url);
const Database=require(sqlitePath);
const db=new Database(dbPath,{readonly:true});
const row=db.prepare("SELECT key FROM apiKeys WHERE isActive=1 ORDER BY createdAt DESC LIMIT 1").get();
db.close();
if(!row?.key)throw new Error('No active 9Router API key found.');

const r=await fetch('http://localhost:20128/v1/chat/completions',{
  method:'POST',
  headers:{Authorization:'Bearer '+row.key,'Content-Type':'application/json'},
  body:JSON.stringify({
    model:'kc/nvidia/nemotron-3.5-lightning:free',
    messages:[{role:'user',content:'Reply with exactly: OK'}],
    max_tokens:64
  })
});
const text=await r.text();
console.log('HTTP_STATUS='+r.status);
if(!r.ok)throw new Error(text);
const clean=text.replace(/^data:\s*/gm,'').replace(/\n?data:\s*\[DONE\]\s*$/,'').trim();
const data=JSON.parse(clean);
const answer=data?.choices?.[0]?.message?.content?.trim();
console.log('MODEL_REPLY='+answer);
if(!answer)throw new Error('Model returned no content.');
console.log('9Router AI test passed.');
