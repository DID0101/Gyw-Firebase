// Quick verification script for google-services.json
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'google-services.json');

console.log('\n=== google-services.json Verification ===\n');

if (!fs.existsSync(filePath)) {
  console.log('❌ File not found at:', filePath);
  process.exit(1);
}

try {
  const content = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(content);
  
  const oauthClients = json.client?.[0]?.oauth_client || [];
  const count = Array.isArray(oauthClients) ? oauthClients.length : 0;
  
  console.log(`OAuth clients found: ${count}`);
  console.log('');
  
  if (count === 0) {
    console.log('❌ CRITICAL: File is MISSING SHA-1 fingerprint data!');
    console.log('   Current: "oauth_client": [] (EMPTY)');
    console.log('   Required: "oauth_client": [{...}] (with SHA-1 data)');
    console.log('');
    console.log('🔧 ACTION REQUIRED:');
    console.log('   1. Add SHA-1 to Firebase Console');
    console.log('   2. Wait 2-3 minutes');
    console.log('   3. Download NEW google-services.json');
    console.log('   4. Replace this file');
    console.log('   5. Rebuild app');
    process.exit(1);
  } else {
    console.log('✅ File has SHA-1 fingerprint data!');
    console.log(`   Found ${count} OAuth client(s)`);
    process.exit(0);
  }
} catch (error) {
  console.log('❌ Error reading file:', error.message);
  process.exit(1);
}
