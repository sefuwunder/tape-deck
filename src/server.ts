// tape-deck server: Bun + zero deps. yt-dlp does the heavy lifting.
import { validateUrl, buildArgs, buildSearchArgs, parseProgress, parseSearchOutput, safeName, friendlyError, FORMATS } from "./lib";
import type { FormatKey } from "./lib";

const PORT = 3030;
const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const PUB = `${ROOT}/public`;
const DL = `${ROOT}/downloads`;
await Bun.$`mkdir -p ${DL}`.quiet();

type Job = {
  id: string;
  status: "working" | "done" | "error";
  phase: string;
  progress: number;
  title: string;
  duration: string;
  filename: string;
  error: string;
  proc: Bun.Subprocess | null;
};
const jobs = new Map<string, Job>();
const jobId = () => Math.random().toString(36).slice(2, 10);

const AUDIO_EXT = /\.(mp3|m4a|flac|wav|ogg|opus)$/i;

async function tapes() {
  const out: { name: string; size: number; mtime: number }[] = [];
  for (const f of await Bun.$`ls -1t ${DL}`.quiet().text().then((t) => t.split("\n"))) {
    const n = f.trim();
    if (n && AUDIO_EXT.test(n)) {
      const file = Bun.file(`${DL}/${n}`);
      if (await file.exists()) out.push({ name: n, size: file.size, mtime: 0 });
    }
  }
  return out;
}

