/**
 * Dev-only — tracks current route for network audit grouping + listener leak context.
 */
import { usePathname } from 'expo-router';
import { useEffect } from 'react';

import {
  markAuditScreenMount,
  markAuditScreenUnmount,
  setAuditScreen,
} from '@/lib/debug/networkAudit/auditContext';

const NetworkAuditScreenTracker = () => {
  const pathname = usePathname();

  useEffect(() => {
    if (!__DEV__) return;
    const screen = pathname || '(root)';
    markAuditScreenMount(screen);
    return () => {
      markAuditScreenUnmount(screen);
    };
  }, [pathname]);

  useEffect(() => {
    if (!__DEV__) return;
    setAuditScreen(pathname || '(root)');
  }, [pathname]);

  return null;
};

export default NetworkAuditScreenTracker;
