import test from 'node:test';
import assert from 'node:assert/strict';
import {redactForAI} from '../src/ai.js';

test('AI redaction removes sensitive resume data',()=>{
  const input='Email amit@example.com Phone +91 9876543210 Salary 12 LPA PAN ABCDE1234F Address 12 Main Street';
  const out=redactForAI(input);
  assert.doesNotMatch(out,/amit@example\.com/i);
  assert.doesNotMatch(out,/9876543210/);
  assert.doesNotMatch(out,/12 LPA/);
  assert.doesNotMatch(out,/ABCDE1234F/);
  assert.doesNotMatch(out,/12 Main Street/);
});

test('redacts unlabelled PAN, Indian postal codes, and numbered street addresses',()=>{
  const out=redactForAI('ABCDE1234F, home at 12 Main Street.');
  const postal=redactForAI('Postal code 110059.');
  assert.doesNotMatch(out,/ABCDE1234F/i);
  assert.doesNotMatch(out,/12 Main Street/i);
  assert.doesNotMatch(postal,/110059/);
  assert.match(out,/\[ID REDACTED\]/);
  assert.match(out,/\[ADDRESS REDACTED\]/);
  assert.match(postal,/\[POSTAL CODE REDACTED\]/);
});
