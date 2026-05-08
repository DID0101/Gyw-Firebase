/**
 * e2e/jest.config.js
 *
 * Separate Jest configuration for Detox E2E tests.
 * This is intentionally isolated from the unit-test jest.config.js
 * at the project root so that `npx jest` (unit tests) and
 * `npx detox test` (E2E) never interfere with each other.
 */

/** @type {import('@jest/types').Config.InitialOptions} */
module.exports = {
  rootDir:     '..',            // project root
  testMatch:   ['<rootDir>/e2e/**/*.test.ts'],
  testTimeout: 120_000,         // Detox interactions can be slow

  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          // E2E tests target Node; no JSX needed
          target:       'ES2019',
          module:       'commonjs',
          esModuleInterop: true,
          strict:       false,
        },
      },
    ],
  },

  // Detox types live in devDependencies
  setupFilesAfterEnv: [],

  // Never transform Detox itself
  transformIgnorePatterns: ['node_modules/(?!(detox)/)'],

  verbose: true,
  bail:    1,    // stop after first failure in CI
};
