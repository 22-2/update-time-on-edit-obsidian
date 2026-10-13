import { getFrontMatterInfo, MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import {
  DEFAULT_SETTINGS,
  type UpdateTimeOnEditSettings,
  UpdateTimeOnEditSettingsTab,
} from './Settings';
import { applyTimestamps, type FrontMatter } from './frontmatter';
import {
  getActiveFile,
  hashBody,
  isExcalidrawFile,
  isPathIgnored,
  normalizeIgnoreFolders,
} from './utils';

interface FileChangeResult {
  status: 'ok' | 'error' | 'ignored';
  error?: unknown;
}

// 旧版が data.json に保存していた項目。ハッシュは今はメモリにだけ持ち、照合は常に有効なので、読み込み時に捨てる
const LEGACY_KEYS = ['fileHashMap', 'enableExperimentalHash'] as const;
type LoadedData = Partial<UpdateTimeOnEditSettings> & Partial<Record<(typeof LEGACY_KEYS)[number], unknown>>;

class UpdateCancelledError extends Error {}

/**
 * 更新日時を書き込む条件が複雑な理由（設計メモ）
 *
 * 目的は「開いているファイルの本文を、この端末のユーザーが編集した時だけ updated を書く」こと。
 * 次の事実のため、単一のイベントでは判別できず、複数の層を重ねている。
 *
 * 1. トリガーを editor-change にしても外部編集を区別できない（Obsidian 1.14.4 で実測）
 *    - 開いているファイルを外部から書き換えると、modify の約7ms後に editor-change も発火する
 *    - 自分の processFrontMatter の書き込みでも、modify と editor-change が発火する（自己発火）
 *    - 開いていないファイルの外部編集は modify だけが発火する
 *    - 公式ドキュメントに editor-change の発火条件の記載は無い。
 *      alangrainger/obsidian-frontmatter-modified-date が別途「typing events」モード
 *      （CodeMirror でユーザー入力だけを拾う）を持つのも同じ理由と思われる
 *    → 「ユーザー入力があったか」は DOM の beforeinput / keydown で別に追跡する
 *      （setupUserInputTracking。貼り付けも beforeinput で拾える）
 *
 * 2. 同期クライアントはファイルの mtime や改行コードだけを変えることがある
 *    - modify は内容が変わらなくても発火し、複数端末で更新日時を書き合う往復が起きる
 *      （upstream の issue #78・#80）。他のプラグインも内容ハッシュ（Frontmatter Date Manager）や
 *      前回更新からの最小間隔（alangrainger 版は30秒）で対処している
 *    → 本文のハッシュを基準として持ち、開いた時点から本文が変わっていなければ更新しない。
 *      外部編集の後は基準を新しい本文に合わせる（でないと、その後のプロパティだけの編集で更新される）
 *
 * 3. 入力中に processFrontMatter で書くと、Obsidian が「modified externally, merging changes」を出し、
 *    直前の入力が消えることがある（upstream #87、alangrainger 版 #32・#59。プラグイン側では直せない）
 *    → 入力が止まるまで待つ（DEBOUNCE_DELAY_MS・EDIT_IDLE_DELAY_MS）。実行直前にも条件を再確認する
 *
 * 4. 非フォーカスのウィンドウやポップアウトでの編集、vault 外の仮想ファイルも modify を起こす
 *    → 対象タブ自身の document でフォーカスを確認し、isInvalidFile で vault 外のパスを除外する
 *
 * 簡素化を検討する時は、上の実測（特に1）が今のバージョンでも成り立つかを先に確かめること。
 */
export default class UpdateTimeOnEditPlugin extends Plugin {
  declare settings: UpdateTimeOnEditSettings;
  private readonly DEBOUNCE_DELAY_MS = 3000;
  private readonly EDIT_IDLE_DELAY_MS = 1500;
  private readonly USER_INPUT_WINDOW_MS = 10000;
  private lastUserInputAt = 0;
  // 更新できるのはアクティブなファイルだけなので、予約も常に1件でよい
  // （別のファイルへ移ると、元の予約は実行時の確認で捨てられる）
  private pendingUpdateTimer: number | undefined;
  // パス → 本文のハッシュ。「この端末のユーザーが書いたものではない、最後に確認した本文」を表す。
  // 起動をまたいで残す必要が無く、保存すると同期の競合の原因になるため、メモリにだけ持つ。
  private readonly baselineHashes = new Map<string, string>();

  async onload(): Promise<void> {
    await this.loadSettings();
    this.log('loading plugin');

    this.setupEventHandlers();
    this.addSettingTab(new UpdateTimeOnEditSettingsTab(this.app, this));
  }

  onunload(): void {
    this.log('unloading Update time on edit plugin');
    this.clearPendingUpdate();
  }

  // ==================== Settings ====================

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as LoadedData | null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
    const legacyKeys = LEGACY_KEYS.filter((key) => loaded && key in loaded);
    if (legacyKeys.length > 0) {
      for (const key of legacyKeys) {
        delete (this.settings as LoadedData)[key];
      }
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // ==================== Event Handlers ====================

  private setupEventHandlers(): void {
    this.log('Setup handler');
    this.setupUserInputTracking();
    this.setupModifyHandler();
    this.setupFileOpenHandler();
    this.setupRenameHandler();
    this.setupDeleteHandler();
  }

  private setupModifyHandler(): void {
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (!(file instanceof TFile) || this.isInvalidFile(file)) {
          return;
        }
        // 外部（同期・AIなど）からの編集は、更新日時の対象にせず基準だけを新しい本文に合わせる。
        // 合わせないと、その後のプロパティだけの編集で更新されてしまう。
        if (!this.hasRecentUserInput()) {
          void this.refreshBaselineIfTracked(file);
          return;
        }
        if (!this.isValidActiveFile(file)) {
          return;
        }
        this.log('TRIGGER FROM MODIFY');
        this.scheduleIdleUpdate(file);
      }),
    );
  }

  private setupFileOpenHandler(): void {
    this.registerEvent(
      this.app.workspace.on('file-open', (file) => {
        if (file) {
          void this.ensureBaseline(file);
        }
      }),
    );
  }

  /**
   * 基準が無いファイルは、開いた時点の内容を基準として記録する。
   * 記録が無いと、未編集でも最初の保存で必ず更新対象になってしまうため。
   */
  private async ensureBaseline(file: TFile): Promise<void> {
    if (this.isInvalidFile(file) || this.baselineHashes.has(file.path)) {
      return;
    }
    await this.recordBaseline(file);
  }

  private async refreshBaselineIfTracked(file: TFile): Promise<void> {
    if (this.baselineHashes.has(file.path)) {
      await this.recordBaseline(file);
    }
  }

  private setupRenameHandler(): void {
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.moveBaseline(oldPath, file.path);
      }),
    );
  }

  private setupDeleteHandler(): void {
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.baselineHashes.delete(file.path);
      }),
    );
  }

  // ==================== File Guards ====================

  // activeDocument は設定などの別ウィンドウを指すことがあるため、
  // アクティブなマークダウンのタブ自身の document を使う（ポップアウトにも対応）
  private getActiveViewDocument(): Document | undefined {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.containerEl.ownerDocument;
  }

  private isValidActiveFile(file: TFile): boolean {
    if (this.isInvalidFile(file)) {
      this.log('not a vault markdown file');
      return false;
    }

    if (!this.getActiveViewDocument()?.hasFocus()) {
      this.log('not focused');
      return false;
    }

    if (getActiveFile(this.app) !== file) {
      this.log('not active file');
      return false;
    }

    // 開いたまま外部（AIなど）から編集された場合は modify だけが発火するので、
    // 直前にユーザー入力がなければ更新しない
    if (!this.hasRecentUserInput()) {
      this.log('no recent user input (external edit?)');
      return false;
    }

    return true;
  }

  private hasRecentUserInput(): boolean {
    return Date.now() - this.lastUserInputAt < this.USER_INPUT_WINDOW_MS;
  }

  private setupUserInputTracking(): void {
    // 外部編集と区別するため、modify の直前にユーザー入力があったかを見る（設計メモ参照）。
    // Obsidian の自動保存は入力の数秒後に走るため、窓は保存遅延より長くする
    const trackDocument = (doc: Document) => {
      const markInput = () => {
        const file = getActiveFile(this.app);
        if (
          doc !== this.getActiveViewDocument() || !doc.hasFocus() || !file ||
          this.isInvalidFile(file)
        ) {
          return;
        }
        this.lastUserInputAt = Date.now();
      };
      this.registerDomEvent(doc, 'beforeinput', markInput, true);
      this.registerDomEvent(doc, 'keydown', markInput, true);
    };

    trackDocument(document);
    // ポップアウトウィンドウは別の document を持つので、開くたびに追加する
    this.registerEvent(
      this.app.workspace.on('window-open', (_workspaceWindow, win) => {
        trackDocument(win.document);
      }),
    );
  }

  // 入力が途切れて間もない間は、まだ編集中として書き込みを延期する
  private isUserTyping(): boolean {
    return Date.now() - this.lastUserInputAt < this.EDIT_IDLE_DELAY_MS;
  }

  private clearPendingUpdate(): void {
    window.clearTimeout(this.pendingUpdateTimer);
    this.pendingUpdateTimer = undefined;
  }

  private scheduleIdleUpdate(file: TFile): void {
    this.clearPendingUpdate();

    this.pendingUpdateTimer = window.setTimeout(() => {
      this.pendingUpdateTimer = undefined;

      if (this.isUserTyping()) {
        this.log('EDITING IN PROGRESS, DELAYING UPDATE');
        this.scheduleIdleUpdate(file);
        return;
      }

      // 予約から実行までの間にフォーカスやアクティブファイルが変わることがあるため、
      // 実行時にも再確認する
      if (!this.isValidActiveFile(file)) {
        this.log('CONDITIONS CHANGED, CANCEL UPDATE');
        return;
      }

      void this.handleFileChange(file);
    }, this.DEBOUNCE_DELAY_MS);
  }

  // ==================== File Filtering ====================

  // 読み込みの要らない判定を先に行い、無視するファイルの本文は読まない
  async shouldFileBeIgnored(file: TFile): Promise<boolean> {
    if (this.isInvalidFile(file) || isExcalidrawFile(file)) {
      return true;
    }
    if (this.isPathInIgnoredFolder(file.path)) {
      return true;
    }

    const fileContent = await this.getFileContent(file);
    if (!fileContent) {
      return true;
    }

    return this.isFileUnchanged(file, fileContent);
  }

  private isInvalidFile(file: TFile): boolean {
    if (!file.path || file.extension !== 'md') {
      return true;
    }

    // 外部ファイルも仮想 TFile として vault に登録されることがある。
    // file: URI・絶対パス・親への参照は vault 相対パスではないため除外する。
    if (
      /^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(file.path) ||
      file.path.split(/[/\\]/).includes('..')
    ) {
      return true;
    }
    if (
      file.vault !== this.app.vault ||
      this.app.vault.getAbstractFileByPath(file.path) !== file
    ) {
      return true;
    }

    // Canvas files are created as 'Canvas.md',
    // so the plugin will update "frontmatter" and break the file when it gets created
    if (file.name === 'Canvas.md') {
      return true;
    }

    // Temporary files created by Obsidian start with "Untitled"
    if (file.name.startsWith("Untitled")) {
      return true;
    }

    return false;
  }

  private async getFileContent(file: TFile): Promise<string | null> {
    try {
      const content = (await this.app.vault.read(file)).trim();
      return content.length === 0 ? null : content;
    } catch {
      return null;
    }
  }

  private isFileUnchanged(file: TFile, fileContent: string): boolean {
    const baselineHash = this.baselineHashes.get(file.path);
    if (!baselineHash) {
      return false;
    }

    if (hashBody(fileContent) === baselineHash) {
      this.log('Ignoring file because, sha same');
      return true;
    }

    return false;
  }

  private isPathInIgnoredFolder(path: string): boolean {
    const ignorePatterns = normalizeIgnoreFolders(this.settings.ignoreGlobalFolder);
    return isPathIgnored(path, ignorePatterns);
  }

  private shouldIgnoreCreated(path: string): boolean {
    return !this.settings.enableCreateTime || this.isPathInIgnoredFolder(path);
  }

  // ==================== File Processing ====================

  async handleFileChange(file: TFile): Promise<FileChangeResult> {
    // 読み取りの間に条件が変わっても、書き込み直前に processFrontMatter 内で再確認する
    if (!this.isValidActiveFile(file)) {
      return { status: 'ignored' };
    }

    if (await this.shouldFileBeIgnored(file)) {
      return { status: 'ignored' };
    }

    try {
      if (!(await this.updateFileFrontmatter(file))) {
        return { status: 'ignored' };
      }
      await this.recordBaseline(file);
      return { status: 'ok' };
    } catch (e: unknown) {
      if (e instanceof UpdateCancelledError) {
        return { status: 'ignored' };
      }
      return this.handleProcessingError(e, file);
    }
  }

  // 書き込んだ時だけ true。スキップした時に基準を進めると、その編集が更新日時に反映されなくなる
  private async updateFileFrontmatter(file: TFile): Promise<boolean> {
    if (this.shouldSkipWhenCursorInFrontmatter(file)) {
      return false;
    }

    await this.app.fileManager.processFrontMatter(
      file,
      (frontmatter) => {
        // processFrontMatter 内の非同期読み取り後にも書き込み条件を確認する。
        if (!this.isValidActiveFile(file)) {
          // コールバックを抜けるだけでは再保存され得るため、処理自体を中断する。
          throw new UpdateCancelledError();
        }
        // Obsidian はフロントマターを常にオブジェクトとして渡す
        this.updateFrontmatterFields(frontmatter as FrontMatter, file);
      },
      { ctime: file.stat.ctime, mtime: file.stat.mtime },
    );
    return true;
  }

  private shouldSkipWhenCursorInFrontmatter(file: TFile): boolean {
    if (!this.settings.skipFrontmatterWhenCursorInFrontmatter) {
      return false;
    }
    if (getActiveFile(this.app)?.path !== file.path) {
      return false;
    }
    const editor = this.app.workspace.activeEditor?.editor;
    if (!editor) {
      return false;
    }

    // metadataCache の位置は入力中に古い値を返し得るため、エディターの今の内容から判定する
    const { exists, contentStart } = getFrontMatterInfo(editor.getValue());
    const cursorOffset = editor.posToOffset(editor.getCursor());
    if (exists && cursorOffset < contentStart) {
      this.log('Skipping frontmatter update because cursor is in frontmatter area');
      return true;
    }

    return false;
  }

  private updateFrontmatterFields(frontmatter: FrontMatter, file: TFile): void {
    this.log('current metadata: ', frontmatter);
    this.log('current stat: ', file.stat);

    const result = applyTimestamps(frontmatter, file.stat, {
      dateFormat: this.settings.dateFormat,
      headerCreated: this.settings.headerCreated,
      headerUpdated: this.settings.headerUpdated,
      minMinutesBetweenSaves: this.settings.minMinutesBetweenSaves,
      addCreated: !this.shouldIgnoreCreated(file.path),
    });
    this.log('timestamps:', result);
  }

  private handleProcessingError(error: unknown, file: TFile): FileChangeResult {
    if (error instanceof Error && error.name === 'YAMLParseError') {
      const errorMessage = `Update time on edit failed
Malformed frontmatter on this file: ${file.path}

${error.message}`;
      new Notice(errorMessage, 4000);
      console.error(errorMessage);
    }
    return { status: 'error', error };
  }

  // ==================== Baseline Management ====================

  private async recordBaseline(file: TFile): Promise<void> {
    const fileContent = await this.getFileContent(file);
    if (!fileContent) {
      return;
    }

    this.baselineHashes.set(file.path, hashBody(fileContent));
  }

  // フォルダの改名では子ファイルの基準が残らないが、次に開いた時に作り直されるので問題ない
  private moveBaseline(oldPath: string, newPath: string): void {
    const hash = this.baselineHashes.get(oldPath);
    if (!hash) {
      return;
    }

    this.baselineHashes.set(newPath, hash);
    this.baselineHashes.delete(oldPath);
  }

  // ==================== Utilities ====================

  private log(...data: unknown[]): void {
    if (!this.settings.debugLogging) {
      return;
    }
    console.debug('[UTOE]:', ...data);
  }
}
