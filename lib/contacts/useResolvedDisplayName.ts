import { useMemo } from 'react';

import {
  resolveDisplayName,
  type ResolveDisplayNameOptions,
  type ResolveUserInput,
} from '@/lib/contacts/contactResolver';
import { useContactsStore } from '@/store/contactsStore';

/**
 * Subscribe to contacts cache so UI updates once after preload
 * without re-scanning the address book per row.
 */
export function useResolvedDisplayName(
  user: ResolveUserInput,
  options?: ResolveDisplayNameOptions
): string {
  const revision = useContactsStore((s) => s.revision);
  const contactsReady = useContactsStore((s) => s.contactsReady);

  return useMemo(
    () => resolveDisplayName(user, { preferLiveProfile: true, ...options }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision bumps when cache loads
    [
      revision,
      contactsReady,
      user.phoneNumber,
      user.firstName,
      user.lastName,
      user.username,
      user.displayName,
      user.participantName,
      user.name,
      options?.fallback,
      options?.logContext,
    ]
  );
}
