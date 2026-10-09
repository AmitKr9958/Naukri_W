import test from 'node:test';
import assert from 'node:assert/strict';
import {nextSearchPageUrl,parseAgeHours,remoteJobMatchesPreferredLocation} from '../src/naukri.js';

test('finds Naukri Next page and avoids loops',()=>{
  const current='https://www.naukri.com/power-bi-developer-jobs-in-gurgaon';
  assert.equal(
    nextSearchPageUrl(current,[{text:'Next',href:'https://www.naukri.com/power-bi-developer-jobs-in-gurgaon-2'}]),
    'https://www.naukri.com/power-bi-developer-jobs-in-gurgaon-2'
  );
  assert.equal(nextSearchPageUrl(current,[{text:'Next',href:current}]),null);
});

test('keeps strict freshness parsing',()=>{
  assert.equal(parseAgeHours('30 minutes ago'),0.5);
  assert.equal(parseAgeHours('6 hours ago'),6);
  assert.equal(parseAgeHours('1 day ago'),24);
  assert.equal(parseAgeHours('3+ weeks ago'),504);
  assert.equal(parseAgeHours('3+ days ago'),72);
  assert.equal(parseAgeHours('2weeks ago'),336);
  assert.equal(parseAgeHours('not available'),null);
});

test('remote jobs must mention one of the preferred cities',()=>{
  const locations=['Delhi','Gurgaon','Gurugram','Noida','Jaipur'];
  assert.equal(remoteJobMatchesPreferredLocation({title:'Remote Power BI Developer',location:'Remote',description:'Work from anywhere, candidates must be based in Delhi NCR'},locations),true);
  assert.equal(remoteJobMatchesPreferredLocation({title:'Remote Data Analyst',location:'Remote',description:'Applicants must be based in Gurugram'},locations),true);
  assert.equal(remoteJobMatchesPreferredLocation({title:'Remote BI Analyst',location:'Remote',description:'Candidates in Noida preferred'},locations),true);
  assert.equal(remoteJobMatchesPreferredLocation({title:'Remote Reporting Analyst',location:'Remote',description:'Must be based in Jaipur'},locations),true);
  assert.equal(remoteJobMatchesPreferredLocation({title:'Remote Data Analyst',location:'Remote',description:'Open to applicants anywhere in India'},locations),false);
  assert.equal(remoteJobMatchesPreferredLocation({title:'Remote BI Developer',location:'Remote',description:'Candidates in Bengaluru only'},locations),false);
});
