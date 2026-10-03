import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCamsConsentStatus, isCamsConsentActive } from './camsStatus.js';

test('normalizeCamsConsentStatus trims and uppercases values', () => {
  assert.equal(normalizeCamsConsentStatus(' active '), 'ACTIVE');
  assert.equal(normalizeCamsConsentStatus({ consentStatus: 'Active' }), 'ACTIVE');
  assert.equal(normalizeCamsConsentStatus({ data: { status: 'approved' } }), 'APPROVED');
});

test('isCamsConsentActive accepts real-world CAMS status payloads', () => {
  assert.equal(isCamsConsentActive({ consentStatus: 'Active', consentId: 'abc123' }), true);
  assert.equal(isCamsConsentActive({ data: { status: 'approved', consentId: 'xyz456' } }), true);
  assert.equal(isCamsConsentActive({ consentStatus: 'PENDING', consentId: 'abc123' }), false);
  assert.equal(isCamsConsentActive({ consentStatus: 'ACTIVE' }), false);
});
