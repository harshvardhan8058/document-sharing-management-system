"use strict";

const mongoose = require("mongoose");
const { newId } = require("../../../utils/ids");

/**
 * A comment on a document. One level of replies, not arbitrary nesting —
 * `parentId` points at a top-level comment and replies cannot themselves be
 * replied to, which keeps rendering and notification fan-out predictable.
 *
 * Deletion is soft (`deletedAt` plus a cleared body) so a thread does not lose
 * its shape when a middle comment goes, and so the audit trail stays coherent.
 */
const commentSchema = new mongoose.Schema(
  {
    _id: { type: String, default: newId },

    documentId: { type: String, required: true, index: true },
    /** null for a top-level comment. */
    parentId: { type: String, default: null, index: true },

    authorId: { type: String, required: true, index: true },
    authorName: { type: String, default: "" },
    authorAccent: { type: String, default: "#5b8cff" },

    body: { type: String, default: "", maxlength: 4000 },

    /** User ids resolved from @mentions at write time. */
    mentions: { type: [String], default: [] },

    editedAt: { type: String, default: null },
    deletedAt: { type: String, default: null },

    createdAt: { type: String },
    updatedAt: { type: String },
  },
  { versionKey: false, timestamps: false, _id: false }
);

commentSchema.index({ documentId: 1, createdAt: 1 });

module.exports = commentSchema;
