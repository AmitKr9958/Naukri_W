const norm=s=>String(s||'').toLowerCase();
const tokens=s=>new Set(norm(s).split(/[^a-z0-9+#.-]+/).filter(x=>x.length>1));

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
    locations:config.locations.map(norm)
  };
}

export function scoreJob(job,p){
  const h=norm([job.title,job.description,job.company,job.location].join(' '));
  const title=norm(job.title);
  let score=0,matched=[];

  for(const r of p.roles){
    if(title.includes(r)||h.includes(r)){
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
    matched:[...new Set(matched)]
  };
}