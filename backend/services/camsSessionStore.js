const crypto = require("crypto");
const db = require("../db");
const { recordCamsDiagnostic } = require("./camsDiagnostics");

const tableName = "cams_redirect_sessions";
let encryptionKey;

const getEncryptionKey = () => {
  if (encryptionKey) return encryptionKey;

  const configuredKey = process.env.CAMS_SESSION_ENCRYPTION_KEY;
  if (!configuredKey) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CAMS_SESSION_ENCRYPTION_KEY is required in production");
    }
    if (!process.env.CAMS_REDIRECTION_KEY) {
      throw new Error("CAMS_REDIRECTION_KEY is required to protect local CAMS sessions");
    }

    encryptionKey = crypto
      .createHash("sha256")
      .update(`labdhi-local-cams-session:${process.env.CAMS_REDIRECTION_KEY}`)
      .digest();
    return encryptionKey;
  }

  const parsedKey = /^[a-f0-9]{64}$/i.test(configuredKey)
    ? Buffer.from(configuredKey, "hex")
    : Buffer.from(configuredKey, "base64");
  if (parsedKey.length !== 32) {
    throw new Error("CAMS_SESSION_ENCRYPTION_KEY must encode exactly 32 bytes");
  }

  encryptionKey = parsedKey;
  return encryptionKey;
};

const sessionReference = (sessionId, key) =>
  crypto
    .createHmac("sha256", key)
    .update(`cams-redirect-session:${sessionId}`)
    .digest("hex");

const encryptSession = (session, key) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(session), "utf8"),
    cipher.final(),
  ]);

  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64"))
    .join(".");
};

const decryptSession = (payload, key) => {
  const [ivValue, tagValue, encryptedValue] = String(payload).split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Stored CAMS session has an invalid encrypted payload");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivValue, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(decrypted);
};

const ensureTable = async () => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      session_ref CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      expires_at BIGINT UNSIGNED NOT NULL,
      encrypted_payload MEDIUMTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (session_ref),
      KEY idx_cams_redirect_sessions_expires_at (expires_at)
    ) ENGINE=InnoDB
  `);
};

const loadRedirectSessions = async () => {
  const key = getEncryptionKey();
  await ensureTable();

  const now = Date.now();
  await db.execute(`DELETE FROM ${tableName} WHERE expires_at < ?`, [now]);
  const [rows] = await db.execute(
    `SELECT session_ref, expires_at, encrypted_payload
     FROM ${tableName}
     WHERE expires_at >= ?`,
    [now]
  );

  return rows.map((row) => {
    let session;
    try {
      session = decryptSession(row.encrypted_payload, key);
    } catch {
      throw new Error("Unable to decrypt a stored CAMS session; verify CAMS_SESSION_ENCRYPTION_KEY");
    }

    if (
      !session.sessionId ||
      sessionReference(session.sessionId, key) !== row.session_ref ||
      Number(session.expiresAt) !== Number(row.expires_at)
    ) {
      throw new Error("Stored CAMS session failed integrity validation");
    }

    return session;
  });
};

const saveRedirectSession = async (session) => {
  const expiresAtValid = Number.isInteger(session.expiresAt) && session.expiresAt > Date.now();
  const sessionPayloadValid = Boolean(
    session.sessionId &&
    session.token &&
    session.consentHandle &&
    session.txnId &&
    expiresAtValid
  );

  recordCamsDiagnostic("REDIRECT_SESSION_DB_SAVE_STARTED", {
    sessionId: session.sessionId,
    txnId: session.txnId,
    sessionIdPresent: Boolean(session.sessionId),
    mobilePresent: Boolean(session.mobile),
    sessionTokenPresent: Boolean(session.token),
    consentHandlePresent: Boolean(session.consentHandle),
    redirectTxnIdPresent: Boolean(session.txnId),
    expiresAtValid,
    sessionPayloadValid,
  });

  let result;
  try {
    const key = getEncryptionKey();
    const sessionRef = sessionReference(session.sessionId, key);
    const encryptedPayload = encryptSession(session, key);
    [result] = await db.execute(
      `INSERT INTO ${tableName} (session_ref, expires_at, encrypted_payload)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         expires_at = VALUES(expires_at),
         encrypted_payload = VALUES(encrypted_payload)`,
      [sessionRef, session.expiresAt, encryptedPayload]
    );
  } catch (error) {
    recordCamsDiagnostic("REDIRECT_SESSION_DB_SAVE_FAILED", {
      sessionId: session.sessionId,
      txnId: session.txnId,
      mobilePresent: Boolean(session.mobile),
      sessionTokenPresent: Boolean(session.token),
      consentHandlePresent: Boolean(session.consentHandle),
      redirectTxnIdPresent: Boolean(session.txnId),
      expiresAtValid,
      sessionPayloadValid,
      storeErrorCode: error.code || error.name,
    });
    throw error;
  }

  recordCamsDiagnostic("REDIRECT_SESSION_DB_SAVE_SUCCEEDED", {
    sessionId: session.sessionId,
    txnId: session.txnId,
    expiresAtValid,
    sessionStoreSaveSucceeded: true,
    storeRowsAffected: result.affectedRows,
  });
  return result;
};

const deleteRedirectSession = async (sessionId) => {
  const key = getEncryptionKey();
  await db.execute(
    `DELETE FROM ${tableName} WHERE session_ref = ?`,
    [sessionReference(sessionId, key)]
  );
};

module.exports = {
  loadRedirectSessions,
  saveRedirectSession,
  deleteRedirectSession,
};