import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import crypto from "node:crypto";
import { chooseNextTrack, chooseRandomSeedTrack, generateDJSet } from "./lib/djAlgorithm.js";
import { enrichTracksWithExternalAudioFeatures } from "./lib/externalAudioFeatures.js";
import { clearSession, createSession, getSession, updateSession } from "./lib/sessionStore.js";
import {
  addToPlaybackQueue,
  exchangeCodeForToken,
  getAudioFeaturesForTracks,
  getAvailableDevices,
  getCurrentUser,
  getPlaybackState,
  getPlaylistTracks,
  getPlaylistTrackTotal,
  getSavedTracks,
  getSavedTracksTotal,
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
  "playlist-read-collaborative",
  "user-library-read",
  "user-modify-playback-state",
  "user-read-playback-state",
  "user-read-currently-playing",
  "streaming",
].join(" ");

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
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

      return {
        ...track,
        tempo: feature?.tempo ?? null,
        energy: feature?.energy ?? null,
        danceability: feature?.danceability ?? null,
        valence: feature?.valence ?? null,
        key: feature?.key ?? null,
        hasAudioFeatures: Boolean(feature),
      };
    });
}

function getCachedTrackSource(session, sourceId) {
  const cachedSource = session?.cachedTrackSource;
  if (!cachedSource?.sourceId || cachedSource.sourceId !== sourceId || !Array.isArray(cachedSource.tracks)) {
    return null;
  }

  return cachedSource.tracks;
}

function uniqueTrackKey(track) {
  return track.id ?? track.uri;
}

function removeTrackByKey(tracks, targetTrack) {
  const targetKey = uniqueTrackKey(targetTrack);
  return tracks.filter((track) => uniqueTrackKey(track) !== targetKey);
}

function buildUpcomingPreview(currentTrack, upcomingTracks) {
  return upcomingTracks.slice(0, 5).map((track, index) => ({
    ...track,
    djPosition: index + 1,
  }));
}

function extendDynamicQueue(currentTrack, upcomingTracks, remainingTracks, intensity, desiredSize) {
  const nextUpcoming = [...upcomingTracks];
  let nextRemaining = [...remainingTracks];
  let referenceTrack = nextUpcoming[nextUpcoming.length - 1] ?? currentTrack ?? null;
  const totalLength = nextUpcoming.length + nextRemaining.length + (currentTrack ? 1 : 0);

  while (nextUpcoming.length < desiredSize && nextRemaining.length > 0) {
    const candidate = chooseNextTrack(referenceTrack, nextRemaining, intensity, nextUpcoming.length, totalLength);
    const selected = candidate ?? nextRemaining[0];
    nextUpcoming.push(selected);
    nextRemaining = removeTrackByKey(nextRemaining, selected);
    referenceTrack = selected;
  }

  return {
    upcomingTracks: nextUpcoming,
    remainingTracks: nextRemaining,
  };
}

function syncDynamicSessionState(djSession, currentTrackId) {
  if (!djSession) {
    return null;
  }

  let currentTrack = djSession.currentTrack ?? null;
  let upcomingTracks = [...(djSession.upcomingTracks ?? [])];
  let playedTrackIds = [...(djSession.playedTrackIds ?? [])];

  if (currentTrackId) {
    if (uniqueTrackKey(currentTrack) !== currentTrackId) {
      const promotedIndex = upcomingTracks.findIndex((track) => uniqueTrackKey(track) === currentTrackId);
      if (promotedIndex >= 0) {
        if (currentTrack) {
          playedTrackIds.push(uniqueTrackKey(currentTrack));
        }
        currentTrack = upcomingTracks[promotedIndex];
        upcomingTracks = upcomingTracks.slice(promotedIndex + 1);
      }
    }
  }

  const queueState = extendDynamicQueue(
    currentTrack,
    upcomingTracks,
    djSession.remainingTracks ?? [],
    djSession.intensity,
    djSession.previewSize ?? 5,
  );

  return {
    ...djSession,
    currentTrack,
    upcomingTracks: queueState.upcomingTracks,
    remainingTracks: queueState.remainingTracks,
    playedTrackIds,
    preview: buildUpcomingPreview(currentTrack, queueState.upcomingTracks),
  };
}

