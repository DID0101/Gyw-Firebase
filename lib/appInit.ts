/**
 * Run before RN Firebase loads to silence modular deprecation warnings.
 * Import first in app/_layout.tsx.
 */
if (typeof globalThis !== 'undefined') {
  (globalThis as any).RNFB_SILENCE_MODULAR_DEPRECATION_WARNINGS = true;
}
