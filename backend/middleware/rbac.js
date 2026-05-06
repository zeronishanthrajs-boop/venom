function normalizeRole(role) {
  const raw = String(role || "").trim().toLowerCase();
  if (!raw) {
    return "viewer";
  }
  if (raw === "owner") {
    return "admin";
  }
  if (raw === "analyst") {
    return "operator";
  }
  return raw;
}

function requireRole(...allowedRoles) {
  const allowed = new Set(allowedRoles.map((role) => normalizeRole(role)));
  return (req, res, next) => {
    const userRole = normalizeRole(req.user?.role);
    if (!allowed.has(userRole)) {
      return res.status(403).json({
        error: "Insufficient permissions"
      });
    }
    return next();
  };
}

module.exports = {
  normalizeRole,
  requireRole
};
