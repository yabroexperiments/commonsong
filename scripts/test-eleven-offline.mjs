// Offline gates for the ElevenLabs adapter's pure logic (eleven-core.ts).
//   node --experimental-strip-types scripts/test-eleven-offline.mjs
// Fixture eleven-words-folk.json is a REAL words_timestamps payload captured
// from the 2026-08-19 bake-off (7 中文 lines + Latin inline-direction tokens).

import { readFileSync } from "fs";

const core = await import("../src/eleven-core.ts");

let failures = 0;
function gate(name, cond, detail = "") {
  if (cond) console.log(`PASS  ${name}${detail ? "  — " + detail : ""}`);
  else {
    console.log(`FAIL  ${name}${detail ? "  — " + detail : ""}`);
    failures++;
  }
}

// ── stylePromptToTags on a REAL assembled genre prompt
const NAKASI_PROMPT =
  "Reference and imitate the style of 陳小雲 (known for 舞女), 文夏 (known for 黃昏的故鄉), 洪一峰 (known for 思慕的人): retro Taiwanese nakasi cabaret at 85-105 BPM, vintage electric organ backing, old-school enka-flavoured melody, nostalgic karaoke-parlor production, crooning vocal with heavy vibrato. Mood: playful, cheeky. STRICT structure: instrumental intro under 3 seconds — vocals start almost immediately. Sing the message through once.";
{
  const tags = core.stylePromptToTags(NAKASI_PROMPT);
  gate("T1 STRICT-structure block dropped", tags.every((t) => !/STRICT|intro under/i.test(t)), JSON.stringify(tags.slice(-2)));
  gate("T1b artist preamble dropped", tags.every((t) => !/Reference and imitate/i.test(t)));
  gate("T1c descriptors kept", tags.includes("vintage electric organ backing"), tags.join(" | ").slice(0, 120));
  gate("T1d mood kept as a tag", tags.some((t) => /Mood: playful/.test(t)));
}
{
  const tags = core.stylePromptToTags("dreamy synthwave, slow, retro");
  gate("T2 custom free-text prompt splits plainly", tags.length === 3 && tags[0] === "dreamy synthwave");
}

// ── duration budget
{
  const short = core.budgetDurationMs("嗨");
  const mid = core.budgetDurationMs("大嫂我在開發一個唱歌的工具\n把簡訊輸入之後\n選一個曲風\n他就會幫你做曲唱給你聽\n可以幫忙試用一下\n給些建議嗎\n謝謝");
  const max = core.budgetDurationMs("字".repeat(300));
  gate("T3 tiny message floors at 10s", short === 10000, `${short}`);
  gate("T3b 50-char message ≈ 29s", mid > 26000 && mid < 32000, `${mid}`);
  gate("T3c long text caps under the 120s chunk ceiling", max <= 118000, `${max}`);
}

// ── chunk building
{
  const chunks = core.buildChunks("你好\n世界", NAKASI_PROMPT, { elevenSongId: "abc_upload" });
  gate("T4 one chunk with [Verse] + lyrics + cold ending", chunks.length === 1 && /\[Verse\]\n你好\n世界\n\{cold ending\}/.test(chunks[0].text));
  gate("T4b conditioning_ref present + range capped at 30s", chunks[0].conditioning_ref?.song_id === "abc_upload" && chunks[0].conditioning_ref.range.end_ms <= 30000);
  gate("T4c condition_strength high", chunks[0].condition_strength === "high");
  const plain = core.buildChunks("你好", NAKASI_PROMPT);
  gate("T4d no reference → no conditioning fields", plain[0].conditioning_ref === undefined && plain[0].condition_strength === undefined);
}

// ── words_timestamps → timings on the REAL fixture
{
  const wt = JSON.parse(readFileSync("scripts/fixtures/eleven-words-folk.json", "utf8"));
  const timings = core.wordsTimestampsToTimings(wt);
  const lines = timings?.[0]?.lines ?? [];
  gate("T5 7 中文 lines kept, Latin direction tokens dropped", lines.length === 7, `lines=${lines.length}`);
  gate("T5b first line is the message opening at ~0.8s", lines[0]?.text === "大嫂我在開發一個唱歌的工具" && lines[0].start === 799);
  gate("T5c monotonic", lines.every((l, i) => i === 0 || l.start >= lines[i - 1].start));
  gate("T5d section shape consumable by timingsToAssLines/captions", timings[0].section_type === "eleven" && typeof timings[0].start === "number");
  gate("T5e garbage → null (fail-soft)", core.wordsTimestampsToTimings("nope") === null && core.wordsTimestampsToTimings([{ word: "{tag}", start_ms: 1, end_ms: 2 }]) === null);
}

// ── multipart parser on a synthetic but spec-shaped body
{
  const boundary = "abc123";
  const json = JSON.stringify({ hello: "世界" });
  const audio = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);
  const raw = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json\r\n\r\n${json}\r\n`),
    Buffer.from(`--${boundary}\r\ncontent-type: audio/mpeg\r\n\r\n`),
    audio,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const { meta, audio: got } = core.parseMultipartMixed(raw, `multipart/mixed; boundary=${boundary}`);
  gate("T6 json part parsed", meta && meta.hello === "世界");
  gate("T6b audio bytes extracted intact", got && got.length === audio.length && got[0] === 0xff);
  const none = core.parseMultipartMixed(Buffer.from("x"), "text/plain");
  gate("T6c non-multipart → nulls, never throws", none.meta === null && none.audio === null);
}

console.log("");
if (failures > 0) {
  console.log(`${failures} GATE(S) FAILED`);
  process.exit(1);
}
console.log("ALL GATES PASS");
