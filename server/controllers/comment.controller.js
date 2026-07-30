"use strict";

const asyncHandler = require("../utils/asyncHandler");
const commentService = require("../services/comment.service");

exports.list = asyncHandler(async (req, res) => {
  res.json(await commentService.listForDocument({ id: req.params.id, user: req.user, query: req.query }));
});

exports.create = asyncHandler(async (req, res) => {
  res.status(201).json(
    await commentService.create({ id: req.params.id, user: req.user, body: req.body, req })
  );
});

exports.update = asyncHandler(async (req, res) => {
  res.json(
    await commentService.update({
      id: req.params.id,
      commentId: req.params.commentId,
      user: req.user,
      body: req.body,
      req,
    })
  );
});

exports.remove = asyncHandler(async (req, res) => {
  res.json(
    await commentService.remove({
      id: req.params.id,
      commentId: req.params.commentId,
      user: req.user,
      req,
    })
  );
});
