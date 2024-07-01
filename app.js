require("dotenv").config();
const express = require("express");
const connectDB = require("./config/db");
const { logger } = require("./middleware/upload");
const documentRoutes = require("./routes/documentroutes");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

connectDB();

app.use(cors());
app.use(express.json());
app.use(logger);
app.use("/uploads", express.static("uploads"));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

app.use("/api/documents", documentRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
