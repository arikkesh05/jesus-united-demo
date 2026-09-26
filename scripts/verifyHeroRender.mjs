/**
 * Reports the hero stage's geometry, then screenshots exactly that rect.
 *
 * Kept deliberately small: every step gets its own hard timeout so a stalled CDP call fails loudly
 * instead of hanging the run, and the screenshot is the ground truth for "did the model paint"
 * (an in-page canvas read returns blank under `preserveDrawingBuffer: false`).
 *
 * Usage: node scripts/verifyHeroRender.mjs [--url http://localhost:3111/] [--out /tmp/hero-verify]
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { get as httpGet } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const URL_ = arg("url", "http://localhost:3111/");
const OUT = arg("out", "/tmp/hero-verify");
const PORT = Number(arg("port", "9444"));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=/tmp/cprof-hero-${PORT}`,
    // Headless Chrome ships no GPU; SwiftShader is the only way WebGL exists in this VM.
    "--enable-unsafe-swiftshader",
    "--hide-scrollbars",
    "--window-size=1280,1000",
    "--no-first-run",
    "--no-default-browser-check",
    URL_,
  ],
  { stdio: "ignore" },
);

const getJson = (path) =>
  new Promise((resolve, reject) => {
    const req = httpGet({ host: "127.0.0.1", port: PORT, path }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("error", reject);
  });

// Hard watchdog: a stalled CDP call must fail the run loudly instead of hanging it forever.
const watchdog = setTimeout(() => {
  step("WATCHDOG: exceeded budget, aborting");
  chrome.kill();
  process.exit(2);
}, Number(arg("budget", "150")) * 1000);

let stepNo = 0;
function step(message) {
  stepNo += 1;
  const line = `[${stepNo}] ${message}`;
  console.log(line);
  appendFileSync(`${OUT}/steps.log`, `${line}\n`);
}

async function main() {
  step(`out=${OUT} url=${URL_} port=${PORT}`);

  // Find the page target. Chrome can answer /json/list before the navigation settles.
  let page = null;
  for (let attempt = 0; attempt < 40 && !page; attempt++) {
    try {
      const targets = await getJson("/json/list");
      page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    } catch {
      /* endpoint not up yet */
    }
    if (!page) await sleep(500);
  }
  if (!page) throw new Error("no page target appeared");
  step(`page target ${page.url}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("websocket failed")), { once: true });
  });
  step("websocket open");

  let nextId = 0;
  const pending = new Map();
  const consoleErrors = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? "exception");
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 25000);
    });

  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? "evaluate threw");
    }
    return result.result.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");
  step("domains enabled");

  // Let the dynamic chunk mount, the GLB parse and the idle clip settle.
  await sleep(Number(arg("settle", "12")) * 1000);
  step("settled");

  // Scope to the hero stage. The page also mounts a large globe canvas, so a document-wide
  // querySelector('canvas') reports the globe's size and hides the figurine's state.
  const hero = await evaluate(`(() => {
    const host = [...document.querySelectorAll('[role="img"]')]
      .find((el) => /watchman/i.test(el.getAttribute('aria-label') || ''));
    if (!host) {
      return { found: false, canvases: document.querySelectorAll('canvas').length,
               roles: [...document.querySelectorAll('[role="img"]')].map((e) => e.getAttribute('aria-label')) };
    }
    const r = host.getBoundingClientRect();
    const canvas = host.querySelector('canvas');
    let gl = null;
    if (canvas) { gl = canvas.getContext('webgl2'); if (!gl) gl = canvas.getContext('webgl'); }
    return {
      found: true,
      label: host.getAttribute('aria-label'),
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
      hasCanvas: Boolean(canvas),
      canvasCss: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null,
      canvasBuffer: canvas ? { w: canvas.width, h: canvas.height } : null,
      contextLive: Boolean(gl),
      skeleton: Boolean(host.querySelector('.animate-pulse')),
      text: (host.textContent || '').trim().slice(0, 200),
    };
  })()`);
  step(`probe ${JSON.stringify(hero).slice(0, 400)}`);

  const report = {
    url: URL_,
    hero,
    consoleErrors,
    hydrationErrors: consoleErrors.filter((e) => /hydrat/i.test(e)),
  };

  if (hero.found && hero.hasCanvas) {
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      clip: {
        x: hero.rect.x,
        y: hero.rect.y,
        width: hero.rect.width,
        height: hero.rect.height,
        scale: 1,
      },
      captureBeyondViewport: true,
    });
    const png = Buffer.from(shot.data, "base64");
    writeFileSync(`${OUT}/hero.png`, png);
    report.screenshotBytes = png.length;
    step(`screenshot ${png.length} bytes`);
  }

  writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
  step("report written");
  clearTimeout(watchdog);
  ws.close();
  chrome.kill();
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  step(`FAILED ${error && error.message}`);
  writeFileSync(`${OUT}/error.json`, JSON.stringify({ error: String(error && error.stack) }, null, 2));
  chrome.kill();
  process.exitCode = 1;
});

