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
    const mode = typeof body.mode === "string" ? body.mode : "default"; // future: "legal"

    if (text.trim().length < 10) {
      return res.status(400).json({ error: "TEXT_TOO_SHORT" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENAI_KEY_MISSING" });
    }

    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

    const system = `You are Explain This, a privacy-first document explainer.
Return ONLY valid JSON (no markdown, no code fences).
Be cautious: do not give legal advice. Use uncertainty language.`;

    const schemaHint = `Return JSON with exactly these top-level keys:
{
  "docType": "general_letter|invoice|fine|contract|medical|insurance|bank|employment|education|collections|government|other",
  "intent": "inform|request_action|warning|confirmation|decision|invitation|payment_request|other",
  "summary": "3-5 short sentences for the user (Dutch).",
  "key_points": ["bullet 1", "bullet 2", "bullet 3"],
  "actions": [
    {"label":"...", "deadline": null, "risk":"low|medium|high", "details":"..."}
  ],
  "extracted": {
    "amounts": [],
    "dates": [],
    "deadline": null,
    "iban": null,
    "reference": null,
    "contact": null,
    "sender": null
  },
  "legal": {
    "risk_level": "low|medium|high",
    "notes": ["..."],
    "disclaimer": "..."
  }
}`;

    const user = `Document text:
${text}

Extra context (optional):
${context}

Mode: ${mode}

${schemaHint}`;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
      }),
    });

    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(502).json({ error: "OPENAI_EMPTY_RESPONSE", raw: data });
    }

    function stripFences(s) {
      return String(s)
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```$/i, "")
        .trim();
    }

    function safeJsonParse(s) {
      try {
        return JSON.parse(stripFences(s));
      } catch (_) {
        // try to extract first {...} block
        const m = stripFences(s).match(/\{[\s\S]*\}$/);
        if (m) {
          try { return JSON.parse(m[0]); } catch (_) {}
        }
        return null;
      }
    }

    function uniq(arr) {
      const seen = new Set();
      return (arr || []).filter((x) => {
        const k = String(x);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }

    function extractFacts(t) {
      const s = String(t || "");
      const amounts = uniq((s.match(/€\s*\d{1,3}(?:[.\s]\d{3})*(?:[,\.\s]\d{2})?/g) || []).map(x => x.replace(/\s+/g, " ").trim()));
      const ibanM = s.match(/\bNL\d{2}\s?[A-Z]{4}\s?\d{4}\s?\d{2}\s?\d{2}\s?\d{2}\b/i);
      const iban = ibanM ? ibanM[0].replace(/\s+/g, "").toUpperCase() : null;

      const month = "(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)";
      const dateWords = new RegExp(`\\b\\d{1,2}\\s+${month}\\s+\\d{4}\\b`, "ig");
      const dates = uniq((s.match(dateWords) || []).map(x => x.trim()));
      const dateNums = uniq((s.match(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g) || []).map(x => x.trim()));
      const allDates = uniq([...dates, ...dateNums]);

      // naive deadline: first date that appears near betaal/voor/vóór
      let deadline = null;
      for (const d of allDates) {
        const idx = s.toLowerCase().indexOf(d.toLowerCase());
        if (idx >= 0) {
          const w = s.substring(Math.max(0, idx - 50), Math.min(s.length, idx + d.length + 50)).toLowerCase();
          if (w.includes("betaal") || w.includes("vóór") || w.includes("voor ")) {
            deadline = d;
            break;
          }
        }
      }

      // reference: look for 'betalingskenmerk' or 'kenmerk'
      let reference = null;
      const refM =
        s.match(/betalingskenmerk\s*[:\-]?\s*([0-9 ]{6,})/i) ||
        s.match(/\bkenmerk\s*[:\-]?\s*([A-Z0-9\- ]{6,})/i) ||
        s.match(/\bzaaknummer\s*[:\-]?\s*([A-Z0-9\- ]{6,})/i);
      if (refM) reference = String(refM[1]).trim().replace(/\s+/g, " ");

      return { amounts, dates: allDates, deadline, iban, reference };
    }

    const parsed = safeJsonParse(content);
    const extracted = extractFacts(text);

    if (!parsed || typeof parsed !== "object") {
      // fallback: return minimal structured response
      return res.json({
        docType: "other",
        intent: "inform",
        summary: "Ik heb je tekst ontvangen, maar kon de analyse niet betrouwbaar structureren. Bekijk de originele brief voor details.",
        key_points: [],
        actions: [
          { label: "Lees de originele brief", deadline: extracted.deadline || null, risk: "medium", details: "Controleer wat er precies gevraagd wordt en of er een deadline is." }
        ],
        extracted: {
          amounts: extracted.amounts,
          dates: extracted.dates,
          deadline: extracted.deadline,
          iban: extracted.iban,
          reference: extracted.reference,
          contact: null,
          sender: null
        },
        legal: {
          risk_level: "medium",
          notes: ["De analyse kon niet betrouwbaar worden geformatteerd."],
          disclaimer: "Dit is een vereenvoudigde uitleg. De originele brief is juridisch leidend. Geen juridisch advies."
        },
        raw_text: content
      });
    }

    // normalize + merge extracted facts
    const out = parsed;
    out.extracted = out.extracted && typeof out.extracted === "object" ? out.extracted : {};
    out.extracted.amounts = uniq([...(out.extracted.amounts || []), ...extracted.amounts]);
    out.extracted.dates = uniq([...(out.extracted.dates || []), ...extracted.dates]);
    out.extracted.deadline = out.extracted.deadline || extracted.deadline || null;
    out.extracted.iban = out.extracted.iban || extracted.iban || null;
    out.extracted.reference = out.extracted.reference || extracted.reference || null;

    // guarantee disclaimer
    out.legal = out.legal && typeof out.legal === "object" ? out.legal : {};
    out.legal.disclaimer =
      out.legal.disclaimer ||
      "Dit is een vereenvoudigde uitleg. De originele brief is juridisch leidend. Geen juridisch advies.";

    return res.json(out);
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
