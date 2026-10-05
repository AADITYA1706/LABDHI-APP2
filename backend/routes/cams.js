const express = require("express");
const crypto = require("crypto");
const cams = require("../services/cams");
const { recordCamsDiagnostic } = require("../services/camsDiagnostics");

const router = express.Router();

const normalizeRedirectUrl = (value) => {
  try {
    const url = new URL(value);

    if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
      url.hostname = "loopback";
    }

    return url.toString();
  } catch {
    return String(value || "").trim();
  }
};

/* =====================================================
   TEST
===================================================== */
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "CAMS API working",
  });
});

/* =====================================================
   REDIRECT AA
===================================================== */
router.post("/redirect", async (req, res) => {
  try {
    const mobile = String(req.body.aaCustomerMobile || req.body.mobile || "").trim();
    const pan = String(req.body.pan || "").trim();
    const dob = String(req.body.dob || "").trim();
    const userId = req.body.userId;

    const registeredRedirectUrl = String(
      process.env.CAMS_REDIRECT_URL || ""
    ).trim();
    const requestedRedirectUrl = String(
      req.body.redirecturl || req.body.redirectUrl || ""
    ).trim();
    recordCamsDiagnostic("REDIRECTAA_REQUEST_RECEIVED", {
      mobilePresent: Boolean(mobile),
      redirectUrlPresent: Boolean(requestedRedirectUrl),
    });
    const normalizedRegisteredRedirectUrl = normalizeRedirectUrl(
      registeredRedirectUrl
    );
    const normalizedRequestedRedirectUrl = normalizeRedirectUrl(
      requestedRedirectUrl
    );
    const redirectUrlsMatch =
      normalizedRequestedRedirectUrl === normalizedRegisteredRedirectUrl;

    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({
        success: false,
        message: "Valid 10 digit mobile number required",
        receivedRedirectUrl: requestedRedirectUrl,
        expectedRedirectUrl: registeredRedirectUrl,
        redirectUrlsMatch,
      });
    }

    if (!registeredRedirectUrl) {
      return res.status(500).json({
        success: false,
        message: "CAMS_REDIRECT_URL missing in .env",
        receivedRedirectUrl: requestedRedirectUrl,
        expectedRedirectUrl: registeredRedirectUrl,
        redirectUrlsMatch,
      });
    }

    const redirectUrl = registeredRedirectUrl || requestedRedirectUrl;

    /* STEP 1 : Authentication */
    const authRes = await cams.authenticate();
    const auth = cams.readAuthentication(authRes);

    if (!auth.token || !auth.sessionId) {
      throw new Error("Authentication failed");
    }

    const clientTxnId = crypto.randomUUID();

    /* STEP 2 : RedirectAA (refresh auth token on 401 and retry once) */
    const redirectRes = await cams.redirectAAWithRetry({
      token: auth.token,
      sessionId: auth.sessionId,
      mobile,
      clientTxnId,
      redirectUrl,
      pan,
      dob,
      userId,
    });

    const redirect = cams.readRedirect(redirectRes);
    const sessionId = redirect.sessionId;
    recordCamsDiagnostic("REDIRECTAA_RESPONSE_PARSED", {
      httpStatus: redirectRes.status,
      sessionId,
      txnId: redirect.txnId,
      redirectResponseSessionIdPresent: Boolean(sessionId),
      consentHandlePresent: Boolean(redirect.consentHandle),
      redirectTxnIdPresent: Boolean(redirect.txnId),
    });

    if (!sessionId) {
      throw new Error("RedirectAA response did not include required sessionId");
    }

    /* SAVE SESSION */
    await cams.rememberRedirectSession(sessionId, {
      token: auth.token,
      sessionId,
      mobile,
      clientTxnId,
      clienttxnid: clientTxnId,
      clienttrnxid: clientTxnId,
      consentHandle: redirect.consentHandle,
      txnId: redirect.txnId,
      redirectUrl,
    });

    const sessionDiagnostics = cams.getRedirectSessionDiagnostics(
      sessionId,
      clientTxnId
    );
    console.info("[CAMS SESSION CREATED]", {
      sessionIdExists: Boolean(sessionId),
      clientTxnIdExists: Boolean(clientTxnId),
      consentHandleExists: Boolean(redirect.consentHandle),
      sessionFound: sessionDiagnostics.sessionFound,
      redirectSessionsMapSize: sessionDiagnostics.mapSize,
      sessionCreationTimestamp: sessionDiagnostics.createdAt,
      sessionExpiryTimestamp: sessionDiagnostics.expiresAt,
    });

    return res.status(200).json({
      success: true,
      sessionId,
      consentHandle: redirect.consentHandle,
      txnId: redirect.txnId,
      clienttxnid: clientTxnId,
      redirectionurl: redirect.redirectUrl,
      redirecturl: redirectUrl,
      receivedRedirectUrl: requestedRedirectUrl,
      expectedRedirectUrl: registeredRedirectUrl,
      redirectUrlsMatch,
      aaCustomerMobile: mobile,
      aaCustomerHandleId: `${mobile}@CAMSAA`,
    });
  } catch (err) {
    console.error("\n========== CAMS REDIRECT ERROR ==========");
    console.error(
      err.response?.data
        ? cams.redactSecrets(err.response.data)
        : err.message
    );

    return res.status(err.response?.status || 502).json({
      success: false,
      message:
        err.response?.data?.message ||
        err.message ||
        "Unable to initiate CAMS redirect",
    });
  }
});

