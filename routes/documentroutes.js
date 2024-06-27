const express = require("express");
const documentController = require("../controllers/documentController");
const { body, validationResult } = require("express-validator");
const { upload, authenticate } = require("../middleware/upload");

const router = express.Router();

router.put(
  "/upload",
  authenticate, // Use authenticate middleware
  upload.single("file"), // Replace uploadMiddleware with upload
  [
    body("title").notEmpty().withMessage("Title is required"),
    body("description").notEmpty().withMessage("Description is required"),
  ],
  documentController.uploadDocument
);

router.post(
  "/:id",
  authenticate, // Use authenticate middleware
  [
    body("title").notEmpty().withMessage("Title is required"),
    body("description").notEmpty().withMessage("Description is required"),
  ],
  documentController.updateDocument
);

router.get("/", authenticate, documentController.getDocuments); // Use authenticate middleware

module.exports = router;
