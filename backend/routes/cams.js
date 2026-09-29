const express = require("express");
const crypto = require("crypto");
const cams = require("../services/cams");

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

    /* STEP 2 : RedirectAA */
    const redirectRes = await cams.redirectAA({
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

    /* SAVE SESSION */
    cams.rememberRedirectSession(auth.sessionId, {
      token: auth.token,
      sessionId: auth.sessionId,
      mobile,
      clientTxnId,
      clienttxnid: clientTxnId,
      clienttrnxid: clientTxnId,
      consentHandle: redirect.consentHandle,
      txnId: redirect.txnId,
      redirectUrl,
    });

    const sessionDiagnostics = cams.getRedirectSessionDiagnostics(
      auth.sessionId,
      clientTxnId
    );
    console.info("[CAMS SESSION CREATED]", {
      sessionIdExists: Boolean(auth.sessionId),
      clientTxnIdExists: Boolean(clientTxnId),
      consentHandleExists: Boolean(redirect.consentHandle),
      sessionFound: sessionDiagnostics.sessionFound,
      redirectSessionsMapSize: sessionDiagnostics.mapSize,
      sessionCreationTimestamp: sessionDiagnostics.createdAt,
      sessionExpiryTimestamp: sessionDiagnostics.expiresAt,
    });

    return res.status(200).json({
      success: true,
      token: auth.token,
      sessionId: auth.sessionId,
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
    const inMemorySession = cams.getRedirectSession(sessionId);
    const suppliedSession =
      body.sessionId && body.token && body.consentHandle && body.txnId
        ? {
            sessionId: body.sessionId,
            token: body.token,
            consentHandle: body.consentHandle,
            txnId: body.txnId,
            clientTxnId,
          }
        : null;
    const saved = inMemorySession || mapped || suppliedSession;
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
    callbackDiagnostics.consentActive =
      String(status.consentStatus).toUpperCase() === "ACTIVE";

    if (!callbackDiagnostics.consentActive) {
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
    const { sessionId, consentId, token, txnId } = req.body;

    if (!sessionId || !consentId || !token || !txnId) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const [consentData, periodicData] = await Promise.all([
      cams.getConsentData({ token, consentId }),
      cams.fetchPeriodicData({
        token,
        sessionId,
        txnId,
        consentId,
      }),
    ]);

    return res.status(200).json({
      success: true,
      portfolio: {
        ...cams.readPortfolio(consentData),
        periodicData: cams.readPortfolio(periodicData),
      },
    });
  } catch (err) {
    console.error("FETCH ERROR");
    console.error(
      err.response?.data
        ? cams.redactSecrets(err.response.data)
        : err.message
    );

    return res.status(502).json({
      success: false,
      message: err.message,
    });
  }
});

/* =====================================================
   CONSENT STATUS
===================================================== */
router.post("/status", async (req, res) => {
  const statusDiagnostics = {
    sessionFound: false,
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
      logStatusDiagnostics();
      return res.status(400).json({
        success: false,
        message: "Session not found",
      });
    }

    const response = await cams.getConsentStatus({
      token: req.body.token || saved.token,
      sessionId: saved.sessionId,
      consentHandle: req.body.consentHandle || saved.consentHandle,
      txnId: req.body.txnId || saved.txnId,
    });

    const consent = cams.readConsentStatus(response);
    statusDiagnostics.consentActive =
      String(consent.consentStatus).toUpperCase() === "ACTIVE";
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
    logStatusDiagnostics();
    console.error("STATUS ERROR");
    console.error(
      err.response?.data
        ? cams.redactSecrets(err.response.data)
        : err.message
    );

    return res.status(502).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;