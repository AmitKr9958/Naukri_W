test('rotates query batches across successive cycles without losing coverage',()=>{
  const queries=['Power BI','Data Analyst','Business Intelligence','Reporting Analyst','Fabric Analytics Engineer','Microsoft Fabric'];
  assert.deepEqual(selectSearchBatch(queries,3,0),queries.slice(0,3));
  assert.deepEqual(selectSearchBatch(queries,3,1),queries.slice(3,6));
  assert.deepEqual(selectSearchBatch(queries,3,2),queries.slice(0,3));
  assert.deepEqual(selectSearchBatch(queries,10,1),queries);
  assert.deepEqual(selectSearchBatch(['Power BI','Power BI','Data Analyst'],1,0),['Power BI']);
  assert.deepEqual(selectSearchBatch(queries,3,-1),queries.slice(3,6));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalJobUrl,findPostedText,normalizeAgeLabel,nextSearchPageUrl,parseAgeHours,remoteJobMatchesPreferredLocation,selectSearchBatch} from '../src/naukri.js';

test('finds Naukri Next page and avoids loops',()=>{
  const current='https://www.naukri.com/power-bi-developer-jobs-in-gurgaon';
  assert.equal(
    nextSearchPageUrl(current,[{text:'Next',href:'https://www.naukri.com/power-bi-developer-jobs-in-gurgaon-2'}]),
    'https://www.naukri.com/power-bi-developer-jobs-in-gurgaon-2'
  );
  assert.equal(nextSearchPageUrl(current,[{text:'Next',href:current}]),null);
});


test('posting-age extraction ignores contract durations in job titles',()=>{
  assert.equal(findPostedText('Data Analyst (3 months Contract) | Remote'), '');
  assert.equal(findPostedText('Power BI Developer\n3+ weeks ago'), '3+ weeks ago');
  assert.equal(findPostedText('Data Analyst (3 months Contract)\nPosted: 4 hours ago'), '4 hours ago');
  assert.equal(findPostedText('Power BI Developer\nPosted today'), 'today');
  assert.equal(findPostedText('Data Analyst (3 months Contract)', 'Data Analyst (3 months Contract)'), '');
});

test('normalizes standalone posting-age labels without accepting contract durations',()=>{
  assert.equal(normalizeAgeLabel('Posted: 4 hours ago'), '4 hours ago');
  assert.equal(normalizeAgeLabel('  3+ weeks ago · '), '3+ weeks ago');
  assert.equal(normalizeAgeLabel('Posted today'), 'today');
  assert.equal(normalizeAgeLabel('Data Analyst (3 months Contract)'), '');
  assert.equal(normalizeAgeLabel('3 months contract'), '');
  assert.equal(normalizeAgeLabel('3 months'), '');
});

test('keeps strict freshness parsing',()=>{
  assert.equal(parseAgeHours('30 minutes ago'),0.5);
  assert.equal(parseAgeHours('just now'),0);
  assert.equal(parseAgeHours('Posted today'),null);
  assert.equal(parseAgeHours('today'),null);
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

test('canonical job URLs remove tracking parameters and fragments',()=>{
  assert.equal(
    canonicalJobUrl('/job-listings-power-bi-developer-123456789?src=jobsearchDesk&sid=abc#apply'),
    'https://www.naukri.com/job-listings-power-bi-developer-123456789'
  );
  assert.equal(
    canonicalJobUrl('https://www.naukri.com/job-listings-power-bi-developer-123456789/?src=abc'),
    'https://www.naukri.com/job-listings-power-bi-developer-123456789'
  );
  assert.equal(canonicalJobUrl(''),null);
});
