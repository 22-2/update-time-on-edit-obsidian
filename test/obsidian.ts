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

export class Notice {}
export const debounce = (callback: () => void) => callback;
