# Smart DJ for Spotify Mobile

Smart DJ for Spotify is now a mobile MVP built with Expo React Native for Android and iOS, backed by Node.js + Express. The app connects to Spotify, lets a user choose one of their playlists, analyzes audio features, generates a DJ-style reordered set, and remotely controls playback on an available Spotify device.

## Stack

- Mobile app: React Native with Expo prebuild
- Backend: Node.js + Express
- Auth: Spotify OAuth 2.0 handled by the backend
- API: Spotify Web API
- Styling: React Native `StyleSheet`
- State management: React hooks and context

## Project structure

```text
DJSpotify/
├── backend/
│   ├── package.json
│   └── src/
│       ├── lib/
│       │   ├── djAlgorithm.js
│       │   ├── sessionStore.js
│       │   └── spotifyApi.js
│       └── server.js
├── frontend/
│   ├── app.json
│   ├── App.js
│   ├── package.json
│   └── src/
│       ├── api/client.js
│       ├── components/
│       ├── contexts/AuthContext.jsx
│       └── screens/
├── .env.example
└── package.json
```

## Important Spotify note

This mobile version does not use the browser-only Web Playback SDK. Instead, it uses Spotify OAuth plus the Spotify Web API to control playback on an already available Spotify device.

That means:

- The Spotify app should be installed and logged in on the target device.
- A Spotify Premium account is still required for reliable playback control.
- The app simulates a DJ feel by generating a smooth sequence.
- Spotify does not expose a public API to toggle crossfade settings from third-party apps, so crossfade cannot be forced programmatically here.

## Spotify app setup

1. Go to the Spotify Developer Dashboard: https://developer.spotify.com/dashboard
2. Create a new app.
3. Add this redirect URI to the Spotify app settings:

```text
https://YOUR-HTTPS-BACKEND/mobile/callback
```

4. If you also want to keep the old local browser callback for debugging server auth, optionally add:

```text
http://127.0.0.1:3001/callback
```

## OAuth requirement after November 27, 2025

Spotify announced it would end support for insecure non-loopback HTTP redirect URIs on November 27, 2025. Since today is April 24, 2026, you should assume a mobile app needs an HTTPS backend callback URL for Spotify OAuth.

Official references:

- Redirect URI guide: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- Migration notice: https://developer.spotify.com/documentation/web-api/tutorials/migration-insecure-redirect-uri

## Environment variables

Create a `.env` file in the project root:

```bash
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3001/callback
BACKEND_PUBLIC_URL=https://your-https-tunnel-or-domain.example.com
MOBILE_SPOTIFY_REDIRECT_URI=https://your-https-tunnel-or-domain.example.com/mobile/callback
EXPO_PUBLIC_API_URL=https://your-https-tunnel-or-domain.example.com
FRONTEND_URL=http://127.0.0.1:8081
PORT=3001
SESSION_SECRET=replace_this_with_a_random_secret
EXTERNAL_FEATURE_LOOKUP_LIMIT=40
```

## Local development for Android/iOS

### Recommended mobile dev flow

1. Start an HTTPS tunnel to your backend.
2. Put that HTTPS URL into `BACKEND_PUBLIC_URL`, `MOBILE_SPOTIFY_REDIRECT_URI`, and `EXPO_PUBLIC_API_URL`.
3. Register the same `https://.../mobile/callback` URL in the Spotify dashboard.
4. Install dependencies.
5. Run Expo prebuild once.
6. Run Android or iOS.

### Example commands

```bash
npm install
npm run prebuild
npm run dev:backend
npm run android
```

Or on macOS for iOS:

```bash
npm run ios
```

To run backend + Expo together:

```bash
npm run dev
```

## Main user flow

1. The mobile app asks the backend for a Spotify auth URL.
2. The user signs in through Spotify in a browser session.
3. Spotify redirects back to the backend.
4. The backend exchanges the code securely and redirects back to the mobile app with a temporary backend session id.
5. The app uses that in-memory session to call backend endpoints.
6. The app loads playlists, fetches tracks and audio features, generates the DJ set, and controls playback on a selected Spotify device.

## DJ algorithm

The core function is in:

- [backend/src/lib/djAlgorithm.js](backend/src/lib/djAlgorithm.js)

It does three things:

1. Sorts tracks by BPM ascending as the starting spine.
2. Builds an energy curve that starts lower, rises toward the middle, and cools slightly at the end.
3. Greedily picks the next track using BPM tolerance plus energy fit, so jumps above the preferred BPM threshold are avoided when possible.

Intensity modes:

- `low`: tighter BPM changes, softer build
- `medium`: balanced progression
- `high`: more aggressive energy ramp and larger BPM tolerance

## External BPM fallback

If Spotify does not return audio features for your app, the backend can try an open fallback path:

- Resolve tracks by ISRC through MusicBrainz
- Fetch BPM and loudness-based descriptors from AcousticBrainz
- Estimate energy from loudness when direct Spotify energy is unavailable

Notes:

- MusicBrainz asks clients not to exceed 1 request per second, so very large sources can take time to enrich.
- `EXTERNAL_FEATURE_LOOKUP_LIMIT` controls how many missing tracks the backend will try to enrich per request.
- This fallback is best-effort. BPM can be real external data, but energy may be an estimate derived from loudness-related descriptors.

## Mobile playback behavior

Available controls:

- Play generated DJ set
- Pause
- Skip
- Refresh devices
- Open Spotify

Because Spotify public mobile APIs do not expose third-party raw audio mixing or crossfade configuration, "smooth transitions" in this MVP come from the ordering logic and optional Spotify app-side crossfade if the user has enabled it in Spotify itself.

## Scripts

At the project root:

```bash
npm run dev
npm run dev:backend
npm run dev:frontend
npm run android
npm run ios
npm run prebuild
npm run build
```

## Verification

- Backend health endpoint: `GET /health`
- Mobile auth start endpoint: `POST /api/mobile-auth/start`
- Playlists endpoint: `GET /api/playlists`
- Tracks endpoint: `GET /api/tracks/:playlistId`
- DJ generation endpoint: `POST /api/generate`
- Devices endpoint: `GET /api/player/devices`
- Playback state endpoint: `GET /api/player/state`

## Official Spotify references used

- Web API authorization overview: https://developer.spotify.com/documentation/web-api/concepts/authorization
- Redirect URI requirements: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- Authorization code flow: https://developer.spotify.com/documentation/web-api/tutorials/code-flow
- Web API PKCE guidance for mobile apps: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- Player transfer playback: https://developer.spotify.com/documentation/web-api/reference/transfer-a-users-playback
- Player current playback: https://developer.spotify.com/documentation/web-api/reference/get-information-about-the-users-current-playback
- Playlist items: https://developer.spotify.com/documentation/web-api/reference/get-playlists-items
- Audio features: https://developer.spotify.com/documentation/web-api/reference/get-several-audio-features
