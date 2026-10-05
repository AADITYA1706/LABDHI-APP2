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

test('fetchPeriodicData generates a fresh transaction ID after auth refresh', async () => {
  const environment = {
    CAMS_BASE_URL: process.env.CAMS_BASE_URL,
    CAMS_FIU_ID: process.env.CAMS_FIU_ID,
    CAMS_USER_ID: process.env.CAMS_USER_ID,
    CAMS_REDIRECTION_KEY: process.env.CAMS_REDIRECTION_KEY,
    CAMS_USE_CASE_ID: process.env.CAMS_USE_CASE_ID,
  };
  const originalPost = axios.post;
  const fetchRequests = [];

  Object.assign(process.env, {
    CAMS_BASE_URL: 'https://cams.test',
    CAMS_FIU_ID: 'Labdhi_UAT',
    CAMS_USER_ID: 'test-user',
    CAMS_REDIRECTION_KEY: 'test-key',
    CAMS_USE_CASE_ID: 'test-use-case',
  });
  axios.post = async (url, body, config) => {
    if (url.endsWith('/api/FIU/Authentication')) {
      return { status: 200, data: { token: 'refreshed-token', sessionId: 'auth-session' } };
    }

    if (url.endsWith('/api/FIData/v2/FetchPeriodicData')) {
      fetchRequests.push({ body, config });
      if (fetchRequests.length === 1) {
        const error = new Error('Unauthorized');
        error.response = { status: 401, data: {} };
        throw error;
      }
      return { status: 200, data: { success: true } };
    }

    throw new Error(`Unexpected CAMS request: ${url}`);
  };

  try {
    await cams.fetchPeriodicData({
      token: 'expired-token',
      sessionId: 'current-redirect-session',
      consentId: 'current-consent',
    });

    assert.equal(fetchRequests.length, 2);
    assert.notEqual(fetchRequests[0].body.txnId, fetchRequests[1].body.txnId);
    assert.equal(fetchRequests[0].body.sessionId, 'current-redirect-session');
    assert.equal(fetchRequests[1].body.sessionId, 'current-redirect-session');
    assert.equal(fetchRequests[0].body.consentId, 'current-consent');
    assert.equal(fetchRequests[1].body.consentId, 'current-consent');
    assert.equal(fetchRequests[0].config.headers.Authorization, 'Bearer expired-token');
    assert.equal(fetchRequests[1].config.headers.Authorization, 'Bearer refreshed-token');
  } finally {
    axios.post = originalPost;
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
