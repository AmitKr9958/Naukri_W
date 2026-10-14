import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJobUrl,
  countUniqueListingLinks,
  findPostedText,
  normalizeAgeLabel,
  nextSearchPageUrl,
  parseAgeHours,
  remoteJobMatchesPreferredLocation,
  selectSearchBatch
} from '../src/naukri.js';
import {isTargetRole, scoreJob, buildProfile} from '../src/matcher.js';

test('rotates query batches across successive cycles without losing coverage', () => {
  const queries = [
    'Power BI',
    'Data Analyst',
    'Business Intelligence',
    'Reporting Analyst',
    'Fabric Analytics Engineer',
    'Microsoft Fabric'
  ];
  assert.deepEqual(selectSearchBatch(queries, 3, 0), queries.slice(0, 3));
  assert.deepEqual(selectSearchBatch(queries, 3, 1), queries.slice(3, 6));
  assert.deepEqual(selectSearchBatch(queries, 3, 2), queries.slice(0, 3));
  assert.deepEqual(selectSearchBatch(queries, 10, 1), queries);
  assert.deepEqual(selectSearchBatch(['Power BI', 'Power BI', 'Data Analyst'], 1, 0), ['Power BI']);
  assert.deepEqual(selectSearchBatch(queries, 3, -1), queries.slice(3, 6));
});

test('finds Naukri Next page and avoids loops', () => {
  const current = 'https://www.naukri.com/power-bi-developer-jobs-in-gurgaon';
  assert.equal(
    nextSearchPageUrl(current, [{text: 'Next', href: 'https://www.naukri.com/power-bi-developer-jobs-in-gurgaon-2'}]),
    'https://www.naukri.com/power-bi-developer-jobs-in-gurgaon-2'
  );
  assert.equal(nextSearchPageUrl(current, [{text: 'Next', href: current}]), null);
});

test('posting-age extraction ignores contract durations in job titles', () => {
  assert.equal(findPostedText('Data Analyst (3 months Contract) | Remote'), '');
  assert.equal(findPostedText('Power BI Developer\n3+ weeks ago'), '3+ weeks ago');
  assert.equal(findPostedText('Data Analyst (3 months Contract)\nPosted: 4 hours ago'), '4 hours ago');
  assert.equal(findPostedText('Power BI Developer\nPosted today'), 'today');
  assert.equal(findPostedText('Data Analyst (3 months Contract)', 'Data Analyst (3 months Contract)'), '');
  assert.equal(findPostedText('5-8 years\nPower BI Developer'), '');
  assert.equal(findPostedText('Experience: 5 – 8 years'), '');
});

test('normalizes standalone posting-age labels without accepting contract durations', () => {
  assert.equal(normalizeAgeLabel('Posted: 4 hours ago'), '4 hours ago');
  assert.equal(normalizeAgeLabel('  3+ weeks ago · '), '3+ weeks ago');
  assert.equal(normalizeAgeLabel('Posted today'), 'today');
  assert.equal(normalizeAgeLabel('Data Analyst (3 months Contract)'), '');
  assert.equal(normalizeAgeLabel('3 months contract'), '');
  assert.equal(normalizeAgeLabel('3 months'), '');
  assert.equal(normalizeAgeLabel('5-8 years'), '');
  assert.equal(normalizeAgeLabel('Just now'), 'Just now');
  assert.equal(normalizeAgeLabel('few hours ago'), 'few hours ago');
});

test('parses supported recent-age formats including Today', () => {
  assert.equal(parseAgeHours('30 minutes ago'), 0.5);
  assert.equal(parseAgeHours('just now'), 0);
  assert.equal(parseAgeHours('moments ago'), 0);
  assert.equal(parseAgeHours('few minutes ago'), 0.25);
  assert.equal(parseAgeHours('few hours ago'), 3);
  assert.equal(parseAgeHours('1 hour ago'), 1);
  assert.equal(parseAgeHours('24 hours ago'), 24);
  assert.equal(parseAgeHours('6 hours ago'), 6);
  // Documented rule: "today" → 23h (conservative same-day upper bound)
  assert.equal(parseAgeHours('today'), 23);
  assert.equal(parseAgeHours('Posted today'), 23);
  assert.equal(parseAgeHours('Today'), 23);
  assert.equal(parseAgeHours('1 day ago'), 24);
  assert.equal(parseAgeHours('2 days ago'), 48);
  assert.equal(parseAgeHours('1 week ago'), 168);
  assert.equal(parseAgeHours('3+ weeks ago'), 504);
  assert.equal(parseAgeHours('3+ days ago'), 72);
  assert.equal(parseAgeHours('2weeks ago'), 336);
  assert.equal(parseAgeHours('yesterday'), 24);
  assert.equal(parseAgeHours('not available'), null);
  assert.equal(parseAgeHours(''), null);
  assert.equal(parseAgeHours(null), null);
});

