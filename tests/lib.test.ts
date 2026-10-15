import { describe, test, expect } from "bun:test";
import { validateUrl, buildArgs, parseProgress, safeName, durationToSec } from "../src/lib";

describe("validateUrl", () => {
  test("accepts watch urls", () => {
    const r = validateUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(r.ok).toBe(true);
  });
  test("accepts youtu.be", () => {
    expect(validateUrl("https://youtu.be/dQw4w9WgXcQ").ok).toBe(true);
  });
  test("accepts shorts", () => {
    expect(validateUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ").ok).toBe(true);
  });
  test("accepts music.youtube.com", () => {
    expect(validateUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ").ok).toBe(true);
  });
  test("rejects non-youtube", () => {
    const r = validateUrl("https://vimeo.com/12345");
    expect(r.ok).toBe(false);
  });
  test("rejects empty", () => {
    expect(validateUrl("").ok).toBe(false);
  });
  test("rejects injection", () => {
    expect(validateUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ; rm -rf /").ok).toBe(false);
  });
});

describe("buildArgs", () => {
  test("mp3 extracts at 192k", () => {
    const a = buildArgs("https://youtu.be/abc123def45", "mp3", "/tmp/dl");
    expect(a).toContain("--audio-format");
    expect(a).toContain("mp3");
    expect(a).toContain("--no-playlist");
    expect(a[a.length - 1]).toBe("https://youtu.be/abc123def45");
  });
  test("m4a keeps native audio", () => {
    const a = buildArgs("https://youtu.be/abc123def45", "m4a", "/tmp/dl");
    expect(a).toContain("bestaudio[ext=m4a]/bestaudio/best");
    expect(a).not.toContain("-x");
  });
  test("flac extracts lossless", () => {
    const a = buildArgs("https://youtu.be/abc123def45", "flac", "/tmp/dl");
    expect(a).toContain("flac");
  });
});

describe("parseProgress", () => {
  test("parses download percent, reserving headroom", () => {
    const p = parseProgress("[download]  50.0% of ~4.20MiB at 1.20MiB/s ETA 00:03");
    expect(p).toEqual({ progress: 45, phase: "downloading" });
  });
  test("detects extract phase", () => {
    const p = parseProgress("[ExtractAudio] Destination: song.mp3");
    expect(p).toEqual({ progress: 95, phase: "converting" });
  });
  test("ignores other lines", () => {
    expect(parseProgress("[youtube] Extracting video information")).toBeNull();
    expect(parseProgress("")).toBeNull();
  });
});

describe("safeName", () => {
  test("accepts audio files", () => {
    expect(safeName("song_[abc123].mp3")).toBe(true);
  });
  test("rejects traversal", () => {
    expect(safeName("../secret")).toBe(false);
    expect(safeName("a/b.mp3")).toBe(false);
  });
  test("rejects non-audio", () => {
    expect(safeName("evil.sh")).toBe(false);
  });
});

describe("durationToSec", () => {
  test("m:ss", () => expect(durationToSec("3:45")).toBe(225));
  test("h:mm:ss", () => expect(durationToSec("1:02:03")).toBe(3723));
  test("garbage", () => expect(durationToSec("live")).toBe(0));
});
