# VidStash

Download videos to your phone and watch them offline. It runs on iPhone and Android from one codebase (Expo / React Native). See [PLAN.md](PLAN.md) for the roadmap.

## What works now

- **Browser tab:** browse to an episode and press play. The app watches what the page's player loads (inside embedded players too, on iPhone) and lights up a **"⬇ N videos found"** button. Each find is checked first (length, quality, size), so ads and dead links are hidden.
- **Servers:** on sites with a mirror picker (like animexin), the same button lists every server. Tapping one switches the page's player to it.
- **Blocks ad redirects and pop-ups**, with an "Open anyway" button.
- **Downloads tab:** paste a direct video link (`.mp4`, `.m4v`, `.mov`, `.webm`) to download it, or paste an episode page link to open it in the browser.
- Download queue: two at a time, progress, pause/resume, retry, remove. On iPhone, downloads keep going when you leave the app. Finished files are checked, so an error page saved as `.mp4` shows up as a failed download.
- Library grouped by show. Tap to play; long-press to rename, mark as watched, or delete.
- Player: resumes where you left off, Picture-in-Picture, background audio, AirPlay. Episodes count as watched at 90%.
- On iPhone, downloaded files also appear in the Files app (On My iPhone › VidStash).

- **Streams (`.m3u8`)** download too: up to 1080p, AES-128 encrypted streams included, plus streams whose audio is separate (Dailymotion). Pieces download four at a time and are put together into a normal MP4 that plays and seeks offline. Keep the app open while a stream downloads (the screen stays on). If you leave or it gets closed, it picks up from the last finished piece.

### How the main animexin mirrors behave

Tested from a cloud server with Chromium, not yet on a phone:

| Mirror | Found as | Notes |
|---|---|---|
| Dailymotion | Stream | Video and audio are separate streams; the app combines them (tested end to end) |
| ok.ru | Stream | Link is tied to your IP address; switching Wi-Fi ↔ cellular mid-download will break it |
| d.tube | Stream | 1080p/720p/360p (tested end to end) |
| Odysee | MP4 | Refused requests from the cloud server; needs a phone test |
| Rumble, Dood (playmogo) | ? | Cloudflare blocked the cloud server; needs a phone test |
| Streamwish (seekplayer) | ? | Player stalls behind a Google ad in headless Chrome; needs a phone test |
| Mega | ✗ | Decrypts inside the page, so it can't be captured |

## Getting the app

Every push to `main` builds both apps on GitHub Actions and publishes them to the **Latest build** release on this repo's Releases page:

- `VidStash.ipa`: iPhone (unsigned; SideStore signs it with your Apple ID)
- `VidStash.apk`: Android (install directly)

The repo is private, so open the Releases page in Safari while signed in to GitHub to download.

### iPhone install (free, with SideStore)

One-time setup needs your Windows PC:

1. Set up **SideStore** on the iPhone by following the official guide at <https://docs.sidestore.io>. It walks through installing SideStore from Windows and creating the pairing file.
2. On the iPhone, download `VidStash.ipa` from the Latest build release (Safari → Releases → tap the file → it saves to Files).
3. In SideStore: **My Apps → +** → choose `VidStash.ipa`.

A free Apple ID signs apps for 7 days. SideStore refreshes them from the phone, so open SideStore every few days (or let its background refresh run). Free accounts can have up to 3 sideloaded apps active at once, and SideStore counts as one.

To update: download the new `.ipa` and install it the same way. Your library and downloads are kept.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test              # needs Chromium (npx playwright install chromium) and ffmpeg
npx expo start        # dev server
```

Quick testing without installing a build: install **Expo Go** from the App Store, run `npx expo start` on a computer on the same Wi-Fi, and scan the QR code with the iPhone camera. The modules this app uses are all included in Expo Go. Background downloads behave differently there, so use the CI builds for real use.

Layout:

- `app/`: screens (Expo Router). `(tabs)/` holds Library, Browser, Downloads, Settings; `player/[id]` is the player; `episode-form` is the add/edit sheet.
- `lib/db.ts`: SQLite schema and queries.
- `lib/downloads.ts`: download queue.
- `lib/links.ts`: link detection and show/episode name guessing.
- `lib/detector.ts`: the script injected into web pages to find videos and mirror servers.
- `lib/probe.ts`, `lib/hls.ts`: checking found links; HLS playlist parsing.
- `lib/hls-download.ts`: stream downloads (plan → download pieces → assemble). `lib/mp4/`: MP4 box tools and the fragmented-to-regular MP4 writer. `lib/fs-io.ts`: the app's storage for both.
- `tests/`: `npm test` runs unit tests plus detector tests in headless Chromium against offline fixture pages.
- `.github/workflows/build.yml`: CI that builds the APK and IPA and publishes the release.
