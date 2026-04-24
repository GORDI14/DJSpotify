import crypto from "node:crypto";

const sessions = new Map();

export function createSession() {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { createdAt: Date.now() });
  return sessionId;
}

export function getSession(sessionId) {
  if (!sessionId) {
    return null;
  }

  return sessions.get(sessionId) ?? null;
}

export function updateSession(sessionId, payload) {
  const current = getSession(sessionId) ?? { createdAt: Date.now() };
  const nextValue = { ...current, ...payload, updatedAt: Date.now() };
  sessions.set(sessionId, nextValue);
  return nextValue;
}

export function clearSession(sessionId) {
  if (sessionId) {
    sessions.delete(sessionId);
  }
}
