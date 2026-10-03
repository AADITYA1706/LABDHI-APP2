const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

// Load Environment Variables
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 5000;

// Routes
const employeeRoutes = require("./routes/employee");
const authRoutes = require("./routes/auth");
const camsRoutes = require("./routes/cams");
const consentRoutes = require("./routes/consent");
const fetchRoutes = require("./routes/fetch");
const webhookRoutes = require("./routes/webhook");
const insuranceRoutes = require("./routes/insurance");

// Middleware
app.use(cors());
app.use(express.json());
app.use(
  express.urlencoded({
    extended: true,
    verify: (req, res, buffer) => {
      req.rawBody = buffer.toString("utf8");
    },
  })
);

// Home
app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Labdhi Banking Backend Running",
  });
});

// Health Check
app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message: "Backend Working Successfully",
  });
});

// API Routes
app.use("/api/employee", employeeRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/cams", camsRoutes);
app.use("/api/consent", consentRoutes);
app.use("/api/fetch", fetchRoutes);
app.use("/webhook/cams", webhookRoutes);
app.use("/api/cams/webhook", webhookRoutes);
app.use("/api/insurance", insuranceRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route Not Found",
    path: req.originalUrl,
  });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});