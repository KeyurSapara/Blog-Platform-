const express = require("express");
const config = require("./config");
const { pool, initSchema } = require("./db");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch {
    res.status(503).json({ status: "database unavailable" });
  }
});

app.use("/api/posts", require("./routes/posts"));
app.use("/api/comments", require("./routes/comments"));
app.use("/api/users", require("./routes/users"));
app.use("/api/media", require("./routes/media"));
app.use("/api/subscriptions", require("./routes/subscriptions"));

app.use((req, res) => res.status(404).json({ error: "Not found" }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "File too large (max 5 MB)" });
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  await initSchema();
  const server = app.listen(config.port, () => console.log(`CloudBlog API listening on :${config.port}`));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
