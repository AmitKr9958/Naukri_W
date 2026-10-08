import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const appData=process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming');
const dbPath=path.join(appData,'9router','db','data.sqlite');
const sqlitePath=path.join(appData,'npm','node_modules','9router','runtime','node_modules','better-sqlite3');

if(!fs.existsSync(dbPath)) throw new Error('9Router database not found: '+dbPath);
if(!fs.existsSync(sqlitePath)) throw new Error('9Router SQLite driver not found: '+sqlitePath);

const Database=(await import(sqlitePath)).default||await import(sqlitePath);
const Ctor=typeof Database==='function'?Database:Database.default;
const db=new Ctor(dbPath,{readonly:true});
const row=db.prepare("SELECT key FROM apiKeys WHERE isActive=1 ORDER BY createdAt DESC LIMIT 1").get();
db.close();

if(!row?.key) throw new Error('No active 9Router API key found.');

const envPath=path.resolve('.env');
if(!fs.existsSync(envPath)) throw new Error('.env not found. Copy .env.example to .env first.');

let env=fs.readFileSync(envPath,'utf8');
const set=(name,value)=>{
  const re=new RegExp('^'+name+'=.*$','m');
  const line=name+'='+value;
  env=re.test(env)?env.replace(re,line):env.trimEnd()+'\\n'+line+'\\n';
};
set('AI_BASE_URL','http://localhost:20128/v1');
set('AI_API_KEY',row.key);
set('AI_MODEL','kc/nvidia/nemotron-3.5-lightning:free');
fs.writeFileSync(envPath,env);
console.log('9Router configuration saved to .env (API key not displayed).');