async function handlePlaylists(req, res) {
  const { session } = await getAuthorizedSession(req, res);
  const playlists = await getUserPlaylists(session.accessToken);
  const readablePlaylists = playlists.filter(
    (playlist) => playlist.ownerId === session.profile?.id || playlist.collaborative,
  );

  const playlistsWithVerifiedTotals = await Promise.all(
    readablePlaylists.map(async (playlist) => {
      try {
        const verifiedTotal = await getPlaylistTrackTotal(session.accessToken, playlist.id);
        return {
          ...playlist,
          totalTracks: verifiedTotal,
          sourceType: "playlist",
        };
      } catch {
        return {
          ...playlist,
          sourceType: "playlist",
        };
      }
    }),
  );

  let likedSongsEntry = null;
  try {
    likedSongsEntry = {
      id: "liked-songs",
      name: "Liked Songs",
      description: "Tracks saved in Your Music library",
      totalTracks: await getSavedTracksTotal(session.accessToken),
      image: null,
      owner: "Your Library",
      ownerId: session.profile?.id ?? null,
      collaborative: false,
      uri: null,
      sourceType: "saved",
    };
  } catch {
    likedSongsEntry = null;
  }

  res.json({
    playlists: likedSongsEntry ? [likedSongsEntry, ...playlistsWithVerifiedTotals] : playlistsWithVerifiedTotals,
  });
}

async function handlePlaylistTracks(req, res) {
  const { sessionId, session } = await getAuthorizedSession(req, res);
  let tracks;

  if (req.params.playlistId === "liked-songs") {
    tracks = await getSavedTracks(session.accessToken);
  } else {
    try {
      tracks = await getPlaylistTracks(session.accessToken, req.params.playlistId);
    } catch (error) {
      if (error.status === 403) {
        const readableError = new Error(
          "Spotify does not allow this app to read tracks from that playlist. Use a playlist you own or a collaborative one.",
        );
        readableError.status = 403;
        throw readableError;
      }
      throw error;
    }
  }
  let features = [];
  try {
    features = await getAudioFeaturesForTracks(
      session.accessToken,
      tracks.map((track) => track.id).filter(Boolean),
    );
  } catch (error) {
    if (error.status !== 403) {
      throw error;
    }
  }
  const enrichedTracks = combineTracksWithFeatures(tracks, features);

  updateSession(sessionId, {
    cachedTrackSource: {
      sourceId: req.params.playlistId,
      tracks: enrichedTracks,
      updatedAt: Date.now(),
    },
  });

  res.json({
    tracks: enrichedTracks,
    audioFeaturesAvailable: features.length > 0,
  });
}

async function handleGenerate(req, res) {
  const { tracks = [], sourceId = null, intensity = "medium" } = req.body;

  let sourceTracks = Array.isArray(tracks) ? tracks : [];
  if (sourceId) {
    const sessionId = getSessionId(req, res);
    const session = getSession(sessionId);
    const cachedSource = session?.cachedTrackSource;
    if (cachedSource?.sourceId === sourceId && Array.isArray(cachedSource.tracks)) {
      sourceTracks = cachedSource.tracks;
    }
  }

  let resolvedTracks = sourceTracks;
  let externalAudioFeatures = {
    provider: "none",
    enrichedCount: 0,
    attemptedLookups: 0,
    lookupLimitApplied: false,
  };

  const needsFallbackFeatures = resolvedTracks.some(
    (track) => !Number.isFinite(track.tempo) || !Number.isFinite(track.energy) || !Number.isFinite(track.danceability),
  );

  if (needsFallbackFeatures) {
    const fallback = await enrichTracksWithExternalAudioFeatures(resolvedTracks);
    resolvedTracks = fallback.tracks;
    externalAudioFeatures = fallback.meta;

    if (sourceId) {
      const sessionId = getSessionId(req, res);
      const session = getSession(sessionId);
      const cachedSource = session?.cachedTrackSource;
      if (cachedSource?.sourceId === sourceId) {
        updateSession(sessionId, {
          cachedTrackSource: {
            ...cachedSource,
            tracks: resolvedTracks,
            updatedAt: Date.now(),
          },
        });
      }
    }
  }

  const generatedSet = generateDJSet(resolvedTracks, intensity);
  res.json({
    tracks: generatedSet,
    intensity,
    externalAudioFeatures,
  });
}

