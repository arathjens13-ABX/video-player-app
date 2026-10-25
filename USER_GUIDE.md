# VidStash: Getting Started

This guide takes you from nothing to watching your first downloaded episode offline. It's written for an **iPhone** and a **Windows PC**.

There are three parts:

1. **Set up SideStore** (one time, about 20–30 minutes). SideStore lets you install apps that aren't on the App Store, using your free Apple account.
2. **Install VidStash** (about 2 minutes).
3. **Download and watch an episode.**

---

## What you need

- Your iPhone (iOS 15 or newer) with a passcode set.
- Your Windows PC (64-bit; nearly all are).
- A **USB cable** for the iPhone.
- Your **Apple account** (Apple ID) email and password.
- **Wi-Fi**. SideStore needs Wi-Fi, not mobile data, to install and refresh apps.

---

## Part 1: Set up SideStore (one time)

### On your iPhone

1. Open the **App Store** and install **LocalDevVPN** (free).
2. Open LocalDevVPN and tap **Connect**. If asked to "Allow VPN Configurations", tap **Allow** and enter your passcode.
   - This VPN only lets SideStore talk to your phone. It doesn't route your internet anywhere. It needs to be connected whenever you install or refresh apps in SideStore.

### On your Windows PC

3. Install **iTunes**. Apple's own download from apple.com works best; the Microsoft Store version is the fallback.
4. Download and install **iloader**. Get it from the link on SideStore's official page: <https://docs.sidestore.io/docs/installation/prerequisites> (choose the Windows **MSI** installer).
5. Plug your iPhone into the PC with the USB cable. If the iPhone asks "Trust This Computer?", tap **Trust** and enter your passcode.
6. Open **iloader** and sign in with your Apple account. The password is case-sensitive.
7. Select your iPhone, then click **Install SideStore (Stable)**. Wait for it to finish.

### Back on your iPhone

8. Open **Settings → General → VPN & Device Management**. Under "Developer App", tap your Apple account and then **Trust**.
   - On iOS 18 the button says **Allow & Restart**. Tap it and enter your passcode.
9. On iOS 16 or newer: go to **Settings → Privacy & Security**, scroll to the bottom, and turn on **Developer Mode**. The phone restarts.
10. Open **LocalDevVPN** and tap **Connect**.
11. Open **SideStore** and sign in with the same Apple account you used in iloader.
12. Go to **My Apps** and tap the **7 DAYS** button next to SideStore to finish setting it up. If it asks about a signing certificate, tap **Yes** / **Refresh Now**.

SideStore is ready. You won't need the PC again unless something goes badly wrong.

> If you get stuck in Part 1, SideStore's own guide has screenshots and a troubleshooting page: <https://docs.sidestore.io>

---

## Part 2: Install VidStash

1. On your iPhone, open **Safari**. (No GitHub account needed: the repo is public.)
2. Go to your repo's **Releases** page: `github.com/arathjens13-ABX/video-player-app/releases`
3. Under **Latest build**, tap **VidStash.ipa** to download it. It saves to the Files app (Downloads).
4. Make sure **LocalDevVPN is connected** and you're on **Wi-Fi**.
5. Open **SideStore → My Apps → +** (top left), then pick **VidStash.ipa** from Downloads.
6. Wait for it to install. **VidStash** appears on your home screen.

> **If "Latest build" is out of date** (the newest build failed to publish): sign in to GitHub in Safari, then open the repo's **Actions** tab, tap the newest green **Build apps** run on `main`, scroll down to **Artifacts** and tap **VidStash-ios**. That downloads a zip. In the Files app, tap the zip to unzip it, then install the `VidStash.ipa` inside it with SideStore (steps 4–6 above).

---

## Part 3: Download your first episode

1. Open **VidStash** and go to the **Browser** tab.
2. Tap **AnimeXin** (or type an address at the top) and open an **episode page**.
3. **Press play** on the video in the page. Ads may play first; let them, or skip them.
4. Watch the button at the bottom. When it turns blue and says **"⬇ 1 video found"**, tap it.
5. Each video found shows its **length** and **quality**. Tap **Download** on the one that looks like the full episode (around 15–25 minutes, not a 30-second ad).
6. Check the **Show** and **Episode** names (usually filled in for you), pick a **Quality** if it's a stream, and tap **Download** at the top right.
7. Go to the **Downloads** tab to watch progress.
   - Some videos are **streams** that come in many small pieces ("120 of 460 pieces"). **Keep VidStash open** until these finish. The screen stays on by itself. If you leave, the download picks up where it stopped next time you open the app.
   - **MP4** downloads keep going even if you leave the app.

### If no video is found

- Tap the bottom button anyway. It lists the page's **Servers** (Dailymotion, ok.ru, Rumble…). Tap a different one, press play again, and wait for "video found".
- On AnimeXin, **Dailymotion**, **ok.ru** and **Dtube** are the most likely to work. **Mega** never works (it scrambles the video inside the page).

### If a download fails

- **Retry** tries again.
- **Find again** reopens the episode page. Press play, then download the video again, and it replaces the broken link on the same download. Use this when the error mentions an expired link or 403. Many sites' links only last a few hours.

