import { defineConfig } from '@playwright/test';

const runtimeEnv = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> }
}).process?.env ?? {};
const browserExecutable = runtimeEnv.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: '../tests',
  testMatch: 'website.spec.ts',
  outputDir: './test-results',
  webServer: {
    command: 'npm run site:build && npm run site:preview',
    cwd: '..',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false
  },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    browserName: 'chromium',
    ...(browserExecutable ? { launchOptions: { executablePath: browserExecutable } } : {})
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1366, height: 900 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } }
  ]
});