async function resolveSourceTracksForDjSession(req, res, sourceId) {
  const { sessionId, session } = await getAuthorizedSession(req, res);
  const cachedTracks = getCachedTrackSource(session, sourceId);
  if (!cachedTracks?.length) {
    const error = new Error("Load the playlist tracks before starting Smart DJ playback.");
    error.status = 400;
    throw error;
  }

  let resolvedTracks = cachedTracks;
  let externalAudioFeatures = {
    provider: "none",
    enrichedCount: 0,
    attemptedLookups: 0,
    lookupLimitApplied: false,
  };

  const needsFallbackFeatures = resolvedTracks.some(
    (track) => !Number.isFinite(track.tempo) || !Number.isFinite(track.energy) || !Number.isFinite(track.danceability),
  );

  if (needsFallbackFeatures) {
    const fallback = await enrichTracksWithExternalAudioFeatures(resolvedTracks);
    resolvedTracks = fallback.tracks;
    externalAudioFeatures = fallback.meta;
    updateSession(sessionId, {
      cachedTrackSource: {
        sourceId,
        tracks: resolvedTracks,
        updatedAt: Date.now(),
      },
    });
  }

  return { sessionId, session: getSession(sessionId), resolvedTracks, externalAudioFeatures };
}

async function queueTracksOnDevice(accessToken, deviceId, tracks) {
  for (const track of tracks) {
    if (track?.uri) {
      await addToPlaybackQueue(accessToken, track.uri, deviceId);
    }
  }
}

app.post("/api/dj/session/start", async (req, res, next) => {
  try {
    const { sourceId, intensity = "medium", deviceId } = req.body;
    if (!sourceId || !deviceId) {
      const error = new Error("Missing sourceId or deviceId.");
      error.status = 400;
      throw error;
    }

    const { sessionId, session, resolvedTracks, externalAudioFeatures } = await resolveSourceTracksForDjSession(req, res, sourceId);
    if (!resolvedTracks.length) {
      const error = new Error("No playable tracks available for Smart DJ.");
      error.status = 400;
      throw error;
    }

    const seedTrack = chooseRandomSeedTrack(resolvedTracks);
    const remainingTracks = removeTrackByKey(resolvedTracks, seedTrack);
    const queueState = extendDynamicQueue(seedTrack, [], remainingTracks, intensity, 5);

    await transferPlayback(session.accessToken, deviceId, false);
    await startPlayback(session.accessToken, deviceId, [seedTrack.uri]);
    await queueTracksOnDevice(session.accessToken, deviceId, queueState.upcomingTracks);

    const djSession = {
      sourceId,
      intensity,
      deviceId,
      currentTrack: seedTrack,
      upcomingTracks: queueState.upcomingTracks,
      remainingTracks: queueState.remainingTracks,
      previewSize: 5,
      playedTrackIds: [uniqueTrackKey(seedTrack)],
      lastQueueRefreshAt: Date.now(),
    };

    updateSession(sessionId, {
      djSession,
    });

    res.json({
      started: true,
      currentTrack: seedTrack,
      preview: buildUpcomingPreview(seedTrack, queueState.upcomingTracks),
      externalAudioFeatures,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/dj/session/sync", async (req, res, next) => {
  try {
    const { sessionId, session } = await getAuthorizedSession(req, res);
    const djSession = session?.djSession;
    if (!djSession) {
      const error = new Error("No Smart DJ session is active.");
      error.status = 400;
      throw error;
    }

    const playback = await getPlaybackState(session.accessToken);
    const currentTrackId = playback?.item?.id ?? playback?.item?.uri ?? null;
    const nextSession = syncDynamicSessionState(djSession, currentTrackId);

    const previousUpcomingKeys = new Set((djSession.upcomingTracks ?? []).map((track) => uniqueTrackKey(track)));
    const newTracksToQueue = (nextSession.upcomingTracks ?? []).filter(
      (track) => !previousUpcomingKeys.has(uniqueTrackKey(track)),
    );

    if (newTracksToQueue.length) {
      await queueTracksOnDevice(session.accessToken, djSession.deviceId, newTracksToQueue);
    }

    updateSession(sessionId, {
      djSession: {
        ...nextSession,
        lastQueueRefreshAt: Date.now(),
      },
    });

    res.json({
      currentTrack: nextSession.currentTrack,
      preview: nextSession.preview,
      playbackState: playback,
    });
  } catch (error) {
    next(error);
  }
});

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
