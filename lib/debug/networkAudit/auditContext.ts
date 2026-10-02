/**
 * Tracks current screen + unmount times for listener leak detection.
 * Dev-only — all exports no-op outside __DEV__ via callers.
 */
let currentScreen = '(boot)';
const screenMountCounts = new Map<string, number>();
const lastUnmountAt = new Map<string, number>();

export function getAuditScreen(): string {
  return currentScreen;
}

export function setAuditScreen(screen: string): void {
  currentScreen = screen || '(unknown)';
}

export function markAuditScreenMount(screen: string): void {
  screenMountCounts.set(screen, (screenMountCounts.get(screen) ?? 0) + 1);
  setAuditScreen(screen);
}

export function markAuditScreenUnmount(screen: string): void {
  lastUnmountAt.set(screen, Date.now());
  const count = (screenMountCounts.get(screen) ?? 1) - 1;
  if (count <= 0) {
    screenMountCounts.delete(screen);
  } else {
    screenMountCounts.set(screen, count);
  }
}

export function getScreenUnmountAgeMs(screen: string): number | null {
  const at = lastUnmountAt.get(screen);
  if (!at) return null;
  return Date.now() - at;
}

export function getAuditContextSnapshot(): {
  currentScreen: string;
  mountedScreens: string[];
  lastUnmountAt: Record<string, number>;
} {
  return {
    currentScreen,
    mountedScreens: [...screenMountCounts.keys()],
    lastUnmountAt: Object.fromEntries(lastUnmountAt),
  };
}

/** Hour bucket key — e.g. "2026-07-05T09" */
export function currentHourBucket(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}`;
}
