/**
 * jest.config.js
 *
 * ── Install dev dependencies first ───────────────────────────────────────
 *   npm install -D \
 *     jest jest-expo @types/jest \
 *     @testing-library/react-native @testing-library/jest-native \
 *     ts-jest identity-obj-proxy
 *
 * ── Run tests ────────────────────────────────────────────────────────────
 *   npx jest                    # all unit tests
 *   npx jest --watch            # watch mode
 *   npx jest __tests__/CallService.test.ts
 */

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',

  // TypeScript support via babel-jest (bundled in jest-expo)
  transform: {
    '^.+\\.[jt]sx?$': [
      'babel-jest',
      {
        presets: ['babel-preset-expo'],
        plugins: [['@babel/plugin-transform-modules-commonjs', { allowTopLevelThis: true }]],
      },
    ],
  },

  // Resolve @/ path alias
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',

    // Static asset stubs
    '\\.(png|jpg|jpeg|gif|svg|ttf|woff|woff2)$': '<rootDir>/__mocks__/fileMock.js',
    '\\.css$': 'identity-obj-proxy',
  },

  // Setup file: defines globals + common mocks
  setupFilesAfterEnv: ['./jest.setup.ts'],

  // Directories to search
  roots: ['<rootDir>/__tests__'],

  // Don't run e2e tests through Jest
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/functions/'],

  // Allow transforming these ESM packages
  transformIgnorePatterns: [
    'node_modules/(?!' +
      [
        'react-native',
        '@react-native(-community)?',
        'expo(nent)?',
        '@expo(nent)?/.*',
        '@expo-google-fonts/.*',
        'react-navigation',
        '@react-navigation/.*',
        'zustand',
        'nativewind',
        '@shopify/flash-list',
      ].join('|') +
    ')',
  ],

  // Coverage
  collectCoverageFrom: [
    'lib/callkeep.ts',
    'lib/services/NotificationService.ts',
    'lib/hooks/useCallManager.ts',
    'store/callManagerStore.ts',
  ],

  coverageThresholds: {
    global: {
      branches:  60,
      functions: 70,
      lines:     70,
      statements: 70,
    },
  },

  // Verbose output per-test
  verbose: true,
};
