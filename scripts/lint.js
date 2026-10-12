import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const roots=['src','scripts','test','tests'];
const files=[];
async function walk(dir){
  let entries;
  try{entries=await fs.readdir(dir,{withFileTypes:true});}
  catch(err){if(err.code==='ENOENT')return;throw err;}
  for(const entry of entries){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())await walk(full);
    else if(entry.isFile()&&entry.name.endsWith('.js'))files.push(full);
  }
}
for(const root of roots)await walk(root);
files.sort();
if(!files.length)throw new Error('No JavaScript files found to lint.');
let failed=0;
for(const file of files){
  const result=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});
  if(result.error){console.error(result.error.message);failed++;}
  else if(result.status!==0)failed++;
}
if(failed){
  console.error(`JavaScript syntax check failed for ${failed} of ${files.length} files.`);
  process.exitCode=1;
}else{
  console.log(`JavaScript syntax check passed for all ${files.length} files.`);
}
