/**
 * For physical Android devices on USB: forward the phone's localhost:8081
 * to the PC's Metro (so dev builds that open with http://127.0.0.1:8081 can load JS).
 *
 * Safe to run on failure (prints a hint). Requires `adb` on PATH and USB debugging.
 */
const { execSync } = require('child_process');

function main() {
  try {
    execSync('adb reverse tcp:8081 tcp:8081', { stdio: 'inherit' });
    console.log(
      '[dev] adb reverse tcp:8081 ok — device 127.0.0.1:8081 → PC Metro (reload / fast refresh should connect).'
    );
  } catch (_) {
    console.warn(
      '[dev] adb reverse failed (adb missing, no device, or USB debugging off). ' +
        'Fix: enable USB debugging, plug in the phone, then re-run. ' +
        'Or use Wi‑Fi: run `npm run start:lan` on the PC and open the dev client using the LAN URL from the terminal.'
    );
    process.exitCode = 0;
  }
}

main();