function startDownload(url: string, format: FormatKey, title: string, duration: string): Job {
  const job: Job = {
    id: jobId(), status: "working", phase: "downloading", progress: 0,
    title, duration, filename: "", error: "", proc: null,
  };
  jobs.set(job.id, job);

  const proc = Bun.spawn(["yt-dlp", ...buildArgs(url, format, DL)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  job.proc = proc;

  (async () => {
    const dec = new TextDecoder();
    let buf = "";
    const errTail: string[] = [];
    const pump = async (stream: ReadableStream<Uint8Array>, isErr: boolean) => {
      const reader = stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() || "";
          for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            if (isErr) {
              const p = parseProgress(t);
              if (p) {
                job.progress = Math.max(job.progress, p.progress);
                job.phase = p.phase;
              }
              errTail.push(t);
              if (errTail.length > 10) errTail.shift();
            } else if (t && !t.startsWith("[") && /\.(mp3|m4a|flac)$/i.test(t)) {
              // after_move:filepath print
              job.filename = t.split("/").pop() || "";
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    };
    await Promise.all([pump(proc.stdout, false), pump(proc.stderr, true)]);
    const code = await proc.exited;
    if (code === 0 && job.filename) {
      job.status = "done";
      job.progress = 100;
      job.phase = "done";
    } else if (code === 0) {
      // fallback: newest audio file in DL dir
      const list = await tapes();
      if (list.length) {
        job.filename = list[0].name;
        job.status = "done";
        job.progress = 100;
        job.phase = "done";
      } else {
        job.status = "error";
        job.error = "download finished but no file found";
      }
    } else {
      job.status = "error";
      job.error = friendlyError(errTail.join("\n"), code);
    }
    job.proc = null;
  })();

  return job;
}

async function info(url: string) {
  const proc = Bun.spawn(
    ["yt-dlp", "--skip-download", "--no-playlist", "--print", "%(title)s",
     "--print", "%(duration_string)s", "--print", "%(id)s", url],
    { stdout: "pipe", stderr: "pipe" }
  );
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  if (code !== 0) return { ok: false as const, error: "could not read video info" };
  const [title, duration, id] = out.trim().split("\n");
  if (!title) return { ok: false as const, error: "no title found" };
  return { ok: true as const, title: title.trim(), duration: (duration || "").trim(), id: (id || "").trim() };
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

async function toolVersion(cmd: string): Promise<string | null> {
  try {
    const p = Bun.spawn([cmd, "--version"], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(p.stdout).text();
    const code = await p.exited;
    if (code === 0 && out.trim()) return out.trim().split("\n")[0];
  } catch { /* fall through to which */ }
  try {
    const p = Bun.spawn(["which", cmd], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(p.stdout).text();
    await p.exited;
    if (out.trim()) return "installed";
  } catch { /* not found */ }
  return null;
}
const YTDLP_VERSION = await toolVersion("yt-dlp");
const FFMPEG_VERSION = await toolVersion("ffmpeg");

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const u = new URL(req.url);
    const p = u.pathname;

    // ---- static ----
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      return new Response(Bun.file(`${PUB}/index.html`));
    }
    if (req.method === "GET" && !p.startsWith("/api/")) {
      const fp = `${PUB}${p}`.replace(/\/+/g, "/");
      if (!fp.startsWith(PUB) || p.includes("..")) return new Response("nope", { status: 403 });
      const f = Bun.file(fp);
      if (await f.exists()) return new Response(f);
      return new Response("not found", { status: 404 });
    }

    // ---- api ----
    if (p === "/api/health" && req.method === "GET") {
      return json({ ok: true, ytDlp: YTDLP_VERSION, ffmpeg: FFMPEG_VERSION });
    }

    if (p === "/api/info" && req.method === "POST") {
      const { url: raw } = await req.json().catch(() => ({}));
      const v = validateUrl(raw);
      if (!v.ok) return json({ ok: false, error: v.error }, 400);
      return json(await info(v.url!));
    }

    if (p === "/api/search" && req.method === "POST") {
      const { artist = "", title = "" } = await req.json().catch(() => ({}));
      const q = `${artist} ${title}`.trim().replace(/\s+/g, " ");
      if (!q) return json({ ok: false, error: "empty query" }, 400);
      if (q.length > 200) return json({ ok: false, error: "query too long" }, 400);
      const proc = Bun.spawn(["yt-dlp", ...buildSearchArgs(q)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = await new Response(proc.stdout).text();
      const code = await proc.exited;
      if (code !== 0) return json({ ok: false, error: "search failed" });
      const results = parseSearchOutput(out).map((r) => ({
        ...r,
        url: `https://www.youtube.com/watch?v=${r.id}`,
      }));
      return json({ ok: true, results });
    }

    if (p === "/api/download" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const v = validateUrl(body.url);
      if (!v.ok) return json({ ok: false, error: v.error }, 400);
      const format: FormatKey = (FORMATS as any)[body.format] ? body.format : "mp3";
      const meta = await info(v.url!);
      const title = meta.ok ? meta.title : "untitled";
      const duration = meta.ok ? meta.duration : "";
      const job = startDownload(v.url!, format, title, duration);
      return json({ ok: true, jobId: job.id, title, duration });
    }

    const jm = p.match(/^\/api\/jobs\/([\w-]+)$/);
    if (jm && req.method === "GET") {
      const job = jobs.get(jm[1]);
      if (!job) return json({ ok: false, error: "unknown job" }, 404);
      const { proc, ...rest } = job;
      return json({ ok: true, ...rest });
    }

    const js = p.match(/^\/api\/jobs\/([\w-]+)\/cancel$/);
    if (js && req.method === "POST") {
      const job = jobs.get(js[1]);
      if (job?.proc) {
        job.proc.kill();
        job.status = "error";
        job.error = "cancelled";
        return json({ ok: true });
      }
      return json({ ok: false, error: "nothing to cancel" }, 404);
    }

    if (p === "/api/tapes" && req.method === "GET") {
      return json({ ok: true, tapes: await tapes() });
    }

    const tm = p.match(/^\/api\/tapes\/(.+)$/);
    if (tm && req.method === "GET") {
      const name = decodeURIComponent(tm[1]);
      if (!safeName(name)) return new Response("nope", { status: 403 });
      const f = Bun.file(`${DL}/${name}`);
      if (!(await f.exists())) return new Response("not found", { status: 404 });
      const dl = u.searchParams.get("dl") === "1";
      return new Response(f, {
        headers: dl ? { "Content-Disposition": `attachment; filename="${name}"` } : {},
      });
    }

    if (tm && req.method === "DELETE") {
      const name = decodeURIComponent(tm[1]);
      if (!safeName(name)) return json({ ok: false }, 403);
      await Bun.$`rm -f ${DL}/${name}`.quiet();
      return json({ ok: true });
    }

    return json({ ok: false, error: "unknown route" }, 404);
  },
});

console.log(`tape-deck on http://127.0.0.1:${PORT}`);
console.log(`yt-dlp: ${YTDLP_VERSION ?? "NOT FOUND"} | ffmpeg: ${FFMPEG_VERSION ?? "NOT FOUND"}`);
