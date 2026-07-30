"use strict";

const config = require("../config/env");
const logger = require("../utils/logger");

const { openStore } = require("./local/store");
const { createLocalRepository } = require("./local/repository");
const { createMongooseRepository } = require("./mongoose/repository");

const userSchema = require("./mongoose/models/user");
const documentSchema = require("./mongoose/models/document");
const shareSchema = require("./mongoose/models/share");
const activitySchema = require("./mongoose/models/activity");
const collectionSchema = require("./mongoose/models/collection");
const commentSchema = require("./mongoose/models/comment");
const notificationSchema = require("./mongoose/models/notification");

/** Collection name -> local-driver options. Mongo gets its constraints from the schemas. */
const COLLECTIONS = {
  users: { uniqueKeys: ["email"] },
  documents: {},
  shares: {},
  activities: {},
  collections: {},
  comments: {},
  notifications: {},
};

const MONGOOSE_SCHEMAS = {
  users: { modelName: "User", schema: userSchema },
  documents: { modelName: "Document", schema: documentSchema },
  shares: { modelName: "Share", schema: shareSchema },
  activities: { modelName: "Activity", schema: activitySchema },
  collections: { modelName: "Collection", schema: collectionSchema },
  comments: { modelName: "Comment", schema: commentSchema },
  notifications: { modelName: "Notification", schema: notificationSchema },
};

/**
 * The repository registry.
 *
 * Services only ever touch `db.users`, `db.documents`, ... — they never learn
 * which driver backs them, which is what makes "runs with no database
 * installed" and "runs against MongoDB Atlas" the same code path.
 */
const db = {
  driver: null,
  ready: false,
  users: null,
  documents: null,
  shares: null,
  activities: null,
  collections: null,
  comments: null,
  notifications: null,
  /** @type {null | {drain(): Promise<void>, close(): Promise<void>, flushSync(): void}} */
  _localStore: null,
  _mongoose: null,
};

async function connectMongo() {
  const mongoose = require("mongoose");
  mongoose.set("strictQuery", true);

  await mongoose.connect(config.db.mongoUri, {
    serverSelectionTimeoutMS: 10_000,
    // useNewUrlParser / useUnifiedTopology were removed in the v4 driver;
    // passing them (as the original code did) is a no-op at best.
  });

  for (const [collection, { modelName, schema }] of Object.entries(MONGOOSE_SCHEMAS)) {
    const model = mongoose.models[modelName] || mongoose.model(modelName, schema, collection);
    db[collection] = createMongooseRepository(model);
  }

  db._mongoose = mongoose;
  db.driver = "mongo";

  const host = mongoose.connection.host || "unknown host";
  logger.success(`MongoDB connected (${host}/${mongoose.connection.name})`);
}

async function connectLocal() {
  const store = await openStore({ dir: config.db.localDir, collections: COLLECTIONS });

  for (const [collection, instance] of Object.entries(store.collections)) {
    db[collection] = createLocalRepository(instance);
  }

  db._localStore = store;
  db.driver = "local";

  logger.success(`Embedded JSON store ready (${config.db.localDir})`);
  logger.warn("Using the local database driver — set MONGODB_URI to use MongoDB instead.");
}

/** Connect using the driver selected in configuration. Idempotent. */
async function connect() {
  if (db.ready) return db;

  if (config.db.driver === "mongo") {
    await connectMongo();
  } else {
    await connectLocal();
  }

  db.ready = true;
  return db;
}

async function disconnect() {
  if (db._localStore) {
    await db._localStore.close();
    db._localStore = null;
  }
  if (db._mongoose) {
    await db._mongoose.disconnect();
    db._mongoose = null;
  }
  db.ready = false;
  db.driver = null;
  for (const collection of Object.keys(COLLECTIONS)) db[collection] = null;
}

/** Flush pending local writes; no-op for mongo. Used by shutdown handlers. */
function flushSync() {
  if (db._localStore) db._localStore.flushSync();
}

/** Wait for pending writes to reach disk (local driver only). */
async function drain() {
  if (db._localStore) await db._localStore.drain();
}

module.exports = { db, connect, disconnect, flushSync, drain, COLLECTIONS };
