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

const normalizeConsentStatus = (status) => {
  if (status == null) return "";

  if (typeof status === "string") {
    return status.trim().toUpperCase();
  }

  if (typeof status === "object") {
    const nested =
      status.consentStatus ??
      status.status ??
      status.consentState ??
      status.state ??
      status.data ??
      status.result ??
      status.payload;

    return normalizeConsentStatus(nested);
  }

  return String(status).trim().toUpperCase();
};

const isConsentStatusActive = (status) => {
  const normalized = normalizeConsentStatus(status);
  return new Set([
    "ACTIVE",
    "APPROVED",
    "CONSENTED",
    "AUTHORIZED",
    "SUCCESS",
    "COMPLETED",
  ]).has(normalized);
};

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
    throw new Error(
      `Missing required CAMS configuration: ${missing.join(", ")}. Add them to backend/.env and restart the backend.`
    );
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

const normalizeFieldName = (value) =>
  String(value).replace(/[^a-z0-9]/gi, "").toLowerCase();

const findArrayByNames = (sources, names) => {
  const targetNames = new Set(names.map(normalizeFieldName));

  const search = (value, depth = 0, visited = new Set()) => {
    if (!value || typeof value !== "object" || depth > 8 || visited.has(value)) {
      return null;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const result = search(item, depth + 1, visited);
        if (result) return result;
      }
      return null;
    }

    for (const [key, child] of Object.entries(value)) {
      if (targetNames.has(normalizeFieldName(key)) && Array.isArray(child)) {
        return child;
      }
    }

    for (const child of Object.values(value)) {
      const result = search(child, depth + 1, visited);
      if (result) return result;
    }

    return null;
  };

  for (const source of sources) {
    const result = search(source);
    if (result) return result;
  }

  return [];
};

const findFieldValue = (source, names) => {
  const targetNames = new Set(names.map(normalizeFieldName));
  const visited = new Set();

  const search = (value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 6 || visited.has(value)) {
      return undefined;
    }
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const result = search(item, depth + 1);
        if (result !== undefined) return result;
      }
      return undefined;
    }

    for (const [key, child] of Object.entries(value)) {
      if (
        targetNames.has(normalizeFieldName(key)) &&
        child !== null &&
        child !== undefined &&
        typeof child !== "object"
      ) {
        return child;
      }
    }

    for (const child of Object.values(value)) {
      const result = search(child, depth + 1);
      if (result !== undefined) return result;
    }

    return undefined;
  };

  return search(source);
};

