const express = require("express");

const router = express.Router();

router.get("/", (req, res) => {
  return res.json({
    success: true,
    supported: false,
    policies: [],
  });
});

module.exports = router;
