const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";

function normalizeModel(value) {
  const model = String(value || DEFAULT_GEMINI_MODEL).trim();
  if (!model) {
    return DEFAULT_GEMINI_MODEL;
  }
  return model.replace(/^models\//i, "");
}

function extractTextFromGeminiPayload(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  const chunks = [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
      : [];
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) {
        chunks.push(part.text.trim());
      }
    }
  }

  return chunks.join("\n").trim();
}

async function callGeminiText({
  apiKey,
  model,
  systemInstruction,
  userPrompt,
  temperature = 0.2,
  maxOutputTokens = 1200,
  timeoutMs = 20000,
  responseMimeType
}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const resolvedModel = normalizeModel(model);
  const baseUrl = String(
    process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/+$/g, "");
  const url = `${baseUrl}/models/${encodeURIComponent(
    resolvedModel
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const generationConfig = {
    temperature
  };
  if (Number.isFinite(Number(maxOutputTokens)) && Number(maxOutputTokens) > 0) {
    generationConfig.maxOutputTokens = Number(maxOutputTokens);
  }
  if (typeof responseMimeType === "string" && responseMimeType.trim()) {
    generationConfig.responseMimeType = responseMimeType.trim();
  }

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: String(userPrompt || "")
          }
        ]
      }
    ],
    generationConfig
  };
  if (typeof systemInstruction === "string" && systemInstruction.trim()) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction.trim() }]
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    signal:
      typeof AbortSignal !== "undefined" &&
      typeof AbortSignal.timeout === "function" &&
      Number.isFinite(Number(timeoutMs)) &&
      Number(timeoutMs) > 0
        ? AbortSignal.timeout(Number(timeoutMs))
        : undefined
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Gemini API request failed with ${response.status}: ${text}`);
  }

  const payload = await response.json();
  const text = extractTextFromGeminiPayload(payload);
  return {
    model: resolvedModel,
    text,
    payload
  };
}

module.exports = {
  DEFAULT_GEMINI_MODEL,
  callGeminiText,
  extractTextFromGeminiPayload,
  normalizeModel
};
