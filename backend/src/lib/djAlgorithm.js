function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function splitIntoSections(tracks) {
  const total = tracks.length;
  const introEnd = Math.max(1, Math.floor(total * 0.25));
  const peakEnd = Math.max(introEnd + 1, Math.floor(total * 0.7));

  return tracks.map((track, index) => {
    if (index < introEnd) {
      return { ...track, targetPhase: "intro", targetCurve: index / Math.max(1, introEnd - 1) };
    }

    if (index < peakEnd) {
      return {
        ...track,
        targetPhase: "build",
        targetCurve: (index - introEnd) / Math.max(1, peakEnd - introEnd - 1),
      };
    }

    return {
      ...track,
      targetPhase: "outro",
      targetCurve: (index - peakEnd) / Math.max(1, total - peakEnd - 1),
    };
  });
}

function buildEnergyTargets(length, intensityMultiplier) {
  const skeleton = Array.from({ length }, (_, index) => ({ index }));

  return splitIntoSections(skeleton).map((slot) => {
    if (slot.targetPhase === "intro") {
      return 0.25 + slot.targetCurve * 0.3 * intensityMultiplier;
    }

    if (slot.targetPhase === "build") {
      return 0.45 + slot.targetCurve * 0.45 * intensityMultiplier;
    }

    return clamp(0.7 - slot.targetCurve * 0.3, 0.25, 0.85);
  });
}

function scoreCandidate(previousTrack, candidate, targetEnergy, bpmTolerance) {
  const bpmGap = previousTrack ? Math.abs(candidate.tempo - previousTrack.tempo) : 0;
  const energyGap = Math.abs(candidate.energy - targetEnergy);
  const danceabilityBoost = 1 - Math.abs(candidate.danceability - 0.7);
  const bpmPenalty = bpmGap > bpmTolerance ? (bpmGap - bpmTolerance) * 3 : bpmGap * 0.5;
  const keyPenalty = previousTrack && candidate.key === previousTrack.key ? 0 : 0.25;

  return energyGap * 4 + bpmPenalty + keyPenalty - danceabilityBoost;
}

function annotateOrderedTracks(tracks, buildHint) {
  return tracks.map((track, index) => ({
    ...track,
    djPosition: index + 1,
    transitionHint: buildHint(track, index),
  }));
}

function getIntensityMode(intensity) {
  const intensityMap = {
    low: { multiplier: 0.85, bpmTolerance: 10 },
    medium: { multiplier: 1, bpmTolerance: 15 },
    high: { multiplier: 1.15, bpmTolerance: 18 },
  };

  return intensityMap[intensity] ?? intensityMap.medium;
}

function sampleRandomCandidates(tracks, sampleSize) {
  if (tracks.length <= sampleSize) {
    return [...tracks];
  }

  const shuffled = [...tracks];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled.slice(0, sampleSize);
}

function scoreCandidateWithFallback(previousTrack, candidate, targetEnergy, bpmTolerance) {
  const hasFullFeatures =
    Number.isFinite(candidate.tempo) && Number.isFinite(candidate.energy) && Number.isFinite(candidate.danceability);

  if (previousTrack && hasFullFeatures) {
    return scoreCandidate(previousTrack, candidate, targetEnergy, bpmTolerance);
  }

  return scoreFallbackCandidate(previousTrack, candidate);
}

function scoreFallbackCandidate(previousTrack, candidate) {
  const durationGap = previousTrack ? Math.abs((candidate.durationMs ?? 0) - (previousTrack.durationMs ?? 0)) / 1000 : 0;
  const indexPenalty = Math.abs((candidate.originalIndex ?? 0) - (previousTrack?.originalIndex ?? 0)) * 0.08;
  const localPenalty = candidate.isLocal ? 5 : 0;
  const repeatedArtistPenalty =
    previousTrack && previousTrack.artists && candidate.artists && previousTrack.artists === candidate.artists ? 1.5 : 0;

  return durationGap * 0.02 + indexPenalty + localPenalty + repeatedArtistPenalty;
}

