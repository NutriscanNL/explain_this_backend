const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));


app.post("/explain_v2", async (req, res) => {
  try {
    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text : "";
    const context = typeof body.context === "string" ? body.context : "";
    const mode = body.mode === "legal" ? "legal" : "default";

    if (text.trim().length < 10) {
      return res.status(400).json({ error: "TEXT_TOO_SHORT" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_KEY_MISSING" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    // We keep prompt strict + JSON-only to simplify frontend parsing.
    const prompt = `
Je bent een rustige, uiterst duidelijke uitleg-assistent voor gescande teksten/briefstukken.

TAAL: Nederlands (eenvoudig, menselijk, geen jargon).
BELANGRIJK: Geef ALLEEN geldige JSON terug. Geen markdown. Geen uitleg buiten JSON.

Doel:
- Werkt voor ELKE tekst (brief, e-mail, handleiding, contract, boete, factuur).
- Geef altijd een bruikbare samenvatting + kernpunten + acties, ook als er weinig feiten te vinden zijn.
- Extractie (bedrag/datum/IBAN/kenmerk) is optioneel: alleen als het echt in de tekst staat.

MODE:
- default: geen juridische stelligheid, geen "risico" taal.
- legal: extra voorzichtig + duidelijk "geen juridisch advies" disclaimer en een impact_level (low/medium/high).

Kies doc_type uit EXACT deze waarden:
manual | invoice | letter | contract | fine | other

Kies goal uit EXACT deze waarden:
inform | request_action | warning | confirmation | rejection | invitation | unknown

Geef dit JSON schema terug:

{
  "version": 2,
  "mode": "${mode}",
  "doc_type": "manual|invoice|letter|contract|fine|other",
  "goal": "inform|request_action|warning|confirmation|rejection|invitation|unknown",
  "title_guess": "korte titel (max 60 tekens)",
  "summary": "max 2-3 zinnen, kort en duidelijk",
  "key_points": ["3-6 bullets, geen herhaling"],
  "actions": [
    {
      "label": "korte actie (max 40 tekens)",
      "details": "1 zin uitleg",
      "deadline": "datum of null"
    }
  ],
  "what_if": [
    {
      "if": "Als je niets doet…",
      "then": "kort gevolg (zonder juridisch advies)"
    }
  ],
  "extracted": {
    "amounts": [],
    "dates": [],
    "iban": [],
    "reference": null,
    "organization": null
  },
  "legal": null
}

Als mode = "legal", zet legal op:
{
  "impact_level": "low|medium|high",
  "disclaimer": "Dit is geen juridisch advies..."
}
(en gebruik voorzichtige taal: 'mogelijk', 'vaak', 'kan').

CONTEXT:
${context}

TEKST:
${text}
`.trim();

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

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(502).json({ error: "OPENAI_EMPTY_RESPONSE", raw: data });
    }

    // Parse JSON strictly, with a small repair attempt if model wrapped text.
    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const first = content.indexOf("{");
      const last = content.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        const slice = content.slice(first, last + 1);
        try {
          parsed = JSON.parse(slice);
        } catch (e2) {
          return res.status(502).json({ error: "OPENAI_JSON_PARSE_FAILED", detail: e2?.message || String(e2), raw: content });
        }
      } else {
        return res.status(502).json({ error: "OPENAI_JSON_PARSE_FAILED", detail: e?.message || String(e), raw: content });
      }
    }

    // Minimal shape guard
    if (!parsed || typeof parsed !== "object") {
      return res.status(502).json({ error: "OPENAI_JSON_INVALID", raw: parsed });
    }

    return res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: "AI_ERROR", detail: e?.message || String(e) });
  }
});




// ------------------------------
// Contracts (JSON Schemas) – for frontend/back-end agreement
// ------------------------------
const fs = require("fs");
const path = require("path");

function sendJsonFile(res, relPath) {
  try {
    const p = path.join(__dirname, relPath);
    const raw = fs.readFileSync(p, "utf8");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.status(200).send(raw);
  } catch (e) {
    res.status(404).json({ error: "SCHEMA_NOT_FOUND" });
  }
}

app.get("/contract/standard_v2", (req, res) => sendJsonFile(res, "contracts/standard_v2.schema.json"));
app.get("/contract/legal_v1", (req, res) => sendJsonFile(res, "contracts/legal_v1.schema.json"));


