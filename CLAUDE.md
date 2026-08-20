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

<!-- ECVP:BEGIN (managed by install-vet-protocol.sh — edit the yabro-hq copy, then re-run) -->
> **🛡️ EXTERNAL CODE VETTING PROTOCOL — mandatory, ALL projects
> (Albert, 2026-07-21).** NO external skill / plugin / MCP server /
> package / prompt / workflow enters any environment without passing
> the ECVP pipeline (run via **`/vet <url>`**; full spec in
> `docs/external-code-vetting-protocol.md` in this repo, or
> `~/.claude/docs/` for the global copy). Pipeline: intake
> (true-owner/typosquat check, trust tier) → scan (SkillSpector for
> skills, mcp-scan for MCP, Socket+OSV for packages) → full-file
> analysis (scanners are bypassable — a scan pass alone is NEVER a
> green light) → quarantine test in a secret-free throwaway session →
> merge pinned to exact SHA + row in the project's
> `docs/vetted-external-code.md` registry (present but unlisted =
> unvetted) → monitor (updates are new vettings). Hard rules: secrets
> and unvetted code never meet; unknown author + wants
> network/auth/secrets = automatic reject; Albert reads only
> plain-English GREEN/YELLOW/RED verdicts and makes the go/no-go call.
<!-- ECVP:END -->

<!-- COST:BEGIN (managed by install-vet-protocol.sh — edit the yabro-hq copy, then re-run) -->
> **💸 COST DISCIPLINE — never burn credits blind-iterating (Albert,
> 2026-07-26).** If a bug needs an environment you cannot drive (a real
> device, rendered pixels, mobile PWA / safe-area — anything pixel-visual),
> STOP after the FIRST failed attempt: say so, and move to a loop that CAN
> see it (local dev + simulator, device inspector, or a screenshot from
> Albert). Never blind-iterate against production. **"Verified" must be
> literally true** — claim it only when the check actually reproduced the
> reported failure in the real environment; a headless render or a simulated
> viewport does NOT verify a device-specific bug, so write "unverified —
> needs device" instead. **Two strikes**: the same symptom failing twice
> means STOP — a third attempt needs NEW EVIDENCE (screenshot, real repro,
> inspector output), never a new theory; two contradictory root causes for
> one symptom means the bug isn't understood. Visual / pixel / layout work
> belongs in a batched local live-preview loop, NOT a stream of prod deploys
> driven by an agent that cannot see rendered output — keep a blind remote
> agent on logic/data/backend work it can verify itself. Ambiguous on-screen
> target → ask ONE cheap question (or ask for a circled screenshot) BEFORE
> editing. Call the cost out loud the moment work turns into repeated
> deploy → eyeball → correct cycles.
<!-- COST:END -->
