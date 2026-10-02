/**
 * SHA-1 fingerprints registered in google-services.json for com.gyw1.chat (lowercase, no colons).
 * Used at OTP time to warn when the dev build cert may not match Firebase Console.
 */
import googleServices from '../../google-services.json';

const EXPECTED_PACKAGE = 'com.gyw1.chat';

function normalizeSha1(input: string): string {
  return input.toLowerCase().replace(/:/g, '');
}

/** SHA-1 hex strings from google-services.json oauth clients for the app package. */
export function getRegisteredSha1FingerprintsForPackage(
  packageName = EXPECTED_PACKAGE
): string[] {
  const clients = (googleServices as { client?: unknown[] }).client ?? [];
  const out = new Set<string>();
  for (const client of clients) {
    const c = client as {
      client_info?: { android_client_info?: { package_name?: string } };
      oauth_client?: Array<{
        client_type?: number;
        android_info?: { package_name?: string; certificate_hash?: string };
      }>;
    };
    const pkg = c.client_info?.android_client_info?.package_name;
    if (pkg !== packageName) continue;
    for (const oauth of c.oauth_client ?? []) {
      if (oauth.client_type === 1 && oauth.android_info?.certificate_hash) {
        out.add(normalizeSha1(oauth.android_info.certificate_hash));
      }
    }
  }
  return [...out];
}

export function logRegisteredSha1Index(): void {
  if (!__DEV__) return;
  const shas = getRegisteredSha1FingerprintsForPackage();
  console.log(
    '[AUTH_PHONE] AUTH_FIREBASE_REGISTERED_SHA1',
    JSON.stringify({
      package: EXPECTED_PACKAGE,
      count: shas.length,
      prefixes: shas.map((s) => s.slice(0, 8)),
    })
  );
}
