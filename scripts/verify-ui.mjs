/**
 * End-to-end interface verification in a real headless browser.
 *
 * Boots the built client and the real server against a throwaway database and
 * upload directory, seeds the demo data, then drives the interface the way a
 * person does — keyboard, drag-and-drop, a second account commenting from
 * another session — and asserts on behaviour rather than on markup.
 *
 *   npm run verify:ui
 *
 * Requires a Chrome or Chromium binary. Set CHROME_PATH to point at one; if none
 * is found the suite skips rather than fails, so it can sit in a pipeline that
 * does not install a browser. Use `--strict` to turn a missing browser into a
 * failure.
 */
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Page, createReport, findChrome, launchChrome, sleep } from "./ui/browser.mjs";
import { runChecks } from "./ui/checks.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SANDBOX = path.join(ROOT, ".verify-ui");
const PORT = Number(process.env.UI_PORT || 4598);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = process.env.UI_SHOT_DIR || path.join(SANDBOX, "screenshots");
const STRICT = process.argv.includes("--strict");

const childEnv = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(PORT),
  DB_DRIVER: "local",
  LOCAL_DB_DIR: path.join(SANDBOX, "data"),
  UPLOAD_DIR: path.join(SANDBOX, "uploads"),
  JWT_SECRET: "ui-verification-only-secret",
  // A sweep firing mid-run would make results depend on how long this took.
  MAINTENANCE_INTERVAL_HOURS: "0",
  RATE_LIMIT_MAX: "100000",
  AUTH_RATE_LIMIT_MAX: "100000",
};

function run(script, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: ROOT, env: childEnv, stdio: "pipe" });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${label} exited ${code}:\n${output.slice(-1500)}`))
    );
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await sleep(250);
  }
  throw new Error("the server never became healthy");
}

// Pre-flight runs before the try/finally below, because a `finally` that calls
// process.exit would override an exit code set inside the block.
if (!existsSync(path.join(ROOT, "client", "dist", "index.html"))) {
  console.error("The client is not built. Run `npm run build` first.");
  process.exit(1);
}

const binary = findChrome();
if (!binary) {
  const message = "No Chrome or Chromium found. Set CHROME_PATH to a browser binary to run the interface checks.";
  if (STRICT) {
    console.error(message);
    process.exit(1);
  }
  console.log(`\u001b[33mSkipped\u001b[0m  ${message}`);
  process.exit(0);
}

const report = createReport();
let server;
let chrome;
let failed = false;

try {
  rmSync(SANDBOX, { recursive: true, force: true });

  console.log(`\u001b[2mBrowser\u001b[0m ${binary}`);
  await run(path.join(ROOT, "scripts", "seed.js"), "seed");

  server = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    cwd: ROOT,
    env: childEnv,
    stdio: "ignore",
  });
  await waitForServer();

  chrome = await launchChrome(binary);
  const page = await Page.attach();
  await page.setViewport(1440, 900);

  // Slow the renderer down on purpose to shake out races between a user action
  // and the state it depends on. A CI runner is slower than a laptop, and a
  // check that only passes on fast hardware is not a check.
  const throttle = Number(process.env.UI_CPU_THROTTLE || 0);
  if (throttle > 1) {
    await page.send("Emulation.setCPUThrottlingRate", { rate: throttle });
    console.log(`\u001b[2mCPU\u001b[0m     throttled ${throttle}x`);
  }

  let shotIndex = 0;
  const shot = (name) => {
    shotIndex += 1;
    return page.screenshot(path.join(SHOT_DIR, `${String(shotIndex).padStart(2, "0")}-${name}.png`));
  };

  await runChecks({ page, base: BASE, report, shot });
} catch (error) {
  failed = true;
  report.state.failed += 1;
  report.state.failures.push(error.message);
  console.error(`\n\u001b[31mError\u001b[0m  ${error.message}`);
} finally {
  chrome?.kill("SIGKILL");
  server?.kill("SIGTERM");
  await sleep(400);
  server?.kill("SIGKILL");

  report.summary(`\u001b[1mScreenshots\u001b[0m  ${SHOT_DIR}`);

  // Keep the sandbox on failure: the screenshots are the evidence.
  if (!report.state.failed && !failed) rmSync(SANDBOX, { recursive: true, force: true });

  process.exit(report.state.failed ? 1 : 0);
}
