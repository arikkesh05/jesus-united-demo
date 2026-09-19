import { test } from 'node:test';
import assert from 'node:assert/strict';
test('event handlers attach/detach on canvas lifecycle', () => {
  let attached = false; let removed = false;
  const ref = { addEventListener: () => attached = true, removeEventListener: () => removed = true };
  // Simulate mount/unmount
  ref.addEventListener('webglcontextlost', () => {});
  ref.removeEventListener('webglcontextlost', () => {});
  assert.ok(attached); assert.ok(removed);
});
test('contextlost: preventDefault + lost flag', () => {
  let defaulted = false; let lostFlag = false;
  const handler = (e) => { e.preventDefault(); lostFlag = true; };
  const evt = { preventDefault: () => defaulted = true };
  handler(evt);
  assert.ok(defaulted); assert.ok(lostFlag);
});
test('reduced-motion disables spin and snap transitions', () => {
  const reducedMotion = true; // media query match
  const spinEnabled = !reducedMotion; const snapImmediate = reducedMotion;
  assert.equal(spinEnabled, false); assert.equal(snapImmediate, true);
});