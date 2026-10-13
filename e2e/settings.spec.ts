import { expect, test } from 'obsidian-e2e-toolkit';
import { PLUGIN_DIR, PLUGIN_ID } from './global-setup';
import { NOTE_CONTENT, OLD_UPDATED, preparePlugin, waitNoUpdateWindow } from './helpers';

test.use({
  vaultOptions: {
    fresh: true,
    plugins: [
      {
        path: PLUGIN_DIR,
        // fileHashMap・enableExperimentalHash は旧版の項目。読み込み時に取り除かれる
        data: { ignoreGlobalFolder: ['ignored/'], fileHashMap: { 'old.md': 'deadbeef' }, enableExperimentalHash: false },
      },
    ],
  },
});

test.beforeEach(async ({ obsidian }) => {
  await preparePlugin(obsidian);
});

test('旧版の項目は読み込み時に data.json から取り除かれる', async ({ obsidian }) => {
  await expect
    .poll(async () => (await obsidian.pluginData(PLUGIN_ID)) ?? {})
    .not.toHaveProperty('fileHashMap');
  expect(await obsidian.pluginData(PLUGIN_ID)).not.toHaveProperty('enableExperimentalHash');
  expect(await obsidian.pluginData(PLUGIN_ID)).toMatchObject({ ignoreGlobalFolder: ['ignored/'] });
});

test('除外フォルダのノートは updated を更新せず、それ以外は更新する', async ({ obsidian, page }) => {
  await obsidian.createNote('ignored/note.md', NOTE_CONTENT);
  await obsidian.createNote('kept.md', NOTE_CONTENT);

  await obsidian.open('ignored/note.md');
  await page.locator('.cm-content').click();
  await page.keyboard.type('hello');
  await expect.poll(() => obsidian.content()).toContain('hello');
  await waitNoUpdateWindow();
  expect(await obsidian.read('ignored/note.md')).toContain(OLD_UPDATED);

  await obsidian.open('kept.md');
  await page.locator('.cm-content').click();
  await page.keyboard.type('hello');
  await expect.poll(() => obsidian.read('kept.md'), { timeout: 10_000 }).not.toContain(OLD_UPDATED);
});
