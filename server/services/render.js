import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer';
import { ROOT, config } from '../config.js';

let bundlePromise = null;
function getBundle() {
  if (!bundlePromise) {
    bundlePromise = bundle({ entryPoint: path.join(ROOT, 'src/remotion/index.ts') }).catch((e) => { bundlePromise = null; throw e; });
  }
  return bundlePromise;
}

const MB = 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// out of RAM / Chrome or the compositor crashed: worth trying again with lighter settings
const isMemoryError = (e) => /memory|ran out|allocation|Compositor exited|screenshot|Target closed|disk space|EOF|EPIPE|crash/i.test(String(e?.message || e));

// keep both sides of the picture even numbers (h264 needs that): snap the width to a multiple of 64 (1280x720, 960x540 ...)
const snap = (s) => Math.max(1, Math.round((1920 * s) / 64)) * 64 / 1920;

/** Settings to try, lightest last. Long video: 720p + one browser tab. If that still runs out of memory: 540p, one thread. */
function profiles(format) {
  const r = config.render;
  if (format === 'long') {
    const s1 = snap(r.longScale), s2 = Math.min(s1, snap(0.5));
    return [
      { name: `long ${Math.round(1920 * s1)}x${Math.round(1080 * s1)}`, concurrency: r.concurrencyLong, scale: s1, cache: 128 * MB, threads: 2 },
      { name: 'long 960x540 (low memory)', concurrency: 1, scale: s2, cache: 48 * MB, threads: 1, noParallel: true },
    ];
  }
  return [
    { name: 'short', concurrency: r.concurrency, scale: 1, cache: 512 * MB, threads: null },
    { name: 'short (low memory)', concurrency: 1, scale: 1, cache: 128 * MB, threads: 1, noParallel: true },
  ];
}

export async function renderReel(inputProps, outputLocation, onProgress = () => {}, signal) {
  const serveUrl = await getBundle(); // bundled once per server start
  const composition = await selectComposition({ serveUrl, id: inputProps.format === 'long' ? 'Long' : 'Reel', inputProps });
  const list = profiles(inputProps.format);
  let lastErr;
  for (const [i, p] of list.entries()) {
    const { cancelSignal, cancel } = makeCancelSignal(); // Pause = cancel the render
    const onAbort = () => cancel();
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', onAbort, { once: true });
    try {
      console.log(`[render] ${p.name}: concurrency ${p.concurrency}, scale ${+p.scale.toFixed(3)}`);
      await renderMedia({
        composition, serveUrl, inputProps, outputLocation,
        codec: 'h264',
        crf: config.render.crf,
        x264Preset: config.render.preset,
        concurrency: p.concurrency,
        scale: p.scale,
        hardwareAcceleration: 'if-possible',
        offthreadVideoCacheSizeInBytes: p.cache,
        ...(p.threads ? { offthreadVideoThreads: p.threads } : {}),
        ...(p.noParallel ? { disallowParallelEncoding: true } : {}),
        cancelSignal,
        onProgress: ({ progress }) => onProgress(progress),
      });
      return;
    } catch (e) {
      lastErr = e;
      if (signal?.aborted || !isMemoryError(e) || i === list.length - 1) throw e;
      console.warn(`[render] "${p.name}" ran out of memory, trying lighter settings...`);
      await sleep(4000); // let Windows free the memory first
    } finally { signal?.removeEventListener('abort', onAbort); }
  }
  throw lastErr;
}
