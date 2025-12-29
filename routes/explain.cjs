const express = require("express");
const router = express.Router();
const { explainText } = require("../services/ai_explain.cjs");

router.post("/explain", async (req, res) => {
  try {
    const { text, context, output_language } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({
        error: "INVALID_INPUT",
        detail: "Geen geldige tekst ontvangen",
      });
    }

    const result = await explainText({
      text,
      context: context || "",
    });

    if (!result || typeof result !== "string") {
      return res.status(500).json({
        error: "AI_EMPTY_RESULT",
        detail: "AI gaf geen geldige uitleg terug",
      });
    }

    res.json({ result });
  } catch (err) {
    console.error("❌ AI_ERROR:", err);

    const msg = String(err?.message || "");
    const status = err?.status;

    // Missing key
    if (err?.code === "MISSING_OPENAI_API_KEY" || msg.includes("OPENAI_API_KEY")) {
      return res.status(500).json({
        error: "MISSING_OPENAI_API_KEY",
        detail: "OPENAI_API_KEY ontbreekt. Zet je key in backend/.env of als environment variable en herstart de backend.",
      });
    }

    // Quota / rate limit
    if (
      status === 429 ||
      err?.code === "insufficient_quota" ||
      msg.includes("exceeded your current quota") ||
      msg.includes("insufficient_quota") ||
      msg.includes("Rate limit") ||
      msg.includes("429")
    ) {
      return res.status(429).json({
        error: "OPENAI_QUOTA_OR_RATE_LIMIT",
        detail: msg,
        hint: "Check Billing/Usage in je OpenAI dashboard. Soms duurt activatie een paar minuten.",
      });
    }

    // Auth
    if (status === 401 || msg.includes("invalid_api_key") || msg.includes("Incorrect API key")) {
      return res.status(401).json({
        error: "OPENAI_AUTH_ERROR",
        detail: msg,
        hint: "Je API key is ongeldig/ingetrokken. Maak een nieuwe key in OpenAI dashboard en zet hem in backend/.env. Post je key nooit.",
      });
    }

    res.status(500).json({
      error: "AI_ERROR",
      detail: msg || String(err),
    });
  }
});

module.exports = router;
