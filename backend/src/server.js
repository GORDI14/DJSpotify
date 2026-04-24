import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import crypto from "node:crypto";
import { generateDJSet } from "./lib/djAlgorithm.js";
import { clearSession, createSession, getSession, updateSession } from "./lib/sessionStore.js";
import {
  exchangeCodeForToken,
  getAudioFeaturesForTracks,
  getAvailableDevices,
  getCurrentUser,
  getPlaybackState,
  getPlaylistTracks,
  getUserPlaylists,
  pausePlayback,
  refreshAccessToken,
  skipToNext,
  startPlayback,
  transferPlayback,
} from "./lib/spotifyApi.js";

dotenv.config({ path: "../.env" });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT ?? 3001);
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://127.0.0.1:5173";
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:3001/callback";
const BACKEND_PUBLIC_URL = process.env.BACKEND_PUBLIC_URL ?? "http://127.0.0.1:3001";
const MOBILE_SPOTIFY_REDIRECT_URI =
  process.env.MOBILE_SPOTIFY_REDIRECT_URI ?? `${BACKEND_PUBLIC_URL}/mobile/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET ?? "smart-dj-session-secret";
const SCOPES = [
  "user-read-private",
  "user-read-email",
  "playlist-read-private",
  "user-modify-playback-state",
  "user-read-playback-state",
  "streaming",
].join(" ");

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

function requireConfig() {
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    const error = new Error("Missing Spotify credentials. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to .env.");
    error.status = 500;
    throw error;
  }
}

function signState(sessionId) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(sessionId).digest("hex");
}

function getHeaderSessionId(req) {
  const raw = req.header("x-smart-dj-session");
  return raw ? String(raw) : null;
}

function getSessionId(req, res) {
  let sessionId = getHeaderSessionId(req) ?? req.cookies.smart_dj_session;

  if (!sessionId || !getSession(sessionId)) {
    // Tokens live only in memory, so we tie them to a short-lived cookie session.
    sessionId = createSession();
    if (!getHeaderSessionId(req)) {
      res.cookie("smart_dj_session", sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 1000 * 60 * 60 * 8,
      });
    }
  }

  return sessionId;
}

async function getAuthorizedSession(req, res) {
  requireConfig();

  const sessionId = getSessionId(req, res);
  const session = getSession(sessionId);

  if (!session?.accessToken) {
    const error = new Error("No Spotify session found. Please log in again.");
    error.status = 401;
    throw error;
  }

  if (session.expiresAt && Date.now() > session.expiresAt - 60_000 && session.refreshToken) {
    const refreshed = await refreshAccessToken({
      refreshToken: session.refreshToken,
      clientId: SPOTIFY_CLIENT_ID,
      clientSecret: SPOTIFY_CLIENT_SECRET,
    });

    updateSession(sessionId, {
      accessToken: refreshed.access_token,
      expiresAt: Date.now() + refreshed.expires_in * 1000,
      refreshToken: refreshed.refresh_token ?? session.refreshToken,
    });
  }

  return { sessionId, session: getSession(sessionId) };
}

function combineTracksWithFeatures(tracks, features) {
  const featureMap = new Map(features.filter(Boolean).map((feature) => [feature.id, feature]));

  return tracks
    .map((track) => {
      const feature = featureMap.get(track.id);
      if (!feature) {
        return null;
      }

      return {
        ...track,
        tempo: feature.tempo,
        energy: feature.energy,
        danceability: feature.danceability,
        valence: feature.valence,
        key: feature.key,
      };
    })
    .filter(Boolean);
}

async function handlePlaylists(req, res) {
  const { session } = await getAuthorizedSession(req, res);
  const playlists = await getUserPlaylists(session.accessToken);
  res.json({ playlists });
}

async function handlePlaylistTracks(req, res) {
  const { session } = await getAuthorizedSession(req, res);
  const tracks = await getPlaylistTracks(session.accessToken, req.params.playlistId);
  const features = await getAudioFeaturesForTracks(
    session.accessToken,
    tracks.map((track) => track.id),
  );
  const enrichedTracks = combineTracksWithFeatures(tracks, features);

  res.json({ tracks: enrichedTracks });
}

async function handleGenerate(req, res) {
  const { tracks = [], intensity = "medium" } = req.body;
  const generatedSet = generateDJSet(tracks, intensity);
  res.json({ tracks: generatedSet, intensity });
}

function redirectToMobileApp(returnUrl, query) {
  const url = new URL(returnUrl);

  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/login", (req, res, next) => {
  try {
    requireConfig();
    const sessionId = getSessionId(req, res);
    const state = `${sessionId}.${signState(sessionId)}`;
    const params = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: "code",
      redirect_uri: SPOTIFY_REDIRECT_URI,
      scope: SCOPES,
      state,
      show_dialog: "true",
    });

    res.redirect(`https://accounts.spotify.com/authorize?${params.toString()}`);
  } catch (error) {
    next(error);
  }
});

