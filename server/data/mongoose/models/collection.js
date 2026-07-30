"use strict";

const mongoose = require("mongoose");
const { newId } = require("../../../utils/ids");

/**
 * A user-owned grouping of documents — the folder concept, kept deliberately flat.
 *
 * Nesting was considered and rejected: it forces recursive permission resolution
 * and "move a subtree" transactions for very little benefit at this scale. A
 * document belongs to at most one collection (`documents.collectionId`), so
 * membership needs no join table and no cascade.
 *
 * Collections never grant access. Putting someone else's shared document into
 * your collection organises *your* view of it and changes nobody's permissions.
 */
const collectionSchema = new mongoose.Schema(
  {
    _id: { type: String, default: newId },

    name: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: "", trim: true, maxlength: 300 },

    /** Hex accent used for the sidebar dot and the collection header. */
    color: { type: String, default: "#5b8cff" },
    /** Key into the client's icon set. */
    icon: { type: String, default: "files" },

    ownerId: { type: String, required: true, index: true },

    /** Manual ordering in the sidebar. */
    position: { type: Number, default: 0 },

    createdAt: { type: String },
    updatedAt: { type: String },
  },
  { versionKey: false, timestamps: false, _id: false }
);

collectionSchema.index({ ownerId: 1, position: 1 });

module.exports = collectionSchema;
