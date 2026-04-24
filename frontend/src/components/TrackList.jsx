import React from "react";
import { StyleSheet, Text, View } from "react-native";

export default function TrackList({ tracks, compact = false }) {
  return (
    <View>
      {tracks.map((track, index) => (
        <View key={`${track.id}-${index}`} style={styles.row}>
          <View style={styles.indexWrap}>
            <Text style={styles.index}>{track.djPosition ?? index + 1}</Text>
          </View>
          <View style={styles.main}>
            <Text style={styles.name}>{track.name}</Text>
            <Text style={styles.artist}>{track.artists}</Text>
          </View>
          {!compact ? (
            <View style={styles.metrics}>
              <Text style={styles.metric}>
                {Number.isFinite(track.tempo) ? `${Math.round(track.tempo)} BPM` : "BPM unavailable"}
              </Text>
              <Text style={styles.metric}>
                {Number.isFinite(track.energy)
                  ? `${Math.round(track.energy * 100)}% energy`
                  : "Energy unavailable"}
              </Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    borderBottomColor: "#233145",
    borderBottomWidth: 1,
    flexDirection: "row",
    paddingVertical: 12,
  },
  indexWrap: {
    marginRight: 14,
    width: 28,
  },
  index: {
    color: "#7ce7b0",
    fontWeight: "700",
  },
  main: {
    flex: 1,
  },
  name: {
    color: "#f4f7fb",
    fontWeight: "700",
  },
  artist: {
    color: "#aab7c8",
    marginTop: 4,
  },
  metrics: {
    alignItems: "flex-end",
    marginLeft: 12,
  },
  metric: {
    color: "#d9e1ec",
    fontSize: 12,
  },
});
