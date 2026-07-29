"use strict";

const { db } = require("../data");
const ApiError = require("../utils/ApiError");
const { newToken } = require("../utils/ids");
const { hashPassword, verifyPassword } = require("../utils/password");
const { formatBytes, isInlinePreviewable } = require("../utils/files");

const access = require("./access.service");
const activity = require("./activity.service");
const authService = require("./auth.service");
const storage = require("./storage.service");

const PERMISSIONS = ["view", "edit", "manage"];

/** Turn `expiresAt` / `expiresInDays` input into an ISO string or null. */
function resolveExpiry({ expiresAt, expiresInDays }) {
  if (expiresAt) {
    const when = new Date(expiresAt);
    if (Number.isNaN(when.getTime())) {
      throw ApiError.unprocessable("expiresAt is not a valid date", {
        details: [{ field: "expiresAt", message: "Invalid date" }],
      });
    }
    if (when.getTime() <= Date.now()) {
      throw ApiError.unprocessable("Expiry must be in the future", {
        details: [{ field: "expiresAt", message: "Must be in the future" }],
      });
    }
    return when.toISOString();
  }

  if (expiresInDays !== undefined && expiresInDays !== null && expiresInDays !== "") {
    const days = Number(expiresInDays);
    if (!Number.isFinite(days) || days <= 0 || days > 365) {
      throw ApiError.unprocessable("expiresInDays must be between 1 and 365", {
        details: [{ field: "expiresInDays", message: "Out of range" }],
      });
    }
    return new Date(Date.now() + days * 86_400_000).toISOString();
  }

  return null;
}

function assertPermission(permission) {
  if (!PERMISSIONS.includes(permission)) {
    throw ApiError.unprocessable(`Permission must be one of: ${PERMISSIONS.join(", ")}`, {
      details: [{ field: "permission", message: "Invalid value" }],
    });
  }
}

/** Shape a share for the owner's management UI. Password hashes never leave the server. */
function presentShare(share, { origin = "" } = {}) {
  return {
    id: share.id,
    documentId: share.documentId,
    type: share.type,
    email: share.email || null,
    userId: share.userId || null,
    permission: share.permission,
    expiresAt: share.expiresAt || null,
    isExpired: Boolean(share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()),
    hasPassword: Boolean(share.passwordHash),
    maxDownloads: share.maxDownloads ?? null,
    downloadCount: share.downloadCount || 0,
    lastAccessedAt: share.lastAccessedAt || null,
    token: share.type === "link" ? share.token : null,
    url: share.type === "link" ? `${origin}/s/${share.token}` : null,
    createdBy: share.createdBy,
    createdAt: share.createdAt,
  };
}

/** All live shares on a document. Requires manage access. */
async function listForDocument({ id, user, origin }) {
  await access.loadDocumentFor(id, user, "manage");
  const shares = await db.shares.find({ documentId: id, revokedAt: null }, { sort: { createdAt: -1 } });
  return shares.map((share) => presentShare(share, { origin }));
}

/**
 * Grant a named person access.
 *
 * Re-sharing with the same address updates the existing grant instead of
 * stacking duplicates, so the effective permission is never ambiguous.
 */
async function shareWithUser({ id, user, body = {}, req, origin }) {
  const { document } = await access.loadDocumentFor(id, user, "manage");

  const email = authService.normalizeEmail(body.email);
  if (!email) {
    throw ApiError.unprocessable("An email address is required", {
      details: [{ field: "email", message: "Required" }],
    });
  }
  if (email === user.email) {
    throw ApiError.badRequest("You already have access to this document", { code: "SELF_SHARE" });
  }

  const permission = body.permission || "view";
  assertPermission(permission);
  const expiresAt = resolveExpiry(body);

  const recipient = await authService.findByEmail(email);
  if (recipient && recipient.id === document.ownerId) {
    throw ApiError.badRequest("The owner already has full access", { code: "OWNER_SHARE" });
  }

  const existing = await db.shares.findOne({ documentId: id, type: "user", email, revokedAt: null });

  const share = existing
    ? await db.shares.updateById(existing.id, {
        permission,
        expiresAt,
        userId: recipient ? recipient.id : existing.userId,
      })
    : await db.shares.create({
        documentId: id,
        type: "user",
        email,
        userId: recipient ? recipient.id : null,
        permission,
        expiresAt,
        downloadCount: 0,
        createdBy: user.id,
        revokedAt: null,
      });

  await activity.record("share.user_granted", {
    req,
    actor: user,
    document,
    detail: `${email} · ${permission}${expiresAt ? ` · expires ${expiresAt.slice(0, 10)}` : ""}`,
  });

  return {
    share: presentShare(share, { origin }),
    recipientExists: Boolean(recipient),
    pending: !recipient,
  };
}

/** Create a public link. Multiple links per document are allowed (different terms). */
async function createLink({ id, user, body = {}, req, origin }) {
  const { document } = await access.loadDocumentFor(id, user, "manage");

  const permission = body.permission === "edit" ? "edit" : "view";
  const expiresAt = resolveExpiry(body);

  let maxDownloads = null;
  if (body.maxDownloads !== undefined && body.maxDownloads !== null && body.maxDownloads !== "") {
    maxDownloads = Number(body.maxDownloads);
    if (!Number.isInteger(maxDownloads) || maxDownloads < 1 || maxDownloads > 100_000) {
      throw ApiError.unprocessable("maxDownloads must be a whole number between 1 and 100000", {
        details: [{ field: "maxDownloads", message: "Out of range" }],
      });
    }
  }

  const password = body.password ? String(body.password) : "";
  if (password && password.length < 4) {
    throw ApiError.unprocessable("Link passwords must be at least 4 characters", {
      details: [{ field: "password", message: "Too short" }],
    });
  }

  const share = await db.shares.create({
    documentId: id,
    type: "link",
    token: newToken(),
    permission,
    expiresAt,
    maxDownloads,
    passwordHash: password ? await hashPassword(password) : null,
    downloadCount: 0,
    createdBy: user.id,
    revokedAt: null,
  });

  await activity.record("share.link_created", {
    req,
    actor: user,
    document,
    detail: [
      permission,
      password ? "password protected" : "no password",
      expiresAt ? `expires ${expiresAt.slice(0, 10)}` : "no expiry",
      maxDownloads ? `max ${maxDownloads} downloads` : "unlimited downloads",
    ].join(" · "),
  });

  return presentShare(share, { origin });
}

