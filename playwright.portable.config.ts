import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'./e2e-portable',
  workers:1,
  timeout:60_000,
  expect:{timeout:20_000},
  use:{
    browserName:'chromium',
    viewport:{width:1440,height:1050},
    launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||undefined},
    trace:'retain-on-failure',
  },
})
