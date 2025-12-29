const express = require("express");
const cors = require("cors");
require("dotenv").config();

let OpenAI = require("openai");
OpenAI = OpenAI.default || OpenAI;

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

const LANG = {
  en: { name: "English" },
  nl: { name: "Dutch" },
  de: { name: "German" },
  fr: { name: "French" },
  es: { name: "Spanish" },
  sv: { name: "Swedish" },
  pl: { name: "Polish" },
  tr: { name: "Turkish" },
  uk: { name: "Ukrainian" },
  ar: { name: "Arabic" },
};

function normalizeLang(code) {
  const c = String(code || "").trim().toLowerCase();
  return LANG[c] ? c : "en";
}

function getClient() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !String(key).trim()) {
    const err = new Error("OPENAI_API_KEY is missing (set it in backend/.env)");
    err.code = "MISSING_OPENAI_API_KEY";
    throw err;
  }
  return new OpenAI({ apiKey: String(key).trim() });
}

function extractJsonObject(text) {
  // Strict: must be JSON only, but we still try a safe salvage.
  try {
    return JSON.parse(text);
  } catch (_) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) return null;
    const slice = text.slice(first, last + 1);
    try {
      return JSON.parse(slice);
    } catch (_) {
      return null;
    }
  }
}

function standardV2Prompt({ text, context, outputLang }) {
  const langName = LANG[outputLang].name;

  const contract = {
    version: "2",
    mode: "default",
    language: outputLang,
    doc_type: "short label (e.g. invoice, fine, contract, reminder, cancellation, notice)",
    goal: "1 sentence: what the recipient is expected to do / understand",
    title_guess: "short title from the document",
    summary: ["3 short bullet-like sentences"],
    key_points: ["up to 10 bullets"],
    actions: [
      {
        label: "short action",
        how: "how to do it (1-2 sentences)",
        deadline: "date or null",
      },
    ],
    extracted: {
      amounts: [],
      dates: [],
      iban: [],
      reference: null,
      organization: null,
      recipient_guess: null,
    },
    legal: {
      impact_level: "low",
      disclaimer: "1 sentence: not legal advice; original document is leading",
    },
  };

  return [
    {
      role: "system",
      content:
        "You are a privacy-first document explanation assistant. " +
        "Return VALID JSON only. No markdown. No extra keys outside the requested object wrapper. " +
        "All user-facing strings must be in the requested language.",
    },
    {
      role: "user",
      content:
        `OUTPUT_LANGUAGE: ${langName} (code: ${outputLang})\n` +
        `TASK: Explain the document clearly and safely. Extract practical actions and key facts.\n` +
        `RULES:\n` +
        `- Output must be JSON only (no backticks, no extra text).\n` +
        `- Use the same language for all natural language fields.\n` +
        `- If a field is unknown, use null (or empty arrays).\n` +
        `- Keep it concise and non-judgmental.\n\n` +
        `Return a single JSON object following this example shape (fill with real values):\n` +
        JSON.stringify(contract, null, 2) +
        `\n\nDOCUMENT_TEXT:\n${text}\n\nCONTEXT:\n${context || ""}\n`,
    },
  ];
}

function v1Prompt({ text, context, outputLang }) {
  const langName = LANG[outputLang].name;
  return [
    {
      role: "system",
      content:
        "Return VALID JSON only. No markdown. No extra text. " +
        "You produce a short plain-language explanation.",
    },
    {
      role: "user",
      content:
        `OUTPUT_LANGUAGE: ${langName} (code: ${outputLang})\n` +
        `Return JSON: { "result": "<plain-language explanation>" }\n` +
        `Rules: Keep it short, clear, and practical. Not legal advice.\n\n` +
        `DOCUMENT_TEXT:\n${text}\n\nCONTEXT:\n${context || ""}\n`,
    },
  ];
}

app.get("/health", (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.post("/explain_v2", async (req, res) => {
  try {
    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text : "";
    const context = typeof body.context === "string" ? body.context : "";
    const outputLang = normalizeLang(body.output_language);

    if (text.trim().length < 10) {
      return res.status(400).json({
        error: "INVALID_INPUT",
        detail: "text must be at least 10 characters",
      });
    }

    const client = getClient();
    const messages = standardV2Prompt({ text, context, outputLang });

    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 1200,
    });

    const content = response?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(content);

    if (!parsed || typeof parsed !== "object") {
      return res.status(502).json({
        error: "OPENAI_JSON_PARSE_FAILED",
        detail: "Model did not return valid JSON",
        raw: content,
      });
    }

    return res.json({ result: parsed });
  } catch (e) {
    const code = e?.code;
    if (code === "MISSING_OPENAI_API_KEY") {
      return res.status(500).json({ error: code, detail: e.message });
    }
    return res.status(500).json({ error: "AI_ERROR", detail: e?.message || String(e) });
  }
});

app.post("/explain", async (req, res) => {
  try {
    const body = req.body || {};
    const text = typeof body.text === "string" ? body.text : "";
    const context = typeof body.context === "string" ? body.context : "";
    const outputLang = normalizeLang(body.output_language);

    if (text.trim().length < 10) {
      return res.status(400).json({
        error: "INVALID_INPUT",
        detail: "text must be at least 10 characters",
      });
    }

    const client = getClient();
    const messages = v1Prompt({ text, context, outputLang });

    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 600,
    });

    const content = response?.choices?.[0]?.message?.content || "";
    const parsed = extractJsonObject(content);

    if (!parsed || typeof parsed !== "object" || typeof parsed.result !== "string") {
      return res.status(502).json({
        error: "OPENAI_JSON_PARSE_FAILED",
        detail: "Model did not return valid JSON: {result: string}",
        raw: content,
      });
    }

    return res.json({ result: parsed.result });
  } catch (e) {
    const code = e?.code;
    if (code === "MISSING_OPENAI_API_KEY") {
      return res.status(500).json({ error: code, detail: e.message });
    }
    return res.status(500).json({ error: "AI_ERROR", detail: e?.message || String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Explain This backend running on port ${PORT}`);
});
