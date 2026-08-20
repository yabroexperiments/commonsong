/**
 * Pure helpers for the ElevenLabs Music adapter — NO imports (align-core
 * pattern) so `node --experimental-strip-types scripts/test-eleven-offline.mjs`
 * exercises them offline.
 *
 * Probe-established facts these encode (2026-08-19/20 bake-off, see the
 * timing-research artifact):
 *  - music_v2 takes CHUNK plans ({text, duration_ms, positive_styles, ...});
 *    the v1 sections/lines shape 422s.
 *  - ElevenLabs OBEYS duration_ms strictly, so the duration must be budgeted
 *    from character count × singing pace or slow genres squeeze the ending
 *    (measured: 3 lines into a too-small chunk crammed the last 2 lines into
 *    1.7s).
 *  - `words_timestamps` tokenizes on whitespace → per-LINE entries for 中文.
 *    Spaced-char input gives per-char timing but fragments the singing —
 *    REJECTED by ear (AC 2026-08-20). Word-level comes from the recognize
 *    matcher downstream, which is engine-agnostic.
 *  - The response is multipart/mixed: one JSON part + one audio part.
 */

/** Same singing-pace constant family as align-core/recognize-core. */
const CHARS_PER_SECOND = 2.2;
const MIN_CHUNK_MS = 10_000;
const MAX_CHUNK_MS = 118_000; // API cap is 120s per chunk; leave headroom
/** Breathing room beyond the sung characters: intro beat + line gaps + tail. */
const PAD_MS = 6_000;

const CLEAN_RE = /[\s,，。、!！?？.…:：;；'"「」()（）]/g;

export function singableCharCount(lyrics: string): number {
  return [...lyrics.replace(CLEAN_RE, "")].length;
}

/** Duration for the whole message at genre-agnostic pace. ≤200-char messages
 *  (the product cap) stay well inside one chunk's 120s ceiling. */
export function budgetDurationMs(lyrics: string): number {
  const ms = (singableCharCount(lyrics) / CHARS_PER_SECOND) * 1000 + PAD_MS;
  return Math.max(MIN_CHUNK_MS, Math.min(MAX_CHUNK_MS, Math.round(ms)));
}

/**
 * Style TAGS from our assembled stylePrompt. The prompt was written for
 * Mureka: an artist clause ("Reference and imitate the style of X (known for
 * Y): …"), descriptor list, "Mood: …", then a STRICT-structure block that is
 * Mureka-specific (ElevenLabs gets structure from the plan itself, so the
 * block is dropped rather than sent as a bogus style tag).
 */
export function stylePromptToTags(stylePrompt: string): string[] {
  let s = stylePrompt.trim();
  const structureAt = s.indexOf("STRICT structure");
  if (structureAt >= 0) s = s.slice(0, structureAt);
  if (/^Reference and imitate/i.test(s)) {
    const colon = s.indexOf(": ");
    if (colon >= 0) s = s.slice(colon + 2);
  }
  const tags = s
    .split(/[,;.]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 120)
    .slice(0, 45);
  return tags.length > 0 ? tags : [stylePrompt.trim().slice(0, 120)];
}

export interface ElevenChunk {
  text: string;
  duration_ms: number;
  positive_styles: string[];
  negative_styles: string[];
  context_adherence: string;
  conditioning_ref?: { song_id: string; range: { start_ms: number; end_ms: number } };
  condition_strength?: string;
}

export function buildChunks(
  lyrics: string,
  stylePrompt: string,
  opts: { elevenSongId?: string } = {}
): ElevenChunk[] {
  const durationMs = budgetDurationMs(lyrics);
  const chunk: ElevenChunk = {
    text: `[Verse]\n${lyrics.trim()}\n{cold ending}`,
    duration_ms: durationMs,
    positive_styles: stylePromptToTags(stylePrompt),
    negative_styles: ["instrumental intro", "english vocals", "long outro", "instrumental tail"],
    context_adherence: "high",
  };
  if (opts.elevenSongId) {
    chunk.conditioning_ref = {
      song_id: opts.elevenSongId,
      // Exemplar slices are ~31s; condition on what exists, not the whole
      // (possibly longer) budgeted duration.
      range: { start_ms: 0, end_ms: Math.min(durationMs, 30_000) },
    };
    chunk.condition_strength = "high";
  }
  return [chunk];
}

/** words_timestamps → Mureka-shaped timings. Entries are whitespace tokens:
 *  for 中文 that is one entry per lyric LINE; section labels ([Verse]) and
 *  inline directions ({cold ending}) are Latin-only and dropped. Word-level
 *  refinement happens downstream (recognize matcher). */
export function wordsTimestampsToTimings(
  wt: unknown
): unknown | null {
  if (!Array.isArray(wt)) return null;
  const lines = (wt as Array<Record<string, unknown>>)
    .filter(
      (w) =>
        typeof w?.word === "string" &&
        /[㐀-鿿豈-﫿]/.test(w.word as string) &&
        typeof w.start_ms === "number" &&
        typeof w.end_ms === "number"
    )
    .map((w) => ({
      start: w.start_ms as number,
      end: w.end_ms as number,
      text: (w.word as string).trim(),
    }));
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) return null;
  for (let i = 1; i < lines.length; i++) {
    const cur = lines[i];
    const prev = lines[i - 1];
    if (!cur || !prev) continue;
    if (cur.start < prev.start) cur.start = prev.start;
    if (cur.end < cur.start) cur.end = cur.start + 400;
  }
  return [
    {
      section_type: "eleven",
      start: first.start,
      end: lines[lines.length - 1]!.end,
      lines,
    },
  ];
}

/** Minimal multipart/mixed split: returns the JSON part (parsed) and the
 *  audio part (bytes). Shape verified against real responses 2026-08-19. */
export function parseMultipartMixed(
  raw: Buffer,
  contentType: string
): { meta: unknown | null; audio: Buffer | null } {
  const bm = /boundary=([^;]+)/.exec(contentType);
  let meta: unknown | null = null;
  let audio: Buffer | null = null;
  if (!bm || !bm[1]) return { meta, audio };
  const boundary = Buffer.from(`--${bm[1].trim()}`);
  const parts: Buffer[] = [];
  let start = 0;
  for (;;) {
    const i = raw.indexOf(boundary, start);
    if (i < 0) {
      parts.push(raw.subarray(start));
      break;
    }
    parts.push(raw.subarray(start, i));
    start = i + boundary.length;
  }
  for (const part of parts) {
    const sep = part.indexOf("\r\n\r\n");
    if (sep < 0) continue;
    const head = part.subarray(0, sep).toString("utf8").toLowerCase();
    const body = part.subarray(sep + 4);
    if (head.includes("application/json")) {
      try {
        meta = JSON.parse(body.toString("utf8"));
      } catch {
        meta = null;
      }
    } else if (head.includes("audio/")) {
      let end = body.length;
      while (end > 0 && (body[end - 1] === 0x0a || body[end - 1] === 0x0d || body[end - 1] === 0x2d)) {
        end--;
      }
      audio = body.subarray(0, end);
    }
  }
  return { meta, audio };
}