/** Revoke any share (user grant or public link). Soft — keeps the audit trail. */
async function revoke({ id, shareId, user, req }) {
  const { document } = await access.loadDocumentFor(id, user, "manage");

  const share = await db.shares.findById(shareId);
  if (!share || share.documentId !== id) {
    throw ApiError.notFound("Share not found", { code: "SHARE_NOT_FOUND" });
  }
  if (share.revokedAt) return { revoked: true, id: shareId, alreadyRevoked: true };

  await db.shares.updateById(shareId, { revokedAt: new Date().toISOString() });

  await activity.record(share.type === "link" ? "share.link_revoked" : "share.user_revoked", {
    req,
    actor: user,
    document,
    detail: share.type === "link" ? `token ${String(share.token).slice(0, 8)}…` : share.email,
  });

  return { revoked: true, id: shareId };
}

/**
 * Validate a public token and return the share plus its document.
 *
 * Every failure mode is distinguished with a stable code so the UI can show the
 * right screen: expired, revoked, exhausted, or password required.
 */
async function resolveToken(token, { password } = {}) {
  const share = await db.shares.findOne({ token: String(token || ""), type: "link" });

  if (!share) throw ApiError.notFound("This link is not valid", { code: "LINK_NOT_FOUND" });
  if (share.revokedAt) throw ApiError.forbidden("This link has been revoked", { code: "LINK_REVOKED" });
  if (share.expiresAt && new Date(share.expiresAt).getTime() <= Date.now()) {
    throw ApiError.forbidden("This link has expired", { code: "LINK_EXPIRED" });
  }
  if (share.maxDownloads !== null && share.maxDownloads !== undefined && share.downloadCount >= share.maxDownloads) {
    throw ApiError.forbidden("This link has reached its download limit", { code: "LINK_EXHAUSTED" });
  }

  if (share.passwordHash) {
    if (!password) {
      throw ApiError.unauthorized("This link is password protected", {
        code: "LINK_PASSWORD_REQUIRED",
      });
    }
    if (!(await verifyPassword(String(password), share.passwordHash))) {
      throw ApiError.unauthorized("Incorrect link password", { code: "LINK_PASSWORD_INVALID" });
    }
  }

  const document = await db.documents.findById(share.documentId);
  if (!document || document.status !== "active") {
    throw ApiError.notFound("The shared document is no longer available", { code: "DOCUMENT_GONE" });
  }

  return { share, document };
}

/** Public, unauthenticated view of a shared document. */
async function viewByToken({ token, password, req }) {
  const { share, document } = await resolveToken(token, { password });

  await db.shares.updateById(share.id, { lastAccessedAt: new Date().toISOString() });
  await db.documents.increment(document.id, { viewCount: 1 });
  await activity.record("share.link_accessed", {
    req,
    actor: req && req.user ? req.user : null,
    document,
    detail: `token ${String(share.token).slice(0, 8)}…`,
  });

  return {
    document: {
      id: document.id,
      title: document.title,
      description: document.description || "",
      tags: document.tags || [],
      ownerName: document.ownerName,
      version: document.version,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      file: {
        originalName: document.originalName,
        mimeType: document.mimeType,
        extension: document.extension,
        size: document.size,
        sizeLabel: formatBytes(document.size),
        category: document.category,
        previewable: isInlinePreviewable(document.mimeType),
      },
    },
    share: {
      permission: share.permission,
      expiresAt: share.expiresAt || null,
      maxDownloads: share.maxDownloads ?? null,
      downloadCount: share.downloadCount || 0,
      remainingDownloads:
        share.maxDownloads == null ? null : Math.max(0, share.maxDownloads - (share.downloadCount || 0)),
    },
    links: {
      download: `/api/share/${share.token}/download`,
      preview: `/api/share/${share.token}/preview`,
    },
  };
}

/** Resolve a token to an on-disk file for streaming. */
async function fileByToken({ token, password }) {
  const { share, document } = await resolveToken(token, { password });

  if (!(await storage.exists(document.storedName))) {
    throw ApiError.notFound("The stored file is missing from disk", { code: "FILE_MISSING" });
  }

  return { share, document, absolutePath: storage.pathFor(document.storedName) };
}

/** Record a download made through a public link. */
async function countLinkDownload({ share, document, req }) {
  await db.shares.updateById(share.id, {
    downloadCount: (share.downloadCount || 0) + 1,
    lastAccessedAt: new Date().toISOString(),
  });
  await db.documents.increment(document.id, { downloadCount: 1 });
  await activity.record("document.downloaded", {
    req,
    actor: req && req.user ? req.user : null,
    document,
    detail: `via public link ${String(share.token).slice(0, 8)}…`,
  });
}

module.exports = {
  listForDocument,
  shareWithUser,
  createLink,
  revoke,
  resolveToken,
  viewByToken,
  fileByToken,
  countLinkDownload,
  presentShare,
  PERMISSIONS,
};
