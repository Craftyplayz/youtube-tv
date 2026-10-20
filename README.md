# Youtube TV

Live, TV-style Channels made from YouTube videos, for one household. Terms are defined in [GLOSSARY.md](GLOSSARY.md).

## Run it

1. Get a YouTube Data API v3 key: [Google Cloud console](https://console.cloud.google.com/) → new project → enable **YouTube Data API v3** → Credentials → Create API key.
2. Next to `docker-compose.yml`, create `.env` containing `YOUTUBE_API_KEY=your-key`.
3. `docker compose up -d`, open `http://<server-ip>:2345`, then **Settings** → add a Channel → add a Source. To use another port, add `WEB_PORT=1234` to `.env`.

Update: `docker compose pull && docker compose up -d`. Everything is stored in the `youtube-tv-data` volume.

There is no login: anyone who can reach the port can edit Channels. Keep it on your home network.

## Controls

The home page lists every Channel with a search bar; each Channel has its own page, e.g. a Channel named "Tech" is at `/tech-tv`.

The player copies YouTube's: click to pause, double-click for full screen, drag the red bar to seek, click **● LIVE** to catch up. Move the mouse to show the controls, including **Exclude** (never show this video on this Channel again).

↑ ↓ change Channel · ← → skip 5s · Shift+N / Shift+P next / previous video · Space/K pause · M mute · C captions · F full screen · G Guide · R Restart · L Go live · Esc back to Channels · hold right-click and scroll for volume

## Android app

The app in `android/` shows your server's page full screen with phone controls modelled on YouTube's app: tap to show or hide the controls, double-tap either side to skip 10s, swipe up or down the video to change Channel, turn the phone sideways (or tap the full screen button) for full screen, and the back button closes things. Picture-in-picture keeps the video in a small window over other apps, and starts by itself when you leave the app while a video plays. Leaving the app any other way pauses: YouTube's player doesn't allow background play.

Install `youtube-tv.apk` from a release (or the **Android app** workflow's artifacts) and allow installing from unknown sources. On first launch, enter the address you use in the browser, e.g. `http://192.168.1.20:2345`; change it later under **Settings** → **Server address**. The app loads its page from the server, so page changes reach it when you update the server.

To install new versions over old ones, every APK must be signed with the same key. Make one once and keep it safe: `keytool -genkey -keystore household.jks -alias youtube-tv -keyalg RSA -validity 10000` (same password for the keystore and the key), then add repository secrets `ANDROID_KEYSTORE_BASE64` (output of `base64 -w0 household.jks`) and `ANDROID_KEYSTORE_PASSWORD`. Without them each build is signed with a throwaway debug key, and updating means uninstalling first.

Build locally with the Android SDK: `cd android && ./gradlew assembleRelease`.

## Develop

```sh
npm install
cp .env.example .env      # add your key
npm run dev:server        # terminal 1: API on :8080
npm run dev:web           # terminal 2: page on http://localhost:5173
npm test && npm run typecheck
```

## Release

`git tag v1.0.0 && git push --tags` runs the tests, smoke-tests the image, then publishes `ghcr.io/<owner>/<repo>:1.0.0` and `:latest` for x86 and ARM. A new GHCR package starts private: make it public in its GitHub package settings, or run `docker login ghcr.io` on the server.
