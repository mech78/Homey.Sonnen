module.exports = {
  displayName: 'Jest Tests',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    // The Homey SDK is only available on-device; stub it for unit tests.
    '^homey$': '<rootDir>/tests/__mocks__/homey.ts',
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  collectCoverageFrom: [
    'domain/**/*.ts',
    '!domain/**/*.d.ts'
  ],
};