/* =====================================================
   CALLBACK
===================================================== */
router.post("/callback", async (req, res) => {
  const callbackDiagnostics = {
    sessionFound: false,
    sessionIdPresent: false,
    callbackParameters: {
      ecresPresent: false,
      resdatePresent: false,
      clientTxnIdPresent: false,
      consentHandlePresent: false,
      txnIdPresent: false,
    },
    upstreamStatusResponseStatus: null,
    statusResponseStatus: null,
    consentStatus: null,
    consentIdPresent: false,
    consentActive: false,
    getConsentDataSucceeded: false,
    fetchPeriodicDataSucceeded: false,
    portfolioFetched: false,
  };
  const logCallbackDiagnostics = () =>
    console.info("[CAMS CALLBACK OUTCOME]", callbackDiagnostics);

  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const query = req.query && typeof req.query === "object" ? req.query : {};
    const rawParams =
      req.rawBody && Object.keys(body).length === 0
        ? new URLSearchParams(req.rawBody)
        : null;
    const ecres = String(
      body.ecres ||
        query.ecres ||
        rawParams?.get("ecres") ||
        ""
    ).trim();
    const resdate = String(
      body.resdate ||
        query.resdate ||
        rawParams?.get("resdate") ||
        ""
    ).trim();
    const clientTxnId = String(
      body.clienttxnid ||
        body.clienttrnxid ||
        body.clientTxnId ||
        query.clienttxnid ||
        query.clienttrnxid ||
        query.clientTxnId ||
        rawParams?.get("clienttxnid") ||
        rawParams?.get("clienttrnxid") ||
        rawParams?.get("clientTxnId") ||
        ""
    ).trim();
    const statusCompletion =
      body.completionMode === "status" && !ecres && !resdate;

    if ((!ecres || !resdate) && !statusCompletion) {
      return res.status(400).json({
        success: false,
        message: "ecres & resdate required",
      });
    }

    const mapped = cams.findRedirectSession(clientTxnId);

    const sessionId = mapped?.sessionId || body.sessionId;
    callbackDiagnostics.sessionIdPresent = Boolean(sessionId);
    callbackDiagnostics.callbackParameters = {
      ecresPresent: Boolean(ecres),
      resdatePresent: Boolean(resdate),
      clientTxnIdPresent: Boolean(clientTxnId),
      consentHandlePresent: Boolean(body.consentHandle || mapped?.consentHandle),
      txnIdPresent: Boolean(body.txnId || mapped?.txnId),
    };
    const inMemorySession = cams.getRedirectSession(sessionId);
    const saved = inMemorySession || mapped;
    callbackDiagnostics.sessionFound = Boolean(saved);

    if (!saved) {
      logCallbackDiagnostics();
      return res.status(409).json({
        success: false,
        message: "CAMS session expired",
      });
    }

    /* CONSENT STATUS */
    const statusRes = await cams.getConsentStatus({
      token: saved.token,
      sessionId: saved.sessionId,
      consentHandle: saved.consentHandle,
      txnId: saved.txnId,
    });

    const status = cams.readConsentStatus(statusRes);
    callbackDiagnostics.upstreamStatusResponseStatus = statusRes.status || null;
    callbackDiagnostics.consentStatus = status.consentStatus || null;
    callbackDiagnostics.consentIdPresent = Boolean(status.consentId);
    callbackDiagnostics.consentActive = cams.isConsentStatusActive(status.consentStatus);

    if (!callbackDiagnostics.consentActive) {
      callbackDiagnostics.statusResponseStatus = 200;
      logCallbackDiagnostics();
      return res.status(200).json({
        success: false,
        consentStatus: status.consentStatus,
        consentId: status.consentId,
        message: "Consent not active",
      });
    }

    /* FETCH DATA */
    const consentRes = await cams.getConsentData({
      token: saved.token,
      consentId: status.consentId,
    });
    callbackDiagnostics.getConsentDataSucceeded = true;

    const periodicRes = await cams.fetchPeriodicData({
      token: saved.token,
      sessionId: saved.sessionId,
      txnId: saved.txnId,
      consentId: status.consentId,
    });
    callbackDiagnostics.fetchPeriodicDataSucceeded = true;

    const portfolio = {
      ...cams.readPortfolio(consentRes),
      periodicData: cams.readPortfolio(periodicRes),
    };

    cams.saveConsentRecord({
      sessionId: saved.sessionId,
      token: saved.token,
      consentHandle: saved.consentHandle,
      txnId: saved.txnId,
      consentId: status.consentId,
      consentStatus: "ACTIVE",
      consentData: portfolio,
    });
    callbackDiagnostics.portfolioFetched = true;
    callbackDiagnostics.statusResponseStatus = 200;
    logCallbackDiagnostics();

    return res.status(200).json({
      success: true,
      consentStatus: "ACTIVE",
      portfolioFetched: true,
      consentId: status.consentId,
      consentHandle: saved.consentHandle,
      sessionId: saved.sessionId,
      txnId: saved.txnId,
      portfolio,
    });
  } catch (err) {
    callbackDiagnostics.statusResponseStatus = err.response?.status || 502;
    logCallbackDiagnostics();
    console.error("\n========== CAMS CALLBACK ERROR ==========");
    console.error(
      err.response?.data
        ? cams.redactSecrets(err.response.data)
        : err.message
    );

    return res.status(err.response?.status || 502).json({
      success: false,
      message:
        err.response?.data?.message ||
        err.message ||
        "Unable to complete CAMS callback",
    });
  }
});

