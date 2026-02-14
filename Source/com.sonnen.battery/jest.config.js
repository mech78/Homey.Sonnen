module.exports = {
  displayName: 'Jest Tests',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  collectCoverageFrom: [
    'domain/**/*.ts',
    '!domain/**/*.d.ts'
  ],
};