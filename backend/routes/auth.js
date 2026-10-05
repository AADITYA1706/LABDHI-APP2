const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db");
const cams = require("../services/cams");
const { recordCamsDiagnostic } = require("../services/camsDiagnostics");

const router = express.Router();
const dashboardDataInFlight = new Map();
const dashboardVerificationInFlight = new Map();
const dashboardFetchBlocks = new Map();
const dashboardPartialDataCache = new Map();
const dashboardCacheMaxAgeMs = 24 * 60 * 60 * 1000;

const nextUtcMonthStart = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
};

const dashboardArrays = (portfolio) => ({
  accounts: Array.isArray(portfolio?.accounts) ? portfolio.accounts : [],
  transactions: Array.isArray(portfolio?.transactions) ? portfolio.transactions : [],
  dmat: Array.isArray(portfolio?.dmat) ? portfolio.dmat : [],
  insurance: Array.isArray(portfolio?.insurance) ? portfolio.insurance : [],
});

const getCamsSession = (body) => {
  const sessionId = body?.sessionId;
  const savedSession = cams.getRedirectSession(sessionId);

  return {
    sessionId,
    consentHandle: savedSession?.consentHandle || body?.consentHandle,
    token: savedSession?.token,
    txnId: savedSession?.txnId || body?.txnId,
    mobile: savedSession?.mobile,
  };
};

const consentStatusResponse = (response, session) => {
  const consent = cams.readConsentStatus(response);

  return {
    success: true,
    consentStatus: consent.consentStatus,
    consentId: consent.consentId,
    consentHandle: session.consentHandle,
    sessionId: session.sessionId,
    txnId: session.txnId,
    data: cams.readPayload(response),
  };
};

router.post("/verify-consent", async (req, res) => {
  try {
    const session = getCamsSession(req.body);

    if (!session.sessionId || !session.consentHandle || !session.token || !session.txnId) {
      return res.status(400).json({
        success: false,
        message: "CAMS consent session is missing or expired",
      });
    }

    const response = await cams.getConsentStatus(session);
    return res.status(200).json(consentStatusResponse(response, session));
  } catch (err) {
    console.error("VERIFY CONSENT ERROR", err.response?.data || err.message);

    return res.status(err.response?.status || 502).json({
      success: false,
      message: err.response?.data?.message || err.message || "Unable to verify consent",
    });
  }
});

router.post("/resend-otp", async (req, res) => {
  try {
    const session = getCamsSession(req.body);

    if (!session.sessionId || !session.token || !session.mobile) {
      return res.status(400).json({
        success: false,
        message: "CAMS redirect session is missing or expired",
      });
    }

    const response = await cams.redirectAA(session);
    const redirect = cams.readRedirect(response);
    const updatedSession = {
      ...session,
      consentHandle: redirect.consentHandle,
      txnId: redirect.txnId,
    };

    await cams.rememberRedirectSession(session.sessionId, updatedSession);

    return res.status(200).json({
      success: true,
      message: "CAMS OTP request sent",
      consentHandle: updatedSession.consentHandle,
      txnId: updatedSession.txnId,
    });
  } catch (err) {
    console.error("RESEND OTP ERROR", err.response?.data || err.message);

    return res.status(err.response?.status || 502).json({
      success: false,
      message: err.response?.data?.message || err.message || "Unable to resend OTP",
    });
  }
});

