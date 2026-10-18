/**
 * Integration tests: run the real Nest app against the `pos_test` database
 * using the restricted `pos_app` role, so RLS is exercised exactly as in production.
 */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.*\\.int-spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: '<rootDir>/../tsconfig.json', diagnostics: { ignoreCodes: [151002] } },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  globalSetup: '<rootDir>/global-setup.ts',
  setupFiles: ['<rootDir>/env.ts'],
  testTimeout: 30000,
};
