/** Default list route when chat has no stack history (e.g. opened from notification). */
export const CHATS_LIST_ROUTE = '/(home)/(tabs)/chats' as const;

type ChatRouter = {
  canGoBack?: () => boolean;
  back?: () => void;
  replace?: (href: string) => void;
};

/**
 * Leave chat screen without dispatching a failing GO_BACK (common after notification deep links).
 */
export function exitChatScreen(router: ChatRouter): void {
  try {
    if (router.canGoBack?.()) {
      router.back?.();
      return;
    }
  } catch {
    /* canGoBack can throw during hydration */
  }
  router.replace?.(CHATS_LIST_ROUTE);
}
