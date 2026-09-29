const crypto = require("crypto");
const axios = require("axios");

const requiredEnvironment = [
  "CAMS_BASE_URL",
  "CAMS_FIU_ID",
  "CAMS_USER_ID",
  "CAMS_REDIRECTION_KEY",
  "CAMS_USE_CASE_ID",
];

const getBaseUrl = () => String(process.env.CAMS_BASE_URL || "").replace(/\/$/, "");
const getFiuId = () => process.env.CAMS_FIU_ID;
const getUserId = () => process.env.CAMS_USER_ID;
const redirectSessions = new Map();
const consentRecords = new Map();

const rememberRedirectSession = (sessionId, values) => {
  const createdAt = Date.now();
  redirectSessions.set(sessionId, {
    ...values,
    createdAt,
    expiresAt: createdAt + 15 * 60 * 1000,
  });
};

const getRedirectSession = (sessionId) => {
  const session = redirectSessions.get(sessionId);

  if (!session || session.expiresAt < Date.now()) {
    redirectSessions.delete(sessionId);
    return null;
  }

  return session;
};

const findRedirectSession = (clientTxnId) => {
  if (!clientTxnId) return null;
  for (const session of redirectSessions.values()) {
    if (
      session.clientTxnId === clientTxnId ||
      session.clienttxnid === clientTxnId ||
      session.clienttrnxid === clientTxnId
    ) {
      if (session.expiresAt >= Date.now()) return session;
    }
  }

  return null;
};

const getRedirectSessionDiagnostics = (sessionId, clientTxnId) => {
  let session = sessionId ? redirectSessions.get(sessionId) : null;

  if (!session && clientTxnId) {
    session = Array.from(redirectSessions.values()).find(
      (candidate) =>
        candidate.clientTxnId === clientTxnId ||
        candidate.clienttxnid === clientTxnId ||
        candidate.clienttrnxid === clientTxnId
    );
  }

  return {
    mapSize: redirectSessions.size,
    sessionFound: Boolean(session && session.expiresAt >= Date.now()),
    createdAt: session?.createdAt
      ? new Date(session.createdAt).toISOString()
      : null,
    expiresAt: session?.expiresAt
      ? new Date(session.expiresAt).toISOString()
      : null,
  };
};

const normalizeConsentStatus = (status) => String(status || "").trim().toUpperCase();

const getConsentRecordKey = ({ consentHandle, consentId, sessionId }) =>
  consentHandle || consentId || sessionId;

const saveConsentRecord = (record) => {
  const key = getConsentRecordKey(record);
  if (!key) throw new Error("Consent notification has no identifying handle");

  const previous = consentRecords.get(key) || {};
  const next = {
    ...previous,
    ...record,
    consentStatus: normalizeConsentStatus(record.consentStatus || previous.consentStatus),
    updatedAt: new Date().toISOString(),
  };

  consentRecords.set(key, next);
  return next;
};

const getConsentRecord = (values) => consentRecords.get(getConsentRecordKey(values));

const findConsentRecordBySessionId = (sessionId) =>
  getAllConsentRecords().find((record) => record.sessionId === sessionId);

const getAllConsentRecords = () => Array.from(consentRecords.values());

const assertConfiguration = () => {
  const missing = requiredEnvironment.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(`Missing CAMS environment variables: ${missing.join(", ")}`);
  }
};

const requireValue = (name, value) => {
  if (!value) {
    throw new Error(`Missing CAMS value: ${name}`);
  }

  return value;
};

const redactSecrets = (value) => {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const isSecret = /(authorization|password|secret|redirection.?key|redirect(?:ion)?[._-]?url|token|ecres)/i.test(
        key
      );

      return [key, isSecret ? "[REDACTED]" : redactSecrets(child)];
    })
  );
};

const logCamsError = (operation, error) => {
  console.error(`[CAMS ${operation} ERROR]`, {
    status: error.response?.status,
    body: redactSecrets(error.response?.data),
    message: error.message,
  });
};

const readPayload = (response) => {
  const payload = response?.data || {};

  return payload.data && typeof payload.data === "object"
    ? { ...payload, ...payload.data }
    : payload;
};

