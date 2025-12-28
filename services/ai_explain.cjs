let OpenAI = require("openai");
OpenAI = OpenAI.default || OpenAI;

function getApiKey() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || !String(key).trim()) {
    const err = new Error("OPENAI_API_KEY ontbreekt");
    err.code = "MISSING_OPENAI_API_KEY";
    throw err;
  }
  return String(key).trim();
}

function getClient() {
  // ✅ Lazy init (backend kan starten zonder key; fout pas bij /explain)
  return new OpenAI({ apiKey: getApiKey() });
}

async function explainText({ text, context }) {
  // ✅ UX FIX: Forceer nette secties, géén Markdown
  const prompt = `
Je bent "Explain This": je legt moeilijke documenten uit in eenvoudige, menselijke taal.

INSTRUCTIES (belangrijk):
- Gebruik GEEN markdown. Dus: geen **, geen ##, geen backticks.
- Gebruik alleen platte tekst.
- Antwoord altijd in het Nederlands.
- Schrijf kort, duidelijk, professioneel.
- Gebruik GEEN opsommingen met '-' of '•'. Schrijf in korte alinea's; nieuwe regels zijn oké, maar zonder bullets.
- Gebruik exact deze kopjes (allemaal met hoofdletters en een dubbele punt):
SAMENVATTING:
BELANGRIJKSTE PUNTEN:
RISICO'S / LET OP:
WAT NU TE DOEN:

Context (documenttype / situatie):
${context}

Tekst uit document:
${text}
`.trim();

  try {
    const client = getClient();

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
    });

    if (
      !response ||
      !response.choices ||
      !Array.isArray(response.choices) ||
      response.choices.length === 0 ||
      !response.choices[0].message ||
      !response.choices[0].message.content
    ) {
      const err = new Error("OpenAI response ongeldig of leeg");
      err.code = "OPENAI_EMPTY_RESPONSE";
      throw err;
    }

    return response.choices[0].message.content.trim();
  } catch (err) {
    const e = new Error(err?.message || String(err));
    e.status = err?.status || err?.response?.status;
    e.code = err?.code;
    e.type = err?.type;
    throw e;
  }
}

module.exports = { explainText };
