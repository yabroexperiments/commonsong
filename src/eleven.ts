import { buildChunks, budgetDurationMs, parseMultipartMixed, wordsTimestampsToTimings } from "./eleven-core.js";
import type { EngineTake, SongEngine } from "./types.js";

// ElevenLabs Music (music_v2) adapter — built 2026-08-20 in sing-for-you after
// a measured bake-off (國語 vocal quality on par with Mureka). Pure plan logic
// lives in eleven-core.ts (import-free, offline-testable).
//
// Contract differences vs Mureka that shape this file:
//  - SYNCHRONOUS: one POST returns the finished song (7-11s measured) as
//    multipart/mixed (JSON meta + audio bytes). No polling.
//  - The audio arrives as BYTES, not a URL — the injected `hostAudio` callback
//    stores it and returns a fetchable URL (no 30-day-expiry debt).
//  - Duration is an INPUT (budgeted from char count in eleven-core); the model
//    OBEYS duration_ms strictly, so undersized chunks squeeze the last lines.
//  - Timestamps come back per lyric LINE for 中文 (whitespace tokens).
//  - ⚠️ conditioning_ref is VERBATIM-UNSAFE (measured 2026-08-20): a vocal
//    exemplar at high strength made the model sing the EXEMPLAR's lyrics; low
//    strength corrupted the message; an instrumental at high strength
//    suppressed vocals. Conditioning is therefore opt-in via options and OFF
//    by default.

/** ElevenLabs' published API rate (elevenlabs.io/pricing/api, 2026-08-20):
 *  US$0.15 per minute of generated audio. Subscription credits make the
 *  effective cost lower (~900 credits/min measured); this records the list
 *  price, same convention as Mureka's COST_PER_SONG_USD. */
const USD_PER_MINUTE = 0.15;

const GENERATE_TIMEOUT_MS = 120_000;

export interface ElevenEngineOptions {
  apiKey: string;
  /** Store generated audio bytes, return a fetchable URL. */
  hostAudio: (fileName: string, buf: Buffer, contentType: string) => Promise<string>;
  /** Opt-in exemplar conditioning — see the verbatim-safety warning above.
   *  A function is evaluated per generate() call, so consumers can wire a
   *  runtime settings toggle instead of a deploy-time constant. */
  conditioning?: boolean | (() => boolean | Promise<boolean>);
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createElevenEngine(opts: ElevenEngineOptions): SongEngine {
  return {
    id: "eleven",
    async generate({ lyrics, stylePrompt, elevenSongId }): Promise<EngineTake[]> {
      if (!opts.apiKey) throw new Error("eleven engine created without an apiKey");
      const conditioningOn =
        typeof opts.conditioning === "function"
          ? (await opts.conditioning()) === true
          : opts.conditioning === true;
      if (elevenSongId && !conditioningOn) {
        console.log(
          `[eleven] exemplar ${elevenSongId} available but conditioning is OFF (verbatim-unsafe)`
        );
      }
      const chunks = buildChunks(lyrics, stylePrompt, {
        elevenSongId: conditioningOn ? elevenSongId : undefined,
      });
      const durationMs = budgetDurationMs(lyrics);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), GENERATE_TIMEOUT_MS);
      try {
        const res = await fetch(
          "https://api.elevenlabs.io/v1/music/detailed?output_format=mp3_44100_128",
          {
            method: "POST",
            headers: { "xi-api-key": opts.apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              model_id: "music_v2",
              with_timestamps: true,
              composition_plan: { chunks },
            }),
            signal: ctrl.signal,
          }
        );
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`ElevenLabs music → HTTP ${res.status}: ${body.slice(0, 300)}`);
        }
        const contentType = res.headers.get("content-type") ?? "";
        const raw = Buffer.from(await res.arrayBuffer());
        const { meta, audio } = parseMultipartMixed(raw, contentType);
        if (!audio || audio.length < 20_000) {
          throw new Error(`ElevenLabs returned no usable audio part (${audio?.length ?? 0} bytes)`);
        }
        const audioUrl = await opts.hostAudio(`eleven-${randomHex(8)}.mp3`, audio, "audio/mpeg");
        const timings = wordsTimestampsToTimings(
          (meta as { words_timestamps?: unknown } | null)?.words_timestamps
        );
        const costUsd = Math.round((durationMs / 60_000) * USD_PER_MINUTE * 1000) / 1000;
        console.log(
          `[eleven] generated ${Math.round(durationMs / 1000)}s cost=$${costUsd} ` +
            `timedLines=${Array.isArray(timings) ? ((timings[0] as { lines?: unknown[] }).lines?.length ?? 0) : 0} ` +
            `reference=${conditioningOn ? (elevenSongId ?? "none") : "off"} bytes=${audio.length}`
        );
        return [
          {
            audioUrl,
            durationS: Math.round(durationMs / 1000),
            costUsd,
            model: "music_v2",
            timings,
          },
        ];
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
