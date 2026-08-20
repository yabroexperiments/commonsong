/**
 * Provider-agnostic song-engine contract, extracted from 唱給他聽
 * (sing-for-you) 2026-08-20 so other products can reuse the engines the same
 * way commonpayment shares the payment rails.
 *
 * Design invariant carried over from the source product: LYRICS ARE SUNG
 * VERBATIM — engines receive final lyric text and must never be handed
 * anything the product would not accept being sung. Style steering happens
 * via `stylePrompt` (and provider-specific reference mechanisms), never by
 * rewriting lyrics.
 */

export interface EngineTake {
  /** Fetchable URL of the generated audio. Mureka returns its own CDN URL
   *  (expires ~30 days — the consumer must re-host for permanence);
   *  ElevenLabs returns bytes which the adapter hosts via the injected
   *  `hostAudio` callback, so its URLs are already the consumer's own. */
  audioUrl: string;
  durationS: number | null;
  /** List-price cost of this take in USD (see each adapter's constant for
   *  provenance) — null when unknown. */
  costUsd: number | null;
  model: string;
  /** Per-section/line/word timestamps in the Mureka lyrics_sections shape
   *  ([{section_type, start, end, lines: [{start, end, text, words?}]}]).
   *  Null when the engine provides none. Callers should treat these as the
   *  engine's CLAIM about timing, not ground truth. */
  timings?: unknown | null;
}

export interface SongGenerateInput {
  /** Final lyric text, newline-separated lines. Sung verbatim. */
  lyrics: string;
  /** English style/genre description. */
  stylePrompt: string;
  /** Product-side style identifier — opaque to engines, present for logs. */
  style?: string;
  gender?: "female" | "male";
  /** Mureka style-reference file id (files/upload purpose=reference). */
  referenceId?: string;
  /** ElevenLabs song_id of an exemplar (music/upload) for conditioning.
   *  ⚠️ Only used when the adapter was created with conditioning enabled —
   *  measured 2026-08-20: conditioning on a vocal exemplar can make the model
   *  sing the EXEMPLAR's lyrics instead of the message. */
  elevenSongId?: string;
  /** Engine model override (A/B testing). Default: adapter's own default. */
  model?: string;
}

export interface SongEngine {
  id: string;
  /** Generate 1–N takes for the given lyrics + style prompt. */
  generate(input: SongGenerateInput): Promise<EngineTake[]>;
}
