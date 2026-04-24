import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { api } from "../api/client";
import DeviceList from "../components/DeviceList";
import LoadingView from "../components/LoadingView";
import SectionCard from "../components/SectionCard";
import TrackList from "../components/TrackList";
import { useAuth } from "../contexts/AuthContext";

export default function PlayerScreen({ route }) {
  const { sessionId } = useAuth();
  const playlist = route.params?.playlist;
  const [sourceTracks, setSourceTracks] = useState([]);
  const [upcomingTracks, setUpcomingTracks] = useState([]);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [playbackState, setPlaybackState] = useState(null);
  const [intensity, setIntensity] = useState("medium");
  const [loading, setLoading] = useState(true);
  const [startingDj, setStartingDj] = useState(false);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [audioFeaturesAvailable, setAudioFeaturesAvailable] = useState(true);
  const [externalAudioFeatures, setExternalAudioFeatures] = useState(null);
  const [dynamicSessionActive, setDynamicSessionActive] = useState(false);

  const loadDevices = useCallback(async () => {
    const response = await api.getDevices(sessionId);
    setDevices(response.devices);

    const active = response.devices.find((device) => device.is_active);
    if (active) {
      setSelectedDeviceId(active.id);
    } else if (!selectedDeviceId && response.devices[0]) {
      setSelectedDeviceId(response.devices[0].id);
    }
  }, [sessionId, selectedDeviceId]);

  const loadPlaybackState = useCallback(async () => {
    const response = await api.getPlaybackState(sessionId);
    setPlaybackState(response.state);
  }, [sessionId]);

  const loadSourceTracks = useCallback(async () => {
    if (!playlist?.id) {
      return;
    }

    try {
      setLoading(true);
      setError("");
      const trackResponse = await api.getTracks(sessionId, playlist.id);
      setSourceTracks(trackResponse.tracks);
      setAudioFeaturesAvailable(trackResponse.audioFeaturesAvailable !== false);
      if (!trackResponse.tracks.length) {
        setError("Spotify returned this playlist without playable tracks for the app.");
      }
      await loadDevices();
      await loadPlaybackState();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [playlist?.id, sessionId, loadDevices, loadPlaybackState]);

  useEffect(() => {
    loadSourceTracks();
  }, [loadSourceTracks]);

  const syncDynamicSession = useCallback(async () => {
    if (!dynamicSessionActive) {
      return;
    }

    try {
      const response = await api.syncDynamicDjSession(sessionId);
      setUpcomingTracks(response.preview ?? []);
      setPlaybackState(response.playbackState?.item ? response.playbackState : response.playbackState ?? null);
    } catch (requestError) {
      setActionError(requestError.message);
    }
  }, [dynamicSessionActive, sessionId]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadDevices().catch(() => {});
      if (dynamicSessionActive) {
        syncDynamicSession().catch(() => {});
      } else {
        loadPlaybackState().catch(() => {});
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [dynamicSessionActive, loadDevices, loadPlaybackState, syncDynamicSession]);

  const sourceStats = useMemo(() => {
    if (!sourceTracks.length) {
      return null;
    }

    const tracksWithTempo = sourceTracks.filter((track) => Number.isFinite(track.tempo));
    const tracksWithEnergy = sourceTracks.filter((track) => Number.isFinite(track.energy));

    return {
      totalTracks: sourceTracks.length,
      tracksWithTempo: tracksWithTempo.length,
      tracksWithEnergy: tracksWithEnergy.length,
    };
  }, [sourceTracks]);

  async function handlePlay() {
    try {
      setActionError("");
      setStartingDj(true);

      if (!selectedDeviceId) {
        throw new Error("Open Spotify on the target device first, then refresh devices.");
      }
      if (!sourceTracks.length) {
        throw new Error("Load a source with playable tracks before starting Smart DJ.");
      }

      const response = await api.startDynamicDjSession(sessionId, playlist.id, intensity, selectedDeviceId);
      setUpcomingTracks(response.preview ?? []);
      setExternalAudioFeatures(response.externalAudioFeatures ?? null);
      setDynamicSessionActive(true);
      await loadPlaybackState();
    } catch (requestError) {
      setActionError(requestError.message);
    } finally {
      setStartingDj(false);
    }
  }

  async function handlePause() {
    try {
      setActionError("");
      await api.pausePlayback(sessionId, selectedDeviceId);
      await loadPlaybackState();
    } catch (requestError) {
      setActionError(requestError.message);
    }
  }

  async function handleSkip() {
    try {
      setActionError("");
      await api.skipNext(sessionId, selectedDeviceId);
      await syncDynamicSession();
    } catch (requestError) {
      setActionError(requestError.message);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionCard>
        <Text style={styles.title}>{playlist?.name ?? "Smart DJ"}</Text>
        <Text style={styles.copy}>
          Smart DJ now starts from a seed track and, at each step, samples around 20 random songs from the source to
          decide which one fits best next with the BPM and energy data available at the time.
        </Text>
      </SectionCard>

      <SectionCard>
        <Text style={styles.sectionTitle}>DJ intensity</Text>
        <View style={styles.segmentedRow}>
          {["low", "medium", "high"].map((value) => (
            <Pressable
              key={value}
              style={[styles.segment, intensity === value && styles.segmentSelected]}
              onPress={() => setIntensity(value)}
            >
              <Text style={[styles.segmentText, intensity === value && styles.segmentTextSelected]}>
                {value.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>
      </SectionCard>

      {loading ? <LoadingView label="Loading source tracks for Smart DJ..." /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && sourceStats ? (
        <SectionCard>
          <Text style={styles.sectionTitle}>Detection summary</Text>
          <Text style={styles.stat}>Tracks in source: {sourceStats.totalTracks}</Text>
          <Text style={styles.stat}>Tracks with BPM: {sourceStats.tracksWithTempo}</Text>
          <Text style={styles.stat}>Tracks with energy: {sourceStats.tracksWithEnergy}</Text>
          {!audioFeaturesAvailable ? (
            <Text style={styles.warning}>
              Spotify did not return native audio features, so Smart DJ is using fallback metadata when possible.
            </Text>
          ) : null}
          {externalAudioFeatures?.provider === "acousticbrainz" ? (
            <Text style={styles.warning}>
              External fallback filled {externalAudioFeatures.enrichedCount} tracks using AcousticBrainz. Energy is an estimate based on loudness descriptors.
            </Text>
          ) : null}
          {externalAudioFeatures?.lookupLimitApplied ? (
            <Text style={styles.warning}>
              The external lookup limit was reached, so some tracks may still be missing BPM or energy.
            </Text>
          ) : null}
        </SectionCard>
      ) : null}

      {!loading ? (
        <SectionCard>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Playback devices</Text>
            <Pressable style={styles.smallButton} onPress={loadDevices}>
              <Text style={styles.smallButtonText}>Refresh</Text>
            </Pressable>
          </View>
          <Text style={styles.copy}>
            Open Spotify on your phone, tablet, or desktop first. Then refresh and select the device that should
            receive the live Smart DJ queue.
          </Text>
          <Pressable style={styles.spotifyButton} onPress={() => Linking.openURL("spotify:")}>
            <Text style={styles.spotifyButtonText}>Open Spotify</Text>
          </Pressable>
          <DeviceList
            devices={devices}
            selectedDeviceId={selectedDeviceId}
            onSelect={setSelectedDeviceId}
          />
        </SectionCard>
      ) : null}

      {!loading ? (
        <SectionCard>
          <Text style={styles.sectionTitle}>Playback control</Text>
          <Text style={styles.copy}>
            Start Smart DJ to play one seed song and keep the next 5 queued dynamically while playback advances.
          </Text>
          <View style={styles.controlRow}>
            <Pressable style={[styles.primaryButton, startingDj && styles.disabledButton]} onPress={handlePlay} disabled={startingDj}>
              <Text style={styles.primaryButtonText}>{dynamicSessionActive ? "Restart Smart DJ" : "Start Smart DJ"}</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={handlePause}>
              <Text style={styles.secondaryButtonText}>Pause</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={handleSkip}>
              <Text style={styles.secondaryButtonText}>Skip</Text>
            </Pressable>
          </View>
          {playbackState?.item ? (
            <View style={styles.nowPlaying}>
              <Text style={styles.nowPlayingLabel}>Now playing</Text>
              <Text style={styles.nowPlayingTitle}>{playbackState.item.name}</Text>
              <Text style={styles.nowPlayingArtist}>
                {playbackState.item.artists.map((artist) => artist.name).join(", ")}
              </Text>
            </View>
          ) : null}
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
        </SectionCard>
      ) : null}

      {!loading ? (
        <SectionCard>
          <Text style={styles.sectionTitle}>Next 5 songs</Text>
          {upcomingTracks.length ? (
            <TrackList tracks={upcomingTracks} />
          ) : (
            <Text style={styles.copy}>
              Start Smart DJ to see the next 5 songs the app is preparing for the live queue.
            </Text>
          )}
        </SectionCard>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#08111d",
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 32,
  },
  title: {
    color: "#f4f7fb",
    fontSize: 24,
    fontWeight: "800",
  },
  sectionTitle: {
    color: "#f4f7fb",
    fontSize: 18,
    fontWeight: "800",
  },
  copy: {
    color: "#d9e1ec",
    lineHeight: 22,
    marginTop: 10,
  },
  segmentedRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  segment: {
    backgroundColor: "#162335",
    borderColor: "#233145",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  segmentSelected: {
    backgroundColor: "#1ed760",
    borderColor: "#1ed760",
  },
  segmentText: {
    color: "#f4f7fb",
    fontWeight: "700",
  },
  segmentTextSelected: {
    color: "#08111d",
  },
  stat: {
    color: "#d9e1ec",
    marginTop: 10,
  },
  rowBetween: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  spotifyButton: {
    alignItems: "center",
    backgroundColor: "#1ed760",
    borderRadius: 999,
    marginBottom: 16,
    marginTop: 16,
    paddingVertical: 14,
  },
  spotifyButtonText: {
    color: "#08111d",
    fontWeight: "800",
  },
  smallButton: {
    backgroundColor: "#162335",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  smallButtonText: {
    color: "#f4f7fb",
    fontWeight: "700",
  },
  controlRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#1ed760",
    borderRadius: 999,
    flex: 1.4,
    paddingVertical: 14,
  },
  disabledButton: {
    opacity: 0.55,
  },
  primaryButtonText: {
    color: "#08111d",
    fontWeight: "800",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#162335",
    borderRadius: 999,
    flex: 1,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: "#f4f7fb",
    fontWeight: "700",
  },
  nowPlaying: {
    backgroundColor: "#0d1623",
    borderColor: "#233145",
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 16,
    padding: 16,
  },
  nowPlayingLabel: {
    color: "#7ce7b0",
    marginBottom: 8,
  },
  nowPlayingTitle: {
    color: "#f4f7fb",
    fontSize: 16,
    fontWeight: "800",
  },
  nowPlayingArtist: {
    color: "#aab7c8",
    marginTop: 6,
  },
  error: {
    color: "#ff92a2",
    marginTop: 14,
  },
  warning: {
    color: "#ffd37a",
    marginTop: 12,
  },
});
