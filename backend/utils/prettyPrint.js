function toCamelCaseKey(value) {
  const normalized = String(value).replace(/^[^a-zA-Z0-9]+/, "");
  if (!normalized) {
    return "value";
  }

  const camelized = normalized
    .replace(/[_-]([a-zA-Z0-9])/g, (_match, group) => group.toUpperCase());

  return camelized.replace(/^[A-Z]/, (char) => char.toLowerCase());
}

function toCamelCaseDeep(input) {
  if (Array.isArray(input)) {
    return input.map((item) => toCamelCaseDeep(item));
  }

  if (input && typeof input === "object" && input.constructor === Object) {
    return Object.entries(input).reduce((acc, [key, value]) => {
      acc[toCamelCaseKey(key)] = toCamelCaseDeep(value);
      return acc;
    }, {});
  }

  return input;
}

function toPrettyPrintedJson(input) {
  return JSON.stringify(toCamelCaseDeep(input), null, 2);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toSyntaxHighlightedJson(input) {
  const formatted = escapeHtml(toPrettyPrintedJson(input));
  return formatted.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let className = "number";

      if (/^"/.test(match)) {
        className = /:$/.test(match) ? "key" : "string";
      } else if (/true|false/.test(match)) {
        className = "boolean";
      } else if (/null/.test(match)) {
        className = "null";
      }

      return `<span class="json-${className}">${match}</span>`;
    }
  );
}

module.exports = {
  toCamelCaseDeep,
  toPrettyPrintedJson,
  toSyntaxHighlightedJson
};
