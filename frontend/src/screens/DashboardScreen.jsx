import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "../api/client";
import LoadingView from "../components/LoadingView";
import PlaylistCard from "../components/PlaylistCard";
import SectionCard from "../components/SectionCard";
import { useAuth } from "../contexts/AuthContext";

export default function DashboardScreen({ navigation }) {
  const { profile, sessionId, logout } = useAuth();
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPlaylists = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const response = await api.getPlaylists(sessionId);
      setPlaylists(response.playlists);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadPlaylists();
  }, [loadPlaylists]);

  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        data={playlists}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <>
            <SectionCard>
              <View style={styles.headerRow}>
                <View style={styles.profileBlock}>
                  <Text style={styles.eyebrow}>Connected account</Text>
                  <Text style={styles.title}>{profile?.displayName ?? "Spotify listener"}</Text>
                  <Text style={styles.subtitle}>{profile?.email}</Text>
                </View>
                <Pressable style={styles.ghostButton} onPress={logout}>
                  <Text style={styles.ghostButtonText}>Logout</Text>
                </Pressable>
              </View>
            </SectionCard>

            <SectionCard>
              <Text style={styles.sectionTitle}>Choose a playlist</Text>
              <Text style={styles.sectionCopy}>
                Select the playlist you want to reorder into a DJ-style sequence.
              </Text>
              <Pressable
                style={[styles.primaryButton, !selectedPlaylist && styles.disabledButton]}
                disabled={!selectedPlaylist}
                onPress={() =>
                  navigation.navigate("Player", {
                    playlist: selectedPlaylist,
                  })
                }
              >
                <Text style={styles.primaryButtonText}>Generate DJ Set</Text>
              </Pressable>
              {loading ? <LoadingView label="Loading Spotify playlists..." /> : null}
              {error ? <Text style={styles.error}>{error}</Text> : null}
            </SectionCard>
          </>
        }
        renderItem={({ item }) => (
          <PlaylistCard
            playlist={item}
            selected={selectedPlaylist?.id === item.id}
            onPress={() => setSelectedPlaylist(item)}
          />
        )}
      />
    </SafeAreaView>
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
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  profileBlock: {
    flex: 1,
    paddingRight: 12,
  },
  eyebrow: {
    color: "#7ce7b0",
    letterSpacing: 2,
    marginBottom: 8,
    textTransform: "uppercase",
  },
  title: {
    color: "#f4f7fb",
    fontSize: 24,
    fontWeight: "800",
  },
  subtitle: {
    color: "#aab7c8",
    marginTop: 6,
  },
  sectionTitle: {
    color: "#f4f7fb",
    fontSize: 20,
    fontWeight: "800",
  },
  sectionCopy: {
    color: "#d9e1ec",
    lineHeight: 22,
    marginTop: 10,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#1ed760",
    borderRadius: 999,
    marginTop: 16,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: "#08111d",
    fontWeight: "800",
  },
  disabledButton: {
    opacity: 0.45,
  },
  ghostButton: {
    alignSelf: "flex-start",
    backgroundColor: "#162335",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  ghostButtonText: {
    color: "#f4f7fb",
    fontWeight: "700",
  },
  error: {
    color: "#ff92a2",
    marginTop: 14,
  },
});