test('unknown or ambiguous posting age returns null (never treated as fresh)', () => {
  assert.equal(parseAgeHours('posted recently'), null);
  assert.equal(parseAgeHours('a while ago'), null);
  assert.equal(parseAgeHours('last month'), null);
  assert.equal(parseAgeHours('N/A'), null);
  assert.equal(parseAgeHours('5-8 years'), null);
  assert.equal(parseAgeHours('3 months contract'), null);
});

test('freshness threshold boundary conditions', () => {
  const maxAge = 48;
  // Policy: reject when ageHours == null || ageHours > maxAgeHours.
  // Exactly at threshold → kept
  assert.equal(parseAgeHours('2 days ago'), 48);
  assert.equal(parseAgeHours('2 days ago') > maxAge, false);
  // Just inside
  assert.ok(parseAgeHours('1 day ago') < maxAge);
  assert.ok(parseAgeHours('today') < maxAge);
  assert.ok(parseAgeHours('24 hours ago') <= maxAge);
  // Just outside
  assert.ok(parseAgeHours('3 days ago') > maxAge);
  assert.ok(parseAgeHours('1 week ago') > maxAge);
  // Missing / unknown must not pass a freshness check (null is rejected)
  assert.equal(parseAgeHours('unknown label'), null);
});

test('counts distinct listing URLs instead of duplicate anchors', () => {
  assert.equal(countUniqueListingLinks([
    '/job-listings-power-bi-developer-123?src=title',
    'https://www.naukri.com/job-listings-power-bi-developer-123?src=company#details',
    '/job-listings-data-analyst-456',
    '/job-listings-reporting-789'
  ]), 3);
  assert.equal(countUniqueListingLinks([]), 0);
  assert.equal(countUniqueListingLinks([null, '']), 0);
});

test('canonical job URLs remove tracking parameters, fragments, and trailing slashes', () => {
  assert.equal(
    canonicalJobUrl('/job-listings-power-bi-developer-123456789?src=jobsearchDesk&sid=abc#apply'),
    'https://www.naukri.com/job-listings-power-bi-developer-123456789'
  );
  assert.equal(
    canonicalJobUrl('https://www.naukri.com/job-listings-power-bi-developer-123456789/?src=abc'),
    'https://www.naukri.com/job-listings-power-bi-developer-123456789'
  );
  assert.equal(
    canonicalJobUrl('https://www.naukri.com/job-listings-power-bi-developer-123456789/?src=jobsearchDesk&qp=power&xt=cat'),
    'https://www.naukri.com/job-listings-power-bi-developer-123456789'
  );
  assert.equal(
    canonicalJobUrl('https://www.naukri.com/job-listings-x-999/#section'),
    'https://www.naukri.com/job-listings-x-999'
  );
  const a = canonicalJobUrl('https://www.naukri.com/job-listings-foo-111?src=a');
  const b = canonicalJobUrl('https://www.naukri.com/job-listings-foo-111?src=b&sid=xyz');
  assert.equal(a, b);
  assert.equal(canonicalJobUrl(''), null);
  assert.equal(canonicalJobUrl(null), null);
});