// ------------------------------
// Pro Legal endpoint – separate route (does NOT change /explain_v2)
// ------------------------------
// Body:
// {
//   "text": "scanned OCR text",
//   "context": "optional user context",
//   "legal_type": "huur|arbeid|incasso|bezwaar|contract|aansprakelijkheid|overig",
//   "tone": "neutral|friendly|firm",
//   "output_language": "nl|en|... (optional)"
// }
app.post("/explain_legal_v1", async (req, res) => {
  try {
    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text : "";
    const context = typeof body.context === "string" ? body.context : "";
    const legalType = typeof body.legal_type === "string" ? body.legal_type : "overig";
    const tone = body.tone === "friendly" || body.tone === "firm" ? body.tone : "neutral";
    const outputLanguage = typeof body.output_language === "string" && body.output_language.trim() ? body.output_language.trim() : "nl";

    if (!text || text.trim().length < 20) {
      return res.status(400).json({ error: "TEXT_TOO_SHORT" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_API_KEY_MISSING" });
    }

    const model = process.env.OPENAI_LEGAL_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";

    const prompt = `
Je bent Explain This – Pro Legal (geen juridisch advies, geen garanties).
Jouw taak: lees de TEKST en geef een juridische-voorzichtig geformuleerde analyse in JSON.

BELANGRIJK:
- Output is ALLEEN geldige JSON (geen markdown, geen uitlegtekst eromheen).
- Geen "win percentage". Gebruik assessment: strong|mixed|weak met uitleg.
- Wees concreet en bondig. Vermijd dubbelingen.
- Max 3 items per extracted array (amounts/dates/iban).
- Kies doc_type uit EXACT: manual|invoice|letter|contract|fine|other
- Kies goal uit EXACT: inform|request_action|warning|confirmation|rejection|invitation|unknown
- impact_level: low|medium|high
- assessment: strong|mixed|weak
- tone: neutral|friendly|firm
- output_language: schrijf reply_draft in deze taal: ${outputLanguage}

Geef dit JSON schema terug:

{
  "version": 1,
  "mode": "legal",
  "doc_type": "manual|invoice|letter|contract|fine|other",
  "goal": "inform|request_action|warning|confirmation|rejection|invitation|unknown",
  "legal_type": "huur|arbeid|incasso|bezwaar|contract|aansprakelijkheid|overig",
  "title_guess": "korte titel (max 60 tekens)",
  "summary": "max 2-3 zinnen, kort en duidelijk",
  "key_points": ["max 5 bullets, geen herhaling"],
  "actions": [
    {
      "label": "korte actie (max 40 tekens)",
      "details": "1 zin uitleg",
      "deadline": "datum of null"
    }
  ],
  "extracted": {
    "amounts": [],
    "dates": [],
    "iban": [],
    "reference": null,
    "organization": null,
    "recipient_guess": null
  },
  "legal": {
    "impact_level": "low|medium|high",
    "assessment": "strong|mixed|weak",
    "assessment_reason": "2-4 zinnen: waarom sterk/gemengd/zwak + onzekerheden",
    "uncertainties": ["max 5 punten: wat is onzeker/afhankelijk"],
    "missing_info": ["max 6 punten: welke info ontbreekt"],
    "arguments_for": ["max 6 punten: argumenten die je kunt aanvoeren (voorzichtig)"],
    "arguments_against": ["max 6 punten: tegenargumenten / risico's"],
    "reply_draft": {
      "tone": "neutral|friendly|firm",
      "subject": "onderwerpregel",
      "body": "volledige concept-brief (zonder placeholders als <...>, gebruik [ ] indien nodig)",
      "notes": ["max 4 korte notities wat de gebruiker moet invullen/aanpassen"]
    },
    "disclaimer": "1 zin: geen juridisch advies, originele tekst leidend"
  }
}

CONTEXT:
${context}

LEGAL_TYPE:
${legalType}

TONE:
${tone}

TEKST:
${text}
`.trim();

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

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(502).json({ error: "OPENAI_EMPTY_RESPONSE", raw: data });
    }

    // Parse JSON strictly, with small repair if wrapped
    let parsed = null;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      const first = content.indexOf("{");
      const last = content.lastIndexOf("}");
      if (first !== -1 && last !== -1 && last > first) {
        const slice = content.slice(first, last + 1);
        try {
          parsed = JSON.parse(slice);
        } catch (e2) {
          return res.status(502).json({ error: "OPENAI_JSON_PARSE_FAILED", detail: e2?.message || String(e2), raw: content });
        }
      } else {
        return res.status(502).json({ error: "OPENAI_JSON_PARSE_FAILED", detail: e?.message || String(e), raw: content });
      }
    }

    if (!parsed || typeof parsed !== "object") {
      return res.status(502).json({ error: "OPENAI_JSON_INVALID", raw: parsed });
    }

    return res.json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "SERVER_ERROR", detail: e?.message || String(e) });
  }
});

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
