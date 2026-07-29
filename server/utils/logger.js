"use strict";

const config = require("../config/env");

const COLOURS = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[36m",
};

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = config.isTest ? LEVELS.error : LEVELS.debug;

const paint = (colour, text) => (process.stdout.isTTY ? `${colour}${text}${COLOURS.reset}` : text);

function emit(level, colour, message, meta) {
  if (LEVELS[level] < threshold) return;
  const stamp = new Date().toISOString();
  const line = `${paint(COLOURS.dim, stamp)} ${paint(colour, level.toUpperCase().padEnd(5))} ${message}`;
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  if (meta === undefined) stream(line);
  else stream(line, meta);
}

module.exports = {
  debug: (message, meta) => emit("debug", COLOURS.dim, message, meta),
  info: (message, meta) => emit("info", COLOURS.blue, message, meta),
  success: (message, meta) => emit("info", COLOURS.green, message, meta),
  warn: (message, meta) => emit("warn", COLOURS.yellow, message, meta),
  error: (message, meta) => emit("error", COLOURS.red, message, meta),
  banner: (lines) => {
    if (config.isTest) return;
    console.log(paint(COLOURS.magenta, lines.join("\n")));
  },
};
