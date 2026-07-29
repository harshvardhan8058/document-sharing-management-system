"use strict";

const mongoose = require("mongoose");
const { newId } = require("../../../utils/ids");

/**
 * One row per grant. Two flavours:
 *  - type "user": a named recipient (matched by userId once they exist, by
 *    email before that, so you can share with someone who has not signed up).
 *  - type "link": an unauthenticated public link identified by `token`, with
 *    optional password, expiry and download cap.
 */
const shareSchema = new mongoose.Schema(
  {
    _id: { type: String, default: newId },

    documentId: { type: String, required: true, index: true },
    type: { type: String, enum: ["user", "link"], required: true, index: true },

    // type: "user"
    userId: { type: String, default: null, index: true },
    email: { type: String, default: null, lowercase: true, trim: true },

    // type: "link"
    token: { type: String, default: null, index: true },
    passwordHash: { type: String, default: null },
    maxDownloads: { type: Number, default: null },

    permission: { type: String, enum: ["view", "edit", "manage"], default: "view" },
    expiresAt: { type: String, default: null },
    downloadCount: { type: Number, default: 0 },
    lastAccessedAt: { type: String, default: null },

    createdBy: { type: String, required: true },
    revokedAt: { type: String, default: null },

    createdAt: { type: String },
    updatedAt: { type: String },
  },
  { versionKey: false, timestamps: false, _id: false }
);

shareSchema.index({ documentId: 1, type: 1, revokedAt: 1 });

module.exports = shareSchema;
