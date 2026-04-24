import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

export default function LoadingView({ label = "Loading..." }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color="#1ed760" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: "#101b2c",
    borderColor: "#233145",
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 20,
    padding: 28,
  },
  label: {
    color: "#d9e1ec",
    marginTop: 12,
  },
});
