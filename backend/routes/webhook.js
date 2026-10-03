const express = require("express");
const cams = require("../services/cams");

const router = express.Router();

const getNotification = (body) =>
  body?.ConsentStatusNotification ||
  body?.consentStatusNotification ||
  body ||
  {};

router.post("/", async (req, res) => {
  const body = req.body || {};
  const notification = getNotification(body);
  const clientTxnId =
    body.clienttxnid ||
    body.clienttrnxid ||
    body.clientTxnId ||
    notification.clienttxnid;
  const mappedSession = cams.findRedirectSession(clientTxnId);
  const consentStatus = cams.normalizeConsentStatus(notification.consentStatus);

  console.info("[CAMS WEBHOOK RECEIVED]", {
    clientTxnIdPresent: Boolean(clientTxnId),
    sessionFound: Boolean(mappedSession),
    consentStatus: consentStatus || null,
    consentIdPresent: Boolean(notification.consentId),
    consentHandlePresent: Boolean(notification.consentHandle),
  });

  try {
    if (
      body.purpose !== "ConsentStatusNotification" ||
      !clientTxnId ||
      !body.txnid ||
      !notification.consentStatus
    ) {
      return res.status(400).json({
        success: false,
        message: "ConsentStatusNotification purpose, clienttxnid, txnid, and consentStatus are required",
      });
    }

    if (![
      "ACTIVE",
      "APPROVED",
      "CONSENTED",
      "AUTHORIZED",
      "SUCCESS",
      "COMPLETED",
      "REJECTED",
      "PAUSED",
      "REVOKED",
    ].includes(consentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported consent status: ${consentStatus}`,
      });
    }

    if (!mappedSession) {
      return res.status(409).json({
        success: false,
        message: "CAMS session not found for consent notification",
      });
    }

    if (
      cams.isConsentStatusActive(consentStatus) &&
      (!notification.consentId || !notification.consentHandle)
    ) {
      return res.status(400).json({
        success: false,
        message: "ACTIVE consent notification requires consentId and consentHandle",
      });
    }

    const record = cams.saveConsentRecord({
      clientTxnId,
      clienttxnid: clientTxnId,
      txnId: body.txnid,
      consentId: notification.consentId,
      consentHandle: notification.consentHandle,
      consentStatus,
      sessionId: mappedSession?.sessionId,
      token: mappedSession?.token,
      customerId: body.customerId,
      fipid: body.fipid,
    });

    if (cams.isConsentStatusActive(record.consentStatus) && record.consentId && record.token) {
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
      clientTxnIdPresent: Boolean(clientTxnId),
      consentStatus,
      consentIdPresent: Boolean(record.consentId),
      sessionIdPresent: Boolean(record.sessionId),
    });

    return res.status(200).json({
      clienttxnid: clientTxnId,
      timestamp: new Date().toISOString(),
      result: "true",
      Message: "success",
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
