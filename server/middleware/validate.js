"use strict";

const { validationResult } = require("express-validator");
const ApiError = require("../utils/ApiError");

/**
 * Convert accumulated express-validator failures into a single 422.
 *
 * Previously each controller repeated this block and several routes declared
 * validators but never checked them, so invalid input reached the database.
 * Now it is one middleware placed after the validator chain.
 */
function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();

  const details = result.array().map((issue) => ({
    field: issue.path || issue.param,
    message: issue.msg,
    location: issue.location,
  }));

  next(
    ApiError.unprocessable("Some fields need your attention", {
      code: "VALIDATION_FAILED",
      details,
    })
  );
}

module.exports = validate;
