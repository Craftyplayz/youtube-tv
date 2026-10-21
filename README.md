# Youtube TV

Live, TV-style Channels made from YouTube videos, for one household. Terms are defined in [GLOSSARY.md](GLOSSARY.md).

## Run it

1. Get a YouTube Data API v3 key: [Google Cloud console](https://console.cloud.google.com/) → new project → enable **YouTube Data API v3** → Credentials → Create API key.
2. Next to `docker-compose.yml`, create `.env` containing `YOUTUBE_API_KEY=your-key` and `ADMIN_PASSWORD=pick-one`.
3. `docker compose up -d`, open `http://<server-ip>:2345`, then **Admin** → log in → add a Channel → add a Source. To use another port, add `WEB_PORT=1234` to `.env`.

Update: `docker compose pull && docker compose up -d`. Everything is stored in the `youtube-tv-data` volume.

Only Admin (`/admin`: Channels and Viewers) needs the password; watching needs none. Viewers shows viewing time per person and Channel: devices that share an IP, or one device seen on several IPs (say, with a VPN on and off), count as one person. Each IP gets a rough location from ip-api.com. Keep it on your home network.

## Controls

The home page lists every Channel with a search bar; each Channel has its own page, e.g. a Channel named "Tech" is at `/tech-tv`.

The player copies YouTube's: click to pause, double-click for full screen, drag the red bar to seek, click **● LIVE** to catch up. Move the mouse to show the controls, including **Exclude** (never show this video on this Channel again).

↑ ↓ change Channel · ← → skip 5s · Shift+N / Shift+P next / previous video · Space/K pause · M mute · C captions · F full screen · G Guide · R Restart · L Go live · Esc back to Channels · hold right-click and scroll for volume

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
