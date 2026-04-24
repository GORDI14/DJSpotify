function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function normalize(value) {
  return String(value ?? "").toLowerCase().trim();
}

function stableUnitFromTrack(track) {
  const fingerprint = [
    normalize(track.name),
    normalize(track.artists),
    normalize(track.album),
    normalize(track.id ?? track.uri ?? track.originalIndex ?? ""),
  ].join("|");

  return (hashString(fingerprint) % 10_000) / 10_000;
}

function keywordWeight(text, positiveWords, negativeWords, amount) {
  const normalized = normalize(text);
  let weight = 0;

  for (const word of positiveWords) {
    if (normalized.includes(word)) {
      weight += amount;
    }
  }

  for (const word of negativeWords) {
    if (normalized.includes(word)) {
      weight -= amount;
    }
  }

  return weight;
}

function buildArtistProfiles(tracks) {
  const profiles = new Map();

  for (const track of tracks) {
    const artistKey = normalize(track.artists.split(",")[0]);
    if (!artistKey) {
      continue;
    }

    const durationSeconds = Math.max(60, (track.durationMs ?? 180000) / 1000);
    const unit = stableUnitFromTrack(track);
    const current = profiles.get(artistKey) ?? { count: 0, tempoSeed: 0, energySeed: 0 };

    current.count += 1;
    current.tempoSeed += 92 + (unit * 48) + clamp((240 - durationSeconds) * 0.08, -8, 12);
    current.energySeed += 0.38 + unit * 0.38;
    profiles.set(artistKey, current);
  }

  return profiles;
}

function estimateTempo(track, artistProfile) {
  const durationSeconds = Math.max(60, (track.durationMs ?? 180000) / 1000);
  const unit = stableUnitFromTrack(track);
  const title = `${track.name} ${track.album}`;

  let tempo = artistProfile
    ? artistProfile.tempoSeed / Math.max(1, artistProfile.count)
    : 95 + unit * 42;

  tempo += clamp((220 - durationSeconds) * 0.1, -10, 14);
  tempo += keywordWeight(title, ["remix", "club", "dance", "edit", "mix"], ["acoustic", "piano", "live", "demo"], 6);
  tempo += keywordWeight(title, ["feat.", "radio"], ["interlude", "intro", "outro"], 2.5);

  return Math.round(clamp(tempo, 72, 158));
}

function estimateEnergy(track, artistProfile) {
  const durationSeconds = Math.max(60, (track.durationMs ?? 180000) / 1000);
  const unit = stableUnitFromTrack(track);
  const title = `${track.name} ${track.album}`;

  let energy = artistProfile
    ? artistProfile.energySeed / Math.max(1, artistProfile.count)
    : 0.42 + unit * 0.32;

  energy += clamp((210 - durationSeconds) / 400, -0.08, 0.1);
  energy += keywordWeight(title, ["remix", "club", "dance", "anthem"], ["acoustic", "piano", "live", "demo"], 0.08);

  return Number(clamp(energy, 0.22, 0.92).toFixed(2));
}

function estimateDanceability(track, tempo, energy) {
  const title = `${track.name} ${track.album}`;
  let danceability = 0.45;

  if (tempo >= 100 && tempo <= 132) {
    danceability += 0.18;
  }

  danceability += (energy - 0.5) * 0.22;
  danceability += keywordWeight(title, ["dance", "remix", "club"], ["ballad", "acoustic", "live"], 0.06);

  return Number(clamp(danceability, 0.3, 0.9).toFixed(2));
}

function estimateValence(track) {
  const title = `${track.name} ${track.album}`;
  let valence = 0.5 + stableUnitFromTrack(track) * 0.2 - 0.1;
  valence += keywordWeight(title, ["love", "sun", "gold", "light"], ["dark", "sad", "cry", "lonely"], 0.08);
  return Number(clamp(valence, 0.15, 0.88).toFixed(2));
}

function estimateKey(track) {
  return hashString(`${track.name}|${track.artists}`) % 12;
}

export function estimateTrackFeatures(tracks) {
  const artistProfiles = buildArtistProfiles(tracks);

  return tracks.map((track) => {
    const artistKey = normalize(track.artists.split(",")[0]);
    const artistProfile = artistProfiles.get(artistKey);
    const tempo = estimateTempo(track, artistProfile);
    const energy = estimateEnergy(track, artistProfile);
    const danceability = estimateDanceability(track, tempo, energy);

    return {
      ...track,
      tempo,
      energy,
      danceability,
      valence: estimateValence(track),
      key: estimateKey(track),
      hasAudioFeatures: true,
      audioFeatureSource: "estimated",
      estimatedTempo: true,
      estimatedEnergy: true,
    };
  });
}
