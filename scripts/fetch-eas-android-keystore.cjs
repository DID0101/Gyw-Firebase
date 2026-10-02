/**
 * Download the default Android upload keystore from EAS (ddr10) for local Gradle builds.
 * Requires: eas login (as ddr10)
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EAS_ROOT = (() => {
  try {
    return path.dirname(require.resolve('eas-cli/package.json'));
  } catch {
    return path.join(
      process.env.LOCALAPPDATA || '',
      'npm-cache',
      '_npx',
      '6bc7bae5c2059953',
      'node_modules',
      'eas-cli'
    );
  }
})();

async function main() {
  process.chdir(ROOT);

  const { createAnalyticsAsync } = require(path.join(EAS_ROOT, 'build/analytics/AnalyticsManager'));
  const SessionManager = require(path.join(EAS_ROOT, 'build/user/SessionManager')).default;
  const { createGraphqlClient } = require(path.join(
    EAS_ROOT,
    'build/commandUtils/context/contextUtils/createGraphqlClient'
  ));
  const GraphqlClient = require(path.join(EAS_ROOT, 'build/credentials/android/api/GraphqlClient'));
  const { DownloadKeystore } = require(path.join(
    EAS_ROOT,
    'build/credentials/android/actions/DownloadKeystore'
  ));

  const analytics = await createAnalyticsAsync();
  const sessionManager = new SessionManager(analytics);
  const user = await sessionManager.getUserAsync();
  if (!user) {
    throw new Error('Not logged in. Run: npx eas-cli login');
  }

  const graphqlClient = createGraphqlClient({
    accessToken: sessionManager.getAccessToken(),
    sessionSecret: sessionManager.getSessionSecret(),
  });

  const appLookup = {
    account: { name: user.username ?? 'ddr10' },
    projectName: 'gyw',
    androidApplicationIdentifier: 'com.gyw1.chat',
  };

  const buildCredentials = await GraphqlClient.getDefaultAndroidAppBuildCredentialsAsync(
    graphqlClient,
    appLookup
  );
  if (!buildCredentials?.androidKeystore) {
    throw new Error('No default Android keystore on EAS for @ddr10/gyw');
  }

  const keystoreRel = 'android/app/upload.keystore';
  const keystorePath = path.join(ROOT, keystoreRel);
  const ctx = { projectDir: ROOT, nonInteractive: true };

  await new DownloadKeystore({
    app: appLookup,
    outputPath: keystorePath,
    displaySensitiveInformation: true,
  }).runAsync(ctx, buildCredentials);

  const ks = buildCredentials.androidKeystore;
  const propsPath = path.join(ROOT, 'android', 'keystore.properties');
  fs.writeFileSync(
    propsPath,
    [
      'MYAPP_UPLOAD_STORE_FILE=upload.keystore',
      `MYAPP_UPLOAD_KEY_ALIAS=${ks.keyAlias}`,
      `MYAPP_UPLOAD_STORE_PASSWORD=${ks.keystorePassword}`,
      `MYAPP_UPLOAD_KEY_PASSWORD=${ks.keyPassword}`,
      '',
    ].join('\n')
  );

  const creds = {
    android: {
      keystore: {
        keystorePath: keystoreRel.replace(/\\/g, '/'),
        keystorePassword: ks.keystorePassword,
        keyAlias: ks.keyAlias,
        keyPassword: ks.keyPassword,
      },
    },
  };
  fs.writeFileSync(path.join(ROOT, 'credentials.json'), JSON.stringify(creds, null, 2) + '\n');

  console.log('\nSaved upload keystore + android/keystore.properties + credentials.json');
  console.log('Run: powershell -File scripts/build-local-aab.ps1');
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
