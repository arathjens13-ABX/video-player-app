# Security notes

VidStash loads untrusted web pages and downloads from servers it doesn't control. This file records what it trusts, what it defends against, and the risks knowingly accepted. Last reviewed October 2026.

## Where untrusted input comes in

| Source | What it can send | Defences |
|---|---|---|
| Web pages and ads in the Browser tab (any frame) | Messages to the app via `postMessage` | `lib/detector-messages.ts`: only well-formed messages; links must be `http(s)`; season-list entries must be on the list's own site; counts and string lengths capped |
| The same pages | Redirects, pop-ups, app-store jumps | `lib/browser.ts` `shouldBlockNavigation` (any cross-site top-frame move needs "Open anyway"); pop-ups blocked; the hidden season-download browser only follows its own site |
| Video servers | Playlists, stream pieces, MP4 files, keys | Size caps (playlist 10 MB / 50,000 pieces, piece 512 MB); pieces checked (`checkPart`), finished files sniffed (`lib/sniff.ts`); AES key length checked; parsers fail with ordinary errors on corrupt data |
| Image hosts | Show posters | `http(s)` only, image content type, 5 MB cap; saved under a hashed name |
| Other apps | `vidstash://open?url=…` links | Only `http(s)` links; downloads always go through the confirm form |

Nothing from a site picks a file name or path: videos are `<id>.mp4`, thumbnails `<id>`, posters a hash, stream pieces a folder per id. Database queries use parameters.

## Fuzzing (October 2026)

Mutation fuzzing of the stream pipeline (playlist parser, MPEG-TS → MP4 via mux.js, the MP4 writer) with ~18,000 corrupted playlists and ~5,400 corrupted stream assemblies found and fixed:

- **mux.js** looped forever on an AAC frame with a corrupt length of 0, until out of memory (an app crash from a 3-byte corruption). Fixed in `patches/mux.js+6.3.0.patch`, applied by `patch-package` on install. Upstream 6.3.0 is unpatched.
- **MP4 writer** trusted a fragment's sample count (up to 4 billion), taking ~50 s and then failing. Counts are now checked against the table and data that hold them.
- A 200,000-entry playlist took ~5 s to read (longer on a phone): playlists are now capped.

`tests/hostile-input.test.ts` keeps both crash cases and a small fixed-seed fuzz run in the normal test suite.

## Accepted risks

- **Plain HTTP is allowed** (`NSAllowsArbitraryLoads`, Android cleartext): some video hosts only serve HTTP. Those connections aren't encrypted.
- **Dependency advisories** (`npm audit`): the high-severity ones (node-forge, zod, @expo/cli) are build tools, not shipped. `decode-uri-component`/`query-string` ship inside expo-router: a crafted `vidstash://` link could make the app hang while parsing it (no code execution). The fix arrives with Expo SDK 58's expo-router.
- **Pages run their own scripts** inside the WebView sandbox, as in any browser; the injected detector runs in every frame and exposes only the message channel above.
- **Diagnostics** record which sites and shows were used (never link tokens). The report leaves the phone only via Share.
- **Sideloading** (SideStore/iloader) signs in with the user's Apple ID through third-party tools; a separate Apple ID for sideloading limits that exposure.
