import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";

export default function PlaylistCard({ playlist, selected, onPress }) {
  return (
    <Pressable style={[styles.card, selected && styles.selected]} onPress={onPress}>
      <Image
        source={{
          uri: playlist.image ?? "https://placehold.co/300x300/08111d/f4f7fb?text=Playlist",
        }}
        style={styles.image}
      />
      <View style={styles.meta}>
        <Text style={styles.title}>{playlist.name}</Text>
        <Text style={styles.subtitle}>{playlist.totalTracks} tracks</Text>
        <Text style={styles.owner}>{playlist.owner}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#101b2c",
    borderColor: "#233145",
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 14,
    overflow: "hidden",
  },
  selected: {
    borderColor: "#1ed760",
  },
  image: {
    height: 180,
    width: "100%",
  },
  meta: {
    padding: 16,
  },
  title: {
    color: "#f4f7fb",
    fontSize: 18,
    fontWeight: "700",
  },
  subtitle: {
    color: "#aab7c8",
    marginTop: 6,
  },
  owner: {
    color: "#7ce7b0",
    marginTop: 6,
  },
});
