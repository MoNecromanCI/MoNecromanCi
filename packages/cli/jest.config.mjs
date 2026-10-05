/**
 * Standalone ts-jest config: the shared preset factory's fake-timers setup
 * would break tests that flush real setImmediate.
 */
export default {
  displayName:     'cli',
  testEnvironment: 'node',
  rootDir:         '.',
  roots:           ['<rootDir>/src'],
  testMatch:       ['**/*.spec.ts'],
  // commander 15 ships ESM only, which Jest cannot load as it is: it is compiled with the rest.
  transform:       {
    '^.+\\.ts$':                                          ['ts-jest', { tsconfig: '<rootDir>/../../tsconfig.jest.json' }],
    '[\\\\/]node_modules[\\\\/]commander[\\\\/].+\\.js$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest-commander.json' }],
  },
  transformIgnorePatterns: [String.raw`[\\/]node_modules[\\/](?!commander[\\/])`],
  collectCoverageFrom:     ['src/**/*.ts', '!src/**/*.spec.ts'],
  coverageReporters:       ['text', 'json-summary'],
  coverageThreshold:       {
    global: { statements: 85, branches: 85, functions: 85, lines: 85 },
  },
  clearMocks: true,
}
