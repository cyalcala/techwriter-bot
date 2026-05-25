export function startCleanupInterval(
  callback: () => void,
  intervalMs: number,
): ReturnType<typeof setInterval> {
  const timer = setInterval(callback, intervalMs);
  const detachable = timer as ReturnType<typeof setInterval> & { unref?: () => void };
  detachable.unref?.();
  return timer;
}
