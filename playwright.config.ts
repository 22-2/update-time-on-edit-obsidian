import { defineConfig, devices } from '@playwright/test';

// ELECTRON_RUN_AS_NODE が設定された環境（Claude Code のシェルなど）では、
// Electron が Node として起動してしまい、Playwright のフラグを受け付けず失敗する。
delete process.env.ELECTRON_RUN_AS_NODE;

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  // 実際の Obsidian を起動するため、テストごとに一時 vault を使い、並列数は控えめにする
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: { trace: 'on-first-retry' },
  projects: [{ name: 'obsidian', use: { ...devices['Desktop Chrome'] } }],
});
