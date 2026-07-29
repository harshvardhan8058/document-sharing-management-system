"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");

const config = require("./config/env");
const apiRoutes = require("./routes");
const requestLogger = require("./middleware/requestLogger");
const { notFound, errorHandler } = require("./middleware/error");

const ALLOWED_ORIGINS =
  config.corsOrigin === "*"
    ? null
    : config.corsOrigin.split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);

/**
 * Per-request CORS decision.
 *
 * Three rules, in order:
 *
 *  1. No Origin header — a same-origin navigation, curl, or a server-to-server
 *     call. Nothing to police.
 *  2. The Origin *is* our own origin. This must always be allowed: Vite's
 *     production build emits `crossorigin` on its `<script>`/`<link>` tags,
 *     which makes the browser attach an Origin header to same-origin asset
 *     requests too. Matching those against the allow-list meant the app's own
 *     JavaScript and CSS were refused whenever it was served from a host that
 *     was not literally spelled out in CORS_ORIGIN.
 *  3. Otherwise consult the allow-list.
 *
 * A disallowed origin is answered with *no* CORS headers rather than an error.
 * The browser still blocks the response — which is the point — but the request
 * gets a normal reply instead of a 500 in our logs.
 */
function corsDelegate(req, callback) {
  const requestOrigin = req.headers.origin;
  if (!requestOrigin) return callback(null, { origin: true });

  const host = req.get("host");
  if (host && requestOrigin === `${req.protocol}://${host}`) {
    return callback(null, { origin: true, credentials: true });
  }

  if (!ALLOWED_ORIGINS) return callback(null, { origin: true });

  if (ALLOWED_ORIGINS.includes(requestOrigin.replace(/\/$/, ""))) {
    return callback(null, { origin: requestOrigin, credentials: true });
  }

  return callback(null, { origin: false });
}

/**
 * Build the Express application.
 *
 * Exported as a factory (rather than a module-level `app`) so tests and scripts
 * can create an instance without binding a port.
 */
function createApp() {
  const app = express();

  // Required for correct req.ip / rate limiting behind a proxy or load balancer.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          // The design system injects CSS custom properties inline for the
          // animated backgrounds, so inline styles have to be permitted.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "blob:"],
          fontSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameSrc: ["'self'", "blob:"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      // Previews are fetched from the same origin but rendered in <img>/<iframe>;
      // the strict default would block them.
      crossOriginResourcePolicy: { policy: "same-site" },
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(compression());
  app.use(cors(corsDelegate));
  app.use(requestLogger);

  // Body limits are modest on purpose: file payloads go through multer, not here.
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true, limit: "256kb" }));

  const apiLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    // Downloads and previews of a large library can legitimately be chatty.
    skip: (req) => req.method === "GET" && /\/(download|preview)(\/|$)/.test(req.path),
    message: {
      error: { code: "RATE_LIMITED", message: "Too many requests — please slow down" },
    },
  });

  app.use("/api", apiLimiter, apiRoutes);

  // Unmatched /api/* paths get a JSON 404 instead of falling through to the SPA.
  app.use("/api", notFound);

  mountClient(app);

  app.use(errorHandler);

  return app;
}

/**
 * Serve the built React app when it exists, with a history fallback so deep
 * links like `/documents/:id` and `/s/:token` resolve to index.html.
 *
 * When the client has not been built yet we return a helpful message rather
 * than a bare 404, because "I ran npm start and got nothing" is the single most
 * confusing failure mode for a full-stack repo.
 */
function mountClient(app) {
  const indexHtml = path.join(config.clientDist, "index.html");

  if (!fs.existsSync(indexHtml)) {
    app.get("*", (req, res) => {
      res.status(503).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Client not built</title>
<style>
  body{background:#070b18;color:#e7ecff;font:16px/1.6 ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}
  main{max-width:38rem;padding:2.5rem;border:1px solid #1e2a4a;border-radius:18px;background:#0b1024}
  code{background:#131a35;padding:.15rem .45rem;border-radius:6px;color:#7dd3fc}
  h1{margin:0 0 .75rem;font-size:1.4rem}
  a{color:#7dd3fc}
</style></head>
<body><main>
  <h1>The API is running — the interface is not built yet</h1>
  <p>Build the React client, then reload this page:</p>
  <p><code>npm run build</code></p>
  <p>Or run the dev server with hot reload on port 5173:</p>
  <p><code>npm run client:dev</code></p>
  <p>The API itself is live at <a href="/api">/api</a> and <a href="/api/health">/api/health</a>.</p>
</main></body></html>`);
    });
    return;
  }

  app.use(
    express.static(config.clientDist, {
      index: false,
      maxAge: "1h",
      setHeaders(res, filePath) {
        // Hashed asset filenames are safe to cache aggressively; index.html is not.
        if (/\.[0-9a-f]{8,}\./.test(path.basename(filePath))) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    })
  );

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(indexHtml);
  });
}

module.exports = createApp;
