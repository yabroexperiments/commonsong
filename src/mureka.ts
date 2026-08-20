import type { EngineTake, SongEngine } from "./types.js";

// Mureka lyrics-to-song adapter, per official docs (platform.mureka.ai/docs):
// POST /v1/song/generate → poll GET /v1/song/query/{id}.
// ⚠️ Returned audio URLs expire after ~30 DAYS — permanent pages must re-host.
//
// Field lore carried from the source product (sing-for-you, 2026-08):
//  - the engine ignores duration/structure params (accepted with HTTP 200,
//    silently dropped) and always writes a full-length track;
//  - lyrics_sections timestamps cover only the supplied-lyrics pass, not
//    later re-sung renditions;
//  - the account tier allows ONE in-flight generation account-wide, so
//    concurrency 429s are wait-your-turn, not failures (bounded retry below);
//  - a QUOTA 429 ("exceeded your current quota") means buy credits — never
//    retried.

interface MurekaLyricsWord {
  start: number;
  end: number;
  text: string;
}
interface MurekaLyricsLine {
  start: number;
  end: number;
  text: string;
  words?: MurekaLyricsWord[];
}
export interface MurekaLyricsSection {
  section_type: string;
  start: number;
  end: number;
  lines?: MurekaLyricsLine[];
}

interface MurekaTask {
  id: string;
  model: string;
  status:
    | "preparing"
    | "queued"
    | "running"
    | "streaming"
    | "succeeded"
    | "failed"
    | "timeouted"
    | "cancelled";
  failed_reason?: string;
  choices?: Array<{
    index: number;
    id: string;
    url: string;
    flac_url?: string;
    duration?: number; // milliseconds
    lyrics_sections?: MurekaLyricsSection[];
  }>;
}

/** Mureka pricing page 2026-08-11 — flat per song; re-verify against a live bill. */
const COST_PER_SONG_USD = 0.045;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 60; // hard bound: 60 × 3s = 3min, then fail loudly
const CONCURRENCY_RETRY_ATTEMPTS = 10;
const CONCURRENCY_RETRY_WAIT_MS = 8_000; // one in-flight call runs ~40-80s

export interface MurekaEngineOptions {
  apiKey: string;
  /** Default https://api.mureka.ai */
  baseUrl?: string;
  /** Songs per generate call (n). Mureka bills PER SONG. Default 1. */
  takesPerCall?: number;
  /** Model when the caller passes none. Default "auto". */
  defaultModel?: string;
}

export function createMurekaEngine(opts: MurekaEngineOptions): SongEngine {
  const baseUrl = opts.baseUrl || "https://api.mureka.ai";
  const takesPerCall = opts.takesPerCall ?? 1;

  async function murekaFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Mureka ${path} → HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  async function startGeneration(body: string): Promise<MurekaTask> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await murekaFetch<MurekaTask>("/v1/song/generate", { method: "POST", body });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isConcurrency = msg.includes("HTTP 429") && /concurrent/i.test(msg);
        if (!isConcurrency || attempt >= CONCURRENCY_RETRY_ATTEMPTS) throw err;
        console.warn(
          `[mureka] concurrent-limit 429 — waiting ${CONCURRENCY_RETRY_WAIT_MS / 1000}s for the in-flight call (attempt ${attempt}/${CONCURRENCY_RETRY_ATTEMPTS})`
        );
        await new Promise((r) => setTimeout(r, CONCURRENCY_RETRY_WAIT_MS));
      }
    }
  }

  return {
    id: "mureka",
    async generate({ lyrics, stylePrompt, gender, referenceId, model }): Promise<EngineTake[]> {
      if (!opts.apiKey) throw new Error("mureka engine created without an apiKey");
      const task = await startGeneration(
        JSON.stringify({
          lyrics,
          model: model || opts.defaultModel || "auto",
          prompt: stylePrompt,
          n: takesPerCall,
          ...(gender ? { gender } : {}),
          // Per-genre style exemplar (files/upload purpose=reference). Sent
          // alongside prompt; the documented combos omit reference_id+prompt,
          // so treat the reference as the dominant control when present.
          ...(referenceId ? { reference_id: referenceId } : {}),
        })
      );

      for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const status = await murekaFetch<MurekaTask>(`/v1/song/query/${task.id}`);

        if (status.status === "succeeded") {
          const choices = status.choices ?? [];
          if (choices.length === 0) {
            throw new Error(`Mureka task ${task.id} succeeded with 0 choices`);
          }
          console.log(
            `[mureka] task=${task.id} model=${status.model} songs=${choices.length} ` +
              `cost=$${(choices.length * COST_PER_SONG_USD).toFixed(3)} polls=${attempt}`
          );
          return choices.map((c) => ({
            audioUrl: c.url, // ⚠️ expires in ~30 days — re-host before permanent pages
            durationS: typeof c.duration === "number" ? Math.round(c.duration / 1000) : null,
            costUsd: COST_PER_SONG_USD,
            model: status.model,
            timings: c.lyrics_sections ?? null,
          }));
        }
        if (
          status.status === "failed" ||
          status.status === "timeouted" ||
          status.status === "cancelled"
        ) {
          throw new Error(
            `Mureka task ${task.id} ${status.status}: ${status.failed_reason ?? "no reason given"}`
          );
        }
      }
      throw new Error(
        `Mureka task ${task.id} still not finished after ${MAX_POLL_ATTEMPTS} polls — aborting (attempts bound)`
      );
    },
  };
}
