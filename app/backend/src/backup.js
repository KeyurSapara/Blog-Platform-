// Nightly disaster-recovery backup: AWS RDS MySQL -> gzip -> Azure Blob Storage (Cool tier).
// Plan A runs this from cron on the EC2 instance.
const { spawn } = require("child_process");
const zlib = require("zlib");
const config = require("./config");
const { blobService } = require("./azure");

async function main() {
  const { host, port, user, password, database, sslCaPath, dumpBin } = config.db;
  const blobName = `mysql/${database}-${new Date().toISOString().replace(/[:.]/g, "-")}.sql.gz`;
  const blob = blobService.getContainerClient(config.azure.backupsContainer).getBlockBlobClient(blobName);

  const args = ["-h", host, "-P", String(port), "-u", user, "--single-transaction", "--no-tablespaces", "--routines"];
  if (sslCaPath) args.push(`--ssl-ca=${sslCaPath}`);
  args.push(database);

  const dump = spawn(dumpBin, args, {
    env: { ...process.env, MYSQL_PWD: password },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const dumpFinished = new Promise((resolve, reject) => {
    dump.on("error", reject);
    dump.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${dumpBin} exited with code ${code}`))));
  });

  const gzip = zlib.createGzip();
  dump.stdout.pipe(gzip);

  try {
    await Promise.all([
      blob.uploadStream(gzip, 4 * 1024 * 1024, 4, {
        blobHTTPHeaders: { blobContentType: "application/gzip" },
        tier: "Cool",
      }),
      dumpFinished,
    ]);
  } catch (err) {
    await blob.deleteIfExists().catch(() => {});
    throw err;
  }
  console.log(`[${new Date().toISOString()}] Backup uploaded to Azure: ${config.azure.backupsContainer}/${blobName}`);
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] Backup failed:`, err.message);
  process.exit(1);
});