/* =====================================================
   FETCH FI DATA
===================================================== */
router.post("/fetch", async (req, res) => {
  try {
    const { sessionId, consentId } = req.body;

    if (!sessionId || !consentId) {
      return res.status(400).json({
        success: false,
        message: "sessionId and consentId are required",
      });
    }

    const result = await cams.fetchActiveConsentData({ sessionId, consentId });

    return res.status(200).json({
      success: true,
      consentId: result.consentId,
      portfolio: result.portfolio,
    });
  } catch (err) {
    console.error("FETCH ERROR", err.message);

    return res.status(err.statusCode || err.response?.status || 502).json({
      success: false,
      message: err.response?.data?.message || err.message,
    });
  }
});

/* =====================================================
   CONSENT STATUS
===================================================== */
router.post("/status", async (req, res) => {
  const statusDiagnostics = {
    sessionFound: false,
    sessionIdPresent: Boolean(req.body.sessionId),
    statusSource: null,
    statusResponseStatus: null,
    upstreamStatusResponseStatus: null,
    consentStatus: null,
    consentIdPresent: false,
    consentActive: false,
    getConsentDataSucceeded: false,
    fetchPeriodicDataSucceeded: false,
    portfolioFetched: false,
  };
  const logStatusDiagnostics = () =>
    console.info("[CAMS STATUS OUTCOME]", statusDiagnostics);

  try {
    const saved = cams.getRedirectSession(req.body.sessionId);
    statusDiagnostics.sessionFound = Boolean(saved);

    if (!saved) {
      statusDiagnostics.statusResponseStatus = 400;
      logStatusDiagnostics();
      return res.status(400).json({
        success: false,
        message: "Session not found",
      });
    }

    const notification = cams.findConsentRecordBySessionId(saved.sessionId);
    const notificationStatus = cams.normalizeConsentStatus(
      notification?.consentStatus
    );

    if (cams.isConsentStatusActive(notification?.consentStatus) && notification?.consentId) {
      statusDiagnostics.statusSource = "ConsentStatusNotification";
      statusDiagnostics.statusResponseStatus = 200;
      statusDiagnostics.consentStatus = notificationStatus;
      statusDiagnostics.consentIdPresent = true;
      statusDiagnostics.consentActive = true;
      logStatusDiagnostics();

      return res.status(200).json({
        success: true,
        consentStatus: notificationStatus,
        consentId: notification.consentId,
        consentHandle: notification.consentHandle || saved.consentHandle,
        sessionId: saved.sessionId,
        txnId: notification.txnId || saved.txnId,
      });
    }

    const response = await cams.getConsentStatus({
      token: saved.token,
      sessionId: saved.sessionId,
      consentHandle: req.body.consentHandle || saved.consentHandle,
      txnId: req.body.txnId || saved.txnId,
    });

    const consent = cams.readConsentStatus(response);
    statusDiagnostics.statusSource = "GetConsentStatus";
    statusDiagnostics.statusResponseStatus = 200;
    statusDiagnostics.upstreamStatusResponseStatus = response.status || null;
    statusDiagnostics.consentStatus = consent.consentStatus || null;
    statusDiagnostics.consentIdPresent = Boolean(consent.consentId);
    statusDiagnostics.consentActive = cams.isConsentStatusActive(consent.consentStatus);
    logStatusDiagnostics();

    return res.status(200).json({
      success: true,
      consentStatus: consent.consentStatus,
      consentId: consent.consentId,
      sessionId: saved.sessionId,
      txnId: saved.txnId,
      data: cams.readPayload(response),
    });
  } catch (err) {
    statusDiagnostics.statusResponseStatus = err.response?.status || 502;
    statusDiagnostics.upstreamStatusResponseStatus = err.response?.status || null;
    logStatusDiagnostics();
    const upstreamStatus = Number.isInteger(err.response?.status)
      ? err.response.status
      : null;
    const errorCode = [
      "ECONNABORTED",
      "ETIMEDOUT",
      "ECONNREFUSED",
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
    ].includes(err.code)
      ? err.code
      : null;
    const failureSource = upstreamStatus !== null
      ? "cams_response"
      : ["ECONNABORTED", "ETIMEDOUT"].includes(err.code)
        ? "timeout"
        : err.isAxiosError
          ? "axios_network"
          : "local_processing";
    const errorType = [
      "Error",
      "TypeError",
      "ReferenceError",
      "RangeError",
      "SyntaxError",
      "AxiosError",
      "CanceledError",
    ].includes(err.name)
      ? err.name
      : "OtherError";
    const responseBody = err.response?.data;
    const responseObjects = [
      responseBody,
      responseBody?.data,
    ].filter((value) => value && typeof value === "object" && !Array.isArray(value));
    const responseFieldNames = [
      ...new Set(
        responseObjects
          .flatMap((value) => Object.keys(value))
          .filter((name) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name))
      ),
    ].slice(0, 30);
    const responseStatusValue =
      responseBody?.consentStatus ||
      responseBody?.status ||
      responseBody?.data?.consentStatus ||
      responseBody?.data?.status;
    const safeCamsStatuses = new Set([
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
    ]);
    const normalizedResponseStatus = typeof responseStatusValue === "string"
      ? responseStatusValue.trim().toUpperCase()
      : "";
    const camsResponseStatus = safeCamsStatuses.has(normalizedResponseStatus)
      ? normalizedResponseStatus
      : null;
    const missingValue = /^Missing CAMS value: (sessionId|consentHandle|txnId)$/.exec(
      String(err.message || "")
    );
    const safeMessage = upstreamStatus !== null
      ? `CAMS returned HTTP ${upstreamStatus}`
      : failureSource === "timeout"
        ? "CAMS status request timed out"
        : failureSource === "axios_network"
          ? `CAMS status request failed before a response${errorCode ? ` (${errorCode})` : ""}`
          : missingValue
            ? `Missing required CAMS value: ${missingValue[1]}`
            : "Local CAMS status processing failed";
    const responseHttpStatus = upstreamStatus ?? (
      failureSource === "local_processing"
        ? 500
        : failureSource === "timeout"
          ? 504
          : 502
    );

    console.error("[CAMS STATUS DIAGNOSTIC]", {
      errorType,
      upstreamStatus,
      camsResponseStatus,
      responseFieldNames,
      safeMessage,
      failureSource,
      errorCode,
    });

    return res.status(responseHttpStatus).json({
      success: false,
      error: "CAMS_STATUS_CHECK_FAILED",
      upstreamStatus,
      camsResponseStatus,
      failureSource,
      message: safeMessage,
    });
  }
});

module.exports = router;