router.post("/dashboard-data", async (req, res) => {
  let requestKey = "";
  let activeConsentId = "";

  try {
    const sessionId = req.body?.sessionId;
    const savedSession = cams.getRedirectSession(sessionId);
    let storedConsent =
      cams.findConsentRecordBySessionId(sessionId) ||
      cams.getConsentRecord({ consentId: req.body?.consentId });
    const consentHandle =
      savedSession?.consentHandle ||
      storedConsent?.consentHandle ||
      req.body?.consentHandle;
    const txnId = savedSession?.txnId || storedConsent?.txnId || req.body?.txnId;

    if (!sessionId || !consentHandle || !txnId) {
      return res.status(409).json({
        success: false,
        status: storedConsent?.consentStatus || "PENDING",
        message: "An approved CAMS session is required before loading dashboard data",
      });
    }

    const fetchContext = {
      sessionId,
      requestedConsentId: req.body?.consentId || null,
      txnId,
      sessionFound: Boolean(savedSession),
      sessionIdMatches: savedSession?.sessionId === sessionId,
      consentHandleFromServerSession: Boolean(savedSession?.consentHandle),
      txnIdFromServerSession: Boolean(savedSession?.txnId),
      consentRecordFound: Boolean(storedConsent),
      consentRecordSessionId: storedConsent?.sessionId || null,
      consentRecordConsentId: storedConsent?.consentId || null,
      consentRecordStatus: storedConsent?.consentStatus || null,
      consentRecordHasData: Boolean(storedConsent?.consentData),
    };
    recordCamsDiagnostic("DASHBOARD_FETCH_CONTEXT", fetchContext);

    const verificationKey = req.body?.consentId || `${sessionId}:${consentHandle}`;
    let verificationPromise = dashboardVerificationInFlight.get(verificationKey);
    if (!verificationPromise) {
      verificationPromise = (async () => {
        const authenticationResponse = await cams.authenticate();
        const authentication = cams.readAuthentication(authenticationResponse);
        if (!authentication.token) {
          throw new Error("CAMS authentication did not return an access token");
        }

        const statusResponse = await cams.getConsentStatus({
          token: authentication.token,
          sessionId,
          consentHandle,
          txnId,
        });

        return {
          authentication,
          status: cams.readConsentStatus(statusResponse),
          statusHttpStatus: statusResponse.status,
        };
      })();
      dashboardVerificationInFlight.set(verificationKey, verificationPromise);
    }

    let verification;
    try {
      verification = await verificationPromise;
    } finally {
      if (dashboardVerificationInFlight.get(verificationKey) === verificationPromise) {
        dashboardVerificationInFlight.delete(verificationKey);
      }
    }

    const { authentication, status, statusHttpStatus } = verification;
    const notificationIsActive =
      cams.isConsentStatusActive(storedConsent?.consentStatus) &&
      Boolean(storedConsent?.consentId);
    const consentIsActive =
      cams.isConsentStatusActive(status.consentStatus) || notificationIsActive;
    const consentId = status.consentId || (notificationIsActive ? storedConsent.consentId : "");
    activeConsentId = consentId;

    const verificationDetails = {
      sessionId,
      txnId,
      httpStatus: statusHttpStatus,
      consentId,
      consentStatus: status.consentStatus || null,
      responseConsentId: status.consentId || null,
      notificationConsentId: notificationIsActive ? storedConsent.consentId : null,
      activeConsentId: consentId || null,
      consentIsActive,
    };
    recordCamsDiagnostic("CONSENT_VERIFIED", {
      ...verificationDetails,
      consentActive: consentIsActive,
    });

    if (!consentIsActive || !consentId) {
      return res.status(409).json({
        success: false,
        status: status.consentStatus || storedConsent?.consentStatus || "UNKNOWN",
        message: consentIsActive
          ? "CAMS confirmed consent, but did not return a consent ID"
          : "CAMS consent is not active; dashboard data was not requested",
      });
    }

    storedConsent =
      storedConsent || cams.getConsentRecord({ consentId }) || {};
    requestKey = consentId;

    const cacheAge = Date.now() - Date.parse(storedConsent.dashboardDataFetchedAt || "");
    if (
      storedConsent.consentId === consentId &&
      storedConsent.consentStatus === "ACTIVE" &&
      storedConsent.consentData &&
      Number.isFinite(cacheAge) &&
      cacheAge >= 0 &&
      cacheAge < dashboardCacheMaxAgeMs
    ) {
      const cachedData = dashboardArrays(storedConsent.consentData);
      recordCamsDiagnostic("DASHBOARD_CACHE_HIT", {
        sessionId,
        consentId,
        accountCount: cachedData.accounts.length,
        transactionCount: cachedData.transactions.length,
        storedSessionMatches: storedConsent.sessionId === sessionId,
      });
      return res.status(200).json({
        success: true,
        status: "ACTIVE",
        consentId,
        data: {
          ...dashboardArrays(storedConsent.consentData),
          portfolio: storedConsent.consentData,
        },
      });
    }

    const fetchBlock = dashboardFetchBlocks.get(requestKey);
    if (fetchBlock && Date.now() < Date.parse(fetchBlock.retryAfter)) {
      let partialData =
        dashboardPartialDataCache.get(consentId) || storedConsent.dashboardPartialData;
      if (!partialData && storedConsent.consentData) {
        partialData = cams.mapDashboardData(storedConsent.consentData, {});
        dashboardPartialDataCache.set(consentId, partialData);
        storedConsent = cams.saveConsentRecord({
          ...storedConsent,
          sessionId,
          consentId,
          consentStatus: "ACTIVE",
          dashboardPartialData: partialData,
        });
      }

      if (partialData) {
        recordCamsDiagnostic("DASHBOARD_PARTIAL_CACHE_RESPONSE", {
          sessionId,
          consentId,
          accountCount: partialData.accounts?.length || 0,
          transactionCount: partialData.transactions?.length || 0,
        });
        return res.status(200).json({
          success: true,
          status: "ACTIVE",
          consentId,
          partial: true,
          warning: fetchBlock.message,
          retryAfter: fetchBlock.retryAfter,
          data: {
            ...dashboardArrays(partialData),
            portfolio: partialData,
          },
        });
      }

      return res.status(429).json({
        success: false,
        status: "ACTIVE",
        message: fetchBlock.message,
        retryAfter: fetchBlock.retryAfter,
      });
    }
    if (fetchBlock) dashboardFetchBlocks.delete(requestKey);

    let fetchPromise = dashboardDataInFlight.get(requestKey);
    if (!fetchPromise) {
      fetchPromise = (async () => {
        const consentResponse = await cams.getConsentData({
          token: authentication.token,
          consentId,
          sessionId,
          txnId,
        });
        const consentData = cams.readPortfolio(consentResponse);
        let periodicResponse;
        try {
          periodicResponse = await cams.fetchPeriodicData({
            token: authentication.token,
            sessionId,
            txnId,
            consentId,
          });
        } catch (error) {
          const message = error.response?.data?.message || error.message || "";
          if (/data fetch count.*max limit|reached to max limit/i.test(message)) {
            const partialData = cams.mapDashboardData(consentData, {});
            dashboardPartialDataCache.set(consentId, partialData);
            cams.saveConsentRecord({
              ...storedConsent,
              sessionId,
              consentId,
              txnId,
              token: authentication.token,
              consentStatus: "ACTIVE",
              consentData: partialData,
              dashboardPartialData: partialData,
              consentDataFetchedAt: new Date().toISOString(),
            });
            error.dashboardPartialData = partialData;
          }
          throw error;
        }
        const periodicData = cams.readPortfolio(periodicResponse);
        const mappedData = cams.mapDashboardData(consentData, periodicData);
        const portfolio = mappedData;
        dashboardPartialDataCache.delete(consentId);
        const fetchedAt = new Date().toISOString();

        const savedRecord = cams.saveConsentRecord({
          ...storedConsent,
          sessionId,
          consentId,
          txnId,
          token: authentication.token,
          consentStatus: "ACTIVE",
          consentData: portfolio,
          consentDataFetchedAt: fetchedAt,
          dashboardDataFetchedAt: fetchedAt,
        });

        recordCamsDiagnostic("DASHBOARD_DATA_STORED", {
          httpStatus: 200,
          sessionId,
          consentId,
          txnId,
          accountCount: mappedData.accounts.length,
          transactionCount: mappedData.transactions.length,
          dmatCount: mappedData.dmat.length,
          insuranceCount: mappedData.insurance.length,
          storedSessionMatches: savedRecord.sessionId === sessionId,
          consentStatus: savedRecord.consentStatus,
        });

        return { mappedData, portfolio };
      })().catch((error) => {
        const message =
          error.response?.data?.message || error.message || "Unable to load dashboard data";
        if (/data fetch count.*max limit|reached to max limit/i.test(message)) {
          dashboardFetchBlocks.set(requestKey, {
            message,
            retryAfter: nextUtcMonthStart(),
          });
        }
        throw error;
      });
      dashboardDataInFlight.set(requestKey, fetchPromise);
    }

    try {
      const { mappedData, portfolio } = await fetchPromise;
      recordCamsDiagnostic("DASHBOARD_RESPONSE", {
        httpStatus: 200,
        sessionId,
        consentId,
        txnId,
        accountCount: mappedData.accounts.length,
        transactionCount: mappedData.transactions.length,
        dmatCount: mappedData.dmat.length,
        insuranceCount: mappedData.insurance.length,
        consentStatus: "ACTIVE",
      });
      return res.status(200).json({
        success: true,
        status: "ACTIVE",
        consentId,
        partial: false,
        data: {
          ...mappedData,
          portfolio,
        },
      });
    } finally {
      if (dashboardDataInFlight.get(requestKey) === fetchPromise) {
        dashboardDataInFlight.delete(requestKey);
      }
    }
  } catch (err) {
    const message = err.response?.data?.message || err.message || "Unable to load dashboard data";
    const fetchBlock = requestKey ? dashboardFetchBlocks.get(requestKey) : null;
    console.error("DASHBOARD DATA ERROR", {
      httpStatus: err.response?.status || null,
      message,
    });

    if (err.dashboardPartialData) {
      recordCamsDiagnostic("DASHBOARD_PARTIAL_RESPONSE", {
        consentId: activeConsentId,
        accountCount: err.dashboardPartialData.accounts?.length || 0,
        transactionCount: err.dashboardPartialData.transactions?.length || 0,
      });
      return res.status(200).json({
        success: true,
        status: "ACTIVE",
        consentId: activeConsentId,
        partial: true,
        warning: message,
        retryAfter: fetchBlock?.retryAfter || nextUtcMonthStart(),
        data: {
          ...dashboardArrays(err.dashboardPartialData),
          portfolio: err.dashboardPartialData,
        },
      });
    }

    return res.status(err.response?.status || 502).json({
      success: false,
      message,
      ...(fetchBlock ? { retryAfter: fetchBlock.retryAfter } : {}),
    });
  }
});

