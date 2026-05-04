const test = require("node:test");
const assert = require("node:assert/strict");
const { extractJsonObjectText } = require("../services/promptEvolver");

test("extractJsonObjectText strips fenced code blocks", () => {
  const raw = "```json\n{\"a\":1,\"b\":2}\n```";
  const extracted = extractJsonObjectText(raw);
  assert.equal(extracted, "{\"a\":1,\"b\":2}");
});

test("extractJsonObjectText keeps plain JSON object", () => {
  const raw = "{\"x\":{\"y\":true}}";
  const extracted = extractJsonObjectText(raw);
  assert.equal(extracted, raw);
});

test("extractJsonObjectText returns best effort when braces absent", () => {
  const raw = "not-json-response";
  const extracted = extractJsonObjectText(raw);
  assert.equal(extracted, raw);
});
