const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.post("/explain", async (req, res) => {
  try {
    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text : "";
    const context = typeof body.context === "string" ? body.context : "";

    if (text.trim().length < 10) {
      return res.status(400).json({ error: "TEXT_TOO_SHORT" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_KEY_MISSING" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const prompt = `Je bent een rustige uitleg-assistent.
Leg onderstaande tekst uit in normaal Nederlands.

STRUCTUUR (verplicht):
In gewone woorden:
- ...

Belangrijk om te weten:
- ...

Wat kun je nu doen:
- ...

CONTEXT: ${context}

TEKST:
${text}`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({
        error: "OPENAI_HTTP_ERROR",
        status: r.status,
        detail: detail?.slice(0, 2000) || "",
      });
    }

    const data = await r.json();
    const result = data?.choices?.[0]?.message?.content;

    if (!result) {
      return res.status(502).json({ error: "OPENAI_EMPTY_RESPONSE", raw: data });
    }

    res.json({ result });
  } catch (e) {
    res.status(500).json({ error: "AI_ERROR", detail: e?.message || String(e) });
  }
});

app.get("/health", (_, res) => {
  res.json({
    ok: true,
    keyPresent: !!process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  });
});

// ✅ Render: bind op process.env.PORT en host 0.0.0.0
const port = Number(process.env.PORT) || 3000;
app.listen(port, "0.0.0.0", () => console.log(`🚀 Explain This backend on :${port}`));
