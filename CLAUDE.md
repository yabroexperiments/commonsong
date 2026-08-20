# CLAUDE.md — commonsong

Shared song-generation engines (Mureka + ElevenLabs Music + mock) behind one
`SongEngine` interface. PUBLIC repo, consumed as a SHA-pinned git dep
(workspace rule 5) — **no secrets, no product content, ever**. Keys and
storage are dependency-injected by consumers.

Primary consumer: 唱給你聽 (sing-for-you) — its CLAUDE.md carries the full
measured lore (engine gotchas, timing pipeline, conditioning incidents).
Changes here must keep that consumer green: after any change, bump the pinned
SHA there and run its full offline suite + tsc.

Hard rules:
- Verbatim lyrics are the design invariant — nothing in this package may
  rewrite, trim, or "improve" lyric text.
- `eleven` conditioning stays OFF by default (vocal exemplars can make the
  model sing the exemplar's lyrics — measured 2026-08-20, the 橄欖樹 incident).
- Pure logic (`src/eleven-core.ts`) stays import-free so consumers' offline
  gates can load it under `node --experimental-strip-types`.
- Gates: `npm test` (must pass before any push).
