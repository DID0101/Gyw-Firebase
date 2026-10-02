import { buildPhoneNameIndex, getContactRowDisplayName } from '@/lib/contacts/contactPhoneIndex';
import { resolveContactNameByPhone, resolveDisplayName } from '@/lib/contacts/contactResolver';
import { useContactsStore } from '@/store/contactsStore';

describe('contactPhoneIndex', () => {
  it('builds lookup keys for E.164 numbers', () => {
    const map = buildPhoneNameIndex(
      [
        {
          id: '1',
          name: 'Alice',
          phoneNumbers: [{ number: '+905369936899' }],
        } as never,
      ],
      'TR'
    );
    expect(map['+905369936899']).toBe('Alice');
    expect(map['905369936899']).toBe('Alice');
  });

  it('extracts display name from first/last name', () => {
    const name = getContactRowDisplayName({
      id: '2',
      firstName: 'Bob',
      lastName: 'Smith',
    } as never);
    expect(name).toBe('Bob Smith');
  });
});

describe('contactResolver', () => {
  beforeEach(() => {
    useContactsStore.setState({
      ready: true,
      contactsReady: true,
      permission: 'granted',
      phoneToName: {
        '+905369936899': 'Abdurrezzak gonur',
        '905369936899': 'Abdurrezzak gonur',
      },
      revision: 0,
      loading: false,
    });
  });

  it('resolves contact name from cache by phone', () => {
    expect(resolveContactNameByPhone('+905369936899', 'TR')).toBe('Abdurrezzak gonur');
  });

  it('prefers contact name over profile in resolveDisplayName', () => {
    expect(
      resolveDisplayName(
        {
          phoneNumber: '+905369936899',
          firstName: 'Profile',
          lastName: 'Name',
        },
        { region: 'TR' }
      )
    ).toBe('Abdurrezzak gonur');
  });
});