app.get("/callback", async (req, res, next) => {
  try {
    requireConfig();

    const { code, state, error } = req.query;
    if (error) {
      return res.redirect(`${FRONTEND_URL}/?error=${encodeURIComponent(error)}`);
    }

    const [sessionId, signature] = String(state ?? "").split(".");
    if (!sessionId || signature !== signState(sessionId)) {
      return res.redirect(`${FRONTEND_URL}/?error=${encodeURIComponent("Invalid login state")}`);
    }

    const tokenData = await exchangeCodeForToken({
      code: String(code),
      clientId: SPOTIFY_CLIENT_ID,
      clientSecret: SPOTIFY_CLIENT_SECRET,
      redirectUri: SPOTIFY_REDIRECT_URI,
    });
    const profile = await getCurrentUser(tokenData.access_token);

    updateSession(sessionId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      profile: {
        id: profile.id,
        displayName: profile.display_name,
        email: profile.email,
        product: profile.product,
      },
    });

    res.cookie("smart_dj_session", sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      maxAge: 1000 * 60 * 60 * 8,
    });
    res.redirect(`${FRONTEND_URL}/dashboard`);
  } catch (error) {
    next(error);
  }
});

app.post("/logout", (req, res) => {
  clearSession(getHeaderSessionId(req) ?? req.cookies.smart_dj_session);
  res.clearCookie("smart_dj_session");
  res.status(204).send();
});