test('remote jobs must mention one of the preferred cities', () => {
  const locations = ['Delhi', 'Gurgaon', 'Gurugram', 'Noida', 'Jaipur'];
  assert.equal(
    remoteJobMatchesPreferredLocation(
      {title: 'Remote Power BI Developer', location: 'Remote', description: 'Work from anywhere, candidates must be based in Delhi NCR'},
      locations
    ),
    true
  );
  assert.equal(
    remoteJobMatchesPreferredLocation(
      {title: 'Remote Data Analyst', location: 'Remote', description: 'Applicants must be based in Gurugram'},
      locations
    ),
    true
  );
  assert.equal(
    remoteJobMatchesPreferredLocation(
      {title: 'Remote BI Analyst', location: 'Remote', description: 'Candidates in Noida preferred'},
      locations
    ),
    true
  );
  assert.equal(
    remoteJobMatchesPreferredLocation(
      {title: 'Remote Reporting Analyst', location: 'Remote', description: 'Must be based in Jaipur'},
      locations
    ),
    true
  );
  assert.equal(
    remoteJobMatchesPreferredLocation(
      {title: 'Remote Data Analyst', location: 'Remote', description: 'Open to applicants anywhere in India'},
      locations
    ),
    false
  );
  assert.equal(
    remoteJobMatchesPreferredLocation(
      {title: 'Remote BI Developer', location: 'Remote', description: 'Candidates in Bengaluru only'},
      locations
    ),
    false
  );
});

test('role filter accepts valid BI/analytics titles and rejects false positives', () => {
  const minExp = 5;
  assert.equal(isTargetRole({title: 'Power BI Developer'}, minExp), true);
  assert.equal(isTargetRole({title: 'Senior Power BI Engineer'}, minExp), true);
  assert.equal(isTargetRole({title: 'Data Analyst'}, minExp), true);
  assert.equal(isTargetRole({title: 'Business Intelligence Analyst'}, minExp), true);
  assert.equal(isTargetRole({title: 'MIS Analyst'}, minExp), true);
  assert.equal(isTargetRole({title: 'Reporting Analyst'}, minExp), true);
  assert.equal(isTargetRole({title: 'Microsoft Fabric Analytics Engineer'}, minExp), true);
  assert.equal(isTargetRole({title: 'Power Platform Developer'}, minExp), true);
  assert.equal(isTargetRole({title: 'BI Developer'}, minExp), true);
  assert.equal(isTargetRole({title: 'Analytics Lead'}, minExp), true);

  assert.equal(isTargetRole({title: 'Java Developer'}, minExp), false);
  assert.equal(isTargetRole({title: 'Full Stack Software Engineer'}, minExp), false);
  assert.equal(isTargetRole({title: 'Data Engineer'}, minExp), false);
  assert.equal(isTargetRole({title: 'Recruitment Specialist'}, minExp), false);
  assert.equal(isTargetRole({title: 'Sales Executive'}, minExp), false);
  assert.equal(isTargetRole({title: 'Operations Manager'}, minExp), false);
  assert.equal(isTargetRole({title: 'QA Test Engineer'}, minExp), false);
  assert.equal(isTargetRole({title: 'DevOps Engineer'}, minExp), false);
  assert.equal(isTargetRole({title: 'Product Manager'}, minExp), false);
  assert.equal(isTargetRole({title: 'Power BI Intern'}, minExp), false);
  assert.equal(isTargetRole({title: 'Fresher Data Analyst'}, minExp), false);

  assert.equal(
    isTargetRole(
      {title: 'Power BI Developer', url: 'https://www.naukri.com/job-listings-power-bi-0-to-2-years-123'},
      minExp
    ),
    false
  );
});

test('scoring respects minMatchScore gate and experience signals', () => {
  const profile = buildProfile(
    'Power BI DAX Power Query SQL Microsoft Fabric Data Analyst 8 years',
    {
      roles: ['Power BI Developer', 'Data Analyst'],
      locations: ['Gurgaon', 'Delhi'],
      minExperienceYears: 5
    }
  );
  const good = scoreJob(
    {
      title: 'Power BI Developer',
      description: 'DAX, Power Query, SQL required',
      location: 'Gurgaon',
      company: 'Acme',
      ageHours: 2
    },
    profile
  );
  assert.ok(good.roleEligible);
  assert.ok(good.score >= 60, `expected score >= 60, got ${good.score}`);

  const unrelated = scoreJob(
    {title: 'Java Developer', description: 'Spring Boot', location: 'Gurgaon', ageHours: 1},
    profile
  );
  assert.equal(unrelated.roleEligible, false);
  assert.equal(unrelated.score, 0);
});
