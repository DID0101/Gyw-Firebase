// Verify google-services.json matches app.json Android package and has OAuth / SHA-1 data.
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'google-services.json');
const appJsonPath = path.join(__dirname, 'app.json');

console.log('\n=== google-services.json Verification ===\n');

if (!fs.existsSync(filePath)) {
  console.log('❌ File not found at:', filePath);
  process.exit(1);
}

let expectedPackage;
try {
  const app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  expectedPackage = app.expo?.android?.package;
  if (expectedPackage) {
    console.log(`Android package from app.json: ${expectedPackage}\n`);
  }
} catch {
  console.log('⚠️  Could not read app.json; skipping package match.\n');
}

try {
  const content = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(content);

  const clients = json.client || [];
  let exitCode = 0;

  if (!clients.length) {
    console.log('❌ No clients in google-services.json');
    process.exit(1);
  }

  for (const entry of clients) {
    const pkg = entry.client_info?.android_client_info?.package_name;
    const appId = entry.client_info?.mobilesdk_app_id;
    if (!pkg) continue;

    const oauth = entry.oauth_client || [];
    const withSha = oauth.filter(
      (o) => o.client_type === 1 && o.android_info?.certificate_hash
    );

    console.log(`App ${pkg}`);
    console.log(`  mobilesdk_app_id: ${appId || '(missing)'}`);
    console.log(`  OAuth Android clients with SHA-1: ${withSha.length}`);

    if (expectedPackage && pkg === expectedPackage) {
      if (withSha.length === 0) {
        console.log('  ❌ CRITICAL: No SHA-1 fingerprints for this app — Phone Auth will fail.');
        console.log('     Add SHA-1 in Firebase → Project settings → Your apps → Download google-services.json');
        exitCode = 1;
      } else {
        console.log('  ✅ SHA-1 data present for primary Android app.');
      }
    }
    console.log('');
  }

  if (expectedPackage) {
    const match = clients.some(
      (c) => c.client_info?.android_client_info?.package_name === expectedPackage
    );
    if (!match) {
      console.log(`❌ No client block for package "${expectedPackage}" from app.json`);
      exitCode = 1;
    }
  }

  process.exit(exitCode);
} catch (error) {
  console.log('❌ Error:', error.message);
  process.exit(1);
}
