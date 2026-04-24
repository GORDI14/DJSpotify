import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { api } from "../api/client";

WebBrowser.maybeCompleteAuthSession();

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authReady, setAuthReady] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [authError, setAuthError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  useEffect(() => {
    setAuthReady(true);
  }, []);

  async function refreshSession(nextSessionId = sessionId) {
    if (!nextSessionId) {
      setProfile(null);
      return;
    }

    const response = await api.getSession(nextSessionId);
    if (!response.authenticated) {
      setSessionId(null);
      setProfile(null);
      return;
    }

    setSessionId(nextSessionId);
    setProfile(response.profile);
  }

  async function login() {
    setIsLoggingIn(true);
    setAuthError("");

    try {
      const returnUrl = Linking.createURL("auth-complete");
      const { authUrl } = await api.startMobileAuth(returnUrl);
      const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);

      if (result.type !== "success" || !result.url) {
        throw new Error("Spotify login was cancelled before the app received a valid session.");
      }

      const parsed = Linking.parse(result.url);
      const nextSessionId = parsed.queryParams?.sessionId;
      const status = parsed.queryParams?.status;
      const message = parsed.queryParams?.message;

      if (status !== "success" || !nextSessionId) {
        throw new Error(String(message ?? "Spotify login did not complete successfully."));
      }

      await refreshSession(String(nextSessionId));
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function logout() {
    if (sessionId) {
      await api.logout(sessionId);
    }

    setSessionId(null);
    setProfile(null);
  }

  const value = useMemo(
    () => ({
      authReady,
      sessionId,
      profile,
      authError,
      isLoggingIn,
      isAuthenticated: Boolean(profile && sessionId),
      login,
      logout,
      refreshSession,
    }),
    [authReady, sessionId, profile, authError, isLoggingIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
