import { expect, test } from 'obsidian-e2e-toolkit';
import { PLUGIN_DIR, PLUGIN_ID } from './global-setup';
import {
  NOTE,
  NOTE_CONTENT,
  OLD_UPDATED,
  editPropertyOnly,
  preparePlugin,
  shortenWaits,
  waitNoUpdateWindow,
} from './helpers';

test.use({
  vaultOptions: { fresh: true, plugins: [{ path: PLUGIN_DIR }] },
});

test.beforeEach(async ({ obsidian }) => {
  await preparePlugin(obsidian);
});

test('再起動後に復元されたノートも、開いた時点を基準にする', async ({ obsidian, page }) => {
  await obsidian.createNote(NOTE, NOTE_CONTENT);
  await obsidian.open(NOTE);
  await obsidian.evaluateApp(async () => {
    await (app.workspace as unknown as { saveLayout(): Promise<void> }).saveLayout();
  });

  // 本当に再読み込みされたことを、読み込み前に置いた目印が消えることで確かめる
  await obsidian.evaluateApp(() => {
    (window as unknown as { __beforeReload?: boolean }).__beforeReload = true;
    location.reload();
  });
  await obsidian.waitReady();
  await obsidian.waitForPluginLoaded(PLUGIN_ID);
  expect(
    await obsidian.evaluateApp(() => (window as unknown as { __beforeReload?: boolean }).__beforeReload),
  ).toBeUndefined();
  await shortenWaits(obsidian);
  await expect.poll(() => obsidian.filePath()).toBe(NOTE);

  // 開き直していないので、基準は起動時の処理で作られていなければならない
  await page.locator('.cm-content').click();
  await page.keyboard.press('Shift');
  await editPropertyOnly(obsidian, NOTE);
  await expect.poll(() => obsidian.read(NOTE)).toContain('property-only');
  await waitNoUpdateWindow();
  expect(await obsidian.read(NOTE)).toContain(OLD_UPDATED);
});

test('ポップアウトウィンドウでの入力も更新する', async ({ obsidian, page }) => {
  await obsidian.createNote(NOTE, NOTE_CONTENT);

  const popupPromise = page.context().waitForEvent('page');
  await obsidian.evaluateApp(async (notePath) => {
    const file = app.vault.getFileByPath(notePath);
    if (!file) throw new Error(`${notePath} が見つかりません`);
    await app.workspace.openPopoutLeaf().openFile(file);
  }, NOTE);
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  await popup.locator('.cm-content').click();
  await popup.keyboard.type('hello');

  await expect.poll(() => obsidian.read(NOTE), { timeout: 10_000 }).not.toContain(OLD_UPDATED);
});

test('フォーカスが無い間の入力では更新せず、戻れば更新する', async ({ obsidian, page }) => {
  await obsidian.createNote(NOTE, NOTE_CONTENT);
  await obsidian.open(NOTE);

  // Playwright は常にフォーカス済みに見せるため、プラグインが見る hasFocus() を差し替えて再現する
  await page.evaluate(() => {
    document.hasFocus = () => false;
  });
  await page.locator('.cm-content').click();
  await page.keyboard.type('hello');
  await expect.poll(() => obsidian.content()).toContain('hello');
  await waitNoUpdateWindow();
  expect(await obsidian.read(NOTE)).toContain(OLD_UPDATED);

  await page.evaluate(() => {
    document.hasFocus = () => true;
  });
  await page.keyboard.type('world');
  await expect.poll(() => obsidian.read(NOTE), { timeout: 10_000 }).not.toContain(OLD_UPDATED);
});
