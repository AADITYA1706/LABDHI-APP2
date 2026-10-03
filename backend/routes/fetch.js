const express = require("express");
const cams = require("../services/cams");

const router = express.Router();

/* =====================================================
   FETCH FI DATA
   POST /api/cams/fetch
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
    console.error("FETCH FI DATA ERROR", err.message);

    return res.status(err.statusCode || err.response?.status || 502).json({
      success: false,
      message: err.response?.data?.message || err.message || "Unable to fetch FI Data",
    });
  }
});

module.exports = router;