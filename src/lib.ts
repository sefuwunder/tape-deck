// tape-deck lib: pure helpers (URL validation, yt-dlp arg building,
// progress parsing, filename safety). Zero deps, fully testable.

export const FORMATS = {
  mp3: { label: "TYPE I", desc: "MP3 192k" },
  m4a: { label: "TYPE II", desc: "M4A 256k" },
  flac: { label: "METAL", desc: "FLAC lossless" },
} as const;
export type FormatKey = keyof typeof FORMATS;

const URL_RE =
  /^(https?:\/\/)?(www\.|music\.|m\.)?(youtube\.com\/(watch\?[^ ]*v=|shorts\/|embed\/|live\/)|youtu\.be\/)[\w-]{11}[A-Za-z0-9\-_?=&%.~]*$/;

export function validateUrl(raw: string): { ok: boolean; url?: string; error?: string } {
  const url = (raw || "").trim();
  if (!url) return { ok: false, error: "empty url" };
  if (!URL_RE.test(url)) return { ok: false, error: "not a youtube url" };
  const full = url.startsWith("http") ? url : "https://" + url;
  return { ok: true, url: full };
}

/** Build yt-dlp argv for an audio download. outDir must exist. */
export function buildArgs(url: string, format: FormatKey, outDir: string): string[] {
  const args = [
    "--no-playlist",
    "--restrict-filenames",
    "--newline",
    "--print",
    "after_move:filepath",
    "-o",
    `${outDir}/%(title).60s_[%(id)s].%(ext)s`,
  ];
  if (format === "mp3") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "192K");
  } else if (format === "m4a") {
    args.push("-f", "bestaudio[ext=m4a]/bestaudio/best");
  } else {
    args.push("-x", "--audio-format", "flac");
  }
  args.push(url);
  return args;
}

/** Parse a yt-dlp stderr line. Returns {progress, phase} or null. */
export function parseProgress(
  line: string
): { progress: number; phase: "downloading" | "converting" } | null {
  if (line.includes("[ExtractAudio]")) return { progress: 95, phase: "converting" };
  const m = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/);
  if (!m) return null;
  const pct = Math.min(100, Math.max(0, parseFloat(m[1])));
  // reserve the top 10% for the extract/convert step
  return { progress: Math.round(pct * 0.9), phase: "downloading" };
}

/** True if a tape filename is safe to serve from the downloads dir. */
export function safeName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length < 256 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("..") &&
    /\.(mp3|m4a|flac|wav|ogg|opus|webm)$/i.test(name)
  );
}

/** "3:45" -> 225 seconds. Handles H:MM:SS too. */
export function durationToSec(s: string): number {
  const parts = (s || "").trim().split(":").map(Number);
  if (parts.some(isNaN)) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
