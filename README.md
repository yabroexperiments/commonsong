# commonsong

Provider-agnostic AI song-generation engines, shared across the
yabroexperiments portfolio the same way [commonpayment] shares the payment
rails. Extracted from 唱給他聽 (sing-for-you) on 2026-08-20.

Engines:

- **`createMurekaEngine`** — Mureka lyrics-to-song (async task + poll, per-song
  billing, bounded concurrency-429 retry, style `reference_id` support).
  ⚠️ Mureka audio URLs expire in ~30 days; consumers must re-host.
- **`createElevenEngine`** — ElevenLabs Music `music_v2` (synchronous, per-minute
  billing, duration budgeted from character count, per-line 中文 timestamps).
  Audio arrives as bytes: the consumer injects `hostAudio` to store it.
  ⚠️ `conditioning` is off by default — measured 2026-08-20, conditioning on a
  vocal exemplar can make the model sing the exemplar's lyrics instead of the
  user's message.
- **`createMockEngine`** — instant zero-cost demo takes; consumer UI must label
  mock output as a demo.

All engines implement one interface:

```ts
import { createMurekaEngine, createElevenEngine, type SongEngine } from "commonsong";

const mureka = createMurekaEngine({ apiKey: process.env.MUREKA_API_KEY! });
const eleven = createElevenEngine({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  hostAudio: async (name, buf, type) => uploadToYourStorage(name, buf, type),
});

const takes = await mureka.generate({
  lyrics: "第一行\n第二行",
  stylePrompt: "1970s taiwanese campus folk, fingerpicked nylon guitar",
});
// takes[0]: { audioUrl, durationS, costUsd, model, timings }
```

Design invariant carried from the source product: **lyrics are sung verbatim**
— engines receive final lyric text; style steering happens via `stylePrompt`
and provider reference mechanisms, never by rewriting lyrics. `timings` on a
take is the engine's *claim* about when lines are sung, not ground truth —
sing-for-you verifies it against the audible audio (Mureka `song/recognize`
matching) before trusting it for karaoke display.

## Consuming

Pin by commit SHA as a git dependency (the portfolio convention — Vercel
builds can fetch public git deps):

```json
"commonsong": "github:yabroexperiments/commonsong#<sha>"
```

`prepare` builds `dist/` on install. `src/` ships in the package so
import-free pure modules (`src/eleven-core.ts`) can be exercised directly by
`node --experimental-strip-types` test gates.

## Tests

```
npm test   # offline gates for the pure eleven-core logic (20 cases,
           # incl. a real captured words_timestamps fixture)
```

[commonpayment]: https://github.com/yabroexperiments/commonpayment
