const fs = require("fs");
const mysql = require("mysql2/promise");
const { db } = require("./config");

// RDS MySQL 8.4 requires TLS, so we verify the server against the RDS CA bundle.
const pool = mysql.createPool({
  host: db.host,
  port: db.port,
  user: db.user,
  password: db.password,
  database: db.database,
  ssl: db.sslCaPath ? { ca: fs.readFileSync(db.sslCaPath) } : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
});

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id           VARCHAR(64)  PRIMARY KEY,
     email        VARCHAR(255) NOT NULL,
     display_name VARCHAR(100),
     bio          TEXT,
     created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE TABLE IF NOT EXISTS posts (
     id          INT AUTO_INCREMENT PRIMARY KEY,
     author_id   VARCHAR(64)  NOT NULL,
     author_name VARCHAR(255) NOT NULL,
     title       VARCHAR(200) NOT NULL,
     content     MEDIUMTEXT   NOT NULL,
     image_url   VARCHAR(500),
     created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     INDEX idx_posts_created (created_at)
   )`,
  `CREATE TABLE IF NOT EXISTS comments (
     id          INT AUTO_INCREMENT PRIMARY KEY,
     post_id     INT          NOT NULL,
     author_id   VARCHAR(64)  NOT NULL,
     author_name VARCHAR(255) NOT NULL,
     body        TEXT         NOT NULL,
     created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_comments_post (post_id),
     FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
   )`,
  // Reader -> author follows. SNS delivers an author's new posts to these readers.
  `CREATE TABLE IF NOT EXISTS subscriptions (
     subscriber_id VARCHAR(64) NOT NULL,
     author_id     VARCHAR(64) NOT NULL,
     created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     PRIMARY KEY (subscriber_id, author_id),
     INDEX idx_subscriptions_author (author_id)
   )`,
  // Each reader's single SNS email subscription (its filter policy lists the authors they follow).
  `CREATE TABLE IF NOT EXISTS notification_endpoints (
     user_id              VARCHAR(64)  PRIMARY KEY,
     email                VARCHAR(255) NOT NULL,
     sns_subscription_arn VARCHAR(512),
     updated_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
   )`,
];

async function initSchema() {
  for (const sql of SCHEMA) await pool.query(sql);
}

module.exports = { pool, initSchema };
