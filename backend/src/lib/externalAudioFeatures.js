const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2";
const ACOUSTICBRAINZ_BASE = "https://acousticbrainz.org/api/v1";
const MUSICBRAINZ_MIN_INTERVAL_MS = 1100;
const ACOUSTICBRAINZ_BULK_LIMIT = 25;
const DEFAULT_LOOKUP_LIMIT = 40;

const recordingIdCache = new Map();
const featureCache = new Map();

let lastMusicBrainzRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildFeatureCacheKey(track) {
  if (track.isrc) {
    return `isrc:${track.isrc}`;
  }

  if (track.id) {
    return `spotify:${track.id}`;
  }

  return `name:${normalizeText(track.name)}|artist:${normalizeText(track.artists)}`;
}

function pickBestRecording(recordings, track) {
  if (!Array.isArray(recordings) || !recordings.length) {
    return null;
  }

  const targetTitle = normalizeText(track.name);
  const targetArtist = normalizeText(track.artists.split(",")[0]);

  const scored = recordings.map((recording) => {
    const title = normalizeText(recording.title);
    const artist = normalizeText(recording["artist-credit"]?.[0]?.name ?? recording["artist-credit"]?.[0]?.artist?.name);
    let score = 0;

    if (title && title === targetTitle) {
      score += 3;
    }

    if (artist && targetArtist && artist === targetArtist) {
      score += 2;
    }

    if (typeof recording.score === "number") {
      score += recording.score / 100;
    }

    return { recording, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.recording ?? recordings[0];
}

async function resolveMusicBrainzRecordingId(track) {
  const isrc = track.isrc;
  if (!isrc) {
    return null;
  }

  if (recordingIdCache.has(isrc)) {
    return recordingIdCache.get(isrc);
  }

  const waitTime = Math.max(0, MUSICBRAINZ_MIN_INTERVAL_MS - (Date.now() - lastMusicBrainzRequestAt));
  if (waitTime > 0) {
    await sleep(waitTime);
  }

  lastMusicBrainzRequestAt = Date.now();

  const response = await fetch(`${MUSICBRAINZ_BASE}/isrc/${encodeURIComponent(isrc)}?inc=recordings&fmt=json`, {
    headers: {
      "User-Agent": "SmartDJSpotify/1.0 (Render backend fallback audio lookup)",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    recordingIdCache.set(isrc, null);
    return null;
  }

  const data = await response.json();
  const recording = pickBestRecording(data.recordings ?? [], track);
  const recordingId = recording?.id ?? null;
  recordingIdCache.set(isrc, recordingId);
  return recordingId;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function estimateEnergyFromLowLevel(lowLevel) {
  const beatsLoudness = lowLevel?.rhythm?.beats_loudness?.mean;
  const averageLoudness = lowLevel?.lowlevel?.average_loudness;
  const dynamicComplexity = lowLevel?.lowlevel?.dynamic_complexity;

  if (Number.isFinite(beatsLoudness)) {
    return clamp(beatsLoudness / 0.12, 0.15, 0.98);
  }

  if (Number.isFinite(averageLoudness)) {
    return clamp(averageLoudness / 0.9, 0.15, 0.98);
  }

  if (Number.isFinite(dynamicComplexity)) {
    return clamp(dynamicComplexity / 8, 0.15, 0.98);
  }

  return null;
}

async function fetchAcousticBrainzFeatures(recordingIds) {
  if (!recordingIds.length) {
    return new Map();
  }

  const featureMap = new Map();
  const requests = chunk(recordingIds, ACOUSTICBRAINZ_BULK_LIMIT);

  for (const batch of requests) {
    const params = new URLSearchParams({
      recording_ids: batch.join(";"),
      features: [
        "rhythm.bpm",
        "rhythm.beats_loudness.mean",
        "rhythm.danceability",
        "lowlevel.average_loudness",
        "lowlevel.dynamic_complexity",
        "tonal.key_key",
        "tonal.key_scale",
      ].join(";"),
    });

    const response = await fetch(`${ACOUSTICBRAINZ_BASE}/low-level?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      continue;
    }

    const data = await response.json();
    for (const [recordingId, payload] of Object.entries(data)) {
      if (recordingId === "mbid_mapping") {
        continue;
      }

      const lowLevel = payload?.["0"] ?? payload?.[0] ?? payload;
      const tempo = lowLevel?.rhythm?.bpm;
      const danceability = lowLevel?.rhythm?.danceability;
      const energy = estimateEnergyFromLowLevel(lowLevel);
      const keyName = lowLevel?.tonal?.key_key;
      const keyScale = lowLevel?.tonal?.key_scale;

      featureMap.set(recordingId.toLowerCase(), {
        tempo: Number.isFinite(tempo) ? tempo : null,
        energy,
        danceability: Number.isFinite(danceability) ? clamp(danceability, 0, 1) : null,
        keyName: keyName ?? null,
        keyScale: keyScale ?? null,
        provider: "acousticbrainz",
        estimatedEnergy: energy != null,
      });
    }
  }

  return featureMap;
}

export async function enrichTracksWithExternalAudioFeatures(tracks) {
  const lookupLimit = Number(process.env.EXTERNAL_FEATURE_LOOKUP_LIMIT ?? DEFAULT_LOOKUP_LIMIT);
  const nextTracks = tracks.map((track) => ({ ...track }));

  const candidates = nextTracks.filter(
    (track) =>
      (!Number.isFinite(track.tempo) || !Number.isFinite(track.energy) || !Number.isFinite(track.danceability)) &&
      !track.isLocal &&
      track.isrc,
  );

  const limitedCandidates = candidates.slice(0, Math.max(0, lookupLimit));
  const candidatesWithCache = [];
  const unresolved = [];

  for (const track of limitedCandidates) {
    const cacheKey = buildFeatureCacheKey(track);
    const cached = featureCache.get(cacheKey);
    if (cached) {
      candidatesWithCache.push({ track, features: cached });
    } else {
      unresolved.push(track);
    }
  }

  const recordingAssignments = [];
  for (const track of unresolved) {
    const recordingId = await resolveMusicBrainzRecordingId(track);
    if (recordingId) {
      recordingAssignments.push({ track, recordingId });
    }
  }

  const acousticBrainzFeatures = await fetchAcousticBrainzFeatures(
    [...new Set(recordingAssignments.map(({ recordingId }) => recordingId.toLowerCase()))],
  );

  for (const { track, recordingId } of recordingAssignments) {
    const features = acousticBrainzFeatures.get(recordingId.toLowerCase());
    if (features) {
      featureCache.set(buildFeatureCacheKey(track), features);
      candidatesWithCache.push({ track, features });
    }
  }

  let enrichedCount = 0;
  for (const { track, features } of candidatesWithCache) {
    const target = nextTracks.find((item) => item.id === track.id || item.uri === track.uri);
    if (!target || !features) {
      continue;
    }

    const hadBefore = Number.isFinite(target.tempo) || Number.isFinite(target.energy);

    target.tempo = Number.isFinite(target.tempo) ? target.tempo : features.tempo;
    target.energy = Number.isFinite(target.energy) ? target.energy : features.energy;
    target.danceability = Number.isFinite(target.danceability) ? target.danceability : features.danceability;
    target.externalFeatureProvider = features.provider;
    target.estimatedEnergy = Boolean(features.estimatedEnergy);
    target.hasAudioFeatures =
      target.hasAudioFeatures || Number.isFinite(target.tempo) || Number.isFinite(target.energy) || Number.isFinite(target.danceability);

    if (!hadBefore && (Number.isFinite(target.tempo) || Number.isFinite(target.energy))) {
      enrichedCount += 1;
    }
  }

  return {
    tracks: nextTracks,
    meta: {
      provider: enrichedCount > 0 ? "acousticbrainz" : "none",
      enrichedCount,
      attemptedLookups: limitedCandidates.length,
      lookupLimitApplied: candidates.length > limitedCandidates.length,
    },
  };
}
