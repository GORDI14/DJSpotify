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

export function generateDJSet(tracks, intensity = "medium") {
  const filtered = tracks.filter((track) => Number.isFinite(track.tempo) && Number.isFinite(track.energy));
  const sortedByTempo = [...filtered].sort((a, b) => a.tempo - b.tempo);

  if (sortedByTempo.length <= 2) {
    return sortedByTempo;
  }

  const intensityMap = {
    low: { multiplier: 0.85, bpmTolerance: 10 },
    medium: { multiplier: 1, bpmTolerance: 15 },
    high: { multiplier: 1.15, bpmTolerance: 18 },
  };

  const mode = intensityMap[intensity] ?? intensityMap.medium;
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

  return ordered.map((track, index) => ({
    ...track,
    djPosition: index + 1,
    transitionHint:
      index === 0
        ? "Warm-up opener"
        : Math.abs(track.tempo - ordered[index - 1].tempo) <= mode.bpmTolerance
          ? "Smooth BPM handoff"
          : "Energy-led jump",
  }));
}
