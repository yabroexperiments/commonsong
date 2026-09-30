// Offline matrix for the Mureka adapter, driven through a local HTTP stub at
// `baseUrl` — the real adapter code, zero spend.
// Run: node --experimental-strip-types scripts/test-mureka-offline.mjs
//
// Each poll waits 3s (the adapter's own interval), so this takes ~15s.

import http from "node:http";

const { createMurekaEngine } = await import("../src/mureka.ts");

let failures = 0;
let ran = 0;
function gate(name, cond, detail = "") {
  ran++;
  if (cond) console.log(`PASS  ${name}${detail ? "  — " + detail : ""}`);
  else { console.log(`FAIL  ${name}${detail ? "  — " + detail : ""}`); failures++; }
}

// The stub: records every generate body; a task whose id starts with "stuck"
// never finishes, anything else succeeds on the first poll.
const seen = [];
let polls = 0;
let nextId = "ok-1";
let nextChoice = {};
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST" && req.url === "/v1/song/generate") {
      seen.push(JSON.parse(body));
      res.end(JSON.stringify({ id: nextId, model: "mureka-9", status: "preparing" }));
      return;
    }
    const m = /^\/v1\/song\/query\/(.+)$/.exec(req.url ?? "");
    if (req.method === "GET" && m) {
      polls++;
      if (m[1].startsWith("stuck")) {
        res.end(JSON.stringify({ id: m[1], model: "mureka-9", status: "running" }));
        return;
      }
      res.end(
        JSON.stringify({
          id: m[1],
          model: "mureka-9",
          status: "succeeded",
          choices: [{ index: 0, id: "song-77", url: "https://cdn.example/a.mp3", duration: 201_400, ...nextChoice }],
        })
      );
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const make = (extra = {}) => createMurekaEngine({ apiKey: "stub", baseUrl, ...extra });

// ── M1-M4: wire payload + the pass-through fields
nextChoice = { flac_url: "https://cdn.example/a.flac", wav_url: "https://cdn.example/a.wav" };
let takes = await make({ takesPerCall: 3 }).generate({ lyrics: "一\n二", stylePrompt: "lo-fi, chill", model: "mureka-9" });
gate("M1 n follows takesPerCall", seen.at(-1).n === 3, `n=${seen.at(-1).n}`);
gate("M2 lyrics + prompt reach the wire verbatim",
  seen.at(-1).lyrics === "一\n二" && seen.at(-1).prompt === "lo-fi, chill");
gate("M3 vendor song id is passed through", takes[0].vendorSongId === "song-77");
gate("M4 both lossless urls are passed through",
  takes[0].losslessUrls?.flac === "https://cdn.example/a.flac" &&
    takes[0].losslessUrls?.wav === "https://cdn.example/a.wav");

// ── M5-M6: a format the vendor did not return is absent, never invented
nextChoice = { flac_url: "https://cdn.example/a.flac" };
takes = await make().generate({ lyrics: "一", stylePrompt: "x" });
gate("M5 flac only → no wav key", takes[0].losslessUrls?.flac && !("wav" in takes[0].losslessUrls));
nextChoice = {};
takes = await make().generate({ lyrics: "一", stylePrompt: "x" });
gate("M6 no lossless urls → null", takes[0].losslessUrls === null);
gate("M7 duration ms → whole seconds", takes[0].durationS === 201);

// ── M8-M9: the poll bound is honoured, and the error names the billed task
nextId = "stuck-9";
polls = 0;
let err = null;
try {
  await make({ maxPollAttempts: 2 }).generate({ lyrics: "一", stylePrompt: "x" });
} catch (e) {
  err = e;
}
gate("M8 bound of 2 stops after exactly 2 polls", err !== null && polls === 2, `polls=${polls}`);
gate("M9 the bound error carries the task id", String(err).includes("stuck-9"));

// ── M10: a broken bound falls back to the default instead of skipping the loop
nextId = "ok-2";
for (const bad of [0, -5, NaN, 1.5]) {
  polls = 0;
  const t = await make({ maxPollAttempts: bad }).generate({ lyrics: "一", stylePrompt: "x" });
  gate(`M10 maxPollAttempts=${bad} still polls`, polls === 1 && t.length === 1, `polls=${polls}`);
}

server.close();
console.log(`\n${ran - failures}/${ran} passed`);
process.exit(failures === 0 ? 0 : 1);
