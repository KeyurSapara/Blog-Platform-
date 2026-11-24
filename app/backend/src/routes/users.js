const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../auth");
const { asyncHandler } = require("../util");

const router = express.Router();

// GET /api/users/me - returns the profile, creating it on first login.
router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query("INSERT INTO users (id, email) VALUES (?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email)", [
      req.user.id,
      req.user.email,
    ]);
    const [rows] = await pool.query("SELECT id, email, display_name, bio, created_at FROM users WHERE id = ?", [
      req.user.id,
    ]);
    res.json(rows[0]);
  })
);

// PUT /api/users/me  { displayName, bio }
router.put(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const displayName = String(req.body?.displayName ?? "").trim().slice(0, 100);
    const bio = String(req.body?.bio ?? "").trim().slice(0, 1000);
    await pool.query(
      `INSERT INTO users (id, email, display_name, bio) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), bio = VALUES(bio)`,
      [req.user.id, req.user.email, displayName || null, bio || null]
    );
    res.json({ ok: true });
  })
);

module.exports = router;
