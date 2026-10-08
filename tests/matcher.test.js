import test from 'node:test';
import assert from 'node:assert/strict';
import {buildProfile,scoreJob} from '../src/matcher.js';

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
