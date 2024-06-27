// const authenticate = require("./path/to/authenticate");
const multer = require("multer");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage });

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    // Multer error occurred during file upload
    res.status(400).json({ error: "File upload error" });
  } else {
    // Other error occurred
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { upload, errorHandler };
// Logging middleware
const logger = (req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
};

// Authentication middleware
const authenticate = (req, res, next) => {
  // Perform authentication logic here
  // For example, check if the user is logged in
  if (req.body) {
    console.log("BODY DATA", req.body);
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// Authorization middleware
const authorize = (req, res, next) => {
  // Perform authorization logic here
  // For example, check if the user has the necessary permissions
  if (req.user.isAdmin) {
    next();
  } else {
    res.status(403).json({ error: "Forbidden" });
  }
};

module.exports = { upload, errorHandler, logger, authenticate, authorize };
