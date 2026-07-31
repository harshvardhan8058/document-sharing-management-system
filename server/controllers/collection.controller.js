"use strict";

const asyncHandler = require("../utils/asyncHandler");
const collectionService = require("../services/collection.service");

exports.list = asyncHandler(async (req, res) => {
  res.json(await collectionService.list({ user: req.user }));
});

exports.create = asyncHandler(async (req, res) => {
  res.status(201).json({ collection: await collectionService.create({ user: req.user, body: req.body, req }) });
});

exports.update = asyncHandler(async (req, res) => {
  res.json({
    collection: await collectionService.update({
      id: req.params.id,
      user: req.user,
      body: req.body,
      req,
    }),
  });
});

exports.remove = asyncHandler(async (req, res) => {
  res.json(await collectionService.remove({ id: req.params.id, user: req.user, req }));
});

/** File documents into this collection. */
exports.assign = asyncHandler(async (req, res) => {
  res.json(
    await collectionService.assign({
      user: req.user,
      collectionId: req.params.id,
      documentIds: req.body.documentIds,
      req,
    })
  );
});

/** Clear a collection from documents, leaving them unfiled. */
exports.unfile = asyncHandler(async (req, res) => {
  res.json(
    await collectionService.assign({
      user: req.user,
      collectionId: null,
      documentIds: req.body.documentIds,
      req,
    })
  );
});
