const SPOTIFY_API_BASE = "https://api.spotify.com/v1";
const SPOTIFY_ACCOUNTS_BASE = "https://accounts.spotify.com";

function createAuthHeader(clientId, clientSecret) {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  return `Basic ${credentials}`;
}

async function parseSpotifyResponse(response) {
  if (response.status === 204) {
    return null;
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = new Error(data?.error?.message ?? data?.error_description ?? "Spotify request failed");
    error.status = response.status;
    error.payload = data;
    throw error;
  }

  return data;
}

export async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    code,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
    method: "POST",
    headers: {
      Authorization: createAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  return parseSpotifyResponse(response);
}

export async function refreshAccessToken({ refreshToken, clientId, clientSecret }) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(`${SPOTIFY_ACCOUNTS_BASE}/api/token`, {
    method: "POST",
    headers: {
      Authorization: createAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  return parseSpotifyResponse(response);
}

export async function spotifyFetch(accessToken, path, options = {}) {
  const response = await fetch(`${SPOTIFY_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  return parseSpotifyResponse(response);
}

export async function getCurrentUser(accessToken) {
  return spotifyFetch(accessToken, "/me");
}

async function resolvePlaylistTrackTotal(accessToken, playlist) {
  const directTotal = playlist.tracks?.total;
  if (Number.isFinite(directTotal) && directTotal > 0) {
    return directTotal;
  }

  const tracksHref = playlist.tracks?.href;
  if (!tracksHref) {
    return Number.isFinite(directTotal) ? directTotal : 0;
  }

  try {
    const totalResponse = await spotifyFetch(
      accessToken,
      tracksHref.replace(SPOTIFY_API_BASE, "") + (tracksHref.includes("?") ? "&limit=1" : "?limit=1"),
    );
    return totalResponse?.total ?? directTotal ?? 0;
  } catch {
    return directTotal ?? 0;
  }
}

export async function getUserPlaylists(accessToken) {
  let nextPath = "/me/playlists?limit=50";
  const playlists = [];

  while (nextPath) {
    const page = await spotifyFetch(accessToken, nextPath.replace(SPOTIFY_API_BASE, ""));
    playlists.push(...page.items);
    nextPath = page.next;
  }

  return Promise.all(
    playlists.map(async (playlist) => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      totalTracks: await resolvePlaylistTrackTotal(accessToken, playlist),
      image: playlist.images?.[0]?.url ?? null,
      owner: playlist.owner?.display_name ?? playlist.owner?.id ?? "Spotify user",
      uri: playlist.uri,
    })),
  );
}

function mapPlaylistItems(items) {
  return items
    .map((item, index) => ({
      track: item.item ?? item.track,
      isLocal: Boolean(item.is_local),
      originalIndex: index,
    }))
    .filter(({ track }) => track && track.type === "track" && (track.id || track.uri))
    .map(({ track, originalIndex, isLocal }) => ({
      id: track.id ?? null,
      uri: track.uri,
      name: track.name,
      artists: Array.isArray(track.artists) ? track.artists.map((artist) => artist.name).join(", ") : "Unknown artist",
      album: track.album?.name ?? "Unknown album",
      durationMs: track.duration_ms,
      image: track.album?.images?.[1]?.url ?? track.album?.images?.[0]?.url ?? null,
      isLocal,
      originalIndex,
    }));
}

async function fetchPlaylistItems(accessToken, initialPath) {
  let nextPath = initialPath;
  const items = [];

  while (nextPath) {
    const page = await spotifyFetch(accessToken, nextPath.replace(SPOTIFY_API_BASE, ""));
    items.push(...(page.items ?? []));
    nextPath = page.next;
  }

  return mapPlaylistItems(items);
}

export async function getPlaylistTracks(accessToken, playlistId) {
  const modernItemsPath = `/playlists/${playlistId}/items?limit=100&market=from_token&additional_types=track`;
  const legacyTracksPath = `/playlists/${playlistId}/tracks?limit=100&market=from_token&additional_types=track`;

  const modernTracks = await fetchPlaylistItems(accessToken, modernItemsPath);
  if (modernTracks.length > 0) {
    return modernTracks;
  }

  return fetchPlaylistItems(accessToken, legacyTracksPath);
}

export async function getAudioFeaturesForTracks(accessToken, trackIds) {
  const validTrackIds = trackIds.filter(Boolean);
  if (!validTrackIds.length) {
    return [];
  }

  const chunks = [];
  for (let index = 0; index < validTrackIds.length; index += 100) {
    chunks.push(validTrackIds.slice(index, index + 100));
  }

  const results = await Promise.all(
    chunks.map((chunk) =>
      spotifyFetch(accessToken, `/audio-features?ids=${chunk.join(",")}`),
    ),
  );

  return results.flatMap((result) => result.audio_features ?? []);
}

export async function transferPlayback(accessToken, deviceId, shouldPlay = false) {
  return spotifyFetch(accessToken, "/me/player", {
    method: "PUT",
    body: JSON.stringify({
      device_ids: [deviceId],
      play: shouldPlay,
    }),
  });
}

export async function startPlayback(accessToken, deviceId, uris) {
  return spotifyFetch(accessToken, `/me/player/play?device_id=${deviceId}`, {
    method: "PUT",
    body: JSON.stringify({ uris }),
  });
}

export async function pausePlayback(accessToken, deviceId) {
  return spotifyFetch(accessToken, `/me/player/pause?device_id=${deviceId}`, {
    method: "PUT",
  });
}

export async function skipToNext(accessToken, deviceId) {
  return spotifyFetch(accessToken, `/me/player/next?device_id=${deviceId}`, {
    method: "POST",
  });
}

export async function getPlaybackState(accessToken) {
  return spotifyFetch(accessToken, "/me/player");
}

export async function getAvailableDevices(accessToken) {
  const response = await spotifyFetch(accessToken, "/me/player/devices");
  return response.devices ?? [];
}
