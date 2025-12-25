const express = require("express");
const cors = require("cors");

// ✅ Load .env if present
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

const explainRoute = require("./routes/explain.cjs");
app.use("/", explainRoute);

// ✅ Health includes key presence (no key printed)
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    openaiKeyPresent: !!(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim()),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Backend draait op poort", PORT);
});
