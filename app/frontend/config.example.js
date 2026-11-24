// Example only. Terraform generates the real config.js and uploads it to S3.
// For local testing, copy this file to config.js and fill in the values from `terraform output`.
window.BLOG_CONFIG = {
  region: "us-east-1",
  userPoolId: "us-east-1_XXXXXXXXX",
  clientId: "xxxxxxxxxxxxxxxxxxxxxxxxxx",
  apiBase: "/api",
};
