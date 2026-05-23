const crypto = require("node:crypto");
const { WebSocket, WebSocketServer } = require("ws");
const { logger } = require("../config/logger");

const roomMap = new Map();
const socketMeta = new WeakMap();
let wss = null;
let heartbeatTimer = null;

function getRealtimeSecret() {
  return (
    process.env.VENOM_REALTIME_SECRET ||
    process.env.VENOM_API_KEY ||
    "venom-dev-realtime-secret"
  );
}

function getTokenTtlMs() {
  const parsed = Number.parseInt(
    String(process.env.VENOM_REALTIME_TOKEN_TTL_MS || "600000"),
    10
  );
  if (!Number.isFinite(parsed) || parsed < 60000) {
    return 600000;
  }
  return parsed;
}

function getHeartbeatIntervalMs() {
  const parsed = Number.parseInt(
    String(process.env.VENOM_REALTIME_HEARTBEAT_MS || "30000"),
    10
  );
  if (!Number.isFinite(parsed) || parsed < 10000) {
    return 30000;
  }
  return parsed;
}

function getAllowedOriginSet() {
  const csv =
    process.env.CORS_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000";
  return new Set(
    String(csv)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function signPayload(payloadBase64) {
  return crypto
    .createHmac("sha256", getRealtimeSecret())
    .update(payloadBase64)
    .digest("hex");
}

function issueRealtimeToken({ userId, role, engagementId }) {
  const now = Date.now();
  const payload = {
    sub: String(userId || "unknown"),
    role: String(role || "operator"),
    engagementId: engagementId ? String(engagementId) : null,
    iat: now,
    exp: now + getTokenTtlMs()
  };

  const payloadBase64 = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url"
  );
  const signature = signPayload(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

function verifyRealtimeToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) {
    return { valid: false, reason: "missing_or_invalid_token" };
  }

  const [payloadBase64, signature] = token.split(".");
  if (!payloadBase64 || !signature) {
    return { valid: false, reason: "malformed_token" };
  }

  const expected = signPayload(payloadBase64);
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(signature, "utf8");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadBase64, "base64url").toString("utf8"));
  } catch {
    return { valid: false, reason: "invalid_payload" };
  }

  if (!payload?.sub || !payload?.exp) {
    return { valid: false, reason: "missing_claims" };
  }

  if (Date.now() > Number(payload.exp)) {
    return { valid: false, reason: "expired" };
  }

  return { valid: true, payload };
}

function addSocketToRoom(engagementId, socket) {
  const key = String(engagementId || "global");
  if (!roomMap.has(key)) {
    roomMap.set(key, new Set());
  }
  roomMap.get(key).add(socket);
}

function removeSocketFromRoom(engagementId, socket) {
  const key = String(engagementId || "global");
  const room = roomMap.get(key);
  if (!room) {
    return;
  }
  room.delete(socket);
  if (room.size === 0) {
    roomMap.delete(key);
  }
}

function cleanupSocket(socket) {
  const currentMeta = socketMeta.get(socket);
  removeSocketFromRoom(currentMeta?.engagementId || "global", socket);
  socketMeta.delete(socket);
}

function broadcastToRoom(engagementId, event, data) {
  const key = String(engagementId || "global");
  const room = roomMap.get(key);
  if (!room || room.size === 0) {
    return;
  }

  const message = JSON.stringify({
    event,
    data,
    timestamp: new Date().toISOString()
  });

  for (const socket of room) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  }
}

function broadcastToAll(event, data) {
  if (!wss) {
    return;
  }
  const message = JSON.stringify({
    event,
    data,
    timestamp: new Date().toISOString()
  });
  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(message);
    }
  }
}

function broadcastToolResult(engagementId, payload) {
  broadcastToRoom(engagementId, "tool_result", payload);
}

function broadcastFinding(engagementId, payload) {
  broadcastToRoom(engagementId, "new_finding", payload);
}

function broadcastResearchUpdate(payload) {
  broadcastToAll("research_update", payload);
}

function getRealtimeStatus() {
  const rooms = {};
  for (const [engagementId, sockets] of roomMap.entries()) {
    rooms[engagementId] = sockets.size;
  }

  return {
    enabled: Boolean(wss),
    totalSockets: wss ? wss.clients.size : 0,
    rooms,
    tokenTtlMs: getTokenTtlMs()
  };
}

function initWebSocketServer(server) {
  if (wss) {
    return wss;
  }

  const allowedOrigins = getAllowedOriginSet();
  wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: ({ origin }) => {
      if (!origin) {
        return true;
      }
      return allowedOrigins.has(origin);
    }
  });

  heartbeatTimer = setInterval(() => {
    if (!wss) {
      return;
    }
    for (const socket of wss.clients) {
      if (socket.isAlive === false) {
        cleanupSocket(socket);
        try {
          socket.terminate();
        } catch {
          // no-op
        }
        continue;
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        // no-op
      }
    }
  }, getHeartbeatIntervalMs());
  if (typeof heartbeatTimer.unref === "function") {
    heartbeatTimer.unref();
  }

  wss.on("connection", (socket, req) => {
    const requestUrl = new URL(req.url, "http://localhost");
    const token = requestUrl.searchParams.get("token");
    const verification = verifyRealtimeToken(token);
    if (!verification.valid) {
      socket.close(1008, "Unauthorized");
      return;
    }

    const tokenEngagementId = verification.payload.engagementId
      ? String(verification.payload.engagementId)
      : null;
    const requestedEngagementId = requestUrl.searchParams.get("engagementId");
    const engagementId = requestedEngagementId
      ? String(requestedEngagementId)
      : tokenEngagementId;

    if (
      tokenEngagementId &&
      engagementId &&
      tokenEngagementId !== String(engagementId)
    ) {
      socket.close(1008, "Scope mismatch");
      return;
    }

    const meta = {
      userId: verification.payload.sub,
      role: verification.payload.role,
      engagementId: engagementId || null
    };
    socket.isAlive = true;
    socketMeta.set(socket, meta);
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    if (engagementId) {
      addSocketToRoom(engagementId, socket);
    } else {
      addSocketToRoom("global", socket);
    }

    socket.send(
      JSON.stringify({
        event: "realtime_connected",
        data: {
          userId: meta.userId,
          role: meta.role,
          engagementId: meta.engagementId,
          connectedAt: new Date().toISOString()
        }
      })
    );

    socket.on("close", () => {
      cleanupSocket(socket);
    });
  });

  wss.on("close", () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });

  logger.info({ path: "/ws" }, "Realtime WebSocket server initialized");
  return wss;
}

function closeWebSocketServer() {
  if (!wss) {
    return;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  for (const socket of wss.clients) {
    try {
      socket.close(1001, "Server shutdown");
    } catch {
      // no-op
    }
  }
  wss.close();
  roomMap.clear();
  wss = null;
}

module.exports = {
  initWebSocketServer,
  closeWebSocketServer,
  issueRealtimeToken,
  verifyRealtimeToken,
  getRealtimeStatus,
  broadcastToRoom,
  broadcastToAll,
  broadcastToolResult,
  broadcastFinding,
  broadcastResearchUpdate,
  __internal: {
    signPayload,
    getTokenTtlMs,
    getHeartbeatIntervalMs
  }
};
