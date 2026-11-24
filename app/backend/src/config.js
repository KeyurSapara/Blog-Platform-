require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

module.exports = {
  port: parseInt(process.env.PORT || "3000", 10),
  // Public URL used for links in notification emails.
  blogUrl: (process.env.BLOG_URL || "http://localhost:3000").replace(/\/$/, ""),
  db: {
    host: required("DB_HOST"),
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    database: required("DB_NAME"),
    sslCaPath: process.env.DB_SSL_CA || "",
    dumpBin: process.env.DUMP_BIN || "mysqldump",
  },
  cognito: {
    userPoolId: required("COGNITO_USER_POOL_ID"),
    clientId: required("COGNITO_CLIENT_ID"),
  },
  aws: {
    region: process.env.AWS_REGION || "us-east-1",
    // Leave empty to disable notifications (e.g. local development).
    snsTopicArn: process.env.SNS_TOPIC_ARN || "",
    sesSenderEmail: process.env.SES_SENDER_EMAIL || "",
  },
  azure: {
    storageConnectionString: required("AZURE_STORAGE_CONNECTION_STRING"),
    imagesContainer: process.env.AZURE_IMAGES_CONTAINER || "images",
    backupsContainer: process.env.AZURE_BACKUPS_CONTAINER || "backups",
    contentSafetyEndpoint: process.env.CONTENT_SAFETY_ENDPOINT || "",
    contentSafetyKey: process.env.CONTENT_SAFETY_KEY || "",
    moderationThreshold: parseInt(process.env.MODERATION_THRESHOLD || "2", 10),
  },
};
