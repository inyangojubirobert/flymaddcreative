// Run: node --test __tests__/lib/onedreamHelpers.test.mjs
// (Rewritten from the old Jest version, which never ran.)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateReferralToken, calcVotesFromAmount, generateShareUrls, checkRateLimit, VOTE_VALUE, GOAL_VOTES,
} from '../../lib/onedreamHelpers.js';

describe('generateReferralToken', () => {
  test('returns a different lowercase alphanumeric token each time', () => {
    const a = generateReferralToken('test-user-123');
    const b = generateReferralToken('test-user-123');
    assert.equal(typeof a, 'string');
    assert.notEqual(a, b);
    assert.ok(a.length > 8);
    assert.match(a, /^[a-z0-9]+$/);
  });
});

describe('calcVotesFromAmount', () => {
  test('divides by VOTE_VALUE and floors', () => {
    assert.equal(VOTE_VALUE, 2);
    assert.equal(calcVotesFromAmount(10), 5);
    assert.equal(calcVotesFromAmount(100), 50);
    assert.equal(calcVotesFromAmount(3), 1);
    assert.equal(calcVotesFromAmount(1), 0);
    assert.equal(calcVotesFromAmount(0), 0);
    assert.equal(calcVotesFromAmount(VOTE_VALUE), 1);
  });
});

describe('generateShareUrls', () => {
  const url = 'https://example.com/onedream/ref/abc123';

  test('builds every network and includes the link', () => {
    const urls = generateShareUrls(url, 'John Doe');
    assert.deepEqual(Object.keys(urls).sort(), ['email', 'facebook', 'linkedin', 'twitter', 'whatsapp']);
    for (const share of Object.values(urls)) assert.ok(share.includes(encodeURIComponent(url)) || share.includes(url));
    assert.ok(urls.twitter.includes(encodeURIComponent('John Doe')));
    assert.ok(urls.email.includes('John Doe'));
  });

  test('falls back to "me" without a name', () => {
    const urls = generateShareUrls(url, '');
    assert.ok(urls.twitter.includes('me'));
    assert.ok(urls.email.includes('me'));
  });
});

describe('checkRateLimit', () => {
  test('allows up to the limit, then refuses', () => {
    for (let i = 0; i < 3; i++) assert.equal(checkRateLimit('rl-a', 3, 60_000), true);
    assert.equal(checkRateLimit('rl-a', 3, 60_000), false);
  });

  test('keeps a separate count per key', () => {
    assert.equal(checkRateLimit('rl-b', 1, 60_000), true);
    assert.equal(checkRateLimit('rl-c', 1, 60_000), true);
    assert.equal(checkRateLimit('rl-b', 1, 60_000), false);
  });
});

test('GOAL_VOTES default', () => {
  assert.equal(GOAL_VOTES, 1_000_000);
});
