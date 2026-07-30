/**
 * A very small Chrome DevTools Protocol driver.
 *
 * No dependency on Playwright or Puppeteer: Node 18+ ships a global WebSocket
 * and CDP's discovery endpoints are plain HTTP, so a headless browser can be
 * driven in a couple of hundred lines. The point is that verifying the interface
 * should not cost a 300 MB devDependency and a browser download.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Locate a Chrome/Chromium binary.
 *
 * `CHROME_PATH` wins, then the usual install locations. Returns null rather than
 * throwing so the caller can skip cleanly on a machine without a browser.
 */
export function findChrome() {
  if (process.env.CHROME_PATH) {
    return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  }

  const candidates = [
    "/usr/local/bin/chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ];

  return candidates.find((path) => existsSync(path)) || null;
}

/** Launch headless Chrome with a debugging port. */
export async function launchChrome(binary, { port = 9333 } = {}) {
  const child = spawn(
    binary,
    [
      "--headless=new",
      // The browser already runs inside whatever isolation the host provides,
      // and nested sandboxing fails in containers.
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      "--window-size=1440,900",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      return child;
    } catch {
      await sleep(200);
    }
  }

  child.kill("SIGKILL");
  throw new Error("Chrome did not open a debugging port");
}

export class Page {
  #socket;
  #nextId = 0;
  #pending = new Map();

  static async attach({ port = 9333 } = {}) {
    let target;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = targets.find((entry) => entry.type === "page");
      if (target) break;
      await sleep(200);
    }
    if (!target) throw new Error("Chrome exposed no page target");

    const page = new Page();
    await page.#connect(target.webSocketDebuggerUrl);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    return page;
  }

  #connect(url) {
    return new Promise((resolve, reject) => {
      this.#socket = new WebSocket(url);
      this.#socket.onopen = resolve;
      this.#socket.onerror = () => reject(new Error("could not connect to the page target"));
      this.#socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const waiter = this.#pending.get(message.id);
        if (!waiter) return;
        this.#pending.delete(message.id);
        message.error ? waiter.reject(new Error(JSON.stringify(message.error))) : waiter.resolve(message.result);
      };
    });
  }

  send(method, params = {}) {
    const id = (this.#nextId += 1);
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.#pending.delete(id)) reject(new Error(`${method} timed out`));
      }, 30000);
    });
  }

  /**
   * Navigate and wait for the document to settle.
   *
   * Driven from inside the page rather than with `Page.navigate`, which can hang
   * when the target is the URL already showing — exactly what happens after the
   * app rewrites its own address with `replaceState`.
   */
  async goto(url, settleMs = 1200) {
    try {
      await this.eval(`
        const target = ${JSON.stringify(url)};
        if (location.href === target || location.href === target + '/') location.reload();
        else location.assign(target);
        return 'navigating';
      `);
    } catch {
      // The execution context is torn down mid-navigation; that is the success
      // case, not an error.
    }

    for (let attempt = 0; attempt < 80; attempt += 1) {
      await sleep(250);
      try {
        if ((await this.eval("document.readyState")) === "complete") break;
      } catch {
        // Still swapping documents.
      }
    }
    await sleep(settleMs);
  }

  /**
   * Evaluate an expression, or a block that returns. Always wrapped in an async
   * IIFE so page code may await; the trailing newline guards `//` comments.
   */
  async eval(expression) {
    const body = /(^|[\s;{])return[\s(]/.test(expression) ? expression : `return (${expression})`;
    const result = await this.send("Runtime.evaluate", {
      expression: `(async () => { ${body}\n })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      throw new Error(`eval failed: ${detail.exception?.description || detail.text}`);
    }
    return result.result.value;
  }

  /** Poll until `expression` is truthy. Throws with the last value seen. */
  async waitFor(expression, { timeout = 15000, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.eval(expression);
        if (last) return last;
      } catch (error) {
        last = String(error.message).slice(0, 120);
      }
      await sleep(250);
    }
    throw new Error(`timed out waiting for ${label} (last value: ${JSON.stringify(last)})`);
  }

  /**
   * Set the value of a React-controlled field.
   *
   * Assigning `.value` is not enough: React caches the previous value on the
   * node, so it treats the change as a no-op and never fires `onChange`. Going
   * through the prototype setter and dispatching `input` is what a real
   * keystroke does.
   */
  fill(selector, value) {
    return this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return "NO_ELEMENT";
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
      Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return "OK";
    `);
  }

  click(selector) {
    return this.eval(`
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return "NO_ELEMENT";
      el.scrollIntoView({ block: "center" });
      el.click();
      return "OK";
    `);
  }

  /** Click the first element matching `selector` whose text contains `text`. */
  clickText(selector, text) {
    return this.eval(`
      const needle = ${JSON.stringify(text.toLowerCase())};
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((node) => (node.innerText || node.textContent || "").toLowerCase().includes(needle));
      if (!el) return "NO_ELEMENT";
      el.scrollIntoView({ block: "center" });
      el.click();
      return "OK";
    `);
  }

  async press(key, { ctrl = false } = {}) {
    const keys = {
      ArrowRight: [39, "ArrowRight"],
      ArrowLeft: [37, "ArrowLeft"],
      ArrowDown: [40, "ArrowDown"],
      ArrowUp: [38, "ArrowUp"],
      Escape: [27, "Escape"],
      Enter: [13, "Enter"],
      " ": [32, "Space"],
      "/": [191, "Slash"],
    };
    const [code, domCode] = keys[key] ?? [key.toUpperCase().charCodeAt(0), `Key${key.toUpperCase()}`];

    // Enter must carry text ("\r"), or Chrome skips the default action and a
    // form is never implicitly submitted.
    const text = key === "Enter" ? "\r" : key.length === 1 && !ctrl ? key : null;
    const shared = {
      key,
      code: domCode,
      windowsVirtualKeyCode: code,
      nativeVirtualKeyCode: code,
      modifiers: ctrl ? 2 : 0,
    };

    await this.send("Input.dispatchKeyEvent", {
      type: text === null ? "rawKeyDown" : "keyDown",
      ...shared,
      ...(text === null ? {} : { text }),
    });
    await this.send("Input.dispatchKeyEvent", { type: "keyUp", ...shared });
    await sleep(350);
  }

  async screenshot(path) {
    mkdirSync(path.replace(/[/\\][^/\\]+$/, ""), { recursive: true });
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(path, Buffer.from(data, "base64"));
    return path;
  }

  setViewport(width, height) {
    return this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
    });
  }

  setReducedMotion(reduce) {
    return this.send("Emulation.setEmulatedMedia", {
      features: reduce ? [{ name: "prefers-reduced-motion", value: "reduce" }] : [],
    });
  }
}

/** A tiny assertion reporter, so the output reads as a checklist. */
export function createReport({ colour = true } = {}) {
  const paint = (code, text) => (colour ? `\u001b[${code}m${text}\u001b[0m` : text);
  const state = { passed: 0, failed: 0, failures: [] };

  return {
    state,
    section(name) {
      console.log(`\n${paint("1;36", name)}`);
    },
    check(label, condition, detail = "") {
      const ok = Boolean(condition);
      if (ok) state.passed += 1;
      else {
        state.failed += 1;
        state.failures.push(label);
      }
      console.log(`  ${ok ? paint("32", "PASS") : paint("31", "FAIL")}  ${label}${detail ? `  ${paint("2", detail)}` : ""}`);
      return ok;
    },
    summary(extra = "") {
      const line = "\u2500".repeat(64);
      console.log(`\n${line}`);
      if (extra) console.log(extra);
      console.log(
        `${paint("1", "Result")}  ${paint("32", `${state.passed} passed`)}  ` +
          (state.failed ? paint("31", `${state.failed} failed`) : "0 failed")
      );
      if (state.failures.length) console.log("Failures:\n  - " + state.failures.join("\n  - "));
      console.log(line);
    },
  };
}
