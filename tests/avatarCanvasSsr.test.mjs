import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import vm from 'node:vm';

/**
 * Hydration contract for `src/app/components/3d/AvatarCanvas.tsx`: the server pass, the first
 * client pass during hydration, and the `next/dynamic` loading placeholder all flow through the
 * same `AvatarSkeleton`, so they must emit the same outer tag and the same fill/layout classes —
 * and never a canvas or the legacy hero markup this viewport replaced (`h-64` / `sm:h-72` /
 * `max-w-[280px]`). Renders the real component through `react-dom/server`'s `renderToString` —
 * the same entry Next uses for the client-component SSR pass — inside the transpile sandbox
 * `watchmanStage.test.mjs` already uses, so markup drift fails here instead of as a runtime
 * hydration error in the browser console.
 */
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToString } = require('react-dom/server');

/** Transpile the real client component and instantiate it through a sandboxed require. */
function loadAvatarCanvas() {
  const source = readFileSync(
    new URL('../src/app/components/3d/AvatarCanvas.tsx', import.meta.url),
    'utf8',
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const moduleObj = { exports: {} };
  vm.runInNewContext(outputText, {
    exports: moduleObj.exports,
    module: moduleObj,
    // react / react/jsx-runtime / next/dynamic / framer-motion — the component's whole graph;
    // the `next/dynamic` loader never fires here because the mounted gate holds the skeleton.
    require: (id) => require(id),
    console,
  });
  return moduleObj.exports.default;
}

const AvatarCanvas = loadAvatarCanvas();

/** DailyReflection's hero stage, quoted verbatim so fill behaviour is tested in context. */
const STAGE_CLASS =
  'relative mx-auto mt-6 flex h-[380px] w-full max-w-[340px] items-center justify-center';

function renderStage(amenPulseCount) {
  return renderToString(
    React.createElement(
      'div',
      { className: STAGE_CLASS, role: 'img' },
      React.createElement(AvatarCanvas, { amenPulseCount }),
    ),
  );
}

describe('AvatarCanvas — hydration contract', () => {
  it('prerenders exactly the frosted skeleton, never the canvas or legacy hero markup', () => {
    const html = renderToString(
      React.createElement(AvatarCanvas, { amenPulseCount: 0 }),
    );

    assert.match(html, /aria-hidden="true"/);
    assert.match(
      html,
      /class="flex h-full w-full items-center justify-center rounded-\[1\.75rem\] border border-white\/10 bg-pill\/60 backdrop-blur-xl"/,
      'the outer container must keep the shared fill + pill-surface classes',
    );
    assert.match(html, /h-16 w-16 animate-pulse rounded-full bg-gold\/20/);

    assert.ok(!html.includes('<canvas'), 'the WebGL canvas must never reach server HTML');
    assert.ok(!html.includes('watchman-stage'), 'the R3F stage must never reach server HTML');
    assert.ok(
      !/h-64|sm:h-72|max-w-\[280px\]/.test(html),
      'the legacy hero classes must not creep back into the SSR tree',
    );
  });

  it('is byte-stable across renders and independent of props (server pass ≡ client first pass)', () => {
    // Rendering twice stands in for server-then-client: same code, same output. A Date/random/
    // storage-dependent branch in the pre-mount path would break the first equality; a prop leak
    // into the skeleton would break the second — both are runtime hydration errors in disguise.
    assert.equal(renderStage(0), renderStage(0));
    assert.equal(renderStage(0), renderStage(7));

    const html = renderStage(0);
    assert.ok(html.includes('h-[380px]'), 'the stage keeps the 380px viewport class');
    assert.ok(html.includes('h-full w-full'), 'the skeleton must fill the stage exactly');
    assert.ok(html.includes('max-w-[340px]'), 'the stage keeps its width cap');
  });
});
