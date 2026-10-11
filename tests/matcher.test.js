import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProfile,isTargetRole,scoreJob} from '../src/matcher.js';

const config={roles:['Power BI Developer'],locations:['Gurgaon','Delhi']};

test('relevant Power BI job scores above threshold',()=>{
  const p=buildProfile('Power BI DAX SQL Power Query Microsoft Fabric 7 years experience',config);
  const r=scoreJob({title:'Power BI Developer',description:'Power BI DAX SQL Power Query',location:'Gurgaon',ageHours:2},p);
  assert.ok(r.score>=60);
});

test('old jobs receive no recency points',()=>{
  const p=buildProfile('Power BI SQL 7 years experience',config);
  const fresh=scoreJob({title:'Power BI Developer',description:'Power BI SQL',location:'Delhi',ageHours:6},p);
  const old=scoreJob({title:'Power BI Developer',description:'Power BI SQL',location:'Delhi',ageHours:7},p);
  assert.equal(fresh.score-old.score,10);
});

test('unrelated job stays below the matching threshold',()=>{
  const p=buildProfile('Power BI DAX SQL 7 years experience',config);
  const r=scoreJob({title:'Java Developer',description:'Java Spring Boot',location:'Bengaluru',ageHours:2},p);
  assert.ok(r.score<60);
});

test('rejects unrelated roles even when description mentions transferable skills',()=>{
  assert.equal(isTargetRole({title:'Lead Software Engineer - .NET with Azure, React',description:'SQL, Power BI'}),false);
  assert.equal(isTargetRole({title:'Digital Marketing Executive',description:'Power BI reporting'}),false);
  assert.equal(isTargetRole({title:'Customer Support Engineer',description:'SQL dashboards'}),false);
});

test('accepts target Power BI, analytics, MIS, and Fabric titles',()=>{
  for(const title of ['Power BI Developer','Data Analyst','MIS Executive','Reporting Analyst','Microsoft Fabric Developer / Data Engineer','Fabric Analytics Engineer']){
    assert.equal(isTargetRole({title}),true,title);
  }
});

test('unrelated role gets a zero deterministic score',()=>{
  const p=buildProfile('Power BI DAX SQL Power Query Microsoft Fabric 7 years experience',config);
  const r=scoreJob({title:'Digital Marketing Executive',description:'Power BI, DAX, SQL',location:'Delhi',ageHours:1},p);
  assert.equal(r.score,0);
  assert.equal(r.roleEligible,false);
});

test('accepts expanded analytics, Power Platform, and Fabric role titles',()=>{
  for(const title of [
    'BI Developer',
    'Business Intelligence Developer',
    'Data Analytics Lead',
    'Analytics Manager',
    'Reporting Developer',
    'Power BI Consultant',
    'Power Platform Developer',
    'Microsoft Fabric Platform Administrator',
    'Fabric Data Architect',
    'MIS Executive'
  ]){
    assert.equal(isTargetRole({title}),true,title);
  }
});

test('rejects unrelated and entry-level job titles',()=>{
  for(const title of [
    'Digital Marketing Executive',
    'Customer Support Engineer',
    'Java Developer',
    'Power BI Developer Intern',
    'Data Analyst Trainee'
  ]){
    assert.equal(isTargetRole({title}),false,title);
  }
});
