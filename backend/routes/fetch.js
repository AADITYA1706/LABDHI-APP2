const express = require("express");
const cams = require("../services/cams");

const router = express.Router();

/* =====================================================
   FETCH FI DATA
   POST /api/cams/fetch
===================================================== */

router.post("/fetch", async (req, res) => {
  try {
    const { sessionId, consentId, token, txnId } = req.body;

    if (!sessionId || !consentId || !token || !txnId) {
      return res.status(400).json({
        success: false,
        message: "sessionId, consentId, token and txnId are required",
      });
    }

    const [consentData, periodicData] = await Promise.all([
      cams.getConsentData({ token, consentId }),
      cams.fetchPeriodicData({ token, sessionId, txnId, consentId }),
    ]);

    return res.status(200).json({
      success: true,
      message: "FI Data fetched successfully",
      portfolio: {
        ...cams.readPortfolio(consentData),
        periodicData: cams.readPortfolio(periodicData),
      },
    });

  } catch (err) {
    console.error("========== FETCH FI DATA ERROR ==========");
    console.error(err.response?.data || err.message);

    return res.status(500).json({
      success: false,
      message:
        err.response?.data?.message ||
        err.message ||
        "Unable to fetch FI Data",
    });
  }
});

module.exports = router;