export function chooseRandomSeedTrack(tracks) {
  if (!tracks.length) {
    return null;
  }

  const preferred = tracks.filter((track) => Number.isFinite(track.tempo) || Number.isFinite(track.energy));
  const pool = preferred.length ? preferred : tracks;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] ?? pool[0];
}

export function chooseNextTrack(previousTrack, remainingTracks, intensity = "medium", stepIndex = 0, totalLength = 0) {
  if (!remainingTracks.length) {
    return null;
  }

  const sampleSize = 20;
  const mode = getIntensityMode(intensity);
  const referenceLength = totalLength || remainingTracks.length + stepIndex + 1;
  const energyTargets = buildEnergyTargets(referenceLength, mode.multiplier);
  const targetEnergy = energyTargets[Math.min(stepIndex, energyTargets.length - 1)] ?? previousTrack?.energy ?? 0.6;
  const candidatePool = sampleRandomCandidates(remainingTracks, sampleSize);

  const rankedCandidates = candidatePool
    .map((candidate) => ({
      candidate,
      score: scoreCandidateWithFallback(previousTrack, candidate, targetEnergy, mode.bpmTolerance),
    }))
    .sort((a, b) => a.score - b.score);

  return rankedCandidates[0]?.candidate ?? candidatePool[0] ?? null;
}

export function generateDJSet(tracks, intensity = "medium") {
  const featuredTracks = tracks.filter(
    (track) => Number.isFinite(track.tempo) && Number.isFinite(track.energy) && Number.isFinite(track.danceability),
  );
  const missingFeatureTracks = tracks.filter((track) => !featuredTracks.includes(track));

  if (featuredTracks.length === 0) {
    return annotateOrderedTracks([...tracks], () => "Original playlist order");
  }

  const mode = getIntensityMode(intensity);
  const sortedByTempo = [...featuredTracks].sort((a, b) => a.tempo - b.tempo);

  if (sortedByTempo.length <= 2) {
    return annotateOrderedTracks([...sortedByTempo, ...missingFeatureTracks], () => "Original playlist order");
  }

  const energyTargets = buildEnergyTargets(sortedByTempo.length, mode.multiplier);
  const remaining = [...sortedByTempo];
  const ordered = [];

  // We anchor the mix with the lowest-BPM track, then greedily choose the
  // next track that best matches the target energy curve and BPM tolerance.
  const firstTrack = remaining.shift();
  if (firstTrack) {
    ordered.push(firstTrack);
  }

  while (remaining.length > 0) {
    const previousTrack = ordered[ordered.length - 1];
    const targetEnergy = energyTargets[ordered.length] ?? previousTrack.energy;

    remaining.sort((a, b) => {
      const scoreA = scoreCandidate(previousTrack, a, targetEnergy, mode.bpmTolerance);
      const scoreB = scoreCandidate(previousTrack, b, targetEnergy, mode.bpmTolerance);
      return scoreA - scoreB;
    });

    ordered.push(remaining.shift());
  }

  const mixed = annotateOrderedTracks(ordered, (track, index) =>
    index === 0
      ? "Warm-up opener"
      : Math.abs(track.tempo - ordered[index - 1].tempo) <= mode.bpmTolerance
        ? "Smooth BPM handoff"
        : "Energy-led jump",
  );

  const fallbackTail = missingFeatureTracks
    .sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0))
    .map((track) => ({
      ...track,
      transitionHint: "Kept from original playlist order",
    }));

  return annotateOrderedTracks([...mixed, ...fallbackTail], (track, index) =>
    track.transitionHint ??
    (index === 0
      ? "Warm-up opener"
      : Math.abs(track.tempo - mixed[index - 1].tempo) <= mode.bpmTolerance
        ? "Smooth BPM handoff"
        : "Energy-led jump"),
  );
}
