const crypto = require("crypto");
const path = require("path");
const { BlobServiceClient } = require("@azure/storage-blob");
const { azure } = require("./config");

const blobService = BlobServiceClient.fromConnectionString(azure.storageConnectionString);

// Uploads an image to Azure Blob Storage and returns its public URL.
async function uploadImage(buffer, mimeType, originalName) {
  const ext = path.extname(originalName || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
  const blobName = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`;
  const blob = blobService.getContainerClient(azure.imagesContainer).getBlockBlobClient(blobName);
  await blob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: mimeType, blobCacheControl: "public, max-age=31536000" },
  });
  return blob.url;
}

// Sends text to Azure AI Content Safety. A comment is rejected when any
// category (Hate, SelfHarm, Sexual, Violence) reaches the configured severity.
async function moderateText(text) {
  if (!azure.contentSafetyEndpoint || !azure.contentSafetyKey) {
    return { allowed: true, categories: [] };
  }
  const url = `${azure.contentSafetyEndpoint.replace(/\/$/, "")}/contentsafety/text:analyze?api-version=2023-10-01`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Ocp-Apim-Subscription-Key": azure.contentSafetyKey },
    body: JSON.stringify({ text: text.slice(0, 10000) }),
  });
  if (!res.ok) throw new Error(`Content Safety API error ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const flagged = (data.categoriesAnalysis || []).filter((c) => c.severity >= azure.moderationThreshold);
  return { allowed: flagged.length === 0, categories: flagged.map((c) => c.category) };
}

module.exports = { blobService, uploadImage, moderateText };
