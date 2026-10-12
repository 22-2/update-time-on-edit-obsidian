import type { App } from 'obsidian';

// Obsidian の実体はアプリ内にしかないため、テストではイベント登録を記録する。
export const domHandlers: { target: unknown; type: string; handler: () => void }[] = [];

export class Plugin {
  constructor(public app: App) {}
  registerEvent() {}
  registerDomEvent(target: unknown, type: string, handler: () => void) {
    domHandlers.push({ target, type, handler });
  }
  addSettingTab() {}
  async loadData() {
    return null;
  }
  async saveData() {}
}

// 実体は Obsidian 内にあるため、先頭のフロントマターを正規表現で見つける簡易版で代用する
export function getFrontMatterInfo(content: string) {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) {
    return { exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0 };
  }
  return {
    exists: true,
    frontmatter: match[1],
    from: content.indexOf('\n') + 1,
    to: content.indexOf('\n') + 1 + match[1].length,
    contentStart: match[0].length,
  };
}

export class Notice {}
export class TFile {}
export class MarkdownView {}

// テストごとに vi.stubGlobal('moment', ...) で差し替えられるよう、呼び出し時に解決する
type MomentLike = (...args: unknown[]) => unknown;
export const moment = (...args: unknown[]) => (globalThis as unknown as { moment: MomentLike }).moment(...args);
