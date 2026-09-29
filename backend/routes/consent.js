const express = require("express");
const cams = require("../services/cams");

const router = express.Router();

/* ======================================================
   CAMS CONSENT STATUS
   POST /api/cams/status
====================================================== */

router.post("/status", async (req, res) => {
  try {
    const { sessionId, consentHandle, token, txnId, userId } = req.body;

    if (!sessionId || !consentHandle || !token) {
      return res.status(400).json({
        success: false,
        message: "sessionId, consentHandle and token are required",
      });
    }

    const response = await cams.getConsentStatus({
      token,
      sessionId,
      consentHandle,
      txnId,
      userId,
    });

    const consent = cams.readConsentStatus(response);

    return res.status(200).json({
      success: true,
      consentStatus: consent.consentStatus,
      consentId: consent.consentId,
      consentHandle,
      sessionId,
      data: cams.readPayload(response),
    });

  } catch (err) {
    console.error("CONSENT STATUS ERROR");
    console.error(err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      message:
        err.response?.data?.message ||
        err.message ||
        "Unable to fetch Consent Status",
    });
  }
});

module.exports = router;