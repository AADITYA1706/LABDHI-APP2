const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const db = require("../db");
const cams = require("../services/cams");

const router = express.Router();

const getCamsSession = (body) => {
  const sessionId = body?.sessionId;
  const savedSession = cams.getRedirectSession(sessionId);

  return {
    sessionId,
    consentHandle: savedSession?.consentHandle || body?.consentHandle,
    token: body?.token || savedSession?.token,
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

    cams.rememberRedirectSession(session.sessionId, updatedSession);

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

const firstArray = (payload, keys) => {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }

  return [];
};

router.post("/dashboard-data", async (req, res) => {
  try {
    const sessionId = req.body?.sessionId;
    const savedSession = cams.getRedirectSession(sessionId);
    const storedConsent =
      cams.findConsentRecordBySessionId(sessionId) ||
      cams.getConsentRecord({ consentId: req.body?.consentId });
    const token = req.body?.token || storedConsent?.token || savedSession?.token;
    const consentId = req.body?.consentId || storedConsent?.consentId;
    const txnId = req.body?.txnId || storedConsent?.txnId || savedSession?.txnId;

    if (!sessionId || !consentId || !token || !txnId) {
      return res.status(409).json({
        success: false,
        status: storedConsent?.consentStatus || "PENDING",
        message: "Consent approval is required before loading dashboard data",
      });
    }

    const [consentResponse, periodicResponse] = await Promise.all([
      cams.getConsentData({ token, consentId }),
      cams.fetchPeriodicData({ token, sessionId, txnId, consentId }),
    ]);
    const consentData = cams.readPortfolio(consentResponse);
    const periodicData = cams.readPortfolio(periodicResponse);
    const portfolio = { ...consentData, periodicData };

    cams.saveConsentRecord({
      ...storedConsent,
      sessionId,
      consentId,
      txnId,
      token,
      consentData: portfolio,
      consentDataFetchedAt: new Date().toISOString(),
    });

    return res.status(200).json({
      success: true,
      status: "ACTIVE",
      data: {
        accounts: firstArray(portfolio, ["accounts", "bankAccounts"]),
        transactions: firstArray(portfolio, ["transactions", "recentTransactions"]),
        dmat: firstArray(portfolio, ["dmat", "holdings", "demat"]),
        insurance: firstArray(portfolio, ["insurance", "policies"]),
        portfolio,
      },
    });
  } catch (err) {
    console.error("DASHBOARD DATA ERROR", err.response?.data || err.message);

    return res.status(err.response?.status || 502).json({
      success: false,
      message: err.response?.data?.message || err.message || "Unable to load dashboard data",
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