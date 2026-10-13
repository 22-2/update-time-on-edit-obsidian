import type { Plugin } from 'obsidian';

interface UserInputTrackerOptions {
  // 最後の入力から、この時間内なら「ユーザーの入力があった」と見なす。
  // Obsidian の自動保存は入力の数秒後に走るため、保存遅延より長くする
  windowMs: number;
  // 最後の入力から、この時間内なら「まだ入力中」と見なす
  idleMs: number;
  // 入力を記録してよい document か（フォーカスのあるアクティブなタブの document か、など）
  shouldRecord: (doc: Document) => boolean;
}

/**
 * ユーザーが実際に入力したかを追跡する。
 * editor-change や modify は、外部編集や自分の書き込みでも発火して区別できないため、
 * DOM の入力イベントで別に見る（設計メモは main.ts を参照）。
 */
export class UserInputTracker {
  private lastInputAt = 0;
  // テストが待機時間を短縮できるよう、公開フィールドにしている
  windowMs: number;
  idleMs: number;
  private readonly shouldRecord: (doc: Document) => boolean;

  constructor(options: UserInputTrackerOptions) {
    this.windowMs = options.windowMs;
    this.idleMs = options.idleMs;
    this.shouldRecord = options.shouldRecord;
  }

  start(plugin: Plugin): void {
    this.track(plugin, document);
    // ポップアウトウィンドウは別の document を持つので、開くたびに追加する
    plugin.registerEvent(
      plugin.app.workspace.on('window-open', (_workspaceWindow, win) => {
        this.track(plugin, win.document);
      }),
    );
  }

  hasRecentInput(): boolean {
    return Date.now() - this.lastInputAt < this.windowMs;
  }

  // 入力が途切れて間もない間は、まだ編集中として扱う
  isTyping(): boolean {
    return Date.now() - this.lastInputAt < this.idleMs;
  }

  private track(plugin: Plugin, doc: Document): void {
    const markInput = () => {
      if (this.shouldRecord(doc)) {
        this.lastInputAt = Date.now();
      }
    };
    plugin.registerDomEvent(doc, 'beforeinput', markInput, true);
    plugin.registerDomEvent(doc, 'keydown', markInput, true);
  }
}
