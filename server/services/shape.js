import { verseById } from '../verses.js';

/** Where the narrator chants a verse: [{afterLine, verse}] (short = 1 verse, long = one per section) */
export function getShloks(_script) {
  return []; // shlok / chant is switched OFF everywhere: videos are stories only
}

export const DEFAULT_LAYOUT = {
  short: { hookY: 0.2, capY: 0.6, shlokY: 0.42, ctaY: 0.82, hookSize: 1, capSize: 1, showHook: true, showCaptions: true, showShlok: true, showCta: true, showProgress: true, showGrain: true, showDust: true, voiceVolume: 1 },
  long: { hookY: 0.45, capY: 0.82, shlokY: 0.4, ctaY: 0.5, hookSize: 1, capSize: 1, showHook: true, showCaptions: true, showShlok: true, showCta: true, showProgress: true, showGrain: true, showDust: true, voiceVolume: 1 },
};

/** per-format placement of the hook / captions (keep in sync with VARIANT_LAYOUT in src/remotion/Reel.tsx) */
export const VARIANTS = ['classic', 'headline', 'kinetic', 'frame', 'cinema'];
export const VARIANT_LAYOUT = {
  classic: {},
  headline: { hookY: 0.17, hookSize: 0.6, capY: 0.62, ctaY: 0.86 },
  kinetic: { hookY: 0.2, capY: 0.55, capSize: 1.5, ctaY: 0.84 },
  frame: { hookY: 0.115, hookSize: 0.6, capY: 0.79, capSize: 0.9, shlokY: 0.44, ctaY: 0.91 },
  cinema: { hookY: 0.08, hookSize: 0.5, capY: 0.915, capSize: 0.62, shlokY: 0.45, ctaY: 0.78, showProgress: false },
};
