// Batches streamed tokens into UI updates. Normally flushes on the next
// animation frame; a timer fallback keeps text flowing in background tabs
// (where rAF is throttled or paused). Once a response grows past
// LONG_RESPONSE_CHARS, flushing slows to LONG_RESPONSE_INTERVAL_MS — every
// flush re-parses the whole accumulated message upstream, so frame-rate
// updates on a long message burn CPU for no visible benefit.
const LONG_RESPONSE_CHARS = 4096;
const LONG_RESPONSE_INTERVAL_MS = 100;
const BACKGROUND_FALLBACK_MS = 120;

export class TokenBatcher {
  private buffer: string[] = [];
  private rafId: number | null = null;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private totalChars = 0;
  private callback: (batch: string) => void;

  constructor(callback: (batch: string) => void) {
    this.callback = callback;
  }

  push(token: string) {
    this.buffer.push(token);
    this.totalChars += token.length;
    if (this.rafId !== null || this.timeoutId !== null) return;

    const run = () => {
      this.clearScheduled();
      this.flush();
    };

    if (this.totalChars > LONG_RESPONSE_CHARS) {
      this.timeoutId = setTimeout(run, LONG_RESPONSE_INTERVAL_MS);
      return;
    }
    if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(run);
      this.timeoutId = setTimeout(run, BACKGROUND_FALLBACK_MS);
    } else {
      this.timeoutId = setTimeout(run, 0);
    }
  }

  private clearScheduled() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.join('');
    this.buffer = [];
    this.callback(batch);
  }

  destroy() {
    this.clearScheduled();
    this.flush();
  }
}
