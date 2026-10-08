import test from 'node:test';
import assert from 'node:assert/strict';
import {nextSearchPageUrl,parseAgeHours} from '../src/naukri.js';

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
