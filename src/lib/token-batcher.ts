export class TokenBatcher {
  private buffer: string[] = [];
  private rafId: number | null = null;
  private callback: (batch: string) => void;

  constructor(callback: (batch: string) => void) {
    this.callback = callback;
  }

  push(token: string) {
    this.buffer.push(token);
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.flush();
        this.rafId = null;
      });
    }
  }

  flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.join('');
    this.buffer = [];
    this.callback(batch);
  }

  destroy() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.flush();
  }
}