/* ===========================
   EMPLOYEE LOGIN
=========================== */

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const enteredUser = String(username || "").trim();
    const enteredPassword = String(password || "");

    if (!enteredUser || !enteredPassword) {
      return res.status(400).json({
        success: false,
        message: "Username & Password are required",
      });
    }

    const demoUser = enteredUser.toLowerCase() === "kunalr@labdhi.in" && enteredPassword === "Admin@12";

    if (demoUser) {
      const token = jwt.sign(
        {
          id: 1,
          employee_id: "EMP001",
          username: enteredUser,
          department: "Banking",
        },
        process.env.JWT_SECRET || "Labdhi@2026SecureKey",
        { expiresIn: "8h" }
      );

      return res.json({
        success: true,
        token,
        data: {
          userId: enteredUser,
          fullname: "Kunal Labdhi",
          employeeId: "EMP001",
          department: "Banking",
          role: "customer",
        },
      });
    }

    if (db && typeof db.query === "function") {
      const [rows] = await db.query(
        `SELECT * FROM employees WHERE username = ?`,
        [enteredUser]
      );

      if (rows.length === 0) {
        return res.status(401).json({
          success: false,
          message: "Invalid Username or Password",
        });
      }

      const employee = rows[0];
      const isMatch = await bcrypt.compare(enteredPassword, employee.password_hash);

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid Username or Password",
        });
      }

      const token = jwt.sign(
        {
          id: employee.id,
          employee_id: employee.employee_id,
          username: employee.username,
          department: employee.department,
        },
        process.env.JWT_SECRET || "Labdhi@2026SecureKey",
        { expiresIn: "8h" }
      );

      return res.json({
        success: true,
        token,
        data: {
          userId: employee.username,
          fullname: employee.full_name,
          employeeId: employee.employee_id,
          department: employee.department,
          role: employee.role,
        },
      });
    }

    return res.status(401).json({
      success: false,
      message: "Invalid Username or Password",
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
});

module.exports = router;