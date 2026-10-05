const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const logPath = path.join(__dirname, "..", "logs", "cams-dashboard-diagnostics.jsonl");
const runId = crypto.randomUUID();
const allowedStatuses = new Set([
  "ACTIVE",
  "APPROVED",
  "CONSENTED",
  "AUTHORIZED",
  "SUCCESS",
  "COMPLETED",
  "PENDING",
  "REJECTED",
  "PAUSED",
  "REVOKED",
  "EXPIRED",
  "FAILED",
  "ERROR",
  "UNKNOWN",
]);

const hashIdentifier = (value) =>
  value
    ? crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16)
    : null;

const safeField = (value) =>
  String(value)
    .replace(/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, "[id]")
    .replace(/\b\d{6,}\b/g, "[number]")
    .slice(0, 120);

const safeFields = (values) =>
  Array.isArray(values)
    ? values.filter((value) => typeof value === "string").slice(0, 80).map(safeField)
    : [];

const recordCamsDiagnostic = (event, details = {}) => {
  const status = String(details.consentStatus || "").trim().toUpperCase();
  const nestedArrays = Array.isArray(details.nestedArrays)
    ? details.nestedArrays.slice(0, 30).map((item) => ({
        field: safeField(item.field || "root"),
        length: Number.isInteger(item.length) && item.length >= 0 ? item.length : null,
      }))
    : [];
  const counts = {};
  const flags = {};

  for (const field of ["accountCount", "transactionCount", "dmatCount", "insuranceCount"]) {
    if (Number.isInteger(details[field]) && details[field] >= 0) {
      counts[field] = details[field];
    }
  }

  for (const field of [
    "sessionFound",
    "sessionIdMatches",
    "consentRecordFound",
    "consentRecordHasData",
    "consentActive",
    "storedSessionMatches",
    "mobilePresent",
    "sessionIdPresent",
    "redirectUrlPresent",
    "redirectResponseSessionIdPresent",
    "sessionTokenPresent",
    "consentHandlePresent",
    "redirectTxnIdPresent",
    "expiresAtValid",
    "sessionPayloadValid",
    "sessionStoreSaveSucceeded",
  ]) {
    if (typeof details[field] === "boolean") flags[field] = details[field];
  }

  const entry = {
    runId,
    timestamp: new Date().toISOString(),
    event: safeField(event),
    httpStatus: Number.isInteger(details.httpStatus) ? details.httpStatus : null,
    sessionRef: hashIdentifier(details.sessionId),
    consentRef: hashIdentifier(details.consentId),
    txnRef: hashIdentifier(details.txnId),
    consentStatus: allowedStatuses.has(status) ? status : null,
    consentActive: typeof details.consentActive === "boolean" ? details.consentActive : null,
    topLevelKeys: safeFields(details.topLevelKeys),
    nestedKeys: safeFields(details.nestedKeys),
    nestedArrays,
    counts,
    flags,
    storeRowsAffected:
      Number.isInteger(details.storeRowsAffected) && details.storeRowsAffected >= 0
        ? details.storeRowsAffected
        : null,
    storeErrorCode:
      typeof details.storeErrorCode === "string" && /^[A-Z0-9_]{1,40}$/.test(details.storeErrorCode)
        ? details.storeErrorCode
        : null,
  };

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
  } catch (error) {
    console.error("[CAMS DIAGNOSTIC FILE WRITE FAILED]", error.code || "UNKNOWN");
  }
};

module.exports = { recordCamsDiagnostic };