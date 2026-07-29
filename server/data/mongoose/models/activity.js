"use strict";

const mongoose = require("mongoose");
const { newId } = require("../../../utils/ids");

/** Append-only audit trail. Never updated, only read and pruned. */
const activitySchema = new mongoose.Schema(
  {
    _id: { type: String, default: newId },

    action: { type: String, required: true, index: true },
    documentId: { type: String, default: null, index: true },
    documentTitle: { type: String, default: "" },

    actorId: { type: String, default: null, index: true },
    actorName: { type: String, default: "Anonymous" },

    detail: { type: String, default: "" },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },

    createdAt: { type: String },
    updatedAt: { type: String },
  },
  { versionKey: false, timestamps: false, _id: false }
);

activitySchema.index({ createdAt: -1 });

module.exports = activitySchema;
