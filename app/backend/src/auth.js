const { CognitoJwtVerifier } = require("aws-jwt-verify");
const { cognito } = require("./config");

// Verifies Cognito ID tokens (signature, expiry, audience) using the user pool's public JWKS.
const verifier = CognitoJwtVerifier.create({
  userPoolId: cognito.userPoolId,
  clientId: cognito.clientId,
  tokenUse: "id",
});

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Login required" });

  try {
    const payload = await verifier.verify(token);
    req.user = { id: payload.sub, email: payload.email, name: String(payload.email).split("@")[0] };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired session, please log in again" });
  }
}

module.exports = { requireAuth };
