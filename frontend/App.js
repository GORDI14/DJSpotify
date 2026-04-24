import React from "react";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "./src/contexts/AuthContext";
import DashboardScreen from "./src/screens/DashboardScreen";
import LoginScreen from "./src/screens/LoginScreen";
import PlayerScreen from "./src/screens/PlayerScreen";

const Stack = createNativeStackNavigator();

const appTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: "#08111d",
    card: "#101b2c",
    text: "#f4f7fb",
    primary: "#1ed760",
    border: "#233145",
  },
};

function AppNavigator() {
  const { authReady, isAuthenticated } = useAuth();

  if (!authReady) {
    return <LoginScreen loadingOnly />;
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: "#08111d" },
        headerTintColor: "#f4f7fb",
        contentStyle: { backgroundColor: "#08111d" },
      }}
    >
      {!isAuthenticated ? (
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      ) : (
        <>
          <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ title: "Your Playlists" }} />
          <Stack.Screen name="Player" component={PlayerScreen} options={{ title: "Smart DJ Set" }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer theme={appTheme}>
          <StatusBar style="light" />
          <AppNavigator />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
