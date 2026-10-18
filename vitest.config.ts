import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // The shell provides this platform module at runtime; its npm build is not
    // loadable outside the shell, so tests render lightweight stand-ins.
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./tests/support/primitives.tsx', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.spec.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts'],
      reporter: ['text-summary', 'text'],
      // A floor against untested modules, not a target to chase with assertions.
      thresholds: { lines: 85, branches: 75 },
    },
  },
})
