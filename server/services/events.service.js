"use strict";

/**
 * Server-Sent Events fan-out.
 *
 * Chosen over WebSockets deliberately: everything here is server -> client
 * (a notification arrived, a document changed), SSE rides ordinary HTTP so it
 * needs no protocol upgrade through proxies, and the browser reconnects on its
 * own.
 *
 * ## Authenticating a stream that cannot send headers
 *
 * `EventSource` has no API for request headers, so the bearer token cannot be
 * attached the usual way. Putting it in the query string "works" and is a bad
 * idea — URLs end up in access logs, proxy logs, referrer headers and browser
 * history, so a long-lived credential would leak into all of them.
 *
 * Instead the client posts its normal bearer token to `/api/events/ticket` and
 * receives a ticket that is single-use and valid for seconds. That is what
 * appears in the stream URL. A leaked ticket is worthless: it has already been
 * consumed, or it has expired.
 */

const crypto = require("crypto");

const config = require("../config/env");
const logger = require("../utils/logger");
const ApiError = require("../utils/ApiError");

/** userId -> Set of open response objects. */
const subscribers = new Map();

/** ticket -> { userId, expiresAt } */
const tickets = new Map();

let sweeper = null;

/** Drop expired tickets. Cheap, and keeps a long-running process from growing. */
function sweepTickets() {
  const now = Date.now();
  for (const [ticket, entry] of tickets) {
    if (entry.expiresAt <= now) tickets.delete(ticket);
  }
}

function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(sweepTickets, 60_000);
  sweeper.unref(); // never hold the process open
}

/** Issue a single-use, short-lived ticket for the given user. */
function issueTicket(userId) {
  ensureSweeper();
  sweepTickets();

  const ticket = crypto.randomBytes(24).toString("base64url");
  tickets.set(ticket, { userId, expiresAt: Date.now() + config.events.ticketTtlMs });

  return { ticket, expiresInMs: config.events.ticketTtlMs };
}

/**
 * Redeem a ticket. Always consumes it, whether or not it was still valid, so a
 * ticket can never be replayed.
 */
function consumeTicket(ticket) {
  const entry = tickets.get(String(ticket || ""));
  tickets.delete(String(ticket || ""));

  if (!entry) throw ApiError.unauthorized("Invalid or already-used stream ticket", { code: "TICKET_INVALID" });
  if (entry.expiresAt <= Date.now()) {
    throw ApiError.unauthorized("Stream ticket expired — request a new one", { code: "TICKET_EXPIRED" });
  }
  return entry.userId;
}

/** Serialise one SSE frame. */
function frame(event, data, id) {
  const payload = JSON.stringify(data ?? null);
  return `${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${payload}\n\n`;
}

/**
 * Attach a response as a subscriber for `userId`.
 * @returns {() => void} detach
 */
function subscribe(userId, res, req) {
  const existing = subscribers.get(userId) || new Set();

  // A tab-hoarding user should not be able to pin an unbounded number of
  // sockets open; drop the oldest instead of refusing the newest.
  if (existing.size >= config.events.maxConnectionsPerUser) {
    const [oldest] = existing;
    try {
      oldest.end();
    } catch {
      /* already gone */
    }
    existing.delete(oldest);
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Tell nginx and friends not to buffer this response.
    "X-Accel-Buffering": "no",
  });

  // Ask the browser to wait a moment before reconnecting, then say hello so the
  // client knows the stream is live rather than merely open.
  res.write("retry: 3000\n\n");
  res.write(frame("ready", { at: new Date().toISOString() }));

  existing.add(res);
  subscribers.set(userId, existing);

  // Comment frames keep intermediaries from timing the connection out.
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {
      detach();
    }
  }, config.events.heartbeatMs);
  heartbeat.unref();

  let detached = false;
  function detach() {
    if (detached) return;
    detached = true;
    clearInterval(heartbeat);

    const set = subscribers.get(userId);
    if (set) {
      set.delete(res);
      if (!set.size) subscribers.delete(userId);
    }
    try {
      res.end();
    } catch {
      /* already closed */
    }
  }

  req.on("close", detach);
  req.on("error", detach);

  return detach;
}

/**
 * Push an event to every stream a user has open.
 *
 * Best-effort by design: a live update is a convenience on top of state the
 * client can always refetch, so a dead socket is cleaned up rather than turned
 * into a failed request somewhere else.
 *
 * @returns {number} how many streams received it
 */
function publish(userId, event, data) {
  const set = subscribers.get(userId);
  if (!set || !set.size) return 0;

  const payload = frame(event, data);
  let delivered = 0;

  for (const res of [...set]) {
    try {
      res.write(payload);
      delivered += 1;
    } catch (err) {
      logger.debug(`Dropping dead event stream for ${userId}: ${err.message}`);
      set.delete(res);
    }
  }

  if (!set.size) subscribers.delete(userId);
  return delivered;
}

/** Push the same event to several users at once. */
function publishToMany(userIds, event, data) {
  let delivered = 0;
  for (const userId of new Set(userIds.filter(Boolean))) {
    delivered += publish(userId, event, data);
  }
  return delivered;
}

/** Diagnostics for the admin health endpoint. */
function stats() {
  let connections = 0;
  for (const set of subscribers.values()) connections += set.size;
  return { users: subscribers.size, connections, pendingTickets: tickets.size };
}

/** Close every stream — used on shutdown so clients reconnect to the new process. */
function closeAll() {
  for (const set of subscribers.values()) {
    for (const res of set) {
      try {
        res.write(frame("shutdown", { at: new Date().toISOString() }));
        res.end();
      } catch {
        /* already gone */
      }
    }
  }
  subscribers.clear();
  tickets.clear();
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

module.exports = {
  issueTicket,
  consumeTicket,
  subscribe,
  publish,
  publishToMany,
  stats,
  closeAll,
};
