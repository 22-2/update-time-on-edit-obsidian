import type { TFile, Vault } from 'obsidian';

// file: URI・Windows のドライブ指定・絶対パスなど、vault 相対ではないパス
const NON_VAULT_PATH = /^(?:[a-z][a-z\d+.-]*:|[/\\])/i;

/**
 * 更新日時を書く対象にならないファイルか。
 * Markdown でない、vault の外のパス、Obsidian が一時的に作るファイルなどが該当する。
 */
export function isInvalidFile(vault: Vault, file: TFile): boolean {
  if (!file.path || file.extension !== 'md') {
    return true;
  }

  // 外部ファイルも仮想 TFile として vault に登録されることがある。
  // file: URI・絶対パス・親への参照は vault 相対パスではないため除外する。
  if (NON_VAULT_PATH.test(file.path) || file.path.split(/[/\\]/).includes('..')) {
    return true;
  }
  if (file.vault !== vault || vault.getAbstractFileByPath(file.path) !== file) {
    return true;
  }

  // Canvas files are created as 'Canvas.md',
  // so the plugin will update "frontmatter" and break the file when it gets created
  if (file.name === 'Canvas.md') {
    return true;
  }

  // Temporary files created by Obsidian start with "Untitled"
  return file.name.startsWith('Untitled');
}
