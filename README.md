# VidStash

Download videos to your phone and watch them offline. It runs on iPhone and Android from one codebase (Expo / React Native). See [PLAN.md](PLAN.md) for the roadmap.

## What works now

- **Browser tab:** browse to an episode and press play. The app watches what the page's player loads (inside embedded players too, on iPhone) and lights up a **"⬇ N videos found"** button. Each find is checked first (length, quality, size), so ads and dead links are hidden.
- **Servers:** on sites with a mirror picker (like animexin), the same button lists every server. Tapping one switches the page's player to it.
- **Blocks ad redirects and pop-ups**, with an "Open anyway" button.
- **Downloads tab:** paste a link, or text containing one. Video files and streams go to the download form; episode pages open in the browser.
- **Share sheet:** send links from Safari or other apps (see *Send links from anywhere* below).
- Download queue: two at a time, progress, pause/resume, retry, remove. On iPhone, downloads keep going when you leave the app. Finished files are checked, so an error page saved as `.mp4` shows up as a failed download.
- Library grouped by show, episodes in number order. Tap to play; long-press to rename, mark as watched, or delete.
- Player: resumes where you left off, Picture-in-Picture, background audio, AirPlay. Episodes count as watched at 90%. When one ends, the next downloaded episode starts after a 5-second countdown.
- On iPhone, downloaded files also appear in the Files app (On My iPhone › VidStash).

- **Streams (`.m3u8`)** download too: up to 1080p, AES-128 encrypted streams included, plus streams whose audio is separate (Dailymotion). Pieces download four at a time and are put together into a normal MP4 that plays and seeks offline. Keep the app open while a stream downloads (the screen stays on). If you leave or it gets closed, it picks up from the last finished piece.

### How the main animexin mirrors behave

Tested from a cloud server with Chromium, not yet on a phone:

| Mirror | Found as | Notes |
|---|---|---|
| Dailymotion | Stream | Video and audio are separate streams; the app combines them (tested end to end) |
| ok.ru | Stream | Tested end to end. Link is tied to your IP address; switching Wi-Fi ↔ cellular mid-download will break it |
| d.tube | Stream | 1080p/720p/360p (tested end to end) |
| Odysee | MP4 | Refused requests from the cloud server; needs a phone test |
| Rumble, Dood (playmogo) | ? | Cloudflare blocked the cloud server; needs a phone test |
| Streamwish (seekplayer) | ? | Player stalls behind a Google ad in headless Chrome; needs a phone test |
| Mega | ✗ | Decrypts inside the page, so it can't be captured |
| Vidara (animekhor) | Stream | Detected |
| Bysekoze / upns / p2pstream (animekhor) | ? | Domain-locked or unreachable from the cloud server; needs a phone test |

Other sites checked with the same detector: **donghuastream.org**, **luciferdonghua.in** and **animekhor.org** all list their servers and their Dailymotion streams are found. luciferdonghua's ok.ru server was tested end to end. All four sites use the same WordPress theme, so other sites built on it should work too.

## Getting the app

Every push to `main` builds both apps on GitHub Actions and publishes them to the **Latest build** release on this repo's Releases page:

- `VidStash.ipa`: iPhone (unsigned; SideStore signs it with your Apple ID)
- `VidStash.apk`: Android (install directly)

The repo is private, so open the Releases page in Safari while signed in to GitHub to download.

### iPhone install (free, with SideStore)

See **[USER_GUIDE.md](USER_GUIDE.md)** for step-by-step setup (SideStore with iloader + LocalDevVPN, installing VidStash, first download, the 7-day refresh, troubleshooting).

## Send links from anywhere (Share → VidStash)

Set up a one-time Shortcut so VidStash shows up in the iPhone share sheet:

1. Open the **Shortcuts** app → **+** → name it **Send to VidStash**.
2. Tap the **ⓘ** (details) button → turn on **Show in Share Sheet** → under *Share Sheet types*, keep only **URLs** and **Text**.
3. Add the action **URL Encode** (it encodes the *Shortcut Input*).
4. Add **Text** and type `vidstash://open?url=`, then insert the *URL Encoded Text* variable right after it.
5. Add **Open URLs** (it opens the Text).

Now in Safari, or any app that shares a link: **Share → Send to VidStash**. Episode pages open in VidStash's browser; direct video links go straight to the download form.

Any app or tool can do the same with a `vidstash://open?url=<encoded link>` link.

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
- `tests/`: `npm test` runs unit tests, detector tests in headless Chromium against offline fixture pages, and end-to-end stream downloads of ffmpeg-made fixtures checked with ffprobe.
- `scripts/hermes/check.sh`: runs the stream pipeline in the Hermes VM (the phone's JavaScript engine) and checks the output is byte-identical to Node's. Needs a Hermes build; see the script header.
- `.github/workflows/build.yml`: CI that builds the APK and IPA and publishes the release.
