// const express = require("express");
// const connectDB = require("./config/db");
// const { logger } = require("./middleware/upload");
// const documentRoutes = require("./routes/documentroutes");

// const app = express();

// // Connect to database
// connectDB();

// // Middleware
// app.use(express.json());
// app.use(logger); // Use logger middleware
// app.use("/uploads", express.static("uploads"));

// // Routes
// app.use("/api/documents", documentRoutes); // Use documentRoutes

// const PORT = process.env.PORT || 3000;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
// app.use(express.static("Frontend")); // Replace 'public' with your directory name
require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const { logger } = require("./middleware/upload");
const documentRoutes = require("./routes/documentroutes");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

// Connect to database
connectDB();

// Middleware
app.use(cors()); // Use CORS middleware
app.use(express.json());
app.use(logger); // Use logger middleware
app.use("/uploads", express.static("uploads"));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Routes
app.use("/api/documents", documentRoutes); // Use documentRoutes

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