---

## Downloading several episodes at once

1. In the **Browser**, open a show's episode list (the season page), or any episode page that lists the other episodes.
2. Tap the bottom button, then **Download several…**
3. Pick the episodes: **Next 10** (after the last one you have), **Latest 10**, **All**, or type a range like 40 to 60. Episodes you already have are skipped.
4. Pick a **Quality** (720p is the default and about half the size of 1080p).
5. Check the **Space** box. VidStash checks one episode and shows roughly how big the whole batch is and how much free space you'll have left.
6. Tap **Download N episodes**.

How it works and what to expect:

- It uses the **server you last switched to** on that site (for example Dailymotion). If an episode doesn't have that server, it uses whatever the episode page plays first.
- Each episode's video is found right before it downloads, one at a time, so links don't expire while they wait. **Keep VidStash open** while it runs (the screen stays on).
- It **never takes your phone below 20 GB free**. If it gets there, it stops and says so: delete some episodes, then tap **Resume**.
- The **Downloads** tab shows the list under **Season downloads**, with **Pause**, **Resume** and **Stop**. An episode whose video can't be found is marked so; tap **Retry**, or **Open page** to do it by hand.

## Watching offline

- Go to the **Library** tab. **Continue watching** at the top has the episode you stopped partway through (or the next one) for each show you're watching. Below it is your list of **Shows**: search by name, and sort by **Recently watched**, **A–Z** or **Recently added**.
- **Tap a show** to open it: a **Resume / Play** button for where you left off, then all its episodes in order.
- Tap an episode to play it. It opens **sideways and full screen**, even with your rotation lock on (turn this off in Settings → Player). It remembers where you stopped, and the next episode starts automatically when one finishes (5-second countdown, with Cancel).
- In the player, tap the video to show the controls:
  - **Double-tap** the left or right side to skip back or forward 10 seconds; keep tapping to skip more.
  - **Skip intro** (first few minutes) jumps ahead 90 seconds.
  - Top bar: **speed** (1× → 1.25× → 1.5× → 2× → 0.75×), **AirPlay**, **Picture in Picture**, and **rotate** (sideways ↔ upright).
  - Drag along the bar at the bottom to jump anywhere.
- Long-press an **episode** to rename it, mark it watched, or delete it.
- On a show's page, **•••** (top right) marks the whole show watched, **deletes the watched episodes**, or deletes the show. Long-pressing a show in the list does the same.
- Your videos also appear in the **Files** app under *On My iPhone › VidStash*.

---

## Optional: "Send to VidStash" from Safari

This lets you find an episode in normal Safari and send it straight to VidStash.

1. Open the **Shortcuts** app and tap **+**. Name the shortcut **Send to VidStash**.
2. Tap the **ⓘ** button, turn on **Show in Share Sheet**, and under share types keep only **URLs** and **Text**.
3. Add the action **URL Encode** (it encodes the Shortcut Input).
4. Add a **Text** action. Type `vidstash://open?url=` and then insert the **URL Encoded Text** variable right after it (no space).
5. Add **Open URLs**.

Now in Safari tap **Share → Send to VidStash**.

---

## Keeping it working

- **Every 7 days** apps installed with a free Apple account expire. To keep VidStash working: connect **LocalDevVPN**, be on **Wi-Fi**, open **SideStore → My Apps** and tap the **days** button next to VidStash (and SideStore). Doing this every few days is easiest.
- If an app does expire, nothing is lost. Refresh it in SideStore and your downloads are still there.
- **Updating VidStash:** download the new `VidStash.ipa` from the Releases page and install it the same way (My Apps → +). Your library is kept.
- Settings → **Clean up leftover files** frees space used by unfinished downloads.

---

## Troubleshooting

| Problem | Try this |
|---|---|
| SideStore says it can't connect | Open LocalDevVPN and tap Connect. Make sure you're on Wi-Fi. |
| VidStash won't open / "no longer available" | It expired: refresh it in SideStore (see *Keeping it working*). |
| "No video yet" stays grey | Press play in the page and wait for ads to finish. Then try another server from the same button. |
| Found a video but it's 30 seconds long | That's an ad. Pick the longer one, or wait: the real episode usually shows up after the ad. |
| Download error mentions 403 / expired | Tap **Find again** on the download. |
| "Not enough free space" | Delete watched episodes (long-press a show in Library) or pick a lower quality. |
| Stream download stopped when I left the app | Normal for streams. Open VidStash again and it continues. |
| Anything else odd | Settings → Diagnostics → **Share report** and send it to me. |

---

## Please tell me (for the next round of fixes)

After you've tried it, go to **Settings → Diagnostics → Share report** (or **Copy report**) and send me the report. It records what the browser found on each page, why links were rejected, and exactly how each download went, so I can fix things without guessing. If you want a clean report for one specific problem, tap **Clear** first, reproduce the problem, then share.

Also tell me:

1. Did SideStore and VidStash install OK?
2. On an AnimeXin episode: **which servers showed "video found"**, and which didn't?
3. Did the downloads **play** in the Library (with sound in sync)?
4. Anything confusing, slow or broken.
