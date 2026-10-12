import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import type { ObsidianAPI } from 'obsidian-e2e-toolkit';
import { PLUGIN_ID } from './global-setup';

export const NOTE = 'note.md';
export const OLD_UPDATED = '2000-01-01T00:00';
export const NOTE_CONTENT = `---\nupdated: ${OLD_UPDATED}\n---\nbody\n`;

// 更新されないことは、待った後に変化が無いことでしか確認できない。
// 待ち時間は、下で短縮した「入力後の待機＋デバウンス」（合計で約0.5秒）より十分長くする
const NO_UPDATE_WINDOW_MS = 2_000;
export const waitNoUpdateWindow = () => new Promise((resolve) => setTimeout(resolve, NO_UPDATE_WINDOW_MS));

/**
 * プラグインの読み込みを待ち、待機時間を短縮する。
 * 本番は入力が止まってから約3秒待つが、テストでは待つ意味が無いので書き換える
 * （private readonly でもコンパイル後は通常のフィールドなので上書きできる）。
 */
export async function preparePlugin(obsidian: ObsidianAPI): Promise<void> {
  await obsidian.waitReady();
  await obsidian.waitForPluginLoaded(PLUGIN_ID);
  await shortenWaits(obsidian);
}

export function shortenWaits(obsidian: ObsidianAPI): Promise<void> {
  return obsidian.evaluateApp((pluginId) => {
    const plugin = (app as unknown as { plugins: { plugins: Record<string, Record<string, unknown>> } }).plugins
      .plugins[pluginId];
    if (!plugin) throw new Error(`${pluginId} が読み込まれていません`);
    plugin.DEBOUNCE_DELAY_MS = 300;
    plugin.EDIT_IDLE_DELAY_MS = 200;
  }, PLUGIN_ID);
}

// Obsidian の外（ファイルシステム）から追記する。外部の同期やエディターによる編集の再現
export async function appendExternally(obsidian: ObsidianAPI, notePath: string, text: string): Promise<void> {
  const vaultPath = await obsidian.evaluateApp(
    () => (app.vault.adapter as unknown as { getBasePath(): string }).getBasePath(),
  );
  await appendFile(path.join(vaultPath, notePath), text);
}

// 本文は変えずにプロパティだけを変える
export function editPropertyOnly(obsidian: ObsidianAPI, notePath: string): Promise<void> {
  return obsidian.evaluateApp(async (target) => {
    const file = app.vault.getFileByPath(target);
    if (!file) throw new Error(`${target} が見つかりません`);
    await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
      frontmatter.tags = ['property-only'];
    });
  }, notePath);
}
