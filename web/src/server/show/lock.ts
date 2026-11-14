/**
 * One FIFO lock for the show's calls into the catalogue. A simulated condition (a stock-out set with the catalogue's
 * demo hook) is process-wide, so while one week holds it no other week may price the same products: every step
 * that looks anything up takes this lock for its calls (not for the pauses or the wait for a sign-off), so several
 * visitors' weeks interleave step by step and never see each other's simulation.
 */
export class FifoLock {
  private tail: Promise<void> = Promise.resolve();
  private held = 0;

  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const before = this.tail;
    this.tail = before.then(() => next);
    await before;
    this.held += 1;
    try {
      return await fn();
    } finally {
      this.held -= 1;
      release();
    }
  }

  get busy(): boolean {
    return this.held > 0;
  }
}

const g = globalThis as typeof globalThis & { __dockShowLock?: FifoLock };
export const catalogueLock = (): FifoLock => (g.__dockShowLock ??= new FifoLock());
