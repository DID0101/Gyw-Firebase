/**
 * Async operation locks — prevent duplicate OTP / verify / profile / init.
 */

export class AuthOperationLock {
  private active = false;
  private label: string;

  constructor(label: string) {
    this.label = label;
  }

  isHeld(): boolean {
    return this.active;
  }

  /** Returns false if lock already held (duplicate operation). */
  tryAcquire(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  release(): void {
    this.active = false;
  }

  getLabel(): string {
    return this.label;
  }
}

export async function withAuthLock<T>(
  lock: AuthOperationLock,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (!lock.tryAcquire()) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(`[AUTH_LOCK] duplicate blocked: ${lock.getLabel()}`);
    }
    return null;
  }
  try {
    return await fn();
  } finally {
    lock.release();
  }
}
