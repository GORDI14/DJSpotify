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
  const [djSet, setDjSet] = useState([]);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [playbackState, setPlaybackState] = useState(null);
  const [intensity, setIntensity] = useState("medium");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

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

  const loadMix = useCallback(async () => {
    if (!playlist?.id) {
      return;
    }

    try {
      setLoading(true);
      setError("");
      const trackResponse = await api.getTracks(sessionId, playlist.id);
      setSourceTracks(trackResponse.tracks);

      const generated = await api.generateDJSet(sessionId, trackResponse.tracks, intensity);
      setDjSet(generated.tracks);
      await loadDevices();
      await loadPlaybackState();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [playlist?.id, sessionId, intensity, loadDevices, loadPlaybackState]);

  useEffect(() => {
    loadMix();
  }, [loadMix]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadDevices().catch(() => {});
      loadPlaybackState().catch(() => {});
    }, 6000);

    return () => clearInterval(interval);
  }, [loadDevices, loadPlaybackState]);

  const stats = useMemo(() => {
    if (!djSet.length) {
      return null;
    }

    return {
      totalTracks: djSet.length,
      averageBpm: Math.round(djSet.reduce((sum, track) => sum + track.tempo, 0) / djSet.length),
      averageEnergy: Math.round(
        (djSet.reduce((sum, track) => sum + track.energy, 0) / djSet.length) * 100 / djSet.length,
      ),
    };
  }, [djSet]);

  async function handlePlay() {
    try {
      setActionError("");
      if (!selectedDeviceId) {
        throw new Error("Open Spotify on the target device first, then refresh devices.");
      }

      await api.transferPlayback(sessionId, selectedDeviceId, false);
      await api.playUris(
        sessionId,
        djSet.map((track) => track.uri),
        selectedDeviceId,
      );
      await loadPlaybackState();
    } catch (requestError) {
      setActionError(requestError.message);
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
      await loadPlaybackState();
    } catch (requestError) {
      setActionError(requestError.message);
    }
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <SectionCard>
        <Text style={styles.title}>{playlist?.name ?? "DJ Set"}</Text>
        <Text style={styles.copy}>
          Smart DJ sorts by BPM, smooths transitions where possible, builds toward a middle peak,
          and cools slightly at the end.
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

      {loading ? <LoadingView label="Analyzing playlist and generating the mobile DJ set..." /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {!loading && stats ? (
        <SectionCard>
          <Text style={styles.sectionTitle}>Set summary</Text>
          <Text style={styles.stat}>Tracks: {stats.totalTracks}</Text>
          <Text style={styles.stat}>Average BPM: {stats.averageBpm}</Text>
          <Text style={styles.stat}>Average energy: {stats.averageEnergy}%</Text>
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
            Open Spotify on your phone, tablet, or desktop first. Then refresh and select the
            device that should receive the generated set.
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
            Crossfade is not exposed through Spotify public mobile APIs, so this MVP simulates a
            smoother DJ feel through sequencing. If you enable Spotify app crossfade in your account
            settings, transitions feel even better.
          </Text>
          <View style={styles.controlRow}>
            <Pressable style={styles.primaryButton} onPress={handlePlay}>
              <Text style={styles.primaryButtonText}>Play DJ Set</Text>
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
          <Text style={styles.sectionTitle}>Generated DJ set</Text>
          <TrackList tracks={djSet} />
        </SectionCard>
      ) : null}

      {!loading ? (
        <SectionCard>
          <Text style={styles.sectionTitle}>Source playlist preview</Text>
          <TrackList tracks={sourceTracks.slice(0, 10)} compact />
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
});
