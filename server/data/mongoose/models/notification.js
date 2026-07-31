"use strict";

const mongoose = require("mongoose");
const { newId } = require("../../../utils/ids");

/**
 * An in-app notification addressed to one user.
 *
 * This is the answer to "sharing with someone was silent": there is no outbound
 * mail in this deployment, so the recipient is told inside the product instead.
 * One row per recipient rather than a shared row with a read-state set — it
 * makes "unread count for this user" a plain indexed count.
 */
const notificationSchema = new mongoose.Schema(
  {
    _id: { type: String, default: newId },

    /** Recipient. */
    userId: { type: String, required: true, index: true },

    type: {
      type: String,
      required: true,
      enum: [
        "document.shared",
        "document.share_revoked",
        "comment.created",
        "comment.mention",
        "comment.reply",
        "document.version_added",
        "quota.warning",
      ],
      index: true,
    },

    title: { type: String, required: true },
    body: { type: String, default: "" },

    documentId: { type: String, default: null, index: true },
    documentTitle: { type: String, default: "" },
    commentId: { type: String, default: null },

    actorId: { type: String, default: null },
    actorName: { type: String, default: "" },
    actorAccent: { type: String, default: "#5b8cff" },

    readAt: { type: String, default: null },

    createdAt: { type: String },
    updatedAt: { type: String },
  },
  { versionKey: false, timestamps: false, _id: false }
);

// Drives the unread badge and the notification list.
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

module.exports = notificationSchema;
