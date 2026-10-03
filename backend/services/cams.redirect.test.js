const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const cams = require('./cams');

test('readRedirect accepts CAMS consentHandle aliases and comma-delimited handles', () => {
  const response = {
    data: {
      sessionId: 'sess_123',
      consentHandleId: 'handle_abc,handle_def',
      txnId: 'txn_456',
      redirectUrl: 'https://example.com/cams',
    },
  };

  const parsed = cams.readRedirect(response);

  assert.equal(parsed.sessionId, 'sess_123');
  assert.equal(parsed.consentHandle, 'handle_abc');
  assert.equal(parsed.txnId, 'txn_456');
  assert.equal(parsed.redirectUrl, 'https://example.com/cams');
});

test('fetchPeriodicData generates a fresh transaction ID for every request', async () => {
  const environment = {
    CAMS_BASE_URL: process.env.CAMS_BASE_URL,
    CAMS_FIU_ID: process.env.CAMS_FIU_ID,
    CAMS_USER_ID: process.env.CAMS_USER_ID,
    CAMS_REDIRECTION_KEY: process.env.CAMS_REDIRECTION_KEY,
    CAMS_USE_CASE_ID: process.env.CAMS_USE_CASE_ID,
  };
  const originalPost = axios.post;
  const requests = [];

  Object.assign(process.env, {
    CAMS_BASE_URL: 'https://cams.test',
    CAMS_FIU_ID: 'Labdhi_UAT',
    CAMS_USER_ID: 'test-user',
    CAMS_REDIRECTION_KEY: 'test-key',
    CAMS_USE_CASE_ID: 'test-use-case',
  });
  axios.post = async (url, body) => {
    requests.push({ url, body });
    return { status: 200, data: { success: true } };
  };

  try {
    await cams.fetchPeriodicData({
      token: 'test-token',
      sessionId: 'session-test',
      txnId: 'redirect-transaction-id',
      consentId: 'consent-test',
    });
    await cams.fetchPeriodicData({
      token: 'test-token',
      sessionId: 'session-test',
      txnId: 'redirect-transaction-id',
      consentId: 'consent-test',
    });

    assert.equal(requests.length, 2);
    assert.equal(requests[0].url, 'https://cams.test/api/FIData/v2/FetchPeriodicData');
    assert.match(requests[0].body.txnId, /^[0-9a-f-]{36}$/i);
    assert.match(requests[1].body.txnId, /^[0-9a-f-]{36}$/i);
    assert.notEqual(requests[0].body.txnId, requests[1].body.txnId);
    assert.notEqual(requests[0].body.txnId, 'redirect-transaction-id');
    assert.notEqual(requests[1].body.txnId, 'redirect-transaction-id');
  } finally {
    axios.post = originalPost;
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
