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


app.post("/explain_v2", async (req, res) => {
  try {
    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text : "";
    const context = typeof body.context === "string" ? body.context : "";
    const mode = (typeof body.mode === "string" && body.mode.trim()) ? body.mode.trim() : "default";

    if (text.trim().length < 10) {
      return res.status(400).json({ error: "TEXT_TOO_SHORT" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_KEY_MISSING" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // V2: return structured JSON (no markdown). Works for ANY letter/text.
    const prompt = `Je bent "Explain This": je legt moeilijke documenten uit in eenvoudige, menselijke taal.

BELANGRIJK:
- Antwoord ALLEEN met geldige JSON.
- GEEN markdown, geen codefences, geen uitleg buiten JSON.
- Taal: Nederlands.
- Wees feitelijk: als iets onzeker is, schrijf dat als "onzeker" in de tekst.

JSON SCHEMA (exact deze keys):
{
  "mode": "default" of "legal",
  "docType": "manual" | "invoice" | "letter" | "contract" | "fine" | "other",
  "intent": "inform" | "request_action" | "warning" | "confirmation" | "decision" | "other",
  "summary": string (max 3 zinnen),
  "key_points": [string, ...] (3-6 punten),
  "actions": [{"label": string, "details": string}],
  "what_if": [{"label": string, "details": string}],
  "extracted": {
    "amounts": [string, ...],
    "dates": [string, ...],
    "iban": [string, ...],
    "reference": [string, ...],
    "contacts": [string, ...]
  },
  "legal": {
    "impact_level": "low" | "medium" | "high",
    "disclaimer": string
  }
}

REGELS:
- "docType": kies het best passende type. Als het een handleiding/instructie is: "manual". Boete/CJIB: "fine". Betalingsverzoek/factuur: "invoice". Voorwaarden/overeenkomst: "contract". Anders: "letter" of "other".
- "intent": wat wil de afzender? (inform/request_action/warning/confirmation/decision/other)
- "actions": 2-4 items. Als er deadlines/bedragen zijn, benoem ze in details. Als niet zeker: zeg "onzeker".
- "what_if": 2-3 items. Maak ze passend bij docType.
- "extracted": alleen dingen die letterlijk in tekst staan; anders lege arrays.
- "legal": als mode == "legal": impact_level + juridisch-voorzichtige disclaimer. Als mode == "default": zet impact_level toch, maar keep disclaimer neutraal ("Geen juridisch advies").

Context (documenttype / situatie):
${context}

Tekst uit document:
${text}`.trim();

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(500).json({ error: "OPENAI_ERROR", detail });
    }

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(500).json({ error: "OPENAI_EMPTY_RESPONSE", raw: data });
    }

    // Clean possible accidental code fences (defensive)
    const cleaned = String(content).trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (_) {
      // Fallback: wrap in minimal object so the app still works
      parsed = {
        mode,
        docType: "other",
        intent: "other",
        summary: cleaned.slice(0, 420),
        key_points: [],
        actions: [],
        what_if: [],
        extracted: { amounts: [], dates: [], iban: [], reference: [], contacts: [] },
        legal: { impact_level: "low", disclaimer: "Geen juridisch advies. Controleer altijd het originele document." },
      };
    }

    // Ensure mode is echoed
    parsed.mode = mode;

    res.json({ result: parsed });
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
