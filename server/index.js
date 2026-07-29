"use strict";

const config = require("./config/env");
const logger = require("./utils/logger");
const { connect, disconnect, flushSync } = require("./data");
const storage = require("./services/storage.service");
const maintenance = require("./services/maintenance.service");
const createApp = require("./app");
const { formatBytes } = require("./utils/files");

/**
 * Boot order matters: the database and upload directory must be ready before
 * the port opens, otherwise the first request can race the initialisation.
 * The original entry point called `connectDB()` without awaiting it and started
 * listening immediately.
 */
async function main() {
  await connect();
  await storage.ensureDir();

  // Retention sweeps run once now and then on a timer.
  const stopMaintenance = maintenance.schedule();

  const app = createApp();

  const server = await new Promise((resolve, reject) => {
    const instance = app.listen(config.port);
    instance.once("listening", () => resolve(instance));
    instance.once("error", reject);
  });

  logger.banner([
    "",
    "  ┌──────────────────────────────────────────────┐",
    "  │  DSMS · Document Sharing & Management        │",
    "  └──────────────────────────────────────────────┘",
    "",
  ]);
  logger.success(`API listening on http://localhost:${config.port}`);
  logger.info(`Environment      ${config.nodeEnv}`);
  logger.info(`Database driver  ${config.db.driver}`);
  logger.info(`Upload directory ${config.uploads.dir}`);
  logger.info(`Max upload size  ${formatBytes(config.uploads.maxBytes)}`);

  if (!config.auth.hasExplicitSecret) {
    logger.warn("JWT_SECRET is not set — a random secret was generated, so tokens will not survive a restart.");
  }

  installShutdownHandlers(server, stopMaintenance);
  return server;
}

/**
 * Close the port first (stop accepting work), then release the database, so
 * in-flight requests can finish. Falls back to a hard exit if something hangs.
 */
function installShutdownHandlers(server, stopMaintenance = () => {}) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received — shutting down`);
    stopMaintenance();

    const force = setTimeout(() => {
      logger.error("Graceful shutdown timed out — forcing exit");
      flushSync();
      process.exit(1);
    }, 10_000);
    force.unref();

    try {
      await new Promise((resolve) => server.close(resolve));
      await disconnect();
      clearTimeout(force);
      logger.success("Shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error("Error during shutdown", err);
      flushSync();
      process.exit(1);
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", reason);
  });

  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception — exiting", err);
    flushSync();
    process.exit(1);
  });
}

if (require.main === module) {
  main().catch((err) => {
    logger.error(`Failed to start: ${err.message}`);
    if (!config.isProduction) console.error(err);
    process.exit(1);
  });
}

module.exports = { main, createApp };
