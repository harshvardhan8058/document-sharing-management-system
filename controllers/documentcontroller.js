const Document = require("../models/documentModel");
const { validationResult } = require("express-validator");
exports.getDocumentById = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
    res.json(document);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.uploadDocument = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const newDocument = new Document({
      title: req.body.title,
      description: req.body.description,
      file: req.file.filename,
    });
    await newDocument.save();
    res.status(201).json(newDocument);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.getDocuments = async (req, res) => {
  try {
    const documents = await Document.find();
    res.json("documents");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
exports.downloadDocument = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
    const filePath = `/path/to/documents/${document.file}`;
    res.download(filePath);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const document = await Document.findByIdAndDelete(req.params.id);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
    res.json({ message: "Document deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.updateDocument = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const document = await Document.findByIdAndUpdate(
      req.params.id,
      {
        title: req.body.title,
        description: req.body.description,
      },
      { new: true }
    );
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }
    res.json(document);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