const numericValue = (value) => {
  const rawValue =
    value && typeof value === "object"
      ? findFieldValue(value, ["amount", "value", "balance", "currentValue"])
      : value;
  if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") {
    return null;
  }
  if (typeof rawValue === "number") return Number.isFinite(rawValue) ? rawValue : 0;
  const parsed = Number(String(rawValue ?? "").replace(/[₹,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const mapDashboardData = (consentData, periodicData) => {
  const sources = [periodicData, consentData];
  const consentAccountEntries = Array.isArray(consentData?.data)
    ? consentData.data
    : [];
  const consentAccounts = consentAccountEntries
    .map((entry) => ({
      wrapper: entry,
      account:
      entry?.dataDetail?.jsonData?.Account ||
      entry?.dataDetail?.jsonData?.account ||
      entry?.jsonData?.Account ||
      entry?.Account ||
      entry,
    }))
    .filter(({ wrapper, account }) => account !== wrapper && account && typeof account === "object");
  const listedAccounts = findArrayByNames(
    [consentData, periodicData],
    ["accounts", "bankAccounts", "accountDetails", "accountList", "depositAccounts"]
  );
  const accountEntries = listedAccounts.length
    ? listedAccounts.map((entry) => ({
        wrapper: entry,
        account:
          entry?.dataDetail?.jsonData?.Account ||
          entry?.dataDetail?.jsonData?.account ||
          entry?.jsonData?.Account ||
          entry?.Account ||
          entry,
      }))
    : consentAccounts;
  const accounts = accountEntries.map(
    ({ wrapper, account }) => ({
      bankName:
        findFieldValue(wrapper, ["bankName", "bank", "fipName", "fipid", "institutionName"]) ||
        findFieldValue(account, ["bankName", "bank", "fipName", "institutionName"]) ||
        "Bank account",
      accountNumber:
        findFieldValue(account, ["accountNumber", "maskedAccountNumber", "maskedAccNumber", "accountRefNumber", "linkedAccRef"]) ||
        findFieldValue(wrapper, ["maskedAccountNumber", "accRefNumber", "linkedAccRef"]) ||
        "",
      accountType:
        findFieldValue(account, ["accountType", "type", "accountCategory"]) ||
        "Bank account",
      balance: numericValue(
        findFieldValue(account, ["balance", "currentBalance", "availableBalance", "closingBalance", "currentValue"])
      ),
    })
  );

  const listedTransactions = findArrayByNames(
    sources,
    ["transactions", "transaction", "recentTransactions", "transactionDetails", "transactionList", "txnHistory"]
  );
  const consentTransactions = consentAccounts.flatMap(({ wrapper, account }) => {
    const accountTransactions = findArrayByNames(
      [account?.Transactions || account?.transactions],
      ["transactions", "transaction", "transactionDetails", "transactionList", "txnHistory"]
    );
    return accountTransactions.map((transaction) => ({
      ...transaction,
      linkedAccRef:
        transaction.linkedAccRef ||
        findFieldValue(account, ["linkedAccRef", "maskedAccNumber"]) ||
        findFieldValue(wrapper, ["linkedAccRef", "maskedAccNumber"]),
    }));
  });
  const transactions = (listedTransactions.length ? listedTransactions : consentTransactions).map((transaction) => {
    const amount = numericValue(
      findFieldValue(transaction, ["amount", "transactionAmount", "txnAmount", "creditAmount", "debitAmount"])
    );
    const direction = String(
      findFieldValue(transaction, ["creditDebitIndicator", "transactionType", "txnType", "type"]) || ""
    ).toUpperCase();

    return {
      title:
        findFieldValue(transaction, ["title", "description", "narration", "transactionType", "txnType", "merchantName"]) ||
        "Account transaction",
      date:
        findFieldValue(transaction, ["date", "transactionDate", "transactionTimestamp", "valueDate", "txnDate"]) ||
        "",
      amount:
        amount === null
          ? null
          : /DEBIT|WITHDRAW|\bDR\b/.test(direction)
            ? -Math.abs(amount)
            : amount,
    };
  });

  const dmat = findArrayByNames(
    sources,
    ["dmat", "demat", "holdings", "securities", "investments"]
  ).map((holding) => ({
    securityName:
      findFieldValue(holding, ["securityName", "instrumentName", "companyName", "name", "symbol"]) ||
      "Security",
    currentValue: numericValue(
      findFieldValue(holding, ["currentValue", "marketValue", "value", "totalValue"])
    ),
    quantity: findFieldValue(holding, ["quantity", "units", "qty"]) ?? "",
  }));

  const insurance = findArrayByNames(
    sources,
    ["insurance", "policies", "insurancePolicies", "policyDetails"]
  ).map((policy) => ({
    policyName:
      findFieldValue(policy, ["policyName", "productName", "name", "policyType"]) ||
      "Insurance policy",
    coverage: numericValue(
      findFieldValue(policy, ["coverage", "sumInsured", "sumAssured", "coverAmount"])
    ),
    premium: numericValue(
      findFieldValue(policy, ["premium", "premiumAmount", "installmentPremium"])
    ),
    status: findFieldValue(policy, ["status", "policyStatus"]) || "",
  }));

  return { accounts, transactions, dmat, insurance };
};

const logDataResponseShape = (operation, response) => {
  const payload = response?.data;
  const topLevelKeys =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.keys(payload).slice(0, 40)
      : [];
  const nestedArrays = [];
  const nestedKeys = [];
  const visited = new Set();

  const inspect = (value, path = "", depth = 0) => {
    if (!value || typeof value !== "object" || depth > 5 || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      if (nestedArrays.length < 30) {
        nestedArrays.push({ field: path || "root", length: value.length });
      }
      if (value[0] && typeof value[0] === "object") {
        inspect(value[0], `${path}[0]`, depth + 1);
      }
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const fieldPath = path ? `${path}.${key}` : key;
      if (nestedKeys.length < 80) nestedKeys.push(fieldPath);
      if (child && typeof child === "object") inspect(child, fieldPath, depth + 1);
    }
  };

  inspect(payload);
  console.info(`[CAMS ${operation} RESPONSE SHAPE]`, {
    httpStatus: Number.isInteger(response?.status) ? response.status : null,
    topLevelKeys,
    nestedKeys,
    nestedArrays,
  });
};

const firstValue = (value, keys) =>
  keys.reduce((result, key) => result || value?.[key], "");

const normalizeConsentHandle = (value) => {
  if (value == null) return "";

  if (Array.isArray(value)) {
    return normalizeConsentHandle(value.find((item) => item != null && String(item).trim()));
  }

  const text = String(value).trim();
  if (!text) return "";

  const candidates = text
    .split(/[\r\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return candidates[0] || text;
};

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
    if (
      path === "/api/fidata/GetConsentData" ||
      path === "/api/FIData/v2/FetchPeriodicData"
    ) {
      logDataResponseShape(path, error.response);
      console.error(`[CAMS ${path} ERROR]`, {
        httpStatus: error.response?.status || null,
        message: error.message,
      });
    } else {
      logCamsError(path, error);
    }
    throw error;
  }
};

const authenticate = async () => {
  const response = await post(
    "/api/FIU/Authentication",
    {
      fiuID: getFiuId(),
      redirection_key: process.env.CAMS_REDIRECTION_KEY,
      userId: getUserId(),
    }
  );

  const auth = readAuthentication(response);
  logTokenDiagnostics("AUTHENTICATED", auth.token, auth.sessionId, 0);

  return response;
};
const readAuthentication = (response) => {
  const data = readPayload(response);

  return {
    token: data.token,
    sessionId: firstValue(data, ["sessionId", "sessionid"]),
  };
};

const logTokenDiagnostics = (label, token, sessionId, tokenAgeMs = null) => {
  console.info(`[CAMS AUTH ${label}]`, {
    tokenExists: Boolean(token),
    tokenLength: token ? token.length : 0,
    tokenAgeMs,
    sessionIdExists: Boolean(sessionId),
  });
};

const redirectAA = ({ token, sessionId, mobile, clientTxnId, redirectUrl, pan, dob, userId }) => {
  const customerMobile = requireValue("aaCustomerMobile", mobile);
  const callbackUrl = requireValue("redirectUrl", redirectUrl);
  const txnId = clientTxnId || crypto.randomUUID();

  const payload = {
    clienttrnxid: txnId,
    fiuID: getFiuId(),
    userId: userId || getUserId(),
    aaCustomerHandleId: `${customerMobile}@CAMSAA`,
    aaCustomerMobile: customerMobile,
    sessionId: requireValue("sessionId", sessionId),
    useCaseid: process.env.CAMS_USE_CASE_ID,
    fipid: "",
    ...(pan ? { pan: String(pan).toUpperCase() } : {}),
    ...(dob ? { dob: String(dob) } : {}),
  };

  return post("/api/FIU/RedirectAA", payload, token).then((response) => {
    return response;
  });
};

const retryWithFreshToken = async (token, callback) => {
  try {
    return await callback(token);
  } catch (error) {
    if (error.response?.status !== 401) {
      throw error;
    }

    const refreshStartedAt = Date.now();
    const refreshedResponse = await authenticate();
    const refreshedAuth = readAuthentication(refreshedResponse);
    const refreshedToken = refreshedAuth.token;
    const refreshedSessionId = refreshedAuth.sessionId;

    logTokenDiagnostics(
      "REFRESHED_AFTER_401",
      refreshedToken,
      refreshedSessionId,
      Date.now() - refreshStartedAt
    );

    if (!refreshedToken) {
      throw new Error("Authentication refresh failed after 401 response");
    }

    return callback(refreshedToken);
  }
};

const redirectAAWithRetry = async ({ token, sessionId, mobile, clientTxnId, redirectUrl, pan, dob, userId }) => {
  const makeRequest = async (currentToken, currentSessionId) =>
    redirectAA({
      token: currentToken,
      sessionId: currentSessionId,
      mobile,
      clientTxnId,
      redirectUrl,
      pan,
      dob,
      userId,
    });

  try {
      console.info("[CAMS REDIRECTAA ATTEMPT]", {
        attempt: 1,
        tokenPresent: Boolean(token),
        sessionIdPresent: Boolean(sessionId),
        consentFlowRestarted: false,
      });
      const response = await makeRequest(token, sessionId);
      console.info("[CAMS REDIRECTAA RESULT]", {
        attempt: 1,
        status: response.status || null,
        retryRequired: false,
      });
      return response;
  } catch (error) {
    if (error.response?.status !== 401) {
      throw error;
    }

      console.info("[CAMS REDIRECTAA TOKEN REJECTED]", {
        attempt: 1,
        status: error.response.status,
        refreshRequired: true,
        consentFlowRestarted: false,
      });
    const refreshStartedAt = Date.now();
    const refreshedResponse = await authenticate();
    const refreshedAuth = readAuthentication(refreshedResponse);
    const refreshedToken = refreshedAuth.token;
    const refreshedSessionId = refreshedAuth.sessionId || sessionId;

    logTokenDiagnostics(
      "REFRESHED_AFTER_401",
      refreshedToken,
      refreshedSessionId,
      Date.now() - refreshStartedAt
    );

    if (!refreshedToken) {
      throw new Error("Authentication refresh failed after 401 response");
    }

    console.info("[CAMS REDIRECTAA RETRY]", {
      attempt: 2,
      tokenPresent: true,
      sessionIdPresent: Boolean(refreshedSessionId),
      consentFlowRestarted: false,
    });

    try {
      const response = await makeRequest(refreshedToken, refreshedSessionId);
      console.info("[CAMS REDIRECTAA RESULT]", {
        attempt: 2,
        status: response.status || null,
        retryRequired: false,
      });
      return response;
    } catch (retryError) {
      console.info("[CAMS REDIRECTAA RETRY FAILED]", {
        attempt: 2,
        status: retryError.response?.status || null,
        retryExhausted: true,
      });
      throw retryError;
    }
  }
};

const readRedirect = (response) => {
  const data = readPayload(response);
  const consentHandleValue = firstValue(data, [
    "consentHandle",
    "consenthandle",
    "consentHandleId",
    "consenthandleid",
    "consent_handle",
    "consentHandleID",
    "handle",
  ]);

  return {
    sessionId: firstValue(data, ["sessionId", "sessionid"]),
    consentHandle: normalizeConsentHandle(consentHandleValue),
    txnId: firstValue(data, ["txnId", "txnid", "txn_id", "transactionId"]),
    clientTxnId: firstValue(data, ["clienttxnid", "clienttrnxid", "clientTxnId", "client_txn_id"]),
    redirectUrl: firstValue(data, ["redirectUrl", "redirectionurl", "redirect_url"]),
  };
};

const readConsentStatus = (response) => {
  const data = readPayload(response);
  const consentStatus =
    firstValue(data, [
      "consentStatus",
      "consentstatus",
      "status",
      "consentState",
      "consentstate",
      "state",
    ]) ||
    data?.data?.consentStatus ||
    data?.data?.status ||
    data?.consentDetails?.consentStatus ||
    data?.consentDetails?.status ||
    "";
  const consentId =
    firstValue(data, ["consentId", "consentid", "consentID"]) ||
    data?.data?.consentId ||
    data?.data?.id ||
    data?.consentDetails?.consentId ||
    data?.consentDetails?.id ||
    "";

  return {
    consentStatus,
    consentId,
    consentHandle: normalizeConsentHandle(
      data?.consentHandle ??
      data?.data?.consentHandle ??
      data?.consentDetails?.consentHandle ??
      ""
    ),
  };
};

const logConsentStatusResponseShape = (response) => {
  const payload = response?.data;
  const safeKeyPattern = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
  const safeStatusValues = new Set([
    "ACTIVE",
    "PENDING",
    "REJECTED",
    "PAUSED",
    "REVOKED",
    "EXPIRED",
    "FAILED",
    "FAILURE",
    "ERROR",
    "INACTIVE",
    "UNKNOWN",
    "APPROVED",
    "CANCELLED",
    "CANCELED",
    "NOT_FOUND",
    "INVALID",
    "SUCCESS",
    "COMPLETED",
    "INITIATED",
    "PROCESSING",
    "IN_PROGRESS",
    "CONSENTED",
    "AUTHORIZED",
    "DENIED",
    "WAITING",
    "CREATED",
    "ACCEPTED",
  ]);
  const consentDetails = payload?.consentDetails;
  const topLevelKeys =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.keys(payload).filter((key) => safeKeyPattern.test(key)).slice(0, 40)
      : [];
  const keysByLevel = [[], [], []];
  const arrayLengths = [];
  const statusFields = [];
  const consentIdFields = [];
  const consentHandleFields = [];

  const inspectValue = (value, path, level) => {
    if (Array.isArray(value)) {
      if (arrayLengths.length < 20) {
        arrayLengths.push({ field: path, length: value.length });
      }
      const firstElement = value[0];
      if (firstElement && typeof firstElement === "object") {
        inspectValue(firstElement, `${path}[0]`, level);
      }
      return;
    }
    if (!value || typeof value !== "object" || level > 3) return;

    for (const [key, child] of Object.entries(value)) {
      if (!safeKeyPattern.test(key)) continue;

      const fieldPath = path ? `${path}.${key}` : key;
      if (keysByLevel[level - 1].length < 80) {
        keysByLevel[level - 1].push(fieldPath);
      }
      if (/status/i.test(key)) {
        statusFields.push({ fieldPath, value: child });
      }
      if (
        /consent.*id|id.*consent/i.test(fieldPath) ||
        (key.toLowerCase() === "id" && /consentDetails/i.test(fieldPath))
      ) {
        consentIdFields.push(fieldPath);
      }
      if (
        /consent.*handle|handle.*consent/i.test(fieldPath) ||
        (key.toLowerCase() === "handle" && /consentDetails/i.test(fieldPath))
      ) {
        consentHandleFields.push(fieldPath);
      }
      if (
        child &&
        typeof child === "object" &&
        level < 3
      ) {
        inspectValue(child, fieldPath, level + 1);
      }
    }
  };

  inspectValue(consentDetails, "consentDetails", 1);

  const detectedStatus =
    statusFields.find((field) => /(^|\.)consentStatus$/i.test(field.fieldPath)) ||
    statusFields.find((field) => /(^|\.)status$/i.test(field.fieldPath)) ||
    statusFields.find((field) => /state/i.test(field.fieldPath)) ||
    statusFields[0];
  const parsedStatus = readConsentStatus(response).consentStatus;
  const normalizedStatusValue =
    typeof detectedStatus?.value === "string"
      ? detectedStatus.value.trim().toUpperCase()
      : "";
  const safeStatusValue =
    safeStatusValues.has(normalizedStatusValue)
      ? normalizedStatusValue
      : null;

  console.info("[CAMS STATUS RESPONSE SHAPE]", {
    httpStatus: Number.isInteger(response?.status) ? response.status : null,
    topLevelKeys,
    consentDetailsType: Array.isArray(consentDetails)
      ? "array"
      : consentDetails === null
        ? "null"
        : typeof consentDetails,
    consentDetailsLength: Array.isArray(consentDetails)
      ? consentDetails.length
      : null,
    arrayLengths,
    level1Keys: [...new Set(keysByLevel[0])],
    level2Keys: [...new Set(keysByLevel[1])],
    level3Keys: [...new Set(keysByLevel[2])],
    statusField: detectedStatus?.fieldPath || null,
    statusValue: safeStatusValue,
    consentIdFields: [...new Set(consentIdFields)],
    consentHandleFields: [...new Set(consentHandleFields)],
    parserDetectedActive:
      String(parsedStatus || "").trim().toUpperCase() === "ACTIVE",
  });
};

const getConsentStatus = async ({ token, sessionId, consentHandle, txnId }) => {
  const normalizedConsentHandle = normalizeConsentHandle(consentHandle);

  const response = await retryWithFreshToken(token, async (activeToken) => {
    const result = await post(
      "/api/consent/GetConsentStatus",
      {
        fiuID: getFiuId(),
        consentHandle: requireValue("consentHandle", normalizedConsentHandle),
        sessionId: requireValue("sessionId", sessionId),
        txnId: requireValue("txnId", txnId),
        userId: getUserId(),
      },
      activeToken
    );

    logConsentStatusResponseShape(result);
    return result;
  });

  return response;
};

const getConsentData = async ({ token, consentId }) => {
  const response = await retryWithFreshToken(token, async (activeToken) =>
    post(
      "/api/fidata/GetConsentData",
      {
        consentId: requireValue("consentId", consentId),
        fiuID: getFiuId(),
      },
      activeToken
    )
  );
  logDataResponseShape("GET CONSENT DATA", response);
  return response;
};

const fetchPeriodicData = async ({ token, sessionId, consentId }) => {
  const txnId = crypto.randomUUID();

  console.info("[CAMS PERIODIC FETCH]", {
    txnId,
    sessionIdPresent: Boolean(sessionId),
    consentIdPresent: Boolean(consentId),
  });

  const response = await retryWithFreshToken(token, async (activeToken) =>
    post(
      "/api/FIData/v2/FetchPeriodicData",
      {
        sessionId: requireValue("sessionId", sessionId),
        txnId,
        consentId: requireValue("consentId", consentId),
        fiuID: getFiuId(),
      },
      activeToken
    )
  );
  logDataResponseShape("FETCH PERIODIC DATA", response);
  return response;
};

const fetchActiveConsentData = async ({ sessionId, consentId }) => {
  const session = getRedirectSession(sessionId);
  if (!session) {
    const error = new Error("CAMS session expired; start a new consent request");
    error.statusCode = 409;
    throw error;
  }

  const authenticationResponse = await authenticate();
  const authentication = readAuthentication(authenticationResponse);
  if (!authentication.token) {
    throw new Error("CAMS authentication did not return an access token");
  }

  const statusResponse = await getConsentStatus({
    token: authentication.token,
    sessionId: session.sessionId,
    consentHandle: session.consentHandle,
    txnId: session.txnId,
  });
  const status = readConsentStatus(statusResponse);
  const notification = findConsentRecordBySessionId(sessionId);
  const notificationIsActive =
    isConsentStatusActive(notification?.consentStatus) && Boolean(notification?.consentId);
  const active = isConsentStatusActive(status.consentStatus) || notificationIsActive;
  const activeConsentId = status.consentId || (notificationIsActive ? notification.consentId : "");

  if (!active || !activeConsentId) {
    const error = new Error("CAMS consent is not active; data was not requested");
    error.statusCode = 409;
    throw error;
  }
  if (consentId !== activeConsentId) {
    const error = new Error("Consent ID does not match the active CAMS consent");
    error.statusCode = 409;
    throw error;
  }

  const [consentResponse, periodicResponse] = await Promise.all([
    getConsentData({ token: authentication.token, consentId: activeConsentId }),
    fetchPeriodicData({
      token: authentication.token,
      sessionId: session.sessionId,
      consentId: activeConsentId,
    }),
  ]);
  const portfolio = mapDashboardData(
    readPortfolio(consentResponse),
    readPortfolio(periodicResponse)
  );

  saveConsentRecord({
    ...notification,
    sessionId,
    consentId: activeConsentId,
    consentHandle: session.consentHandle,
    txnId: session.txnId,
    token: authentication.token,
    consentStatus: "ACTIVE",
    consentData: portfolio,
    consentDataFetchedAt: new Date().toISOString(),
  });

  return { consentId: activeConsentId, portfolio };
};

module.exports = {
  redactSecrets,
  getBaseUrl,
  getFiuId,
  readPayload,
  readPortfolio,
  mapDashboardData,
  authenticate,
  readAuthentication,
  redirectAA,
  redirectAAWithRetry,
  readRedirect,
  readConsentStatus,
  getConsentStatus,
  getConsentData,
  fetchPeriodicData,
  fetchActiveConsentData,
  rememberRedirectSession,
  getRedirectSession,
  findRedirectSession,
  getRedirectSessionDiagnostics,
  normalizeConsentStatus,
  isConsentStatusActive,
  saveConsentRecord,
  getConsentRecord,
  findConsentRecordBySessionId,
  getAllConsentRecords,
};
