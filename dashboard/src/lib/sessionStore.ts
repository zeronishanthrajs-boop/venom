import { MongoClient } from "mongodb";

type SessionRole = "owner";

export type AuthSessionRecord = {
  sid: string;
  email: string;
  role: SessionRole;
  uaHash: string;
  ipHash: string | null;
  refreshTokenHash: string;
  createdAt: string;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  revokeReason: string;
};

type SessionUpdate = {
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
  refreshTokenHash?: string;
  lastSeenAt?: string;
  ipHash?: string | null;
};

declare global {
  var __venomDashboardMongoPromise: Promise<MongoClient> | undefined;
}

const memoryStore = new Map<string, AuthSessionRecord>();

function getMongoUri() {
  const candidates = [
    process.env.VENOM_DASHBOARD_MONGODB_URI,
    process.env.MONGODB_URI
  ];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) {
      return normalized;
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MongoDB session persistence is required in production. Set VENOM_DASHBOARD_MONGODB_URI or MONGODB_URI."
    );
  }

  return "";
}

function getMongoDbName() {
  return String(process.env.VENOM_DASHBOARD_MONGODB_DB || "venom").trim();
}

function getMongoCollectionName() {
  return String(
    process.env.VENOM_DASHBOARD_SESSION_COLLECTION || "dashboard_sessions"
  ).trim();
}

function hasExpired(record: AuthSessionRecord) {
  const expiryMs = new Date(record.refreshExpiresAt).getTime();
  if (!Number.isFinite(expiryMs)) {
    return true;
  }
  return Date.now() >= expiryMs;
}

function pruneMemoryStore() {
  const nowMs = Date.now();
  for (const [sid, record] of memoryStore.entries()) {
    const expiryMs = new Date(record.refreshExpiresAt).getTime();
    const revokedMs = record.revokedAt
      ? new Date(record.revokedAt).getTime()
      : Number.NaN;
    const shouldDeleteByExpiry = Number.isFinite(expiryMs) && nowMs >= expiryMs;
    const shouldDeleteByRevocation =
      Number.isFinite(revokedMs) && nowMs - revokedMs > 7 * 24 * 60 * 60 * 1000;
    if (shouldDeleteByExpiry || shouldDeleteByRevocation) {
      memoryStore.delete(sid);
    }
  }
}

async function getMongoClient() {
  const uri = getMongoUri();
  if (!uri) {
    return null;
  }

  if (!globalThis.__venomDashboardMongoPromise) {
    const client = new MongoClient(uri, {
      maxPoolSize: 10,
      minPoolSize: 1
    });
    globalThis.__venomDashboardMongoPromise = client.connect();
  }
  return globalThis.__venomDashboardMongoPromise;
}

async function getSessionCollection() {
  const client = await getMongoClient();
  if (!client) {
    return null;
  }
  return client.db(getMongoDbName()).collection<AuthSessionRecord>(
    getMongoCollectionName()
  );
}

export async function saveSessionRecord(record: AuthSessionRecord) {
  const collection = await getSessionCollection();
  if (!collection) {
    pruneMemoryStore();
    memoryStore.set(record.sid, { ...record });
    return;
  }

  await collection.updateOne(
    { sid: record.sid },
    {
      $set: record
    },
    {
      upsert: true
    }
  );
}

export async function getSessionRecordById(sid: string) {
  if (!sid) {
    return null;
  }

  const collection = await getSessionCollection();
  if (!collection) {
    pruneMemoryStore();
    const record = memoryStore.get(sid);
    if (!record || hasExpired(record)) {
      memoryStore.delete(sid);
      return null;
    }
    return { ...record };
  }

  const record = await collection.findOne({ sid });
  if (!record) {
    return null;
  }

  if (hasExpired(record)) {
    await collection.deleteOne({ sid }).catch(() => undefined);
    return null;
  }
  return record;
}

export async function revokeSessionRecord(sid: string, reason = "revoked") {
  if (!sid) {
    return;
  }
  const revokedAt = new Date().toISOString();
  const collection = await getSessionCollection();
  if (!collection) {
    pruneMemoryStore();
    const existing = memoryStore.get(sid);
    if (!existing) {
      return;
    }
    memoryStore.set(sid, {
      ...existing,
      revokedAt,
      revokeReason: reason
    });
    return;
  }

  await collection.updateOne(
    { sid },
    {
      $set: {
        revokedAt,
        revokeReason: reason
      }
    }
  );
}

export async function updateSessionRecord(sid: string, update: SessionUpdate) {
  if (!sid) {
    return;
  }

  const collection = await getSessionCollection();
  if (!collection) {
    pruneMemoryStore();
    const existing = memoryStore.get(sid);
    if (!existing) {
      return;
    }
    memoryStore.set(sid, {
      ...existing,
      ...update
    });
    return;
  }

  await collection.updateOne(
    { sid },
    {
      $set: update
    }
  );
}
