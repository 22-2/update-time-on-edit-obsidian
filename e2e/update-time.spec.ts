import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type ObsidianAPI } from 'obsidian-e2e-toolkit';
import { PLUGIN_DIR, PLUGIN_ID } from './global-setup';

test.use({
  vaultOptions: { fresh: true, plugins: [{ path: PLUGIN_DIR }] },
});

const NOTE = 'note.md';
const OLD_UPDATED = '2000-01-01T00:00';
const NOTE_CONTENT = `---\nupdated: ${OLD_UPDATED}\n---\nbody\n`;

// 更新しないことの確認には、デバウンス（3秒）より長く待つ必要がある
const NO_UPDATE_WINDOW_MS = 6_000;

// 更新されないことは、待った後に変化が無いことでしか確認できない
const waitNoUpdateWindow = () => new Promise((resolve) => setTimeout(resolve, NO_UPDATE_WINDOW_MS));

// Obsidian の外（ファイルシステム）から書き換えるため、vault の実パスを取る
const getVaultPath = (obsidian: ObsidianAPI) =>
  obsidian.evaluateApp(() => (app.vault.adapter as unknown as { getBasePath(): string }).getBasePath());

test.beforeEach(async ({ obsidian }) => {
  await obsidian.waitReady();
  await obsidian.waitForPluginLoaded(PLUGIN_ID);
});

test('入力すると updated が更新され、ハッシュは data.json に保存されない', async ({ obsidian, page }) => {
  await obsidian.createNote(NOTE, NOTE_CONTENT);
  await obsidian.open(NOTE);

  await page.locator('.cm-content').click();
  await page.keyboard.type('hello');

  await expect.poll(() => obsidian.read(NOTE), { timeout: 15_000 }).not.toContain(OLD_UPDATED);
  expect((await obsidian.pluginData(PLUGIN_ID)) ?? {}).not.toHaveProperty('fileHashMap');
});

test('フロントマターの無いノートには created と updated を追加する', async ({ obsidian, page }) => {
  await obsidian.createNote(NOTE, 'body\n');
  await obsidian.open(NOTE);

  await page.locator('.cm-content').click();
  await page.keyboard.type('hello');

  await expect.poll(() => obsidian.read(NOTE), { timeout: 15_000 }).toMatch(/^---\n[\s\S]*created: [\s\S]*updated: /);
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
  const vaultPath = await getVaultPath(obsidian);

  await appendFile(path.join(vaultPath, NOTE), 'external\n');
  await expect.poll(() => obsidian.content()).toContain('external');

  await waitNoUpdateWindow();
  expect(await obsidian.read(NOTE)).toContain(OLD_UPDATED);
});

test('外部編集の後にプロパティだけを変えても updated を更新せず、本文を編集すれば更新する', async ({ obsidian, page }) => {
  await obsidian.createNote(NOTE, NOTE_CONTENT);
  await obsidian.open(NOTE);
  const vaultPath = await getVaultPath(obsidian);

  await appendFile(path.join(vaultPath, NOTE), 'external\n');
  await expect.poll(() => obsidian.content()).toContain('external');

  // キー入力で「ユーザーが操作中」にしてから、プロパティだけを変える（本文は変わらない）
  await page.locator('.cm-content').click();
  await page.keyboard.press('Shift');
  await obsidian.evaluateApp(async (notePath) => {
    const file = app.vault.getFileByPath(notePath);
    if (!file) throw new Error(`${notePath} が見つかりません`);
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.tags = ['property-only'];
    });
  }, NOTE);
  await expect.poll(() => obsidian.read(NOTE)).toContain('property-only');

  await waitNoUpdateWindow();
  expect(await obsidian.read(NOTE)).toContain(OLD_UPDATED);

  // 同じ経路で本文の編集は更新されること（上の「更新されない」が経路の故障でないことの確認）
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('typed');
  await expect.poll(() => obsidian.read(NOTE), { timeout: 15_000 }).not.toContain(OLD_UPDATED);
});
