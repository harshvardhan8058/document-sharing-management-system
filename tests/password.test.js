"use strict";

/**
 * Password hashing, and the agreement between the client meter and the server.
 *
 * The strength function existed in three places at one point. The last test here
 * is the guard that matters: if the two implementations ever drift, the sign-up
 * form starts promising something the API will reject.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// Keep hashing cheap so the suite stays fast; the algorithm is what is under test.
process.env.PASSWORD_COST = process.env.PASSWORD_COST || "1024";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";

const { hashPassword, verifyPassword, scorePassword } = require("../server/utils/password");

test("a hash is self-describing and carries no plaintext", async () => {
  const hash = await hashPassword("Corridor7Lantern");

  const [algorithm, cost, salt, digest] = hash.split("$");
  assert.equal(algorithm, "scrypt");
  assert.equal(Number.isInteger(Number(cost)), true);
  assert.match(salt, /^[0-9a-f]{32}$/);
  assert.match(digest, /^[0-9a-f]{128}$/);
  assert.equal(hash.includes("Corridor7Lantern"), false);
});

test("the same password hashes differently every time", async () => {
  const [a, b] = await Promise.all([hashPassword("same-input"), hashPassword("same-input")]);
  assert.notEqual(a, b, "a per-hash salt is what stops rainbow-table lookups");
  assert.equal(await verifyPassword("same-input", a), true);
  assert.equal(await verifyPassword("same-input", b), true);
});

test("verification accepts the right password and rejects everything else", async () => {
  const hash = await hashPassword("Meridian4Cascade");

  assert.equal(await verifyPassword("Meridian4Cascade", hash), true);
  assert.equal(await verifyPassword("meridian4cascade", hash), false, "must be case sensitive");
  assert.equal(await verifyPassword("Meridian4Cascad", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

test("malformed stored hashes verify as false instead of throwing", async () => {
  const malformed = [
    "",
    "not-a-hash",
    "scrypt$",
    "scrypt$16384$onlysalt",
    "scrypt$notanumber$aabb$ccdd",
    "bcrypt$16384$aabb$ccdd",
    "scrypt$16384$$",
    "scrypt$16384$zz$zz",
  ];

  for (const stored of malformed) {
    assert.equal(await verifyPassword("anything", stored), false, `should reject ${JSON.stringify(stored)}`);
  }
});

test("non-string inputs are rejected rather than coerced", async () => {
  assert.equal(await verifyPassword(undefined, "scrypt$1024$aa$bb"), false);
  assert.equal(await verifyPassword("x", null), false);
  await assert.rejects(() => hashPassword(""), TypeError);
  await assert.rejects(() => hashPassword(null), TypeError);
});

test("a hash remains verifiable after the cost parameter is raised", async () => {
  // The cost is stored in the hash, so old credentials keep working when the
  // deployment tightens PASSWORD_COST.
  const hash = await hashPassword("legacy-password-1");
  assert.match(hash, /^scrypt\$1024\$/);

  const raised = hash.replace("$1024$", "$2048$");
  assert.equal(await verifyPassword("legacy-password-1", hash), true);
  assert.equal(
    await verifyPassword("legacy-password-1", raised),
    false,
    "rewriting the cost must not still verify — the digest depends on it"
  );
});

test("the client strength meter agrees with the server, character for character", async () => {
  const client = await import("../client/src/lib/password.js");

  const samples = [
    "",
    "a",
    "short",
    "password",
    "password1",
    "Password1",
    "Password1!",
    "correct horse battery staple",
    "Tr0ub4dor&3",
    "aaaaaaaaaaaaaaaaaaaa",
    "AAAAAAAAAAAA1111!!!!",
    "Corridor7Lantern",
    "12345678",
    "!!!!!!!!",
    "ünïcödé-Pässw0rd!",
  ];

  for (const sample of samples) {
    assert.deepEqual(
      client.scorePassword(sample),
      scorePassword(sample),
      `client and server disagree on ${JSON.stringify(sample)}`
    );
  }
});

test("the client policy check matches what the API enforces", async () => {
  const { meetsPolicy } = await import("../client/src/lib/password.js");

  // Mirrors the express-validator chain in server/routes/auth.routes.js:
  // 8+ characters, at least one letter, at least one digit.
  const serverWouldAccept = (value) =>
    value.length >= 8 && value.length <= 200 && /[a-zA-Z]/.test(value) && /\d/.test(value);

  const samples = [
    "abc12345",
    "abcdefgh",
    "12345678",
    "Passw0rd",
    "aB3",
    "",
    "letters1",
    "        1a",
    "x".repeat(200) + "1",
  ];

  for (const sample of samples) {
    assert.equal(
      meetsPolicy(sample),
      serverWouldAccept(sample),
      `policy mismatch for ${JSON.stringify(sample)}`
    );
  }
});
