import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: {
        perFile: true,
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
})
