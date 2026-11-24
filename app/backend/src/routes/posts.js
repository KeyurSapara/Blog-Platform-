const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../auth");
const { asyncHandler, toId } = require("../util");
const notifications = require("../notifications").fromConfig();

const router = express.Router();

function validatePost({ title, content, imageUrl }) {
  if (typeof title !== "string" || !title.trim() || title.length > 200) return "Title is required (max 200 chars)";
  if (typeof content !== "string" || !content.trim() || content.length > 100000) return "Content is required";
  if (imageUrl != null && (typeof imageUrl !== "string" || !imageUrl.startsWith("https://") || imageUrl.length > 500)) {
    return "imageUrl must be an https URL";
  }
  return null;
}

// GET /api/posts?limit=20&offset=0
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const [rows] = await pool.query(
      `SELECT id, author_id, author_name, title, LEFT(content, 300) AS excerpt, image_url, created_at
         FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    res.json(rows);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid post id" });
    const [rows] = await pool.query("SELECT * FROM posts WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ error: "Post not found" });
    res.json(rows[0]);
  })
);

router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const error = validatePost(req.body || {});
    if (error) return res.status(400).json({ error });
    const { title, content, imageUrl } = req.body;
    const [result] = await pool.query(
      "INSERT INTO posts (author_id, author_name, title, content, image_url) VALUES (?, ?, ?, ?, ?)",
      [req.user.id, req.user.name, title.trim(), content, imageUrl || null]
    );
    res.status(201).json({ id: result.insertId });

    // Fan out to the author's subscribers through SNS (does not delay or fail the request).
    notifications
      .notifyNewPost({ id: result.insertId, authorId: req.user.id, authorName: req.user.name, title: title.trim(), content })
      .catch((err) => console.error("SNS publish failed:", err.message));
  })
);

router.put(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid post id" });
    const error = validatePost(req.body || {});
    if (error) return res.status(400).json({ error });

    const [rows] = await pool.query("SELECT author_id FROM posts WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ error: "Post not found" });
    if (rows[0].author_id !== req.user.id) return res.status(403).json({ error: "You can only edit your own posts" });

    const { title, content, imageUrl } = req.body;
    await pool.query("UPDATE posts SET title = ?, content = ?, image_url = ? WHERE id = ?", [
      title.trim(),
      content,
      imageUrl || null,
      id,
    ]);
    res.json({ id });
  })
);

router.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid post id" });
    const [rows] = await pool.query("SELECT author_id FROM posts WHERE id = ?", [id]);
    if (!rows.length) return res.status(404).json({ error: "Post not found" });
    if (rows[0].author_id !== req.user.id) return res.status(403).json({ error: "You can only delete your own posts" });

    await pool.query("DELETE FROM posts WHERE id = ?", [id]);
    res.status(204).end();
  })
);

module.exports = router;
