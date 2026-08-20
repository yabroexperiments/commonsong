import type { SongEngine } from "./types.js";

export interface MockEngineOptions {
  /** URL of the bundled demo track the consumer serves. */
  demoUrl?: string;
  /** Takes per call — match the real engine so dev exercises the same paths. */
  takes?: number;
}

/** Mock engine: consumer-served sample audio, zero cost, instant. The consumer
 *  UI MUST label mock output as a demo (示範模式 in sing-for-you) — displayed
 *  = observed. */
export function createMockEngine(opts: MockEngineOptions = {}): SongEngine {
  return {
    id: "mock",
    async generate() {
      const take = {
        audioUrl: opts.demoUrl ?? "/demo/demo-song.wav",
        durationS: null, // measured client-side on load, not asserted here
        costUsd: 0,
        model: "demo-sample",
        timings: null,
      };
      return Array.from({ length: opts.takes ?? 1 }, () => ({ ...take }));
    },
  };
}
