"use strict";

const mongoose = require("mongoose");
const { newId } = require("../../../utils/ids");

const versionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    storedName: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    checksum: { type: String },
    uploadedAt: { type: String, required: true },
    uploadedBy: { type: String, required: true },
    note: { type: String, default: "" },
  },
  { _id: false, versionKey: false }
);

const documentSchema = new mongoose.Schema(
  {
    _id: { type: String, default: newId },

    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    tags: { type: [String], default: [], index: true },

    ownerId: { type: String, required: true, index: true },
    ownerName: { type: String, default: "" },

    // "private"  – owner + explicit shares only
    // "internal" – any signed-in user can read
    // "public"   – readable by anyone holding the document id
    visibility: { type: String, enum: ["private", "internal", "public"], default: "private", index: true },

    // Current file. Historic files live in `versions`.
    storedName: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    extension: { type: String, default: "" },
    size: { type: Number, default: 0, index: true },
    checksum: { type: String, default: "" },
    category: { type: String, default: "other", index: true },

    /**
     * Owning collection, or null for "unfiled". A collection is organisational
     * only — it never affects who can see the document.
     */
    collectionId: { type: String, default: null, index: true },

    /**
     * Lower-cased opening slice of a text-ish file, kept so search can look
     * *inside* documents instead of only at their titles.
     *
     * A bounded snippet rather than the whole file: full content would bloat
     * every record (and the local driver holds records in memory), while the
     * first few KB is where titles, headings and summaries live. The cap is
     * `SEARCH_SNIPPET_KB`, and `snippetTruncated` records when a file was longer
     * so the UI can say so rather than implying a whole-file match.
     */
    contentSnippet: { type: String, default: "" },
    snippetTruncated: { type: Boolean, default: false },

    version: { type: Number, default: 1 },
    versions: { type: [versionSchema], default: [] },

    downloadCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
    starredBy: { type: [String], default: [] },

    status: { type: String, enum: ["active", "trashed"], default: "active", index: true },
    trashedAt: { type: String, default: null },

    createdAt: { type: String },
    updatedAt: { type: String },
  },
  { versionKey: false, timestamps: false, _id: false }
);

// Supports the common "my documents, newest first" listing.
documentSchema.index({ ownerId: 1, status: 1, createdAt: -1 });
// Collection listings.
documentSchema.index({ collectionId: 1, status: 1 });
// Duplicate detection by content hash, scoped to an owner.
documentSchema.index({ ownerId: 1, checksum: 1 });
// Text-ish search fallback (regex search is used so this stays a prefix index).
documentSchema.index({ title: 1 });

module.exports = documentSchema;
