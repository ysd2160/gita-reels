import { verseById } from '../verses.js';

/** Where the narrator chants a verse: [{afterLine, verse}] (short = 1 verse, long = one per section) */
export function getShloks(_script) {
  return []; // shlok / chant is switched OFF everywhere: videos are stories only
}

export const DEFAULT_LAYOUT = {
  short: { hookY: 0.2, capY: 0.6, shlokY: 0.42, ctaY: 0.82, hookSize: 1, capSize: 1, showHook: true, showCaptions: true, showShlok: true, showCta: true, showProgress: true, showGrain: true, showDust: true, voiceVolume: 1 },
  long: { hookY: 0.45, capY: 0.82, shlokY: 0.4, ctaY: 0.5, hookSize: 1, capSize: 1, showHook: true, showCaptions: true, showShlok: true, showCta: true, showProgress: true, showGrain: true, showDust: true, voiceVolume: 1 },
};
