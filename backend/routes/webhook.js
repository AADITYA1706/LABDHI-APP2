const express = require("express");
const cams = require("../services/cams");

const router = express.Router();

const getNotification = (body) =>
  body?.ConsentStatusNotification ||
  body?.consentStatusNotification ||
  body ||
  {};

router.post("/cams", async (req, res) => {
  const body = req.body || {};
  const notification = getNotification(body);
  const clientTxnId =
    body.clienttxnid ||
    body.clienttrnxid ||
    body.clientTxnId ||
    notification.clienttxnid;
  const mappedSession = cams.findRedirectSession(clientTxnId);
  const consentStatus = cams.normalizeConsentStatus(notification.consentStatus);

  try {
    if (!clientTxnId || !notification.consentStatus) {
      return res.status(400).json({
        success: false,
        message: "clienttxnid and consentStatus are required",
      });
    }

    if (!["ACTIVE", "REJECTED", "PAUSED", "REVOKED"].includes(consentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported consent status: ${consentStatus}`,
      });
    }

    const record = cams.saveConsentRecord({
      clientTxnId,
      clienttxnid: clientTxnId,
      txnId: body.txnid || body.txnId,
      consentId: notification.consentId,
      consentHandle: notification.consentHandle,
      consentStatus,
      sessionId: mappedSession?.sessionId,
      token: mappedSession?.token,
      customerId: body.customerId,
      fipid: body.fipid,
      rawNotification: body,
    });

    if (consentStatus === "ACTIVE" && record.consentId && record.token) {
      try {
        const consentDataResponse = await cams.getConsentData({
          token: record.token,
          consentId: record.consentId,
        });

        cams.saveConsentRecord({
          ...record,
          consentData: cams.readPortfolio(consentDataResponse),
          consentDataFetchedAt: new Date().toISOString(),
        });
      } catch (error) {
        cams.saveConsentRecord({
          ...record,
          consentDataError: error.response?.data?.message || error.message,
        });
        console.error("[CAMS WEBHOOK GetConsentData ERROR]", error.message);
      }
    }

    console.info("[CAMS WEBHOOK]", {
      clientTxnId,
      consentStatus,
      consentId: record.consentId,
      sessionId: record.sessionId,
    });

    return res.status(200).json({
      clienttxnid: clientTxnId,
      timestamp: new Date().toISOString(),
      result: "true",
      message: "success",
    });
  } catch (error) {
    console.error("[CAMS WEBHOOK ERROR]", error.message);

    return res.status(500).json({
      clienttxnid: clientTxnId || null,
      timestamp: new Date().toISOString(),
      result: "false",
      message: error.message || "Unable to process consent notification",
    });
  }
});

module.exports = router;
