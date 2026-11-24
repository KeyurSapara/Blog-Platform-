const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../auth");
const { asyncHandler } = require("../util");
const { fromConfig, MAX_FILTER_VALUES } = require("../notifications");

const notifications = fromConfig();
const router = express.Router();

const isAuthorId = (v) => typeof v === "string" && v.length > 0 && v.length <= 64;

// Latest name the author published under, plus their email (users row is created at first login).
async function findAuthor(authorId) {
  const [rows] = await pool.query(
    `SELECT p.author_id AS id, p.author_name AS name, u.email
       FROM posts p LEFT JOIN users u ON u.id = p.author_id
      WHERE p.author_id = ? ORDER BY p.created_at DESC LIMIT 1`,
    [authorId]
  );
  return rows[0] || null;
}

async function countSubscribers(authorId) {
  const [[row]] = await pool.query("SELECT COUNT(*) AS n FROM subscriptions WHERE author_id = ?", [authorId]);
  return row.n;
}

// Pushes the reader's current list of followed authors to their SNS email subscription.
async function syncSns(user) {
  const [follows] = await pool.query("SELECT author_id FROM subscriptions WHERE subscriber_id = ?", [user.id]);
  const [[endpoint]] = await pool.query(
    "SELECT email, sns_subscription_arn FROM notification_endpoints WHERE user_id = ?",
    [user.id]
  );
  let currentArn = endpoint?.sns_subscription_arn || null;
  if (currentArn && endpoint.email !== user.email) {
    // Email changed in Cognito: drop the old address and subscribe the new one.
    await notifications.syncEmailSubscription(endpoint.email, [], currentArn);
    currentArn = null;
  }

  const arn = await notifications.syncEmailSubscription(user.email, follows.map((f) => f.author_id), currentArn);
  await pool.query(
    `INSERT INTO notification_endpoints (user_id, email, sns_subscription_arn) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE email = VALUES(email), sns_subscription_arn = VALUES(sns_subscription_arn)`,
    [user.id, user.email, arn]
  );
  return arn;
}

// GET /api/subscriptions - authors I follow, and whether my SNS email subscription is confirmed.
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query(
      `SELECT s.author_id, s.created_at,
              (SELECT p.author_name FROM posts p WHERE p.author_id = s.author_id
                ORDER BY p.created_at DESC LIMIT 1) AS author_name
         FROM subscriptions s WHERE s.subscriber_id = ? ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    const [[endpoint]] = await pool.query(
      "SELECT sns_subscription_arn FROM notification_endpoints WHERE user_id = ?",
      [req.user.id]
    );
    res.json({
      notificationsEnabled: notifications.enabled,
      emailConfirmed: await notifications.isEmailConfirmed(endpoint?.sns_subscription_arn),
      subscriptions: rows,
    });
  })
);

// GET /api/subscriptions/authors/:authorId - public subscriber count
router.get(
  "/authors/:authorId",
  asyncHandler(async (req, res) => {
    if (!isAuthorId(req.params.authorId)) return res.status(400).json({ error: "Invalid author id" });
    res.json({ authorId: req.params.authorId, subscribers: await countSubscribers(req.params.authorId) });
  })
);

// POST /api/subscriptions  { authorId }
router.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const authorId = req.body?.authorId;
    if (!isAuthorId(authorId)) return res.status(400).json({ error: "authorId is required" });
    if (authorId === req.user.id) return res.status(400).json({ error: "You cannot subscribe to yourself" });

    const author = await findAuthor(authorId);
    if (!author) return res.status(404).json({ error: "Author not found" });

    const [[{ n: following }]] = await pool.query(
      "SELECT COUNT(*) AS n FROM subscriptions WHERE subscriber_id = ?",
      [req.user.id]
    );
    if (following >= MAX_FILTER_VALUES) {
      return res.status(400).json({ error: `You can follow at most ${MAX_FILTER_VALUES} authors` });
    }

    await pool.query("INSERT INTO users (id, email) VALUES (?, ?) ON DUPLICATE KEY UPDATE email = VALUES(email)", [
      req.user.id,
      req.user.email,
    ]);
    const [result] = await pool.query("INSERT IGNORE INTO subscriptions (subscriber_id, author_id) VALUES (?, ?)", [
      req.user.id,
      authorId,
    ]);
    if (result.affectedRows === 0) return res.json({ subscribed: true, alreadySubscribed: true });

    let arn;
    try {
      arn = await syncSns(req.user);
    } catch (err) {
      console.error("SNS subscribe failed:", err.message);
      await pool.query("DELETE FROM subscriptions WHERE subscriber_id = ? AND author_id = ?", [req.user.id, authorId]);
      return res.status(502).json({ error: "Could not set up email notifications, please try again" });
    }

    const emailConfirmed = await notifications.isEmailConfirmed(arn);
    const subscriberCount = await countSubscribers(authorId);
    res.status(201).json({ subscribed: true, emailConfirmed, notificationsEnabled: notifications.enabled });

    // Welcome email to the reader + "new subscriber" email to the author via SES.
    notifications
      .notifySubscribed({ subscriber: req.user, author, subscriberCount, emailConfirmed })
      .catch((err) => console.error("Subscription emails failed:", err.message));
  })
);

// DELETE /api/subscriptions/:authorId
router.delete(
  "/:authorId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { authorId } = req.params;
    if (!isAuthorId(authorId)) return res.status(400).json({ error: "Invalid author id" });

    const [result] = await pool.query("DELETE FROM subscriptions WHERE subscriber_id = ? AND author_id = ?", [
      req.user.id,
      authorId,
    ]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "You are not subscribed to this author" });

    try {
      await syncSns(req.user);
    } catch (err) {
      console.error("SNS unsubscribe failed:", err.message);
      await pool.query("INSERT IGNORE INTO subscriptions (subscriber_id, author_id) VALUES (?, ?)", [req.user.id, authorId]);
      return res.status(502).json({ error: "Could not update email notifications, please try again" });
    }
    res.status(204).end();
  })
);

module.exports = router;