const parseJsonValue = (value) => {
  if (Array.isArray(value)) return value.map(parseJsonValue);
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!(text.startsWith("{") || text.startsWith("["))) return value;

    try {
      return parseJsonValue(JSON.parse(text));
    } catch {
      return value;
    }
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, parseJsonValue(child)])
  );
};

const readPortfolio = (response) => parseJsonValue(readPayload(response));

const firstValue = (value, keys) =>
  keys.reduce((result, key) => result || value?.[key], "");

const post = async (path, body, token) => {
  assertConfiguration();

  try {
    return await axios.post(`${getBaseUrl()}${path}`, body, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    logCamsError(path, error);
    throw error;
  }
};

const authenticate = () =>
  post("/api/FIU/Authentication", {
    fiuID: getFiuId(),
    redirection_key: process.env.CAMS_REDIRECTION_KEY,
    userId: getUserId(),
  });

const readAuthentication = (response) => {
  const data = readPayload(response);

  return {
    token: data.token,
    sessionId: firstValue(data, ["sessionId", "sessionid"]),
  };
};

const redirectAA = ({ token, sessionId, mobile, clientTxnId, redirectUrl, pan, dob, userId }) => {
  const customerMobile = requireValue("aaCustomerMobile", mobile);
  const callbackUrl = requireValue("redirectUrl", redirectUrl);
  const txnId = clientTxnId || crypto.randomUUID();

  const payload = {
    clienttxnid: txnId,
    clienttrnxid: txnId,
    fiuID: getFiuId(),
    userId: userId || getUserId(),
    aaCustomerHandleId: `${customerMobile}@CAMSAA`,
    aaCustomerMobile: customerMobile,
    sessionId: requireValue("sessionId", sessionId),
    useCaseid: process.env.CAMS_USE_CASE_ID,
    fipid: "",
    redirect: "",
    redirecturl: callbackUrl,
    ...(pan ? { pan: String(pan).toUpperCase() } : {}),
    ...(dob ? { dob: String(dob) } : {}),
  };

  return post("/api/FIU/RedirectAA", payload, token).then((response) => {
    return response;
  });
};

const readRedirect = (response) => {
  const data = readPayload(response);

  return {
    consentHandle: data.consentHandle,
    txnId: firstValue(data, ["txnId", "txnid"]),
    clientTxnId: firstValue(data, ["clienttxnid", "clienttrnxid", "clientTxnId"]),
    redirectUrl: firstValue(data, ["redirectUrl", "redirectionurl"]),
  };
};

const readConsentStatus = (response) => {
  const data = readPayload(response);

  return {
    consentStatus: data.consentStatus,
    consentId: data.consentId,
  };
};

const getConsentStatus = ({ token, sessionId, consentHandle, txnId }) =>
  post(
    "/api/consent/GetConsentStatus",
    {
      fiuID: getFiuId(),
      consentHandle: requireValue("consentHandle", consentHandle),
      sessionId: requireValue("sessionId", sessionId),
      txnId: requireValue("txnId", txnId),
      userId: getUserId(),
    },
    token
  );

const getConsentData = ({ token, consentId }) =>
  post(
    "/api/fidata/GetConsentData",
    {
      consentId: requireValue("consentId", consentId),
      fiuID: getFiuId(),
    },
    token
  );

const fetchPeriodicData = ({ token, sessionId, txnId, consentId }) =>
  post(
    "/api/FIData/v2/FetchPeriodicData",
    {
      sessionId: requireValue("sessionId", sessionId),
      txnId: requireValue("txnId", txnId),
      consentId: requireValue("consentId", consentId),
      fiuID: getFiuId(),
    },
    token
  );

module.exports = {
  redactSecrets,
  getBaseUrl,
  getFiuId,
  readPayload,
  readPortfolio,
  authenticate,
  readAuthentication,
  redirectAA,
  readRedirect,
  readConsentStatus,
  getConsentStatus,
  getConsentData,
  fetchPeriodicData,
  rememberRedirectSession,
  getRedirectSession,
  findRedirectSession,
  getRedirectSessionDiagnostics,
  normalizeConsentStatus,
  saveConsentRecord,
  getConsentRecord,
  findConsentRecordBySessionId,
  getAllConsentRecords,
};
