const express = require("express");
const multer = require("multer");
const { requireAuth } = require("../auth");
const { uploadImage } = require("../azure");
const { asyncHandler } = require("../util");

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_TYPES.includes(file.mimetype)),
});

const router = express.Router();

// POST /api/media  (multipart/form-data, field "image") -> { url }
router.post(
  "/",
  requireAuth,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "An image file (jpeg, png, gif, webp) is required" });
    const url = await uploadImage(req.file.buffer, req.file.mimetype, req.file.originalname);
    res.status(201).json({ url });
  })
);

module.exports = router;
