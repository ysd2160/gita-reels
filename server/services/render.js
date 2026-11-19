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

export async function renderReel(inputProps, outputLocation, onProgress = () => {}, signal) {
  const serveUrl = await getBundle(); // bundled once per server start
  const composition = await selectComposition({ serveUrl, id: inputProps.format === 'long' ? 'Long' : 'Reel', inputProps });
  const { cancelSignal, cancel } = makeCancelSignal(); // Pause = cancel the render
  const onAbort = () => cancel();
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await renderMedia({
      composition, serveUrl, inputProps, outputLocation,
      codec: 'h264',
      crf: config.render.crf,
      x264Preset: config.render.preset,
      concurrency: config.render.concurrency,
      hardwareAcceleration: 'if-possible',
      offthreadVideoCacheSizeInBytes: 512 * 1024 * 1024,
      cancelSignal,
      onProgress: ({ progress }) => onProgress(progress),
    });
  } finally { signal?.removeEventListener('abort', onAbort); }
}
