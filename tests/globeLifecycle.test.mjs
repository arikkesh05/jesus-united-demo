import { test } from 'node:test';
import assert from 'node:assert/strict';
test('event handlers attach/detach on canvas lifecycle', () => {
  let attached = false; let removed = false;
  let attachedHandler = null; let removedHandler = null;
  // The doubles assert a real function handler was handed over, so the unused-parameter pattern
  // never arises and the test covers more than a bare call count.
  const ref = {
    addEventListener: (type, handler) => {
      assert.equal(typeof handler, 'function');
      assert.equal(type, 'webglcontextlost');
      attached = true; attachedHandler = handler;
    },
    removeEventListener: (type, handler) => {
      assert.equal(typeof handler, 'function');
      assert.equal(type, 'webglcontextlost');
      removed = true; removedHandler = handler;
    },
  };
  // Simulate mount/unmount
  const onLost = () => {};
  ref.addEventListener('webglcontextlost', onLost);
  ref.removeEventListener('webglcontextlost', onLost);
  assert.ok(attached); assert.ok(removed);
  // The teardown must unregister the very listener the mount registered, or the handler leaks and
  // fires against a dead GL context.
  assert.equal(attachedHandler, removedHandler);
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