app.post("/api/mobile-auth/start", (req, res, next) => {
  try {
    requireConfig();

    const { returnUrl } = req.body;
    if (!returnUrl) {
      const error = new Error("Missing mobile return URL.");
      error.status = 400;
      throw error;
    }

    const sessionId = createSession();
    const authState = `${sessionId}.${signState(sessionId)}`;

    updateSession(sessionId, {
      appReturnUrl: returnUrl,
      authState,
      authMode: "mobile",
    });

    const params = new URLSearchParams({
      client_id: SPOTIFY_CLIENT_ID,
      response_type: "code",
      redirect_uri: MOBILE_SPOTIFY_REDIRECT_URI,
      scope: SCOPES,
      state: authState,
      show_dialog: "true",
    });

    res.json({
      authUrl: `https://accounts.spotify.com/authorize?${params.toString()}`,
      sessionId,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/mobile/callback", async (req, res, next) => {
  try {
    requireConfig();

    const { code, state, error } = req.query;
    const [sessionId, signature] = String(state ?? "").split(".");
    const session = getSession(sessionId);
    const returnUrl = session?.appReturnUrl;

    if (!returnUrl) {
      const callbackError = new Error("Missing mobile session return URL.");
      callbackError.status = 400;
      throw callbackError;
    }

    if (error) {
      return res.redirect(
        redirectToMobileApp(returnUrl, {
          status: "error",
          message: error,
        }),
      );
    }

    if (!sessionId || signature !== signState(sessionId)) {
      return res.redirect(
        redirectToMobileApp(returnUrl, {
          status: "error",
          message: "Invalid login state",
        }),
      );
    }

    const tokenData = await exchangeCodeForToken({
      code: String(code),
      clientId: SPOTIFY_CLIENT_ID,
      clientSecret: SPOTIFY_CLIENT_SECRET,
      redirectUri: MOBILE_SPOTIFY_REDIRECT_URI,
    });
    const profile = await getCurrentUser(tokenData.access_token);

    updateSession(sessionId, {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000,
      profile: {
        id: profile.id,
        displayName: profile.display_name,
        email: profile.email,
        product: profile.product,
      },
    });

    return res.redirect(
      redirectToMobileApp(returnUrl, {
        status: "success",
        sessionId,
      }),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/me", async (req, res, next) => {
  try {
    const { session } = await getAuthorizedSession(req, res);
    res.json({
      authenticated: true,
      profile: session.profile,
      accessToken: session.accessToken,
    });
  } catch (error) {
    if (error.status === 401) {
      return res.json({ authenticated: false, profile: null, accessToken: null });
    }
    next(error);
  }
});

app.get("/api/playlists", async (req, res, next) => {
  try {
    await handlePlaylists(req, res);
  } catch (error) {
    next(error);
  }
});

app.get("/playlists", async (req, res, next) => {
  try {
    await handlePlaylists(req, res);
  } catch (error) {
    next(error);
  }
});

app.get("/api/tracks/:playlistId", async (req, res, next) => {
  try {
    await handlePlaylistTracks(req, res);
  } catch (error) {
    next(error);
  }
});

app.get("/tracks/:playlistId", async (req, res, next) => {
  try {
    await handlePlaylistTracks(req, res);
  } catch (error) {
    next(error);
  }
});

app.post("/api/generate", async (req, res, next) => {
  try {
    await handleGenerate(req, res);
  } catch (error) {
    next(error);
  }
});

app.post("/generate", async (req, res, next) => {
  try {
    await handleGenerate(req, res);
  } catch (error) {
    next(error);
  }
});

app.get("/api/player/token", async (req, res, next) => {
  try {
    const { session } = await getAuthorizedSession(req, res);
    res.json({ accessToken: session.accessToken });
  } catch (error) {
    next(error);
  }
});

app.get("/api/player/state", async (req, res, next) => {
  try {
    const { session } = await getAuthorizedSession(req, res);
    const state = await getPlaybackState(session.accessToken);
    res.json({ state });
  } catch (error) {
    next(error);
  }
});

app.get("/api/player/devices", async (req, res, next) => {
  try {
    const { session } = await getAuthorizedSession(req, res);
    const devices = await getAvailableDevices(session.accessToken);
    res.json({ devices });
  } catch (error) {
    next(error);
  }
});

app.post("/api/player/transfer", async (req, res, next) => {
  try {
    const { deviceId, play = false } = req.body;
    const { session } = await getAuthorizedSession(req, res);
    await transferPlayback(session.accessToken, deviceId, play);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/player/play", async (req, res, next) => {
  try {
    const { deviceId, uris } = req.body;
    const { session } = await getAuthorizedSession(req, res);
    await startPlayback(session.accessToken, deviceId, uris);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/player/pause", async (req, res, next) => {
  try {
    const { deviceId } = req.body;
    const { session } = await getAuthorizedSession(req, res);
    await pausePlayback(session.accessToken, deviceId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/player/next", async (req, res, next) => {
  try {
    const { deviceId } = req.body;
    const { session } = await getAuthorizedSession(req, res);
    await skipToNext(session.accessToken, deviceId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.status ?? 500;
  res.status(status).json({
    error: error.message ?? "Unexpected server error",
    details: error.payload ?? null,
  });
});

app.listen(PORT, () => {
  console.log(`Smart DJ backend listening on http://127.0.0.1:${PORT}`);
});
