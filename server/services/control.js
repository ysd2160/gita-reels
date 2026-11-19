// Pause / stop support: a running video gets an AbortSignal; the pipeline checks it between steps.
export class PausedError extends Error {
  constructor(timeout = false) { super(timeout ? 'timeout' : 'paused'); this.timeout = !!timeout; }
}
export const isTimeout = (signal) => signal?.reason?.message === 'timeout';
export function stopIf(signal) { if (signal?.aborted) throw new PausedError(isTimeout(signal)); }
