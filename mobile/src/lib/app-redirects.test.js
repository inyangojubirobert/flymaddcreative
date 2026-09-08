const test = require('node:test');
const assert = require('node:assert/strict');

const { getLandingRoute } = require('./app-redirects');

test('guest users go to the login screen', () => {
  assert.equal(getLandingRoute(null), '/(auth)/login');
});

test('signed-in users are sent to the app home', () => {
  assert.equal(getLandingRoute('token-123'), '/(tabs)');
});
