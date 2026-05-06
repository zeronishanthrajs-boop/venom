function maskSecret(value, visibleChars = 4) {
  if (typeof value !== "string") {
    return "***";
  }
  if (value.length <= visibleChars) {
    return `${"*".repeat(Math.max(value.length, 3))}`;
  }
  return `${value.slice(0, visibleChars)}${"*".repeat(value.length - visibleChars)}`;
}

module.exports = {
  maskSecret
};
