import { expect, test } from 'obsidian-e2e-toolkit';
import { PLUGIN_DIR, PLUGIN_ID } from './global-setup';

test.use({
  vaultOptions: {
    fresh: true,
    plugins: [
      {
        path: PLUGIN_DIR,
        // fileHashMap は旧版が保存していたもの。読み込み時に取り除かれる
        data: { ignoreGlobalFolder: ['ignored/'], fileHashMap: { 'old.md': 'deadbeef' } },
      },
    ],
  },
});

test.beforeEach(async ({ obsidian }) => {
  await obsidian.waitReady();
  await obsidian.waitForPluginLoaded(PLUGIN_ID);
});

test('旧版の fileHashMap は読み込み時に data.json から取り除かれる', async ({ obsidian }) => {
  await expect
    .poll(async () => (await obsidian.pluginData(PLUGIN_ID)) ?? {})
    .not.toHaveProperty('fileHashMap');
  expect(await obsidian.pluginData(PLUGIN_ID)).toMatchObject({ ignoreGlobalFolder: ['ignored/'] });
});

test('除外フォルダのノートは updated を更新せず、それ以外は更新する', async ({ obsidian, page }) => {
  const oldUpdated = '2000-01-01T00:00';
  const content = `---\nupdated: ${oldUpdated}\n---\nbody\n`;
  await obsidian.createNote('ignored/note.md', content);
  await obsidian.createNote('kept.md', content);

  await obsidian.open('ignored/note.md');
  await page.locator('.cm-content').click();
  await page.keyboard.type('hello');
  await expect.poll(() => obsidian.content()).toContain('hello');
  await new Promise((resolve) => setTimeout(resolve, 6_000));
  expect(await obsidian.read('ignored/note.md')).toContain(oldUpdated);

  await obsidian.open('kept.md');
  await page.locator('.cm-content').click();
  await page.keyboard.type('hello');
  await expect.poll(() => obsidian.read('kept.md'), { timeout: 15_000 }).not.toContain(oldUpdated);
});
