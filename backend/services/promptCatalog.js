const fs = require("node:fs/promises");
const path = require("node:path");
const PromptVersion = require("../models/PromptVersion");

const PROMPT_FILES = {
  planning: "planning-agent-v2.txt",
  chain: "chain-agent-v1.txt",
  learning: "learning-agent-v1.txt",
  tagging: "tagging-agent-v1.txt",
  research: "research-agent-v1.txt"
};

function normalizePromptType(promptType) {
  const normalized = String(promptType || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PROMPT_FILES, normalized)) {
    return normalized;
  }
  return null;
}

function promptPathForType(promptType) {
  const normalized = normalizePromptType(promptType);
  if (!normalized) {
    return null;
  }
  return path.join(__dirname, "..", "prompts", PROMPT_FILES[normalized]);
}

async function readPromptFile(promptType) {
  const promptPath = promptPathForType(promptType);
  if (!promptPath) {
    return null;
  }

  try {
    return await fs.readFile(promptPath, "utf8");
  } catch {
    return null;
  }
}

async function getActivePromptRecord(promptType) {
  const normalized = normalizePromptType(promptType);
  if (!normalized) {
    return null;
  }

  return PromptVersion.findOne({
    promptType: normalized,
    isActive: true
  })
    .sort({ updatedAt: -1, createdAt: -1 })
    .lean();
}

async function resolvePromptContent(promptType, fallbackText = "") {
  const normalized = normalizePromptType(promptType);
  if (!normalized) {
    return {
      promptType: null,
      content: fallbackText,
      source: "fallback",
      version: "fallback"
    };
  }

  const active = await getActivePromptRecord(normalized);
  if (active?.content) {
    return {
      promptType: normalized,
      content: active.content,
      source: "db-active",
      version: active.version
    };
  }

  const fileContent = await readPromptFile(normalized);
  if (fileContent) {
    return {
      promptType: normalized,
      content: fileContent,
      source: "file-default",
      version: "default-file"
    };
  }

  return {
    promptType: normalized,
    content: fallbackText,
    source: "fallback",
    version: "fallback"
  };
}

module.exports = {
  PROMPT_FILES,
  normalizePromptType,
  promptPathForType,
  readPromptFile,
  getActivePromptRecord,
  resolvePromptContent
};
