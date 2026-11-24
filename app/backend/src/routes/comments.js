const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../auth");
const { moderateText } = require("../azure");
const { asyncHandler, toId } = require("../util");

const router = express.Router();

// GET /api/comments?postId=1
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const postId = toId(req.query.postId);
    if (!postId) return res.status(400).json({ error: "postId query parameter is required" });
    const [rows] = await pool.query(
      "SELECT id, post_id, author_id, author_name, body, created_at FROM comments WHERE post_id = ? ORDER BY created_at ASC",
      [postId]
    );
    res.json(rows);
  })
);

// POST /api/comments  { postId, body }
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const postId = toId(req.body?.postId);
    const body = req.body?.body;
    if (!postId) return res.status(400).json({ error: "postId is required" });
    if (typeof body !== "string" || !body.trim() || body.length > 2000) {
      return res.status(400).json({ error: "Comment is required (max 2000 chars)" });
    }

    const [posts] = await pool.query("SELECT id FROM posts WHERE id = ?", [postId]);
    if (!posts.length) return res.status(404).json({ error: "Post not found" });

    const verdict = await moderateText(body);
    if (!verdict.allowed) {
      return res.status(422).json({ error: "Comment rejected by content moderation", categories: verdict.categories });
    }

    const [result] = await pool.query(
      "INSERT INTO comments (post_id, author_id, author_name, body) VALUES (?, ?, ?, ?)",
      [postId, req.user.id, req.user.name, body.trim()]
    );
    res.status(201).json({ id: result.insertId });
  })
);

router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid comment id" });
    const [rows] = await pool.query("SELECT author_id FROM comments WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ error: "Comment not found" });
    if (rows[0].author_id !== req.user.id) return res.status(403).json({ error: "You can only delete your own comments" });

    await pool.query("DELETE FROM comments WHERE id = ?", [id]);
    res.status(204).end();
  })
);

module.exports = router;
