import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __KOVA_NETWORK__: JSON.stringify('mainnet'),
    __KOVA_WEB__: JSON.stringify('https://mykova.app'),
    __KOVA_API__: JSON.stringify('https://api.kova.test'),
  },
  test: { include: ['test/**/*.test.ts'], environment: 'node' },
})
