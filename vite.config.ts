import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: { target: 'es2022' },
  server: { host: '127.0.0.1' },
  test: { include: ['src/**/*.test.ts'] },
})
