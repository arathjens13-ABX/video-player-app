# Plan: Phone Video Downloader + Offline Player

A personal app for iPhone (and Android): find a video on a site, or paste a link, download it to the phone, and watch it offline. It's like JDownloader in your pocket.

## Goals

- **Paste a link** to an episode page or a direct `.mp4`/`.m3u8` URL and get a download.
- **Built-in browser** that detects playable video on the current page and offers a download button.
- **Offline library** that groups downloads by show, remembers where you stopped, and lets you delete files to free space.
- **One codebase** for iOS and Android.

Out of scope: DRM-protected streams, publishing to the App Store or Play Store, and accounts or cloud sync.

## Stack

| Concern | Choice | Why |
|---|---|---|
| App framework | **Expo (React Native) + TypeScript** | One codebase for iOS and Android. Can be built in the cloud, so no Mac is needed. |
| Browser / detection | `react-native-webview` with injected JS in **all frames** | Works inside the embedded players that animexin-type sites use. |
| Downloads | `expo-file-system` | Downloads files to app storage and can resume them. |
| Stream (HLS) handling | Our own TypeScript HLS downloader + `mux.js` to convert the stream into one MP4 | Produces a single `.mp4` that plays on both platforms, without depending on ffmpeg. |
| Player | `expo-video` (AVPlayer on iOS / ExoPlayer on Android) | Native playback, Picture-in-Picture, AirPlay. |
| Library database | `expo-sqlite` | Shows, episodes and watch progress. |
| Navigation | `expo-router` | Tabs: Library, Browser, Downloads, Settings. |

## How detection works (the core trick)

Sites like animexin rarely link to an MP4. The episode page embeds a player from a separate video host. That player usually streams the video as many small chunks (HLS: a `.m3u8` playlist that lists `.ts` or fMP4 segments), and the links are often hidden behind JavaScript and expire quickly. Writing a separate extractor for each site would keep breaking, so we let the site's own player find the stream and we watch what it loads:

1. The WebView injects a script into **every frame**, including cross-origin player iframes.
2. The script patches `fetch` and `XMLHttpRequest`, watches `<video>`/`<source>` `src` changes, and notes `MediaSource` usage.
3. Any URL that looks like media (`.m3u8`, `.mp4`, `.webm`, the matching content types) is posted back to the app along with the page URL and the frame's origin. The app uses these as the `Referer` and `Origin` headers, because many hosts check them.
4. The app de-duplicates what it found. For a master `.m3u8` (a playlist that lists several qualities), it reads the available qualities and offers a choice (1080p / 720p / ...).

**Pasted links:**
- A direct `.mp4` or `.m3u8` link goes straight into the download queue.
- Any other link opens in the browser (shown, or hidden in the background), which auto-taps play where it can and runs the same detection.

## Download engine

- A queue with a setting for how many downloads run at once, plus pause/resume/retry. The queue is saved to SQLite so it survives app restarts.
- **MP4:** a resumable download with the captured headers.
- **HLS:**
  - Read the media playlist and download segments a few at a time, with retries.
  - Handle AES-128 encryption (fetch the key and decrypt each segment with WebCrypto or a small AES library).
  - Convert to MP4 with `mux.js` and write the result to one `.mp4` file a piece at a time, so the whole episode never sits in memory.
  - If conversion fails for a stream, fall back to keeping the segments plus a local playlist and playing them through a tiny local HTTP server.
- **iOS background limits:** iOS suspends apps it considers idle. Version 1 keeps the screen awake while downloading. Later, plain MP4s can use iOS's background download sessions, and HLS can use short background-task windows.

## Player

- Full-screen `expo-video`: resume where you left off, ±10s double-tap, playback speed, Picture-in-Picture, lock screen controls.
- Marks an episode watched at 90% and offers to auto-play the next downloaded episode.

## Data model (SQLite)

- `shows(id, title, cover_path, source_site)`
- `episodes(id, show_id, title, number, file_path, duration, size, position, watched, created_at)`
- `downloads(id, episode_id, url, kind[mp4|hls], headers_json, status, progress, bytes, error, created_at)`

Show and episode names are guessed from the page title. For animexin's format, roughly "Show Name Episode 12 Subtitles". You can always edit them.

## Getting it onto your iPhone

| Option | Needs | Notes |
|---|---|---|
| **Expo Go** (development only) | The free Expo Go app + `npx expo start` on your home computer | Quickest way to try things. Background tasks are limited. |
| **SideStore / AltStore** + unsigned `.ipa` built by GitHub Actions | Free Apple ID; Windows or Mac for the first setup | No paid account needed. The app re-signs itself every 7 days (SideStore can do this on the phone). |
| **Apple Developer ($99/yr)** + EAS Build + TestFlight/ad-hoc | A paid account | Smoothest: installs like a normal app and lasts a year. |

On Android: GitHub Actions builds an APK and you install it directly.

## Milestones

1. **Skeleton:** Expo app with tabs, SQLite, CI that builds an Android APK and an unsigned iOS IPA. *Done when: it installs and launches on your phone.*
2. **Direct downloads:** paste an `.mp4` URL → queue → progress → plays offline. *Done when: an MP4 plays in airplane mode.*
3. **Browser + detection:** in-app browser with the detection script; a "N videos found" button. *Done when: an animexin episode is detected.*
4. **HLS:** segment downloader, AES-128, conversion to MP4, quality picker. *Done when: an HLS episode plays offline.*
5. **Library + player polish:** grouping by show, resume, watched state, storage screen.
6. **Nice-to-haves:**
   - **iOS share sheet:** share a link from Safari straight into the app.
   - Download a whole season (queue every episode link on a series page).
   - Subtitles (`.vtt`).
   - Background downloads.
   - **"Send to home JDownloader"** through the My.JDownloader API, for sites the phone can't handle.

## Risks

- **Hosts that block downloads:** some check headers, tie tokens to your IP, or detect bots. We copy the browser's headers and cookies, but a few hosts may still fail. The home-JDownloader option in milestone 6 covers those.
- **Converting the stream on the phone:** a long episode could be slow or fail. The fallback is the local-server playback described under Download engine.
- **iOS install friction:** this depends on which install option you choose (see the table above).
- **Legal:** this is a general-purpose downloader. What you download, and whether that's allowed where you live, is up to you.
