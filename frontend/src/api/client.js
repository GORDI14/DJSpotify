const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL;

function getBaseUrl() {
  if (!API_BASE_URL) {
    throw new Error("Missing EXPO_PUBLIC_API_URL. Point it to your backend public URL.");
  }

  return API_BASE_URL.replace(/\/$/, "");
}

async function request(path, { method = "GET", body, sessionId } = {}) {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(sessionId ? { "x-smart-dj-session": sessionId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (response.status === 204) {
    return null;
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }

  return data;
}

export const api = {
  startMobileAuth: (returnUrl) =>
    request("/api/mobile-auth/start", {
      method: "POST",
      body: { returnUrl },
    }),
  getSession: (sessionId) => request("/api/me", { sessionId }),
  logout: (sessionId) =>
    request("/logout", {
      method: "POST",
      sessionId,
    }),
  getPlaylists: (sessionId) => request("/api/playlists", { sessionId }),
  getTracks: (sessionId, playlistId) => request(`/api/tracks/${playlistId}`, { sessionId }),
  generateDJSet: (sessionId, tracks, intensity) =>
    request("/api/generate", {
      method: "POST",
      sessionId,
      body: { tracks, intensity },
    }),
  getDevices: (sessionId) => request("/api/player/devices", { sessionId }),
  getPlaybackState: (sessionId) => request("/api/player/state", { sessionId }),
  transferPlayback: (sessionId, deviceId, play = false) =>
    request("/api/player/transfer", {
      method: "POST",
      sessionId,
      body: { deviceId, play },
    }),
  playUris: (sessionId, uris, deviceId) =>
    request("/api/player/play", {
      method: "POST",
      sessionId,
      body: { uris, deviceId },
    }),
  pausePlayback: (sessionId, deviceId) =>
    request("/api/player/pause", {
      method: "POST",
      sessionId,
      body: { deviceId },
    }),
  skipNext: (sessionId, deviceId) =>
    request("/api/player/next", {
      method: "POST",
      sessionId,
      body: { deviceId },
    }),
};
