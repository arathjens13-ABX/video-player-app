# VidStash

Download videos to your phone and watch them offline. It runs on iPhone and Android from one codebase (Expo / React Native). See [PLAN.md](PLAN.md) for the roadmap.

## What works now

- Paste a direct video link (`.mp4`, `.m4v`, `.mov`, `.webm`), or any link the server reports as a video file. Name the show and episode, then download.
- Download queue: two downloads at a time, progress, pause/resume, retry, remove. On iPhone, downloads keep going when you leave the app.
- Library grouped by show. Tap to play, long-press to rename, mark as watched, or delete.
- Player: resumes where you left off, Picture-in-Picture, background audio, AirPlay. Episodes count as watched at 90%.
- On iPhone, downloaded files also appear in the Files app (On My iPhone › VidStash).

Coming next: the in-app browser that finds the video on a page (milestone 3), then streaming `.m3u8` downloads (milestone 4).

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
npx expo start        # dev server
```

Quick testing without installing a build: install **Expo Go** from the App Store, run `npx expo start` on a computer on the same Wi-Fi, and scan the QR code with the iPhone camera. The modules this app uses are all included in Expo Go. Background downloads behave differently there, so use the CI builds for real use.

Layout:

- `app/`: screens (Expo Router). `(tabs)/` holds Library, Browser, Downloads, Settings; `player/[id]` is the player; `episode-form` is the add/edit sheet.
- `lib/db.ts`: SQLite schema and queries.
- `lib/downloads.ts`: download queue.
- `lib/links.ts`: link detection and show/episode name guessing.
- `.github/workflows/build.yml`: CI that builds the APK and IPA and publishes the release.
