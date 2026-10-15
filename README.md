# tape-deck

A YouTube audio downloader with a 16-bit soul — the whole thing is a
cassette deck. Paste a URL, press **● REC**, and watch the reels spool
while yt-dlp lays the audio down to "tape."

## The metaphor

- **● REC** — downloads the audio (this is the download button)
- **Reels + tape counter** — spool and advance with download progress;
  the tape pack visibly shifts from the left reel to the right
- **▶ PLAY** — plays the finished tape through the deck; VU needles dance
  to the real audio via WebAudio, reels spin
- **■ STOP** — stops playback, or cancels a recording in progress
- **◀◀ / ▶▶** — seek ∓10s during playback
- **EJECT ⤓** — downloads the file to your device
- **Tape type** — TYPE I = MP3 192k, TYPE II = M4A 256k, METAL = FLAC
- **Tape shelf** — your recorded collection; LOAD puts a tape back in the deck

## Run it

Needs Bun, yt-dlp, and ffmpeg on the machine:

```sh
bun src/server.ts
# → http://127.0.0.1:3030
```

Single videos only (`--no-playlist` is always passed). Files land in
`downloads/`.

## Layout

- `src/server.ts` — Bun + zero deps: static files, `/api/info`,
  `/api/download`, `/api/jobs/:id` (+ `/cancel`), `/api/tapes`
- `src/lib.ts` — pure helpers: URL validation, yt-dlp arg building,
  progress parsing, filename safety
- `public/index.html` — the whole deck: pixel CSS, transport logic,
  WebAudio VU meters (no build step, no framework)
- `tests/lib.test.ts` — 19 bun tests

## Notes

- Downloads are single-track; playlists are refused at the door.
- Progress comes from yt-dlp's `--newline` output; the top 10% of the
  counter is reserved for the extract/convert step.
- Filenames are `--restrict-filenames`'d and include the video id, so
  collisions are near-impossible; served files are extension-allowlisted.

## Troubleshooting

- The deck shows the real reason a download fails (bot-check, rate
  limit, unavailable video, ...). `GET /api/health` reports the
  yt-dlp/ffmpeg versions the server sees.
- Most "code 1" failures are an outdated yt-dlp — YouTube changes
  things often. Update it: `yt-dlp -U` (or reinstall if yours came
  from a distro package).
- `429 / too many requests` means YouTube is throttling that IP —
  wait a few minutes and hit REC again.
