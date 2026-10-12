const norm=s=>String(s||'').toLowerCase();
const tokens=s=>new Set(norm(s).split(/[^a-z0-9+#.-]+/).filter(x=>x.length>1));

// Gate on the job title before scoring. Skills mentioned in an unrelated job
// description must never turn a software, marketing, support, or internship role
// into a Power BI / analytics match.
export function isTargetRole(job, minExperienceYears = 5){
  const title=norm(job?.title).replace(/\s+/g,' ').trim();
  if(!title)return false;

  // Exclude roles outside the BI/analytics target, even when a broad word such
  // as "data" appears in the title. Fabric-specific engineering roles remain valid.
  if(/\b(intern|internship|trainee|apprentice|fresher|freshers)\b/.test(title))return false;
  if(/\b(big data|full.?stack|software engineer|java developer|python developer|network engineer|etl tester|qa tester|test engineer|devops engineer|product manager|project manager)\b/.test(title))return false;
  if(/\bdata engineer\b/.test(title) && !/\b(fabric|analytics)\b/.test(title))return false;

  // Naukri URLs commonly encode experience as "0-to-2-years". Reject clearly
  // junior roles below the configured minimum; unknown ranges are left to AI.
  const minYears=Number.isFinite(Number(minExperienceYears)) ? Number(minExperienceYears) : 5;
  const experienceSource=[job?.url,job?.experience].filter(Boolean).join(' ');
  const range=experienceSource.match(/(\d{1,2})\s*(?:-\s*to\s*-?|to|-)\s*(\d{1,2})[-\s]*(?:years?|yrs?)\b/i);
  if(range && Number(range[2]) < minYears)return false;

  return (
    /\bpower\s*bi\b/.test(title) ||
    /\bbusiness intelligence\b/.test(title) ||
    /\bbi\s+(?:developer|analyst|engineer|consultant|lead|manager|architect|specialist)\b/.test(title) ||
    /\b(?:data|business|reporting|mis)\s+(?:analyst|analytics analyst|intelligence analyst|developer|consultant|lead|manager|specialist|architect)\b/.test(title) ||
    /\bmis\s+executive\b/.test(title) ||
    /\b(?:analytics|data analytics)\s+(?:team\s+)?(?:lead|manager|head|specialist|consultant|developer|engineer|architect)\b/.test(title) ||
    /\b(?:reporting|analytics|business intelligence|data analytics)\b.*\b(?:lead|manager|head|team lead)\b/.test(title) ||
    (/\bfabric\b/.test(title) && /\b(?:data|analytics|bi|developer|engineer|architect|consultant|lead|microsoft|platform|administrator|admin|specialist)\b/.test(title)) ||
    /\bpower platform\b/.test(title)
  );
}

const roleSignals=[
  ['power bi',18],
  ['business intelligence',18],
  ['business intelligence analyst',18],
  ['data analytics specialist',18],
  ['data analyst',18],
  ['bi ',12],
  ['data analytics',12],
  ['reporting',10],
  ['mis ',8],
  ['analytics',8],
  ['team lead',8],
  ['technical lead',6],
  ['lead',4],
  ['microsoft fabric',8]
];

export function buildProfile(text,config){
  const y=(text.match(/(\d{1,2})\+?\s*(?:years?|yrs?)/i)||[])[1];
  return {
    text,
    tokens:tokens(text),
    roles:config.roles.map(norm),
    years:Number(y||0),
    minExperienceYears:Number.isFinite(Number(config.minExperienceYears)) ? Number(config.minExperienceYears) : 5,
    locations:config.locations.map(norm)
  };
}

export function scoreJob(job,p){
  if(!isTargetRole(job,p.minExperienceYears)) return {score:0,matched:[],roleEligible:false};
  const h=norm([job.title,job.description,job.company,job.location].join(' '));
  const title=norm(job.title);
  let score=0,matched=[];

  for(const r of p.roles){
    if(title.includes(r)){
      score+=25;
      matched.push(r);
    }
  }

  for(const [signal,points] of roleSignals){
    if(h.includes(signal)&&p.text.toLowerCase().includes(signal)){
      score+=points;
      matched.push(signal.trim());
    }
  }

  for(const s of ['power bi','dax','power query','sql','microsoft fabric','tableau','snowflake','excel','power automate','alteryx']){
    if(h.includes(s)&&p.text.toLowerCase().includes(s)){
      score+=8;
      matched.push(s);
    }
  }

  if(p.locations.some(l=>norm(job.location).includes(l)))score+=15;
  if(Number.isFinite(job.ageHours)&&job.ageHours<=6)score+=10;

  return {
    score:Math.min(100,score),
    matched:[...new Set(matched)],
    roleEligible:true
  };
}
