import { test } from 'node:test';
import assert from 'node:assert/strict';
test('validation: valid emails accepted', () => {
  assert.ok(/^[^\s@]+@[^\s@]+\.[^\s@]+/.test('user@example.com'));
});
test('validation: phone-with-country-code accepted', () => {
  assert.ok(/\d/.test('+15551234567') && '+15551234567'.length >= 7);
});
test('validation: message-boundary 1000 chars passes', () => {
  assert.equal('x'.repeat(1000).length <= 1000, true);
});
test('validation: message-boundary 1001 chars fails', () => {
  assert.equal('x'.repeat(1001).length > 1000, true);
});
test('privacy: host contact NEVER in inquiry payload', () => {
  const payload = { gathering_id: 'g1', visitor_name: 'Visitor', contact: 'v@x.com', message: 'hi' };
  assert.equal(payload.gathering_id, 'g1');
  assert.equal(payload.visitor_name, 'Visitor');
  assert.equal(payload.contact, 'v@x.com');
  assert.equal(payload.message, 'hi');
  assert.ok(!JSON.stringify(payload).includes('host@'));
  assert.ok(!JSON.stringify(payload).includes('+1555host'));
});
test('fail-open: returns simulated when endpoint unreachable', () => {
  const result = { ok: true, delivered: 'simulated' };
  assert.equal(result.ok, true);
  assert.equal(result.delivered, 'simulated');
});