import { expect, test } from 'obsidian-e2e-toolkit';
import { PLUGIN_DIR, PLUGIN_ID } from './global-setup';
import {
  NOTE,
  NOTE_CONTENT,
  OLD_UPDATED,
  appendExternally,
  editPropertyOnly,
  preparePlugin,
  waitNoUpdateWindow,
} from './helpers';

test.use({
  vaultOptions: { fresh: true, plugins: [{ path: PLUGIN_DIR }] },
});

test.beforeEach(async ({ obsidian }) => {
  await preparePlugin(obsidian);
});

test('入力すると updated が更新され、ハッシュは data.json に保存されない', async ({ obsidian, page }) => {
  await obsidian.createNote(NOTE, NOTE_CONTENT);
  await obsidian.open(NOTE);

  await page.locator('.cm-content').click();
  await page.keyboard.type('hello');

  await expect.poll(() => obsidian.read(NOTE), { timeout: 10_000 }).not.toContain(OLD_UPDATED);
  expect((await obsidian.pluginData(PLUGIN_ID)) ?? {}).not.toHaveProperty('fileHashMap');
});

test('フロントマターの無いノートには created と updated を追加する', async ({ obsidian, page }) => {
  await obsidian.createNote(NOTE, 'body\n');
  await obsidian.open(NOTE);

  await page.locator('.cm-content').click();
  await page.keyboard.type('hello');

  await expect
    .poll(() => obsidian.read(NOTE), { timeout: 10_000 })
    .toMatch(/^---\n[\s\S]*created: [\s\S]*updated: /);
});

test('開いただけでは updated を更新しない', async ({ obsidian, page }) => {
  await obsidian.createNote(NOTE, NOTE_CONTENT);
  await obsidian.open(NOTE);
  await page.locator('.cm-content').click();

  await waitNoUpdateWindow();
  expect(await obsidian.read(NOTE)).toBe(NOTE_CONTENT);
});

test('開いたまま外部から書き換えられても updated を更新しない', async ({ obsidian }) => {
  await obsidian.createNote(NOTE, NOTE_CONTENT);
  await obsidian.open(NOTE);

  await appendExternally(obsidian, NOTE, 'external\n');
  await expect.poll(() => obsidian.content()).toContain('external');

  await waitNoUpdateWindow();
  expect(await obsidian.read(NOTE)).toContain(OLD_UPDATED);
});

test('外部編集の後にプロパティだけを変えても updated を更新せず、本文を編集すれば更新する', async ({ obsidian, page }) => {
  await obsidian.createNote(NOTE, NOTE_CONTENT);
  await obsidian.open(NOTE);

  await appendExternally(obsidian, NOTE, 'external\n');
  await expect.poll(() => obsidian.content()).toContain('external');

  // キー入力で「ユーザーが操作中」にしてから、プロパティだけを変える（本文は変わらない）
  await page.locator('.cm-content').click();
  await page.keyboard.press('Shift');
  await editPropertyOnly(obsidian, NOTE);
  await expect.poll(() => obsidian.read(NOTE)).toContain('property-only');

  await waitNoUpdateWindow();
  expect(await obsidian.read(NOTE)).toContain(OLD_UPDATED);

  // 同じ経路で本文の編集は更新されること（上の「更新されない」が経路の故障でないことの確認）
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('typed');
  await expect.poll(() => obsidian.read(NOTE), { timeout: 10_000 }).not.toContain(OLD_UPDATED);
});
