import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export default function DeviceList({ devices, selectedDeviceId, onSelect }) {
  if (!devices.length) {
    return <Text style={styles.empty}>No Spotify devices detected yet.</Text>;
  }

  return (
    <View>
      {devices.map((device) => (
        <Pressable
          key={device.id}
          style={[styles.row, selectedDeviceId === device.id && styles.selected]}
          onPress={() => onSelect(device.id)}
        >
          <View>
            <Text style={styles.name}>{device.name}</Text>
            <Text style={styles.meta}>
              {device.type} · {device.is_active ? "Active" : "Available"}
            </Text>
          </View>
          <Text style={styles.volume}>{device.volume_percent ?? 0}%</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    color: "#aab7c8",
  },
  row: {
    alignItems: "center",
    backgroundColor: "#0d1623",
    borderColor: "#233145",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    padding: 14,
  },
  selected: {
    borderColor: "#1ed760",
  },
  name: {
    color: "#f4f7fb",
    fontWeight: "700",
  },
  meta: {
    color: "#aab7c8",
    marginTop: 4,
  },
  volume: {
    color: "#7ce7b0",
    fontWeight: "600",
  },
});
