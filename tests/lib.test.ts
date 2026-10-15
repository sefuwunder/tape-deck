import { describe, test, expect } from "bun:test";
import { validateUrl, buildArgs, buildSearchArgs, parseProgress, parseSearchOutput, safeName, durationToSec, friendlyError } from "../src/lib";

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

describe("buildSearchArgs", () => {
  test("ytsearch with flat playlist", () => {
    const a = buildSearchArgs("rick astley never gonna give you up");
    expect(a[0]).toBe("ytsearch5:rick astley never gonna give you up");
    expect(a).toContain("--flat-playlist");
    expect(a).toContain("%(id)s\t%(title)s");
  });
  test("count clamped", () => {
    expect(buildSearchArgs("x", 99)[0].startsWith("ytsearch10:")).toBe(true);
    expect(buildSearchArgs("x", 0)[0].startsWith("ytsearch1:")).toBe(true);
  });
});

describe("parseSearchOutput", () => {
  test("parses tab-separated lines", () => {
    const out = parseSearchOutput(
      "dQw4w9WgXcQ\tRick Astley - Never Gonna Give You Up\n" +
      "abc123def45\tSome Other Song\n" +
      "\n" +
      "garbage-line-without-tab\n"
    );
    expect(out).toEqual([
      { id: "dQw4w9WgXcQ", title: "Rick Astley - Never Gonna Give You Up" },
      { id: "abc123def45", title: "Some Other Song" },
    ]);
  });
  test("rejects bad ids", () => {
    expect(parseSearchOutput("short\tTitle")).toEqual([]);
  });
  test("empty", () => {
    expect(parseSearchOutput("")).toEqual([]);
  });
});

describe("friendlyError", () => {
  test("bot check", () => {
    expect(friendlyError("ERROR: Sign in to confirm you're not a bot", 1))
      .toMatch(/bot-check/i);
  });
  test("unavailable", () => {
    expect(friendlyError("ERROR: Video unavailable", 1)).toMatch(/unavailable/i);
  });
  test("rate limit", () => {
    expect(friendlyError("ERROR: HTTP Error 429: Too Many Requests", 1))
      .toMatch(/rate-limited/i);
  });
  test("falls back to last line", () => {
    expect(friendlyError("WARNING: blah\nERROR: something broke badly", 1))
      .toBe("something broke badly");
  });
  test("falls back to code", () => {
    expect(friendlyError("", 1)).toBe("yt-dlp exited with code 1");
  });
});
