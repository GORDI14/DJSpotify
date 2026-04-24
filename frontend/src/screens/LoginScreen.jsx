import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import SectionCard from "../components/SectionCard";
import { useAuth } from "../contexts/AuthContext";

export default function LoginScreen({ loadingOnly = false }) {
  const { login, authError, isLoggingIn } = useAuth();

  if (loadingOnly) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1ed760" />
          <Text style={styles.subtitle}>Preparing Spotify session...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.hero}>
        <Text style={styles.eyebrow}>Mobile DJ Assistant</Text>
        <Text style={styles.title}>Smart DJ for Spotify</Text>
        <Text style={styles.subtitle}>
          Pick one of your Spotify playlists and rebuild it into a smoother DJ-style flow for
          Android and iOS.
        </Text>
      </View>

      <SectionCard>
        <Text style={styles.cardTitle}>What this mobile MVP does</Text>
        <Text style={styles.copy}>
          It signs in with Spotify, fetches your playlists, analyzes audio features, generates a DJ
          set, and remotely controls playback on an available Spotify device.
        </Text>

        <Pressable style={styles.button} onPress={login} disabled={isLoggingIn}>
          <Text style={styles.buttonText}>
            {isLoggingIn ? "Connecting to Spotify..." : "Login with Spotify"}
          </Text>
        </Pressable>

        <Text style={styles.note}>
          Playback requires Spotify Premium and the Spotify app running on a device tied to your
          account.
        </Text>
        {authError ? <Text style={styles.error}>{authError}</Text> : null}
      </SectionCard>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#08111d",
    flex: 1,
    padding: 20,
  },
  center: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  hero: {
    marginBottom: 20,
    marginTop: 24,
  },
  eyebrow: {
    color: "#7ce7b0",
    letterSpacing: 2,
    marginBottom: 10,
    textTransform: "uppercase",
  },
  title: {
    color: "#f4f7fb",
    fontSize: 34,
    fontWeight: "800",
  },
  subtitle: {
    color: "#aab7c8",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  cardTitle: {
    color: "#f4f7fb",
    fontSize: 20,
    fontWeight: "700",
  },
  copy: {
    color: "#d9e1ec",
    lineHeight: 22,
    marginTop: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#1ed760",
    borderRadius: 999,
    marginTop: 18,
    paddingVertical: 14,
  },
  buttonText: {
    color: "#08111d",
    fontWeight: "800",
  },
  note: {
    color: "#aab7c8",
    lineHeight: 20,
    marginTop: 16,
  },
  error: {
    color: "#ff92a2",
    marginTop: 12,
  },
});
